import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { RecordRepository } from '../../src/data/RecordRepository'
import { type FileArea, type FileStore } from '../../src/data/FileStore'
import { digest } from '../../src/data/ImageStore'
import { validateSnapshot } from '../../src/data/snapshot'
import { createReading, type DevelopmentText } from '../../src/domain/reading'
import type { ArtworkSubmission, Interpretation } from '../../src/domain/artwork'

class FaultFiles implements FileStore {
  files = new Map<string, Uint8Array>()
  fault?: (area: FileArea, path: string, data: Uint8Array) => void
  async write(area: FileArea, path: string, data: Uint8Array) { this.fault?.(area, path, data); this.files.set(`${area}/${path}`, data.slice()) }
  async read(area: FileArea, path: string) { const data = this.files.get(`${area}/${path}`); if (!data) throw new Error('missing'); return data.slice() }
  async remove(area: FileArea, path: string) { this.files.delete(`${area}/${path}`) }
  async list(area: FileArea) { return [...this.files.keys()].filter(k => k.startsWith(`${area}/`)).map(k => k.slice(area.length + 1)) }
}
const probe = async () => ({ width: 292, height: 292 }) // decoder is exercised in the real browsers
const fixtureText: DevelopmentText = { title: '固定测试作品', keywords: ['青草'], description: '非云端生成', origin: 'mock', completedAt: '2026-10-02T00:00:00Z' }
const cloudText: Interpretation = { title: '云端合同测试替身', keywords: ['雪松'], description: '替身验证', displayTextOrigin: 'cloud', completedAt: fixtureText.completedAt, finalImagePrompt: 'exact prompt\n"original"', recipeSnapshot: { test: true }, sceneInputSnapshot: { variant: 2 }, scenePrompt: 'scene', generationConfigSnapshot: { test: true } }
const repos: RecordRepository[] = []
function setup(name = `storage-${crypto.randomUUID()}`, files = new FaultFiles()) {
  const repo = new RecordRepository(name, files, probe); repos.push(repo); return { repo, files }
}
function reading() { return createReading({ captureSessionId: crypto.randomUUID(), source: 'mock', rawScores: [.01,.02,.03,.04,.05,.06,.07,.08], rawScale: '0-1', resultValid: true, preview: false, quality: 'unknown' }) }
function submission(readingId: string, cloud = false): ArtworkSubmission {
  return { generationId: crypto.randomUUID(), assetId: crypto.randomUUID(), readingId, attemptId: crypto.randomUUID(), origin: cloud ? 'cloud' : 'development_fixture', text: cloud ? cloudText : fixtureText, blob: new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])], { type: 'image/png' }), canCommit: () => true }
}
async function reopenLost(repo: RecordRepository, files: FaultFiles) {
  const name = repo.db.name; await repo.db.delete(); const next = setup(name, files).repo; await next.initialize(); return next
}
async function snapshot(repo: RecordRepository) { return (await repo.snapshots.latest()).snapshot! }
afterEach(async () => { for (const repo of repos.splice(0)) await repo.db.delete() })

describe('TASK-03 relationships and local original', () => {
  it('TASK-08 reports partial cache and orphan cleanup without claiming success; retries preserve protected originals', async () => {
    const { repo, files } = setup(), r = await repo.save(reading())
    await repo.commitArtwork(submission(r.id))
    const protectedBefore = await files.read('protection', (await files.list('protection'))[0])
    await files.write('cache', 'derived.png', new Uint8Array([1]))
    const remove = files.remove.bind(files)
    files.remove = async () => { throw new Error('I/O failure') }
    await expect(repo.clearCache()).rejects.toThrow('缓存尚未清理完成')
    expect((await repo.artwork(r.id))?.blob).toBeDefined()
    expect(await files.read('protection', (await files.list('protection'))[0])).toEqual(protectedBefore)
    await repo.deleteReading(r.id)
    expect(repo.getSnapshot().cleanupPending).toBe(true)
    expect(await repo.get(r.id)).toBeUndefined()
    files.remove = remove
    await repo.cleanupFiles(); await repo.clearCache()
    expect(repo.getSnapshot().cleanupPending).toBe(false)
    expect(await files.list('originals')).toEqual([]); expect(await files.list('cache')).toEqual([])
  })
  it('TASK-08 deletion invalidates a Reading attempt before its transaction, but version deletion never cancels a new attempt', async () => {
    const { repo } = setup(), r = await repo.save(reading()), g = await repo.commitArtwork(submission(r.id))
    const events: Array<string | undefined> = []
    repo.onReadingDeleted(id => events.push(id))
    await repo.deleteGeneration(g.id); expect(events).toEqual([])
    const deletion = repo.deleteReading(r.id)
    expect(events).toEqual([r.id]); await deletion
    const cleared = repo.clearAll(); expect(events).toEqual([r.id, undefined]); await cleared
  })
  it('migrates v1 without dropping raw readings, initializes normal empty DB and never restores over it', async () => {
    const name = `v1-${crypto.randomUUID()}`, old = new Dexie(name), r = reading()
    old.version(1).stores({ readings: 'id, &captureSessionId, capturedAt, source, perfumeId' })
    await old.table('readings').add(r); old.close()
    const { repo, files } = setup(name)
    await expect(repo.restore()).rejects.toThrow('先完成恢复检查')
    await repo.initialize()
    expect(await repo.get(r.id)).toEqual(r); expect(repo.db.verno).toBe(2)
    await expect(repo.restore()).rejects.toThrow('不覆盖')
    await repo.clearAll(); repo.db.close()
    const next = setup(name, files).repo; await next.initialize()
    expect(next.getSnapshot().phase).toBe('ready'); expect(await next.latest()).toBeUndefined()
  })
  it('saves one idempotent fixture with its exact text; persists bytes separately; never initializes cloud cover', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), p = await repo.archive(r.id, { name: '香水 A' }), input = submission(r.id)
    const [g, again] = await Promise.all([repo.commitArtwork(input), repo.commitArtwork(input)])
    expect(g).toEqual(again); expect((await repo.artwork(r.id))?.blob?.size).toBe(input.blob.size)
    expect(await repo.getPerfume(p.id)).toMatchObject({ initialCoverPending: true }); expect(await repo.availableVersions(r.id)).toEqual([])
    expect((await snapshot(repo)).generations).toHaveLength(1)
    repo.db.close(); const next = setup(repo.db.name, files).repo; await next.initialize()
    expect((await next.artwork(r.id))?.generation.textSnapshot).toEqual(fixtureText)
    expect(await files.list('originals')).toHaveLength(1)
    expect((await files.list('protection')).filter(p => p.startsWith('snapshot-'))).toHaveLength(2)
  })
  it('cloud commits initialize a pending cover only once, select new main, and preserve version text and old cover', async () => {
    const { repo } = setup(), r = await repo.save(reading()), p = await repo.archive(r.id, { name: '香水 A' })
    await repo.setFallback(r.id, { origin: 'preset_fallback', resourceKey: 'neutral' })
    const a = await repo.commitArtwork(submission(r.id, true))
    const b = await repo.commitArtwork({ ...submission(r.id, true), text: { ...cloudText, title: '第二版' } })
    expect((await repo.get(r.id))?.fallbackPresentation).toBeUndefined()
    expect((await repo.get(r.id))?.selectedGenerationId).toBe(b.id)
    expect((await repo.getPerfume(p.id))?.coverGenerationId).toBe(a.id)
    await repo.selectMain(r.id, a.id)
    expect((await repo.artwork(r.id))?.generation.textSnapshot.title).toBe(cloudText.title)
    expect((await repo.availableVersions(r.id)).map(g => g.version)).toEqual([1,2])
  })
  it('manual clear, deleted cover, and moving archives never re-enable automatic cover initialization', async () => {
    const { repo } = setup(), r = await repo.save(reading()), p = await repo.archive(r.id, { name: 'A' })
    await repo.selectCover(p.id)
    const g = await repo.commitArtwork(submission(r.id, true)); expect((await repo.getPerfume(p.id))?.coverGenerationId).toBeUndefined()
    await repo.selectCover(p.id, g.id)
    const other = await repo.archive(r.id, { name: 'B' })
    expect((await repo.getPerfume(p.id))?.initialCoverPending).toBe(false)
    expect((await repo.getPerfume(p.id))?.coverGenerationId).toBeUndefined()
    expect(other.coverGenerationId).toBe(g.id)
    await repo.deletePerfume(other.id); expect((await repo.get(r.id))?.perfumeId).toBeUndefined(); expect((await repo.artwork(r.id))?.blob).toBeDefined()
  })
  it('deletion clears referenced main/cover without choosing another version or revealing an old fallback', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), p = await repo.archive(r.id, { name: 'A' })
    await repo.setFallback(r.id, { origin: 'preset_fallback', resourceKey: 'lemon' })
    const a = await repo.commitArtwork(submission(r.id, true)), b = await repo.commitArtwork(submission(r.id, true))
    await repo.deleteGeneration(b.id); expect(await repo.artwork(r.id)).toBeUndefined(); expect((await repo.get(r.id))?.fallbackPresentation).toBeUndefined()
    await repo.deleteGeneration(a.id); expect((await repo.getPerfume(p.id))?.initialCoverPending).toBe(false)
    await repo.commitArtwork(submission(r.id, true)); expect((await repo.getPerfume(p.id))?.coverGenerationId).toBeUndefined()
    const next = await reopenLost(repo, files); await next.restore()
    expect((await next.getPerfume(p.id))?.coverGenerationId).toBeUndefined()
  })
  it('cache cleaning protects original bytes, snapshots, and pending preset metadata', async () => {
    const { repo, files } = setup(), r = await repo.save(reading())
    await repo.setFallback(r.id, { origin: 'preset_fallback', resourceKey: 'neutral' }); await repo.commitArtwork(submission(r.id))
    await files.write('cache', 'thumbnail.png', new Uint8Array([1])); await repo.images.clearCache()
    expect(await files.list('cache')).toEqual([]); expect((await repo.artwork(r.id))?.blob).toBeDefined()
    const next = await reopenLost(repo, files); expect(next.getSnapshot().phase).toBe('recovery-choice'); expect(await next.latest()).toBeUndefined()
    await next.restore(); expect((await next.get(r.id))?.fallbackPresentation?.resourceKey).toBe('neutral')
  })
})

describe('TASK-03 interruptions and no resurrection', () => {
  async function rollBackDB(repo: RecordRepository, old: Awaited<ReturnType<typeof snapshot>>) {
    await repo.db.transaction('rw', repo.db.tables, async () => {
      for (const table of repo.db.tables) await table.clear()
      for (const name of ['readings', 'perfumes', 'generations', 'assets'] as const) await repo.db.table(name).bulkAdd(old[name])
      await repo.db.table('metadata').put(old.meta)
    })
  }
  it('a stale but valid DB cannot resurrect deleted records or overwrite a newer protected revision', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), old = await snapshot(repo)
    await repo.deleteReading(r.id); await rollBackDB(repo, old); repo.db.close()
    const next = setup(repo.db.name, files).repo; await next.initialize()
    expect(next.getSnapshot().phase).toBe('recovery-choice')
    await expect(next.retryProtection()).rejects.toThrow()
    await next.restore(); expect(await next.get(r.id)).toBeUndefined()
  })
  it('stale DB startup never garbage-collects originals referenced by a newer valid snapshot', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), old = await snapshot(repo)
    await repo.commitArtwork(submission(r.id)); await rollBackDB(repo, old); repo.db.close()
    const next = setup(repo.db.name, files).repo; await next.initialize()
    expect(next.getSnapshot().phase).toBe('recovery-choice'); expect(await files.list('originals')).toHaveLength(1)
    await next.restore(); expect((await next.artwork(r.id))?.blob).toBeDefined()
  })
  it('a DB behind an unfinished deletion intent is blocked even if it is internally valid', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), old = await snapshot(repo)
    files.fault = (_area, path) => { if (path.startsWith('snapshot-')) throw new Error('full') }
    await repo.deleteReading(r.id); files.fault = undefined
    await rollBackDB(repo, old); repo.db.close()
    const next = setup(repo.db.name, files).repo; await next.initialize()
    expect(next.getSnapshot().phase).toBe('recovery-blocked'); await expect(next.retryProtection()).rejects.toThrow()
  })
  it('failed original write leaves reading/text, no generation, and retries the exact same submission', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), input = submission(r.id)
    await repo.saveDevelopmentText(r.id, fixtureText, () => true)
    files.fault = area => { if (area === 'originals') throw new Error('disk full') }
    await expect(repo.commitArtwork(input)).rejects.toMatchObject({ stage: 'file' })
    expect((await repo.get(r.id))?.developmentText).toEqual(fixtureText); expect((await snapshot(repo)).generations).toHaveLength(0)
    files.fault = undefined; expect((await repo.commitArtwork(input)).id).toBe(input.generationId)
  })
  it('database abort after file write preserves old main and compensates the orphan', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), old = await repo.commitArtwork(submission(r.id)), input = submission(r.id)
    const fail = () => { throw new Error('IndexedDB quota') }
    repo.db.table('generations').hook('creating', fail)
    await expect(repo.commitArtwork(input)).rejects.toMatchObject({ stage: 'database' })
    repo.db.table('generations').hook('creating').unsubscribe(fail)
    expect((await repo.get(r.id))?.selectedGenerationId).toBe(old.id); expect(await files.list('originals')).toHaveLength(1)
    expect(repo.getSnapshot().protection).toBe('pending')
    expect((await repo.commitArtwork(input)).id).toBe(input.generationId)
  })
  it('partial snapshots keep committed data visible, report protection pending, and retry without another version', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), input = submission(r.id)
    files.fault = (area, path, data) => { if (path.startsWith('snapshot-')) { files.files.set(`${area}/${path}`, data.slice(0, 30)); throw new Error('killed') } }
    const g = await repo.commitArtwork(input)
    expect((await repo.artwork(r.id))?.generation.id).toBe(g.id); expect(repo.getSnapshot().protection).toBe('pending')
    expect((await repo.snapshots.latest()).snapshot).toBeUndefined()
    files.fault = undefined; await repo.retryProtection()
    expect(repo.getSnapshot().protection).toBe('protected'); expect((await snapshot(repo)).generations).toHaveLength(1)
  })
  it('failed/partial barrier forbids deletion; restart cannot restore through that uncertain boundary', async () => {
    const { repo, files } = setup(), r = await repo.save(reading())
    files.fault = (area, path) => { if (path.startsWith('intent-')) { files.files.set(`${area}/${path}`, new Uint8Array([0])); throw new Error('interrupted') } }
    await expect(repo.deleteReading(r.id)).rejects.toMatchObject({ stage: 'barrier' }); expect(await repo.get(r.id)).toBeDefined()
    files.fault = undefined; const next = await reopenLost(repo, files)
    expect(next.getSnapshot().phase).toBe('recovery-blocked'); await expect(next.restore()).rejects.toThrow()
  })
  it.each(['reading', 'generation', 'perfume', 'clear'] as const)('old snapshots cannot revive a %s deletion when protection fails', async kind => {
    const { repo, files } = setup(), r = await repo.save(reading()), p = await repo.archive(r.id, { name: 'A' }), g = await repo.commitArtwork(submission(r.id, true))
    const old = new Map(files.files)
    files.fault = (_area, path) => { if (path.startsWith('snapshot-')) throw new Error('full') }
    if (kind === 'reading') await repo.deleteReading(r.id)
    if (kind === 'generation') await repo.deleteGeneration(g.id)
    if (kind === 'perfume') await repo.deletePerfume(p.id)
    if (kind === 'clear') await repo.clearAll()
    expect(repo.getSnapshot().protection).toBe('pending')
    files.fault = undefined
    for (const [key, bytes] of old) if (!files.files.has(key)) files.files.set(key, bytes)
    const next = await reopenLost(repo, files)
    expect(next.getSnapshot().phase).toBe('recovery-blocked'); expect(await next.latest()).toBeUndefined(); await expect(next.restore()).rejects.toThrow()
  })
  it('clear + successful empty snapshot stays empty on restart/recovery and rejects late reading/session replay', async () => {
    const { repo, files } = setup(), r = await repo.save(reading())
    await repo.clearAll(); await expect(repo.save(r)).rejects.toThrow('已删除')
    const next = await reopenLost(repo, files); await next.restore()
    expect(await next.latest()).toBeUndefined(); expect((await snapshot(next)).meta.explicitlyCleared).toBe(true)
  })
  it('missing/corrupt images preserve eight dimensions, keep selected identity, and never auto-select another image', async () => {
    const { repo, files } = setup(), r = await repo.save(reading())
    await repo.commitArtwork(submission(r.id, true)); const b = await repo.commitArtwork(submission(r.id, true)), asset = (await repo.getAsset(b.imageAssetId))!
    await files.remove('originals', asset.relativePath)
    const next = await reopenLost(repo, files); await next.restore()
    expect(next.getSnapshot().missingImages).toBe(1); expect((await next.artwork(r.id))?.missing).toBe(true)
    expect((await next.get(r.id))?.scores100).toEqual(r.scores100); expect((await next.get(r.id))?.selectedGenerationId).toBe(b.id)
    expect(await next.availableVersions(r.id)).toHaveLength(1)
  })
  it('guards late results before and after file writes, and refuses recreation of a deleted generation', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), input = submission(r.id)
    let active = true
    input.canCommit = () => active
    files.fault = area => { if (area === 'originals') active = false }
    await expect(repo.commitArtwork(input)).rejects.toThrow(); expect((await repo.get(r.id))?.selectedGenerationId).toBeUndefined()
    files.fault = undefined; active = true; await repo.commitArtwork(input); await repo.deleteGeneration(input.generationId)
    await expect(repo.commitArtwork(input)).rejects.toThrow('已删除')
    await repo.deleteReading(r.id); await expect(repo.commitArtwork(submission(r.id))).rejects.toThrow('不存在')
  })
  it('does not list a cloud version deleted during an asynchronous availability query', async () => {
    const { repo } = setup(), r = await repo.save(reading())
    const a = await repo.commitArtwork(submission(r.id, true)), b = await repo.commitArtwork(submission(r.id, true))
    const read = repo.images.read.bind(repo.images)
    let release!: () => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve }), paused = new Promise<void>(resolve => { release = resolve })
    repo.images.read = async asset => { if (asset.id === a.imageAssetId) { entered(); await paused }; return read(asset) }
    const query = repo.availableVersions(r.id); await started; await repo.deleteGeneration(b.id); release()
    expect((await query).map(g => g.id)).toEqual([a.id])
  })
  it.each(['version', 'namespace', 'relation', 'path'] as const)('rejects a checksum-valid snapshot with invalid %s', async kind => {
    const { repo, files } = setup(), r = await repo.save(reading()); await repo.commitArtwork(submission(r.id))
    const s = await snapshot(repo), bad = structuredClone(s)
    if (kind === 'version') (bad.meta as { schemaVersion: number }).schemaVersion = 99
    if (kind === 'namespace') bad.meta.namespace = 'another-installation'
    if (kind === 'relation') bad.readings[0].selectedGenerationId = 'wrong'
    if (kind === 'path') bad.assets[0].relativePath = '../../other.png'
    expect(() => validateSnapshot(bad, repo.snapshots.namespace)).toThrow()
    const body = JSON.stringify(bad), bytes = new TextEncoder().encode(body)
    await files.write('protection', `snapshot-${s.meta.commitId}.json`, new TextEncoder().encode(JSON.stringify({ format: 1, body, sha256: await digest(bytes) })))
    const next = await reopenLost(repo, files); expect(next.getSnapshot().phase).toBe('recovery-blocked')
  })
  it('keeps a normal empty library empty even when older nonempty files are present', async () => {
    const { repo, files } = setup(), r = await repo.save(reading()), old = new Map(files.files)
    await repo.clearAll()
    for (const [key, bytes] of old) if (!files.files.has(key)) files.files.set(key, bytes)
    repo.db.close(); const next = setup(repo.db.name, files).repo; await next.initialize()
    expect(next.getSnapshot().phase).toBe('ready'); expect(await next.get(r.id)).toBeUndefined()
  })
})
