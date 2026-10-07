import Dexie, { type Table } from 'dexie'
import type { DevelopmentText, Reading } from '../domain/reading'
import { StorageFailure, type ArtworkSubmission, type FallbackPresentation, type Generation, type ImageAsset, type Interpretation, type LibraryMeta, type LibrarySnapshot, type Perfume } from '../domain/artwork'
import { platformFileStore, type FileStore } from './FileStore'
import { ImageStore, type ImageProbe } from './ImageStore'
import { SnapshotStore, validateSnapshot } from './snapshot'
import type { CloudAttempt, CloudInterpretation } from '../../shared/generation'
import { diagnostics } from '../services/diagnostics'

export interface ReadingRepository {
  save(reading: Reading): Promise<Reading>
  get(id: string): Promise<Reading | undefined>
  latest(): Promise<Reading | undefined>
  saveDevelopmentText(id: string, text: DevelopmentText, canCommit: () => boolean): Promise<void>
  beginCloudAttempt?(id: string, attempt: CloudAttempt, regenerate: boolean, canCommit: () => boolean): Promise<CloudAttempt>
  updateCloudAttempt?(attempt: CloudAttempt, canCommit: () => boolean): Promise<void>
  saveCloudInterpretation?(attempt: CloudAttempt, text: CloudInterpretation, canCommit: () => boolean): Promise<void>
  setFallback?(id: string, fallback?: FallbackPresentation, canCommit?: () => boolean): Promise<void>
}
export interface RepositoryStatus {
  phase: 'opening' | 'ready' | 'recovery-choice' | 'recovery-blocked' | 'unavailable'
  protection: 'protected' | 'pending'
  message?: string
  missingImages: number
  cleanupPending?: boolean
}
const queues = new Map<string, Promise<unknown>>()

export class RecordRepository implements ReadingRepository {
  readonly db: Dexie
  readonly images: ImageStore
  readonly snapshots: SnapshotStore
  private readonly readings: Table<Reading, string>
  private readonly perfumes: Table<Perfume, string>
  private readonly generations: Table<Generation, string>
  private readonly assets: Table<ImageAsset, string>
  private readonly metadata: Table<LibraryMeta, string>
  private initialized = false
  private status: RepositoryStatus = { phase: 'opening', protection: 'pending', missingImages: 0 }
  private listeners = new Set<() => void>()
  private deleteListeners = new Set<(id?: string) => void>()
  constructor(name = 'scentlens', files: FileStore = platformFileStore(name), probe?: ImageProbe) {
    this.db = new Dexie(name)
    this.db.version(1).stores({ readings: 'id, &captureSessionId, capturedAt, source, perfumeId' })
    this.db.version(2).stores({ readings: 'id, &captureSessionId, capturedAt, source, perfumeId', perfumes: 'id, name', generations: 'id, readingId, &[readingId+attemptId]', assets: 'id', metadata: 'id' })
    this.readings = this.db.table('readings'); this.perfumes = this.db.table('perfumes')
    this.generations = this.db.table('generations'); this.assets = this.db.table('assets'); this.metadata = this.db.table('metadata')
    this.images = new ImageStore(files, probe)
    this.snapshots = new SnapshotStore(files, `com.scentlens.app/${name}/v2`)
  }
  getSnapshot = () => this.status
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  onReadingDeleted(fn: (id?: string) => void) { this.deleteListeners.add(fn); return () => { this.deleteListeners.delete(fn) } }
  private update(patch: Partial<RepositoryStatus>) {
    if (patch.protection === 'pending' && patch.message) diagnostics.record('protection')
    if (patch.phase && ['recovery-choice', 'recovery-blocked', 'unavailable'].includes(patch.phase)) diagnostics.record('recovery')
    this.status = { ...this.status, ...patch }; this.listeners.forEach(fn => fn())
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => typeof navigator !== 'undefined' && navigator.locks ? await navigator.locks.request(`scentlens:${this.db.name}`, work) : await work()
    const promise = (queues.get(this.db.name) ?? Promise.resolve()).then(run, run)
    queues.set(this.db.name, promise.catch(() => {}))
    return promise
  }
  private tables() { return [this.readings, this.perfumes, this.generations, this.assets, this.metadata] }
  private freshMeta(): LibraryMeta {
    return { id: 'library', schemaVersion: 2, namespace: this.snapshots.namespace, installationId: crypto.randomUUID(), revision: 0, commitId: crypto.randomUUID(), explicitlyCleared: false, retiredReadingIds: [], retiredSessionIds: [], retiredGenerationIds: [] }
  }
  private async readLibrary(): Promise<LibrarySnapshot> {
    return this.db.transaction('r', this.tables(), async () => ({ meta: (await this.metadata.get('library')) ?? this.freshMeta(), readings: await this.readings.toArray(), perfumes: await this.perfumes.toArray(), generations: await this.generations.toArray(), assets: await this.assets.toArray() }))
  }
  private async writeLibrary(s: LibrarySnapshot, guard: () => boolean = () => true) {
    await this.db.transaction('rw', this.tables(), async () => {
      if (!guard()) throw new Error('尝试已结束')
      for (const table of this.tables()) await table.clear()
      await this.readings.bulkAdd(s.readings); await this.perfumes.bulkAdd(s.perfumes)
      await this.generations.bulkAdd(s.generations); await this.assets.bulkAdd(s.assets); await this.metadata.put(s.meta)
      if (!guard()) throw new Error('尝试已结束')
    })
  }
  private async protect(s: LibrarySnapshot) {
    try { await this.snapshots.commit(s); this.update({ protection: 'protected', message: undefined }) }
    catch { this.update({ protection: 'pending', message: '内容已写入本地记录，但恢复保护尚未完成。请重试保护；无需重新生成图片。' }) }
  }
  private async persist(s: LibrarySnapshot, guard: () => boolean = () => true) {
    validateSnapshot(s, this.snapshots.namespace)
    if (!guard()) throw new StorageFailure('database', '本次尝试已结束，未提交作品。')
    try {
      s.meta.revision = Math.max(s.meta.revision + 1, await this.snapshots.nextRevision()); s.meta.commitId = crypto.randomUUID()
      await this.snapshots.barrier(s.meta)
    } catch {
      this.update({ protection: 'pending', message: '恢复保护未完成，本次操作未提交。现有内容保留，请重试保护。' })
      throw new StorageFailure('barrier', '本次操作未提交：无法建立恢复保护。请检查空间后重试，现有内容保留。')
    }
    try { await this.writeLibrary(s, guard) }
    catch { this.update({ protection: 'pending', message: '本次关联未提交，已有记录保留。请重试保存或恢复保护。' }); throw new StorageFailure('database', '图片尚未关联到记录，八维和原有作品保留。请重试保存。') }
    await this.protect(s)
  }
  private async checkFiles(s: LibrarySnapshot) {
    let missingImages = 0
    for (const asset of s.assets) try { await this.images.read(asset) } catch { missingImages++ }
    this.update({ missingImages })
  }
  initialize() { return this.serial(() => this.open()) }
  private async open() {
    if (this.initialized) return
    try {
      const meta = await this.metadata.get('library'), current = await this.readLibrary(), backup = await this.snapshots.latest()
      if (meta) {
        if (backup.snapshot && backup.snapshot.meta.installationId !== meta.installationId) throw new Error('安装身份不一致')
        const newestIntentRevision = (await this.snapshots.nextRevision()) - 1
        if (backup.snapshot && backup.snapshot.meta.revision > meta.revision) {
          this.update({ phase: 'recovery-choice', message: '本地索引落后于受保护的记录。请恢复较新的完整副本，以保留作品及删除状态。' })
          return
        }
        if (newestIntentRevision > meta.revision || backup.snapshot && backup.snapshot.meta.revision === meta.revision && backup.snapshot.meta.commitId !== meta.commitId) {
          this.update({ phase: 'recovery-blocked', message: '本地索引与最近操作的保护记录不一致。为避免恢复已删除内容，已暂停打开旧数据，请重新检查。' })
          return
        }
        try { validateSnapshot(current, this.snapshots.namespace) }
        catch {
          this.update({ phase: backup.snapshot ? 'recovery-choice' : 'recovery-blocked', message: backup.snapshot ? '本地索引校验未通过。找到同一安装的完整保护副本，可恢复最后受保护的记录。' : '本地索引和保护副本均未通过校验，旧副本已隔离。' })
          return
        }
        await this.checkFiles(current); this.initialized = true
        this.update({ phase: 'ready', protection: backup.snapshot?.meta.commitId === meta.commitId ? 'protected' : 'pending', message: backup.snapshot?.meta.commitId === meta.commitId ? undefined : '本地记录可用，恢复保护待重试。' })
        await this.collectOrphans(current)
      } else if (backup.exists) {
        // Missing IndexedDB metadata is ambiguous. Never import an old snapshot automatically.
        this.update({ phase: backup.snapshot ? 'recovery-choice' : 'recovery-blocked', message: backup.error ?? '本地索引缺失，找到一份完整保护副本。可恢复到最后一次受保护的记录；不会继续生成。' })
      } else {
        validateSnapshot(current, this.snapshots.namespace)
        await this.persist(current); this.initialized = true; this.update({ phase: 'ready' })
      }
    } catch { this.update({ phase: 'unavailable', message: '暂时无法打开本地存储。请检查空间或重启后重试，原有内容未被替换。' }) }
  }
  private async requireReady() { await this.open(); if (!this.initialized) throw new StorageFailure('recovery', this.status.message ?? '请先处理本地恢复') }
  retryOpen() { return this.serial(async () => { this.initialized = false; await this.open() }) }
  restore() {
    return this.serial(async () => {
      if (this.initialized || this.status.phase !== 'recovery-choice') throw new StorageFailure('recovery', '请先完成恢复检查，不覆盖正常数据库。')
      const latest = await this.snapshots.latest()
      if (!latest.snapshot) throw new StorageFailure('recovery', latest.error ?? '没有可恢复副本')
      await this.checkFiles(latest.snapshot); await this.writeLibrary(latest.snapshot); this.initialized = true
      this.update({ phase: 'ready', protection: 'protected', message: undefined })
    })
  }
  startFresh() {
    return this.serial(async () => {
      if (this.initialized || !['recovery-choice', 'recovery-blocked'].includes(this.status.phase)) throw new StorageFailure('recovery', '请先完成恢复检查；正常索引请使用清空本地数据操作')
      const s: LibrarySnapshot = { meta: { ...this.freshMeta(), explicitlyCleared: true }, readings: [], perfumes: [], generations: [], assets: [] }
      await this.persist(s); this.initialized = true; this.update({ phase: 'ready', missingImages: 0 }); await this.collectOrphans(s)
    })
  }
  retryProtection() { return this.serial(async () => { await this.requireReady(); await this.persist(await this.readLibrary()) }) }
  private change<T>(apply: (s: LibrarySnapshot) => T | Promise<T>, guard: () => boolean = () => true) {
    return this.serial(async () => {
      await this.requireReady(); const s = await this.readLibrary(), result = await apply(s)
      await this.persist(s, guard); return result
    })
  }
  save(reading: Reading) {
    return this.change(s => {
      if (s.meta.retiredReadingIds.includes(reading.id) || s.meta.retiredSessionIds.includes(reading.captureSessionId)) throw new Error('该读取已删除')
      const existing = s.readings.find(r => r.captureSessionId === reading.captureSessionId)
      if (existing) return existing
      const saved = structuredClone(reading)
      // An archive may have been deleted during capture. Keep the valid sample unarchived.
      if (saved.perfumeId && !s.perfumes.some(p => p.id === saved.perfumeId)) delete saved.perfumeId
      s.readings.push(saved); s.meta.explicitlyCleared = false; return saved
    })
  }
  get(id: string) { return this.readings.get(id) }
  latest() { return this.readings.orderBy('capturedAt').last() }
  getPerfume(id: string) { return this.perfumes.get(id) }
  getGeneration(id: string) { return this.generations.get(id) }
  getAsset(id: string) { return this.assets.get(id) }
  library() {
    return this.db.transaction('r', [this.readings, this.perfumes, this.generations], async () => ({ readings: await this.readings.toArray(), perfumes: await this.perfumes.toArray(), generations: await this.generations.toArray() }))
  }
  editPerfume(id: string, fields: { name: string; brand?: string; notes?: string }) {
    return this.change(s => {
      const p = s.perfumes.find(p => p.id === id); if (!p) throw new Error('档案不存在')
      Object.assign(p, this.perfumeFields(fields), { updatedAt: new Date().toISOString() })
    })
  }
  private perfumeFields(fields: { name: string; brand?: string; notes?: string }) {
    const name = fields.name.trim(), brand = fields.brand?.trim(), notes = fields.notes?.trim()
    if (!name) throw new Error('请填写香水名称')
    if (name.length > 120 || (brand?.length ?? 0) > 120 || (notes?.length ?? 0) > 2000) throw new Error('名称和品牌最多120字，备注最多2000字')
    return { name, brand, notes }
  }
  async saveDevelopmentText(id: string, text: DevelopmentText, canCommit: () => boolean) {
    await this.change(s => { const r = s.readings.find(r => r.id === id); if (r && canCommit()) r.developmentText = structuredClone(text) }, canCommit)
  }
  async saveInterpretation(id: string, interpretation: Interpretation, canCommit: () => boolean) {
    await this.change(s => { this.reading(s, id).interpretation = structuredClone(interpretation) }, canCommit)
  }
  beginCloudAttempt(id: string, attempt: CloudAttempt, regenerate: boolean, canCommit: () => boolean) {
    return this.change(s => {
      const r = this.reading(s, id), previous = r.cloudAttempt
      const next = structuredClone(attempt)
      next.variantIndex = previous ? previous.variantIndex + (regenerate ? 1 : 0) : 0
      if (!regenerate && previous?.phase !== 'ready') next.interpretation = previous?.interpretation
      r.cloudAttempt = next
      return structuredClone(next)
    }, canCommit)
  }
  updateCloudAttempt(attempt: CloudAttempt, canCommit: () => boolean) {
    return this.change(s => {
      const r = this.reading(s, attempt.recordId), saved = r.cloudAttempt
      if (saved?.attemptId !== attempt.attemptId) throw new Error('尝试已更新')
      // A terminal update can wait behind a successful DB commit / snapshot.
      // Never discard a paid interpretation or downgrade an already saved work.
      if (saved.phase === 'ready') return
      r.cloudAttempt = { ...structuredClone(attempt), interpretation: saved.interpretation ?? attempt.interpretation }
    }, canCommit)
  }
  saveCloudInterpretation(attempt: CloudAttempt, text: CloudInterpretation, canCommit: () => boolean) {
    return this.change(s => { const r = this.reading(s, attempt.recordId); if (r.cloudAttempt?.attemptId !== attempt.attemptId) throw new Error('尝试已更新'); r.interpretation = structuredClone(text); r.cloudAttempt = { ...structuredClone(attempt), interpretation: structuredClone(text), phase: 'generating' } }, canCommit)
  }
  private reading(s: LibrarySnapshot, id: string) { const r = s.readings.find(r => r.id === id); if (!r) throw new Error('识别记录不存在'); return r }
  archive(readingId: string, target: { perfumeId: string } | { name: string; brand?: string; notes?: string }) {
    return this.change(async s => {
      const r = this.reading(s, readingId), now = new Date().toISOString()
      let p = 'perfumeId' in target ? s.perfumes.find(p => p.id === target.perfumeId) : undefined
      if ('perfumeId' in target && !p) throw new Error('档案不存在')
      if (!('perfumeId' in target)) { p = { ...this.perfumeFields(target), id: crypto.randomUUID(), initialCoverPending: true, createdAt: now, updatedAt: now }; s.perfumes.push(p) }
      if (!p) throw new Error('档案不存在')
      for (const previous of s.perfumes) if (previous.id !== p.id && s.generations.some(g => g.readingId === r.id && g.id === previous.coverGenerationId)) { delete previous.coverGenerationId; previous.initialCoverPending = false }
      r.perfumeId = p.id
      p.updatedAt = now
      const g = s.generations.find(g => g.id === r.selectedGenerationId)
      if (p.initialCoverPending && g?.imageOrigin === 'cloud') {
        try { await this.images.read(s.assets.find(a => a.id === g.imageAssetId)!); p.coverGenerationId = g.id; p.initialCoverPending = false } catch { /* Missing image: preserve pending cover. */ }
      }
      return p
    })
  }
  setFallback(readingId: string, fallback?: FallbackPresentation, canCommit: () => boolean = () => true) {
    return this.change(s => {
      const r = this.reading(s, readingId)
      if (r.selectedGenerationId && s.generations.find(g => g.id === r.selectedGenerationId)?.imageOrigin === 'cloud') throw new Error('已有云端主图')
      r.fallbackPresentation = fallback
    }, canCommit)
  }
  commitArtwork(input: ArtworkSubmission) {
    return this.serial(async () => {
      await this.requireReady(); const s = await this.readLibrary(), r = this.reading(s, input.readingId)
      const existing = s.generations.find(g => g.id === input.generationId || g.readingId === r.id && g.attemptId === input.attemptId)
      if (existing) {
        if (existing.readingId !== input.readingId || existing.attemptId !== input.attemptId) throw new Error('作品身份冲突')
        await this.images.read(s.assets.find(a => a.id === existing.imageAssetId)!); return existing
      }
      if (!input.canCommit() || s.meta.retiredGenerationIds.includes(input.generationId)) throw new Error('尝试已结束或作品已删除')
      if (s.assets.some(a => a.id === input.assetId)) throw new Error('作品文件身份冲突')
      const asset = await this.images.save(input.assetId, input.blob, input.origin)
      const generation: Generation = { id: input.generationId, readingId: r.id, version: 1 + Math.max(0, ...s.generations.filter(g => g.readingId === r.id).map(g => g.version)), attemptId: input.attemptId, status: 'saved', imageAssetId: asset.id, imageOrigin: input.origin, textSnapshot: structuredClone(input.text), modelRequested: input.modelRequested, modelActual: input.modelActual, cloudImage: structuredClone(input.cloudImage), createdAt: new Date().toISOString() }
      s.assets.push(asset); s.generations.push(generation); r.selectedGenerationId = generation.id
      if (input.origin === 'cloud') {
        if (r.cloudAttempt?.attemptId === input.attemptId) r.cloudAttempt.phase = 'ready'
        delete r.fallbackPresentation
        const p = s.perfumes.find(p => p.id === r.perfumeId)
        if (p?.initialCoverPending) { p.coverGenerationId = generation.id; p.initialCoverPending = false }
      }
      try { await this.persist(s, input.canCommit) }
      catch (error) {
        // Failed metadata transaction: reclaim the unreferenced file, never claim success.
        try { await this.images.files.remove('originals', asset.relativePath) } catch { /* reclaimed on startup */ }
        throw error
      }
      return generation
    })
  }
  async artwork(readingId: string, generationId?: string) {
    const r = await this.get(readingId), id = generationId ?? r?.selectedGenerationId
    if (!r || !id) return undefined
    const generation = await this.getGeneration(id)
    if (!generation || generation.readingId !== r.id) return undefined
    const asset = await this.getAsset(generation.imageAssetId)
    if (!asset) return { generation, missing: true as const }
    try { return { generation, blob: await this.images.read(asset), missing: false as const } }
    catch { return { generation, missing: true as const } }
  }
  async availableVersions(readingId: string) {
    const list = await this.generations.where('readingId').equals(readingId).sortBy('version'), valid: Generation[] = []
    for (const g of list) if (g.imageOrigin === 'cloud' && (await this.artwork(readingId, g.id))?.blob) valid.push(g)
    return valid
  }
  selectMain(readingId: string, generationId?: string) {
    return this.change(async s => {
      const r = this.reading(s, readingId)
      if (generationId) {
        const g = s.generations.find(g => g.id === generationId && g.readingId === r.id)
        if (!g || g.imageOrigin !== 'cloud') throw new Error('不可选的云端版本')
        await this.images.read(s.assets.find(a => a.id === g.imageAssetId)!); delete r.fallbackPresentation
      }
      r.selectedGenerationId = generationId
    })
  }
  selectCover(perfumeId: string, generationId?: string) {
    return this.change(async s => {
      const p = s.perfumes.find(p => p.id === perfumeId); if (!p) throw new Error('档案不存在')
      if (generationId) {
        const g = s.generations.find(g => g.id === generationId)
        if (!g || g.imageOrigin !== 'cloud' || this.reading(s, g.readingId).perfumeId !== p.id) throw new Error('作品不属于此档案')
        await this.images.read(s.assets.find(a => a.id === g.imageAssetId)!)
      }
      p.coverGenerationId = generationId; p.initialCoverPending = false; p.updatedAt = new Date().toISOString()
    })
  }
  private removeVersions(s: LibrarySnapshot, ids: string[]) {
    const assets = s.generations.filter(g => ids.includes(g.id)).map(g => g.imageAssetId)
    for (const r of s.readings) if (r.selectedGenerationId && ids.includes(r.selectedGenerationId)) { delete r.selectedGenerationId; delete r.fallbackPresentation }
    for (const p of s.perfumes) if (p.coverGenerationId && ids.includes(p.coverGenerationId)) { delete p.coverGenerationId; p.initialCoverPending = false }
    s.meta.retiredGenerationIds.push(...ids)
    s.generations = s.generations.filter(g => !ids.includes(g.id)); s.assets = s.assets.filter(a => !assets.includes(a.id))
  }
  private async collectOrphans(s: LibrarySnapshot) {
    const referenced = new Set(s.assets.map(a => a.relativePath))
    try { for (const path of await this.images.files.list('originals')) if (!referenced.has(path)) await this.images.files.remove('originals', path); this.update({ cleanupPending: false }) }
    catch { diagnostics.record('cleanup'); this.update({ cleanupPending: true }) }
  }
  clearCache() { return this.serial(async () => {
    await this.requireReady()
    try { await this.images.clearCache(); if ((await this.images.files.list('cache')).length) throw new Error('cache remains') }
    catch { diagnostics.record('cleanup'); throw new StorageFailure('file', '缓存尚未清理完成，请检查可用空间后重试。记录、业务原图和恢复保护均保留。') }
  }) }
  cleanupFiles() { return this.serial(async () => { await this.requireReady(); await this.collectOrphans(await this.readLibrary()) }) }
  deleteGeneration(id: string) { return this.change(s => this.removeVersions(s, [id])).then(() => this.cleanupFiles()) }
  deleteReading(id: string) {
    this.deleteListeners.forEach(fn => fn(id))
    return this.change(s => {
      const r = this.reading(s, id)
      this.removeVersions(s, s.generations.filter(g => g.readingId === id).map(g => g.id))
      s.readings = s.readings.filter(r => r.id !== id); s.meta.retiredReadingIds.push(id); s.meta.retiredSessionIds.push(r.captureSessionId)
    }).then(() => this.cleanupFiles())
  }
  deletePerfume(id: string) { return this.change(s => { s.perfumes = s.perfumes.filter(p => p.id !== id); for (const r of s.readings) if (r.perfumeId === id) delete r.perfumeId }) }
  clearAll() {
    this.deleteListeners.forEach(fn => fn())
    return this.change(s => {
      s.meta.retiredReadingIds.push(...s.readings.map(r => r.id)); s.meta.retiredSessionIds.push(...s.readings.map(r => r.captureSessionId))
      this.removeVersions(s, s.generations.map(g => g.id)); s.readings = []; s.perfumes = []; s.meta.explicitlyCleared = true
    }).then(() => this.cleanupFiles())
  }
}
