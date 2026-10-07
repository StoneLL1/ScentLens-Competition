import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordRepository, type ReadingRepository } from '../../src/data/RecordRepository'
import { createReading, type DevelopmentText, type DeviceSample } from '../../src/domain/reading'
import { CaptureCoordinator } from '../../src/services/CaptureCoordinator'
import { MockDeviceAdapter } from '../../src/services/MockDeviceAdapter'
import type { GenerationAdapter } from '../../src/services/MockGenerationAdapter'
import type { ArtworkSubmission, Generation } from '../../src/domain/artwork'
import { demoPresets, createDemoReading } from '../../src/domain/demo'
import { profileStats } from '../../src/domain/library'
import { diagnostics } from '../../src/services/diagnostics'

const sample = (session = 'session'): DeviceSample => ({ captureSessionId: session, source: 'mock', rawScores: [.01,.02,.03,.04,.05,.06,.07,.08], rawScale: '0-1', resultValid: true, preview: false, quality: 'unknown' })
const text: DevelopmentText = { title: '测试文字', description: '固定测试文字', keywords: ['青草'], origin: 'mock', completedAt: '2026-10-02T00:00:00Z' }
class ManualGenerator implements GenerationAdapter {
  starts = 0
  images = 0
  resolveText!: (value: DevelopmentText) => void
  resolveImage!: (value: string) => void
  interpret() { this.starts++; return new Promise<DevelopmentText>(resolve => { this.resolveText = resolve }) }
  image() { this.images++; return new Promise<string>(resolve => { this.resolveImage = resolve }) }
}
const repos: RecordRepository[] = []
const coordinators: CaptureCoordinator[] = []
function setup(decorate?: (repo: RecordRepository) => ReadingRepository, budget?: number) {
  const repo = new RecordRepository(`test-${crypto.randomUUID()}`)
  repos.push(repo)
  const device = new MockDeviceAdapter()
  device.delayMs = null
  const generator = new ManualGenerator()
  const coordinator = new CaptureCoordinator(decorate?.(repo) ?? repo, device, generator, budget)
  coordinators.push(coordinator)
  return { repo, device, generator, coordinator }
}
afterEach(async () => { coordinators.splice(0).forEach(coordinator => coordinator.stop()); vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(repos.splice(0).map(repo => repo.db.delete())) })

describe('saved Reading repository', () => {
  it('deduplicates concurrent completions, survives reopening, and preserves separate equal-score sessions', async () => {
    const { repo } = setup()
    const reading = createReading(sample())
    const [first, duplicate] = await Promise.all([repo.save(reading), repo.save(createReading(sample()))])
    expect(duplicate.id).toBe(first.id)
    repo.db.close()
    await repo.db.open()
    expect((await repo.get(first.id))?.rawScores).toEqual(sample().rawScores)
    const second = await repo.save(createReading(sample('second'), new Date(Date.now() + 1000)))
    expect(second.id).not.toBe(first.id)
    expect((await repo.latest())?.id).toBe(second.id)
  })
})

describe('one foreground capture', () => {
  it('TASK-08 Demo persists a traceable preset through the coordinator, never touches BLE and rejects a double start', async () => {
    const { coordinator, repo, generator, device } = setup()
    const start = vi.spyOn(device, 'start'), stop = vi.spyOn(device, 'stop')
    expect(coordinator.startDemo('garden')).toBe(true)
    expect(coordinator.startDemo('woods')).toBe(false)
    await vi.waitFor(() => expect(generator.starts).toBe(1))
    const saved = (await repo.latest())!
    expect(saved.source).toBe('demo'); expect(saved.rawScores).toEqual(demoPresets[0].scores)
    expect(saved.deviceMetadata).toMatchObject({ demoPreset: 'garden', demoPresetVersion: '1' })
    expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled()
    expect(profileStats(await repo.library())).toEqual({ readings: 0, perfumes: 0 })
    await repo.archive(saved.id, { name: 'Demo 收藏' })
    const real = await repo.save(createReading({ ...sample('real'), source: 'device' }))
    await repo.setFallback(real.id, { origin: 'preset_fallback', resourceKey: 'neutral' })
    await repo.save(createReading(sample('mock')))
    expect(profileStats(await repo.library())).toEqual({ readings: 1, perfumes: 1 })
    await repo.deleteReading(real.id)
    expect(profileStats(await repo.library()).readings).toBe(0)
    expect(Object.values(createDemoReading('quiet').scores100)).toEqual(Array(8).fill(0))
    expect(() => createDemoReading('unknown')).toThrow('演示预设不存在')
  })
  it('TASK-08 Demo save failure retries the identical Reading without starting generation early', async () => {
    let fail = true
    const { coordinator, repo, generator } = setup(repo => ({
      save: async r => { if (fail) { fail = false; throw new Error('full') }; return repo.save(r) },
      get: id => repo.get(id), latest: () => repo.latest(), saveDevelopmentText: (...args) => repo.saveDevelopmentText(...args),
    }))
    coordinator.startDemo('woods')
    const id = coordinator.getSnapshot().sessionId
    await vi.waitFor(() => expect(coordinator.getSnapshot().phase).toBe('save-failed'))
    expect(generator.starts).toBe(0)
    await coordinator.retrySave()
    expect((await repo.latest())?.captureSessionId).toBe(id); expect(generator.starts).toBe(1)
  })
  it('TASK-08 clearing invalidates unsaved passive readings and late generation; logs are bounded and omit arbitrary content', async () => {
    const { coordinator, repo, generator } = setup()
    repo.onReadingDeleted(id => coordinator.readingDeleted(id))
    coordinator.startDemo('garden'); await vi.waitFor(() => expect(generator.starts).toBe(1))
    await repo.clearAll(); generator.resolveText(text)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await repo.latest()).toBeUndefined(); expect(generator.images).toBe(0)
    expect(coordinator.getSnapshot().preview).toBeUndefined()
    diagnostics.clear()
    for (let i = 0; i < 45; i++) diagnostics.record('api', { recordId: 'Bearer secret https://key', attemptId: 'valid-id' })
    expect(diagnostics.getSnapshot()).toHaveLength(40)
    expect(JSON.stringify(diagnostics.getSnapshot())).not.toContain('secret')
    expect(diagnostics.getSnapshot()[0].attemptId).toBe('valid-id')
    diagnostics.clear()
  })
  it('retains received bytes for save-only retry after timeout during the file stage', async () => {
    const { repo, device, generator } = setup()
    const reading = await repo.save(createReading(sample()))
    vi.stubGlobal('fetch', async () => new Response(new Blob(['received image bytes'])))
    let release!: () => void, received!: () => void, calls = 0
    const started = new Promise<void>(resolve => { received = resolve }), paused = new Promise<void>(resolve => { release = resolve })
    const inputs: ArtworkSubmission[] = []
    const saver = async (input: ArtworkSubmission) => {
      inputs.push(input); calls++
      if (calls === 1) { received(); await paused }
      if (!input.canCommit()) throw new Error('attempt ended')
      return { id: input.generationId } as Generation
    }
    const c = new CaptureCoordinator(repo, device, generator, 60_000, saver); coordinators.push(c)
    const running = c.beginPreview(reading); generator.resolveText(text)
    await vi.waitFor(() => expect(generator.images).toBe(1)); generator.resolveImage('test.png'); await started
    c.stopPreview('timeout'); release(); await running
    expect(c.getSnapshot().preview).toMatchObject({ phase: 'timeout', canRetrySave: true })
    await c.retryArtworkSave()
    expect(c.getSnapshot().preview).toMatchObject({ phase: 'ready', canRetrySave: false })
    expect(generator.images).toBe(1); expect(inputs[0].blob).toBe(inputs[1].blob); expect(inputs[0].generationId).toBe(inputs[1].generationId)
  })
  it('rejects invalid data and previews without saving or starting generation', async () => {
    for (const patch of [{ rawScores: [0] }, { rawScores: [2,0,0,0,0,0,0,0] }, { preview: true }, { resultValid: false }]) {
      const { repo, coordinator, generator } = setup()
      coordinator.start()
      await coordinator.accept({ ...sample(coordinator.getSnapshot().sessionId), ...patch })
      expect(coordinator.getSnapshot().phase).toBe('invalid')
      expect(await repo.latest()).toBeUndefined()
      expect(generator.starts).toBe(0)
    }
  })
  it('retries only the failed first save, retaining the same data and starting generation once', async () => {
    let fail = true
    const { coordinator, repo, generator } = setup(repo => ({
      save: async reading => { if (fail) { fail = false; throw new Error('full') }; return repo.save(reading) },
      get: id => repo.get(id), latest: () => repo.latest(), saveDevelopmentText: (...args) => repo.saveDevelopmentText(...args),
    }))
    coordinator.start()
    const input = sample(coordinator.getSnapshot().sessionId)
    await coordinator.accept(input)
    expect(coordinator.getSnapshot().phase).toBe('save-failed')
    expect(await repo.latest()).toBeUndefined()
    expect(generator.starts).toBe(0)
    await Promise.all([coordinator.retrySave(), coordinator.retrySave(), coordinator.accept(input)])
    expect((await repo.latest())?.rawScores).toEqual(input.rawScores)
    expect(generator.starts).toBe(1)
  })
  it('keeps one attempt and its deadline through result/detail navigation, then preserves text on interruption', async () => {
    const { coordinator, repo, generator } = setup()
    coordinator.start()
    const input = sample(coordinator.getSnapshot().sessionId)
    await Promise.all([coordinator.accept(input), coordinator.accept(input)])
    const state = coordinator.getSnapshot()
    const id = state.recordId!
    expect(await repo.get(id)).toBeDefined()
    expect(generator.starts).toBe(1)
    expect(coordinator.start()).toBe(false)
    coordinator.routeChanged(`/result/${id}`)
    coordinator.routeChanged(`/scent/${id}`)
    expect(coordinator.getSnapshot().preview).toEqual(state.preview)
    generator.resolveText(text)
    await vi.waitFor(() => expect(generator.images).toBe(1))
    expect((await repo.get(id))?.developmentText).toEqual(text)
    coordinator.routeChanged('/home')
    generator.resolveImage('late.png')
    await Promise.resolve()
    expect(coordinator.getSnapshot().preview?.phase).toBe('interrupted')
    expect(coordinator.getSnapshot().preview?.imageUrl).toBeUndefined()
    expect(await repo.get(id)).toBeDefined()
  })
  it('saves all-zero input and ignores old-session events after cancellation', async () => {
    const { coordinator, repo, generator } = setup()
    coordinator.start()
    const old = sample(coordinator.getSnapshot().sessionId)
    coordinator.stop()
    coordinator.start()
    await coordinator.accept(old)
    expect(await repo.latest()).toBeUndefined()
    await coordinator.accept({ ...sample(coordinator.getSnapshot().sessionId), rawScores: Array(8).fill(0) })
    expect(Object.values((await repo.latest())!.scores100)).toEqual(Array(8).fill(0))
    expect(generator.starts).toBe(1)
  })
  it('does not navigate or generate when a valid save completes after cancellation', async () => {
    let commit!: () => void
    const { coordinator, generator, repo } = setup(repo => ({
      save: reading => new Promise(resolve => { commit = async () => resolve(await repo.save(reading)) }),
      get: id => repo.get(id), latest: () => repo.latest(), saveDevelopmentText: (...args) => repo.saveDevelopmentText(...args),
    }))
    coordinator.start()
    const saving = coordinator.accept(sample(coordinator.getSnapshot().sessionId))
    coordinator.stop()
    commit()
    await saving
    expect(await repo.latest()).toBeDefined()
    expect(coordinator.getSnapshot().phase).toBe('cancelled')
    expect(generator.starts).toBe(0)
  })
  it('uses one 120-second budget and rejects late text', async () => {
    const { coordinator, repo, generator } = setup()
    coordinator.start()
    await coordinator.accept(sample(coordinator.getSnapshot().sessionId))
    const attempt = coordinator.getSnapshot().preview!
    expect(attempt.deadline - attempt.startedAt).toBe(120_000)
    coordinator.stopPreview()
    const reading = (await repo.latest())!
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const restarting = coordinator.beginPreview(reading)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(coordinator.getSnapshot().preview?.phase).toBe('timeout')
    generator.resolveText(text)
    await restarting
    vi.useRealTimers()
    expect(generator.images).toBe(0)
    expect((await repo.latest())?.developmentText).toBeUndefined()
  })
})

describe('Pocket foreground and passive ownership', () => {
  it('keeps a busy archived generation unchanged while another confirmed device session saves unarchived', async () => {
    const { repo, coordinator, generator } = setup()
    const initial = await repo.save(createReading(sample('existing')))
    const perfume = await repo.archive(initial.id, { name: '原档案' })
    coordinator.start(perfume.id)
    await coordinator.accept(sample(coordinator.getSnapshot().sessionId))
    const foreground = coordinator.getSnapshot()
    expect(coordinator.adoptHardware('hardware-next')).toBe(false)
    await coordinator.acceptPassive({ ...sample('hardware-next'), source: 'device' })
    const readings = (await repo.library()).readings
    expect(readings).toHaveLength(3)
    expect(readings.find(r => r.captureSessionId === 'hardware-next')?.perfumeId).toBeUndefined()
    expect(readings.find(r => r.id === foreground.recordId)?.perfumeId).toBe(perfume.id)
    expect(coordinator.getSnapshot().recordId).toBe(foreground.recordId)
    expect(coordinator.getSnapshot().preview).toEqual(foreground.preview)
    expect(generator.starts).toBe(1)
  })
  it('retries passive persistence without generating or replacing the current record', async () => {
    let fail = true
    const { coordinator, repo, generator } = setup(repo => ({
      save: async reading => { if (fail) throw new Error('full'); return repo.save(reading) },
      get: id => repo.get(id), latest: () => repo.latest(), saveDevelopmentText: (...args) => repo.saveDevelopmentText(...args),
    }))
    await coordinator.acceptPassive({ ...sample('passive-failed'), source: 'device' })
    expect(coordinator.getSnapshot().passiveSaveFailed).toBe(true)
    fail = false; await coordinator.retryPassiveSave()
    expect((await repo.library()).readings.length).toBe(1)
    expect(generator.starts).toBe(0); expect(coordinator.getSnapshot().recordId).toBeUndefined()
  })
  it('preserves STOP uncertainty until explicitly recovered and prevents overlapping phone work', async () => {
    const { repo, generator } = setup()
    let reject!: () => void
    const device = { waitsForSampling: true, start: vi.fn(), stop: () => new Promise<void>((_, no) => { reject = () => no(new Error('timeout')) }) }
    const c = new CaptureCoordinator(repo, device, generator); coordinators.push(c)
    c.start(); expect(c.getSnapshot().phase).toBe('starting')
    const stopping = c.cancelReading(); expect(c.getSnapshot().phase).toBe('cancelling'); expect(c.start()).toBe(false)
    reject(); expect(await stopping).toBe(false); expect(c.getSnapshot().phase).toBe('stop-unknown'); expect(c.start()).toBe(false)
    c.acknowledgeDeviceRecovery(); expect(c.getSnapshot().phase).toBe('cancelled')
  })
  it('real input in a BLE validation build persists with no automatic or manual generation', async () => {
    const { repo, device, generator } = setup()
    const c = new CaptureCoordinator(repo, device, generator, 60_000, undefined, false); coordinators.push(c)
    c.adoptHardware('real-validation'); await c.accept({ ...sample('real-validation'), source: 'device' })
    const r = (await repo.latest())!; await c.beginPreview(r)
    expect(r.source).toBe('device'); expect(generator.starts).toBe(0)
  })
})
