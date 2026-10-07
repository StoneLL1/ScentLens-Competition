import { fallbackAssets } from '../assets/fallbacks'
import { fromHardware, SCENT_KEYS } from '../domain/reading'
import type { LibrarySnapshot } from '../domain/artwork'
import { validFileName, type FileStore } from './FileStore'
import { digest } from './ImageStore'
import { assertCloudInterpretation, assertIdentity, assertModelCall, GENERATION_BUDGET_MS } from '../../shared/generation'

function assert(condition: unknown): asserts condition { if (!condition) throw new Error('本地保护文件的结构或关系无效') }
function object(value: unknown): asserts value is Record<string, unknown> { assert(value && typeof value === 'object' && !Array.isArray(value)) }
function text(value: unknown): asserts value is string { assert(typeof value === 'string' && value.length > 0) }
function date(value: unknown) { text(value); assert(Number.isFinite(Date.parse(value))) }
function strings(value: unknown): asserts value is string[] { assert(Array.isArray(value) && value.every(v => typeof v === 'string')) }
function displayText(value: unknown) {
  object(value); text(value.title); strings(value.keywords); assert(typeof value.description === 'string'); date(value.completedAt)
  if (value.origin !== 'mock') {
    assert(value.displayTextOrigin === 'cloud'); text(value.finalImagePrompt); text(value.scenePrompt)
    assert('recipeSnapshot' in value && 'sceneInputSnapshot' in value && 'generationConfigSnapshot' in value)
  }
}

// Checks external JSON BEFORE adopting any metadata or using a relative path.
export function validateSnapshot(value: unknown, namespace: string): asserts value is LibrarySnapshot {
  object(value); object(value.meta)
  const m = value.meta
  assert(m.id === 'library' && m.schemaVersion === 2 && m.namespace === namespace)
  text(m.installationId); text(m.commitId)
  assert(Number.isSafeInteger(m.revision) && Number(m.revision) >= 0 && typeof m.explicitlyCleared === 'boolean')
  strings(m.retiredReadingIds); strings(m.retiredSessionIds); strings(m.retiredGenerationIds)
  for (const key of ['readings', 'perfumes', 'generations', 'assets']) {
    assert(Array.isArray(value[key]))
    const ids = new Set<string>()
    for (const entry of value[key]) { object(entry); text(entry.id); assert(!ids.has(entry.id)); ids.add(entry.id) }
  }
  const s = value as unknown as LibrarySnapshot
  const readings = new Map(s.readings.map(r => [r.id, r])), perfumes = new Map(s.perfumes.map(p => [p.id, p]))
  const generations = new Map(s.generations.map(g => [g.id, g])), assets = new Map(s.assets.map(a => [a.id, a]))
  const sessions = new Set<string>(), versions = new Set<string>(), attempts = new Set<string>(), usedAssets = new Set<string>()
  for (const r of s.readings) {
    text(r.captureSessionId); date(r.capturedAt); date(r.receivedAt)
    assert(r.schemaVersion === 1 && r.rawScale === '0-1' && ['device','mock','demo'].includes(r.source) && ['unknown','weak','normal'].includes(r.quality))
    assert(['device','phone-received'].includes(r.capturedAtSource))
    const scores = fromHardware(r.rawScores)
    assert(r.scores100 && SCENT_KEYS.every(key => scores[key] === r.scores100[key]))
    assert(!sessions.has(r.captureSessionId) && !m.retiredReadingIds.includes(r.id) && !m.retiredSessionIds.includes(r.captureSessionId)); sessions.add(r.captureSessionId)
    assert(r.perfumeId === undefined || perfumes.has(r.perfumeId))
    assert(r.selectedGenerationId === undefined || generations.get(r.selectedGenerationId)?.readingId === r.id)
    if (r.developmentText) { displayText(r.developmentText); assert(r.developmentText.origin === 'mock') }
    if (r.interpretation) { displayText(r.interpretation); assert(r.interpretation.displayTextOrigin === 'cloud') }
    if (r.interpretation?.cloud) assertCloudInterpretation(r.interpretation)
    if (r.cloudAttempt) {
      const a = r.cloudAttempt
      assertIdentity({ ...a, requestId: a.interpretRequestId }); text(a.imageRequestId)
      assert(a.recordId === r.id && Number.isSafeInteger(a.variantIndex) && a.variantIndex >= 0 && Number.isFinite(a.startedAt) && Number.isFinite(a.deadline) && a.deadline > a.startedAt && a.deadline - a.startedAt <= GENERATION_BUDGET_MS)
      assert(['interpreting','generating','saving-artwork','save-failed','ready','interrupted','timeout','failed','empty'].includes(a.phase))
      if (a.interpretation) { assertCloudInterpretation(a.interpretation); assert(a.interpretation.cloud.identity.recordId === r.id && a.interpretation.cloud.variantIndex === a.variantIndex) }
    }
    if (r.fallbackPresentation) assert(r.fallbackPresentation.origin === 'preset_fallback' && Object.hasOwn(fallbackAssets, r.fallbackPresentation.resourceKey))
    if (r.selectedGenerationId && generations.get(r.selectedGenerationId)?.imageOrigin === 'cloud') assert(!r.fallbackPresentation)
  }
  for (const p of s.perfumes) {
    text(p.name); assert(p.name.trim()); date(p.createdAt); date(p.updatedAt); assert(typeof p.initialCoverPending === 'boolean')
    assert(p.brand === undefined || typeof p.brand === 'string'); assert(p.notes === undefined || typeof p.notes === 'string')
    if (p.coverGenerationId !== undefined) {
      const g = generations.get(p.coverGenerationId)
      assert(g && g.imageOrigin === 'cloud' && readings.get(g.readingId)?.perfumeId === p.id && !p.initialCoverPending)
    }
  }
  for (const g of s.generations) {
    const asset = assets.get(g.imageAssetId)
    assert(readings.has(g.readingId) && g.status === 'saved' && asset && asset.origin === g.imageOrigin && !m.retiredGenerationIds.includes(g.id))
    assert(Number.isSafeInteger(g.version) && g.version > 0); text(g.attemptId); date(g.createdAt); displayText(g.textSnapshot)
    assert(g.imageOrigin === 'cloud' ? 'displayTextOrigin' in g.textSnapshot : 'origin' in g.textSnapshot && g.textSnapshot.origin === 'mock')
    if (g.imageOrigin === 'development_fixture') assert(!g.modelActual && !g.modelRequested)
    if ('cloud' in g.textSnapshot && g.textSnapshot.cloud) assertCloudInterpretation(g.textSnapshot)
    if (g.cloudImage) {
      assertIdentity(g.cloudImage); assertModelCall(g.cloudImage.call)
      assert(g.imageOrigin === 'cloud' && g.cloudImage.recordId === g.readingId && g.cloudImage.attemptId === g.attemptId && g.cloudImage.generationId === g.id && g.cloudImage.byteSize === asset.byteSize && g.cloudImage.sha256 === asset.sha256 && g.cloudImage.width === asset.width && g.cloudImage.height === asset.height)
    }
    const version = `${g.readingId}/${g.version}`, attempt = `${g.readingId}/${g.attemptId}`
    assert(!versions.has(version) && !attempts.has(attempt) && !usedAssets.has(g.imageAssetId))
    versions.add(version); attempts.add(attempt); usedAssets.add(g.imageAssetId)
  }
  const paths = new Set<string>()
  for (const a of s.assets) {
    assert(a.storageKind === 'data' && validFileName(a.relativePath) && !paths.has(a.relativePath) && usedAssets.has(a.id)); paths.add(a.relativePath)
    assert(['cloud','development_fixture'].includes(a.origin) && ['image/png','image/jpeg','image/webp'].includes(a.mimeType))
    assert(Number.isSafeInteger(a.width) && a.width > 0 && a.width <= 8192 && a.height === a.width && Number.isSafeInteger(a.byteSize) && a.byteSize > 0 && a.byteSize <= 25 * 1024 * 1024)
    assert(typeof a.sha256 === 'string' && /^[a-f0-9]{64}$/.test(a.sha256)); date(a.createdAt)
  }
  if (m.explicitlyCleared) assert(!s.readings.length && !s.perfumes.length && !s.generations.length && !s.assets.length)
}

async function pack(value: unknown) {
  const body = JSON.stringify(value)
  return new TextEncoder().encode(JSON.stringify({ format: 1, body, sha256: await digest(new TextEncoder().encode(body)) }))
}
async function unpack(bytes: Uint8Array): Promise<unknown> {
  const e: unknown = JSON.parse(new TextDecoder().decode(bytes)); object(e)
  assert(e.format === 1 && typeof e.body === 'string' && await digest(new TextEncoder().encode(e.body)) === e.sha256)
  return JSON.parse(e.body)
}
interface Intent { namespace: string; installationId: string; revision: number; commitId: string }
export class SnapshotStore {
  constructor(readonly files: FileStore, readonly namespace: string) {}
  private async verifiedWrite(path: string, value: unknown) {
    const bytes = await pack(value)
    await this.files.write('protection', path, bytes)
    const read = await this.files.read('protection', path)
    assert(await digest(read) === await digest(bytes)); await unpack(read)
  }
  async nextRevision() {
    return 1 + Math.max(0, ...(await this.files.list('protection')).filter(p => p.startsWith('intent-')).map(p => {
      const n = Number(/^intent-(\d+)-/.exec(p)?.[1]); assert(Number.isSafeInteger(n) && n > 0); return n
    }))
  }
  async barrier(intent: Intent) {
    await this.verifiedWrite(`intent-${String(intent.revision).padStart(12, '0')}-${intent.commitId}.json`, intent)
  }
  async commit(snapshot: LibrarySnapshot) {
    validateSnapshot(snapshot, this.namespace)
    await this.verifiedWrite(`snapshot-${snapshot.meta.commitId}.json`, snapshot)
    // Retain two revisions. Intents are pruned only AFTER a verified current snapshot.
    // Never select an older snapshot when the newest intent is missing/corrupt.
    const paths = await this.files.list('protection')
    const keep = paths.filter(p => p.startsWith('intent-')).sort().slice(-2)
    const keepSnapshots = keep.map(p => `snapshot-${p.slice(20, -5)}.json`)
    for (const p of paths) if (!keep.includes(p) && !keepSnapshots.includes(p)) {
      try { await this.files.remove('protection', p) } catch { /* Old protection files are safe to retain. */ }
    }
  }
  async latest(): Promise<{ exists: boolean; snapshot?: LibrarySnapshot; error?: string }> {
    const paths = await this.files.list('protection')
    if (!paths.length) return { exists: false }
    try {
      const path = paths.filter(p => p.startsWith('intent-')).sort().at(-1); assert(path)
      const intent = await unpack(await this.files.read('protection', path)); object(intent)
      assert(intent.namespace === this.namespace); text(intent.commitId); text(intent.installationId)
      assert(path === `intent-${String(intent.revision).padStart(12, '0')}-${intent.commitId}.json`)
      const snapshot = await unpack(await this.files.read('protection', `snapshot-${intent.commitId}.json`))
      validateSnapshot(snapshot, this.namespace)
      assert(snapshot.meta.revision === intent.revision && snapshot.meta.commitId === intent.commitId && snapshot.meta.installationId === intent.installationId)
      return { exists: true, snapshot }
    } catch { return { exists: true, error: '最近一次保护未完成，或文件版本、完整性、关系校验未通过。旧副本已隔离，不能自动恢复。' } }
  }
}
