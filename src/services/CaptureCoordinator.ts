import { createReading, type DeviceSample, type Reading } from '../domain/reading'
import type { ReadingRepository } from '../data/RecordRepository'
import type { DeviceAdapter } from './DeviceAdapter'
import type { GenerationAdapter } from './MockGenerationAdapter'
import type { ArtworkSubmission, Generation } from '../domain/artwork'
import { GENERATION_BUDGET_MS, GenerationFailure, type CloudAttempt, type CloudInterpretation } from '../../shared/generation'
import { chooseFallback } from '../domain/fallback'
import { createDemoReading } from '../domain/demo'
import { diagnostics } from './diagnostics'

type CapturePhase = 'starting' | 'cancelling' | 'stop-unknown' | 'idle' | 'reading' | 'saving' | 'save-failed' | 'invalid' | 'cancelled' | 'saved'
export interface PreviewAttempt {
  recordId: string
  attemptId: string
  startedAt: number
  deadline: number
  phase: CloudAttempt['phase']
  imageUrl?: string
  error?: string
  canRetrySave?: boolean
  errorCode?: string
}
export interface CaptureState {
  phase: CapturePhase
  sessionId?: string
  recordId?: string
  error?: string
  preview?: PreviewAttempt
  passiveNotice?: string
  passiveSaveFailed?: boolean
  inputSource?: DeviceSample['source']
}

export class CaptureCoordinator {
  private state: CaptureState = { phase: 'idle' }
  private listeners = new Set<() => void>()
  private pending?: Reading
  private accepting = false
  private abort?: AbortController
  private deadlineTimer?: ReturnType<typeof setTimeout>
  private pendingArtwork?: ArtworkSubmission
  private archiveContext?: string
  private activeCloud?: CloudAttempt
  private stopFlight?: Promise<void>
  private passivePending = new Map<string, Reading>()
  private passiveSaving = new Set<string>()
  constructor(private repo: ReadingRepository, private device: DeviceAdapter, private generator: GenerationAdapter, private budgetMs = GENERATION_BUDGET_MS, private commitArtwork?: (input: ArtworkSubmission) => Promise<Generation>, public readonly generationEnabled = true) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<CaptureState>) {
    if (patch.phase === 'invalid') diagnostics.record('validation', { sessionId: this.state.sessionId })
    if (patch.phase === 'save-failed' || patch.passiveSaveFailed === true) diagnostics.record('save', { sessionId: this.state.sessionId })
    if (patch.preview && patch.preview.phase !== this.state.preview?.phase && ['failed', 'timeout', 'save-failed'].includes(patch.preview.phase)) diagnostics.record(patch.preview.phase === 'save-failed' ? 'save' : 'api', patch.preview)
    this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn())
  }
  isGenerating() { return ['interpreting', 'generating', 'saving-artwork'].includes(this.state.preview?.phase ?? '') }
  isBusy() { return ['starting', 'reading', 'saving', 'save-failed', 'cancelling', 'stop-unknown'].includes(this.state.phase) || this.isGenerating() }

  startDemo(presetId: string) {
    if (this.isBusy()) return false
    this.pending = createDemoReading(presetId)
    this.pendingArtwork = undefined; this.archiveContext = undefined; this.accepting = true
    this.update({ phase: 'saving', sessionId: this.pending.captureSessionId, inputSource: 'demo', recordId: undefined, error: undefined, preview: undefined })
    void this.savePending()
    return true
  }

  start(perfumeId?: string) {
    if (this.isBusy()) return false
    this.pending = undefined
    this.pendingArtwork = undefined
    this.archiveContext = perfumeId
    this.accepting = true
    const sessionId = crypto.randomUUID()
    this.update({ phase: this.device.waitsForSampling ? 'starting' : 'reading', sessionId, inputSource: undefined, recordId: undefined, error: undefined, preview: undefined })
    this.device.start(sessionId, sample => { void this.accept(sample) }, message => this.deviceFailed(sessionId, message), () => {
      if (this.accepting && this.state.sessionId === sessionId) this.update({ phase: 'reading' })
    })
    return true
  }

  async accept(sample: DeviceSample) {
    if (!this.accepting || this.state.phase !== 'reading' || sample.captureSessionId !== this.state.sessionId) return
    try { this.pending = createReading(sample); this.pending.perfumeId = this.archiveContext }
    catch (error) {
      this.accepting = false
      this.releaseDevice()
      this.update({ phase: 'invalid', error: error instanceof Error ? error.message : '八维数据无效' })
      return
    }
    this.releaseDevice()
    await this.savePending()
  }

  private releaseDevice() { if (this.device.release) this.device.release(); else void this.device.stop() }
  deviceFailed(sessionId: string, message: string) {
    if (this.state.sessionId !== sessionId || !['starting', 'reading'].includes(this.state.phase)) return
    this.accepting = false
    diagnostics.record('reading', { sessionId })
    this.update({ phase: 'invalid', error: message })
  }
  adoptHardware(sessionId: string) {
    if (this.isBusy()) return false
    this.pending = undefined; this.pendingArtwork = undefined; this.archiveContext = undefined; this.accepting = true
    this.update({ phase: 'reading', sessionId, inputSource: 'device', recordId: undefined, preview: undefined, error: undefined })
    return true
  }
  async acceptPassive(sample: DeviceSample) {
    if (this.passivePending.has(sample.captureSessionId)) return
    try { this.passivePending.set(sample.captureSessionId, createReading(sample)) }
    catch { this.update({ passiveNotice: '另一轮硬件结果无效，未保存。' }); return }
    await this.savePassive(sample.captureSessionId)
  }
  private async savePassive(id: string) {
    const reading = this.passivePending.get(id)
    if (!reading || this.passiveSaving.has(id)) return
    this.passiveSaving.add(id)
    try {
      await this.repo.save(reading)
      if (this.passivePending.get(id) !== reading) return
      this.passivePending.delete(id)
      this.update({ passiveNotice: '另一轮 Pocket 结果已保存，可稍后从历史查看。', passiveSaveFailed: this.passivePending.size > 0 })
    } catch { if (this.passivePending.get(id) === reading) this.update({ passiveNotice: '另一轮八维已收到，但尚未保存。请重试；关闭 App 会丢失这份未保存数据。', passiveSaveFailed: true }) }
    finally { this.passiveSaving.delete(id) }
  }
  async retryPassiveSave() { for (const id of this.passivePending.keys()) await this.savePassive(id) }
  dismissPassiveNotice() { if (!this.passivePending.size) this.update({ passiveNotice: undefined }) }

  async retrySave() { if (this.state.phase === 'save-failed') await this.savePending() }
  private async savePending() {
    const pending = this.pending
    if (!pending) return
    this.update({ phase: 'saving', error: undefined })
    try {
      const saved = await this.repo.save(pending)
      // Cancellation never rolls back valid data already committed.
      if (!this.accepting || this.state.sessionId !== pending.captureSessionId) return
      this.pending = undefined
      this.accepting = false
      this.update({ phase: 'saved', recordId: saved.id })
      void this.beginPreview(saved)
    } catch {
      if (this.accepting && this.state.sessionId === pending.captureSessionId) this.update({ phase: 'save-failed', error: '八维已收到，但尚未保存到本机。请重试保存；离开后这份未保存数据可能丢失。' })
    }
  }

  async beginPreview(reading: Reading, regenerate = false) {
    if (this.isBusy() || !this.generationEnabled) return
    if (this.generator.kind === 'cloud') return this.beginCloud(reading, regenerate)
    this.pendingArtwork = undefined
    const controller = new AbortController()
    this.abort = controller
    const startedAt = Date.now()
    const attempt: PreviewAttempt = { recordId: reading.id, attemptId: crypto.randomUUID(), startedAt, deadline: startedAt + this.budgetMs, phase: 'interpreting' }
    this.update({ preview: attempt })
    const current = () => !controller.signal.aborted && this.state.preview?.attemptId === attempt.attemptId && Date.now() < attempt.deadline
    this.deadlineTimer = setTimeout(() => this.stopPreview('timeout'), this.budgetMs)
    try {
      const text = reading.developmentText ?? await this.generator.interpret(reading, controller.signal)
      if (!current()) return
      if (!('origin' in text)) throw new Error('Unexpected cloud text in development fixture')
      await this.repo.saveDevelopmentText(reading.id, text, current)
      if (!current()) return
      this.update({ preview: { ...attempt, phase: 'generating' } })
      const imageUrl = await this.generator.image(reading, controller.signal)
      if (!current()) return
      if (typeof imageUrl !== 'string') throw new Error('Unexpected cloud image in development fixture')
      if (this.commitArtwork) {
        const response = await fetch(imageUrl, { signal: controller.signal })
        if (!response.ok) throw new Error('无法读取测试作品')
        const blob = await response.blob()
        if (!current()) return
        this.pendingArtwork = { generationId: crypto.randomUUID(), assetId: crypto.randomUUID(), readingId: reading.id, attemptId: attempt.attemptId, origin: 'development_fixture', text, blob, canCommit: current }
        this.update({ preview: { ...attempt, phase: 'saving-artwork' } })
        try { await this.commitArtwork(this.pendingArtwork) }
        catch (error) {
          if (this.state.preview?.attemptId === attempt.attemptId) {
            clearTimeout(this.deadlineTimer)
            this.update({ preview: { ...this.state.preview, phase: current() ? 'save-failed' : this.state.preview.phase, canRetrySave: true, error: current() && error instanceof Error ? error.message : '等待已结束，收到的图片尚未保存。可重试保存，无需重新生成。' } })
          }
          return
        }
        // A snapshot may finish after the deadline, but its guarded DB commit
        // already succeeded. Do not turn a committed image into a false failure.
        if (this.state.preview?.attemptId !== attempt.attemptId) return
        this.pendingArtwork = undefined
      }
      clearTimeout(this.deadlineTimer)
      this.update({ preview: { ...attempt, phase: 'ready', imageUrl: this.commitArtwork ? undefined : imageUrl } })
    } catch {
      if (current()) this.stopPreview('failed')
    }
  }

  private async beginCloud(reading: Reading, regenerate: boolean) {
    if (!this.repo.beginCloudAttempt || !this.repo.updateCloudAttempt || !this.repo.saveCloudInterpretation || !this.commitArtwork) throw new Error('Cloud generation requires persistent storage')
    this.pendingArtwork = undefined
    this.activeCloud = undefined
    const controller = new AbortController(); this.abort = controller
    const startedAt = Date.now()
    let attempt: CloudAttempt = { recordId: reading.id, attemptId: crypto.randomUUID(), generationId: crypto.randomUUID(), interpretRequestId: crypto.randomUUID(), imageRequestId: crypto.randomUUID(), variantIndex: 0, startedAt, deadline: startedAt + this.budgetMs, phase: 'interpreting' }
    this.update({ preview: attempt })
    const same = () => this.state.preview?.attemptId === attempt.attemptId
    const current = () => same() && !controller.signal.aborted && Date.now() < attempt.deadline
    this.deadlineTimer = setTimeout(() => this.stopPreview('timeout'), this.budgetMs)
    try {
      attempt = await this.repo.beginCloudAttempt(reading.id, attempt, regenerate, current)
      if (!current()) return
      this.activeCloud = attempt
      let interpretation: CloudInterpretation
      if (attempt.interpretation) interpretation = attempt.interpretation
      else {
        const text = await this.generator.interpret(reading, controller.signal, { attempt })
        if (!current()) return
        if ('status' in text) {
          attempt = { ...attempt, phase: 'empty', errorCode: 'EMPTY_RECIPE', error: text.message }
          this.activeCloud = attempt
          await this.repo.updateCloudAttempt(attempt, current)
          if (!current()) return
          clearTimeout(this.deadlineTimer)
          await this.fallback(reading.id, same)
          if (same() && !controller.signal.aborted) this.update({ preview: attempt })
          return
        }
        if (!('cloud' in text)) throw new GenerationFailure('INVALID_RESPONSE', '云端返回了无效来源的文字。')
        interpretation = text
        // Text and its recovery Prompt are committed together before any image call.
        attempt = { ...attempt, interpretation, phase: 'generating' }; this.activeCloud = attempt
        await this.repo.saveCloudInterpretation(attempt, interpretation, current)
        if (!current()) return
      }
      attempt = { ...attempt, interpretation, phase: 'generating' }; this.activeCloud = attempt
      await this.repo.updateCloudAttempt(attempt, current)
      if (!current()) return
      this.update({ preview: attempt })
      const image = await this.generator.image(reading, controller.signal, { attempt, interpretation })
      if (!current()) return
      if (typeof image === 'string') throw new GenerationFailure('INVALID_RESPONSE', '云端未返回可保存的作品。')
      this.pendingArtwork = { readingId: reading.id, attemptId: attempt.attemptId, generationId: attempt.generationId, assetId: crypto.randomUUID(), origin: 'cloud', text: interpretation, blob: image.blob, modelRequested: image.metadata.call.modelRequested, modelActual: image.metadata.call.modelActual, cloudImage: image.metadata, canCommit: current }
      attempt = { ...attempt, phase: 'saving-artwork' }; this.activeCloud = attempt
      this.update({ preview: attempt })
      try { await this.commitArtwork(this.pendingArtwork) }
      catch (e) {
        if (!same()) return
        clearTimeout(this.deadlineTimer)
        const phase = current() ? 'save-failed' : this.state.preview!.phase
        const error = e instanceof Error ? e.message : '作品保存未完成，请重试保存。'
        this.activeCloud = { ...attempt, phase, errorCode: 'LOCAL_SAVE', error }
        await this.persistCloud(same)
        await this.fallback(reading.id, same)
        if (same()) this.update({ preview: { ...this.activeCloud!, canRetrySave: true } })
        return
      }
      if (!same()) return
      this.pendingArtwork = undefined
      clearTimeout(this.deadlineTimer)
      this.activeCloud = { ...attempt, phase: 'ready' }
      this.update({ preview: this.activeCloud })
    } catch (e) {
      if (!current()) return
      const failure = e instanceof GenerationFailure ? e : new GenerationFailure('LOCAL_METADATA', '记录更新未完成，已有八维与作品仍保留。')
      clearTimeout(this.deadlineTimer)
      const phase = failure.code === 'TIMEOUT' ? 'timeout' : 'failed'
      if (this.activeCloud) this.activeCloud = { ...this.activeCloud, phase, errorCode: failure.code, error: failure.message }
      await this.persistCloud(same)
      await this.fallback(reading.id, same)
      if (same() && !controller.signal.aborted) this.update({ preview: { ...attempt, phase, errorCode: failure.code, error: failure.message } })
    }
  }
  private async persistCloud(guard: () => boolean) {
    if (this.activeCloud && this.repo.updateCloudAttempt) {
      try { await this.repo.updateCloudAttempt(this.activeCloud, guard) } catch { /* pending UI remains; no automatic paid retry */ }
    }
  }
  private async fallback(id: string, guard: () => boolean) {
    try { const r = await this.repo.get(id); if (r && !r.selectedGenerationId && guard()) await this.repo.setFallback?.(id, chooseFallback(r.scores100), guard) } catch { /* never replace an existing selected work or resurrect deletion */ }
  }

  async retryArtworkSave() {
    const input = this.pendingArtwork, preview = this.state.preview
    if (!input || !preview || !preview.canRetrySave || !this.commitArtwork) return
    const controller = new AbortController()
    this.abort = controller
    const current = () => !controller.signal.aborted && this.state.preview?.attemptId === preview.attemptId
    this.update({ preview: { ...preview, phase: 'saving-artwork', canRetrySave: false, error: undefined } })
    try {
      await this.commitArtwork({ ...input, canCommit: current })
      if (this.state.preview?.attemptId === preview.attemptId) { this.pendingArtwork = undefined; this.update({ preview: { ...preview, phase: 'ready', canRetrySave: false, error: undefined, errorCode: undefined } }) }
    } catch (error) {
      if (this.state.preview?.attemptId === preview.attemptId) this.update({ preview: { ...preview, phase: 'save-failed', canRetrySave: true, error: error instanceof Error ? error.message : '作品保存未完成，请重试保存。' } })
    }
  }

  readingDeleted(id?: string) {
    if (!id) { this.pending = undefined; this.passivePending.clear(); this.update({ passiveNotice: undefined, passiveSaveFailed: false }); diagnostics.clear() }
    if (!id || this.state.preview?.recordId === id || this.state.recordId === id) {
      this.stop(); this.pendingArtwork = undefined; this.update({ phase: 'idle', preview: undefined, recordId: undefined })
    }
  }

  stopPreview(phase: 'interrupted' | 'timeout' | 'failed' = 'interrupted') {
    clearTimeout(this.deadlineTimer)
    this.abort?.abort()
    if (this.isGenerating() && this.state.preview) {
      this.update({ preview: { ...this.state.preview, phase } })
      if (this.activeCloud) {
        const id = this.activeCloud.attemptId, recordId = this.activeCloud.recordId
        this.activeCloud = { ...this.activeCloud, phase }
        const same = () => this.state.preview?.attemptId === id
        void this.persistCloud(same).then(() => this.fallback(recordId, same))
      }
    }
  }
  stop() {
    this.accepting = false
    this.stopPreview()
    if (this.stopFlight) return
    const active = ['starting', 'reading'].includes(this.state.phase)
    if (active && this.device.waitsForSampling) {
      this.update({ phase: 'cancelling', error: undefined })
      this.stopFlight = Promise.resolve(this.device.stop()).then(() => {
        this.update({ phase: 'cancelled', error: undefined })
      }).catch(() => {
        this.update({ phase: 'stop-unknown', error: '设备尚未确认停止。请查看 Pocket 并刷新状态，不能视为已经停机。' })
      }).finally(() => { this.stopFlight = undefined })
    } else {
      if (active) void this.device.stop()
      if (['starting', 'reading', 'saving', 'save-failed'].includes(this.state.phase)) this.update({ phase: 'cancelled' })
    }
  }
  async cancelReading() { this.stop(); await this.stopFlight; return this.state.phase !== 'stop-unknown' }
  acknowledgeDeviceRecovery() {
    if (this.state.phase === 'stop-unknown' && !this.stopFlight) this.update({ phase: 'cancelled', error: undefined })
  }
  routeChanged(path: string) {
    if (['starting', 'cancelling', 'stop-unknown'].includes(this.state.phase) && (path === '/capture' || path === '/trial' || path === '/device')) return
    if (this.state.phase === 'reading' && path === '/capture') return
    if (['saving', 'save-failed'].includes(this.state.phase) && path === '/capture') return
    const id = this.state.preview?.recordId
    if (id && (path === `/result/${id}` || path === `/scent/${id}` || path === '/capture')) return
    this.stop()
  }
}
