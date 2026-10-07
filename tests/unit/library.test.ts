import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { RecordRepository } from '../../src/data/RecordRepository'
import { createReading, type DeviceSample } from '../../src/domain/reading'
import { detailPath, galleryEntries, historyEntries } from '../../src/domain/library'
import { CaptureCoordinator } from '../../src/services/CaptureCoordinator'
import { MockDeviceAdapter } from '../../src/services/MockDeviceAdapter'

const repos: RecordRepository[] = [], coordinators: CaptureCoordinator[] = []
const sample = (scores = [0,0,0,.9,0,0,0,.9]): DeviceSample => ({ captureSessionId: crypto.randomUUID(), source: 'mock', rawScores: scores, rawScale: '0-1', resultValid: true, preview: false, quality: 'unknown' })
function setup() { const repo = new RecordRepository(`library-${crypto.randomUUID()}`); repos.push(repo); return repo }
afterEach(async () => { coordinators.splice(0).forEach(c => c.stop()); for (const repo of repos.splice(0)) await repo.db.delete() })

describe('TASK-06 archive and browsing contracts', () => {
  it('uses latest exact tied dimensions, reading time ordering, zero only in all, and keeps empty archives', async () => {
    const repo = setup()
    const a = await repo.save(createReading(sample(), new Date('2026-10-01T00:00:00Z'))), p = await repo.archive(a.id, { name: '晨光', brand: '闻见' })
    const b = await repo.save(createReading(sample([0,0,0,0,0,0,0,0]), new Date('2026-10-02T00:00:00Z'))), q = await repo.archive(b.id, { name: '无调' })
    let entries = galleryEntries(await repo.library())
    expect(entries.map(e => e.perfume.id)).toEqual([q.id, p.id]); expect(entries[0].categories).toEqual([]); expect(entries[1].categories).toEqual(['lemon','grass'])
    const c = await repo.save({ ...createReading(sample([0,0,0,.90001,0,0,0,.9]), new Date('2026-10-03T00:00:00Z')), perfumeId: p.id })
    entries = galleryEntries(await repo.library()); expect(entries[0].latest?.id).toBe(c.id); expect(entries[0].categories).toEqual(['lemon'])
    expect(detailPath(entries[0])).toBe(`/scent/${c.id}?generation=none`)
    await repo.deleteReading(c.id); expect(galleryEntries(await repo.library())[1].categories).toEqual(['lemon','grass'])
    await repo.deleteReading(a.id); entries = galleryEntries(await repo.library())
    expect(detailPath(entries[1])).toBe(`/gallery/${p.id}`)
  })
  it('edits user names, searches both archives and unnamed records, and rejects empty names without mutations', async () => {
    const repo = setup(), a = await repo.save(createReading(sample())), b = await repo.save(createReading(sample()))
    const p = await repo.archive(a.id, { name: '  晨光  ', brand: '  A  ' })
    await repo.archive(b.id, { perfumeId: p.id })
    const unarchived = await repo.save(createReading(sample()))
    await repo.editPerfume(p.id, { name: '雨后青苔', brand: 'B', notes: '留下的空气' })
    expect(historyEntries(await repo.library(), '雨后').map(r => r.id).sort()).toEqual([a.id,b.id].sort())
    expect(historyEntries(await repo.library(), '未命名').map(r => r.id)).toEqual([unarchived.id])
    await expect(repo.editPerfume(p.id, { name: '  ' })).rejects.toThrow('名称')
    await expect(repo.archive(unarchived.id, { name: '  ' })).rejects.toThrow('名称')
    expect((await repo.getPerfume(p.id))?.name).toBe('雨后青苔'); expect((await repo.library()).perfumes).toHaveLength(1)
    await repo.deletePerfume(p.id); expect(historyEntries(await repo.library(), '未命名')).toHaveLength(3)
  })
  it('capture context is session-scoped, survives save retry, and ordinary trials never inherit it', async () => {
    const repo = setup(), first = await repo.save(createReading(sample())), p = await repo.archive(first.id, { name: 'A' })
    const device = new MockDeviceAdapter(); device.delayMs = null
    const c = new CaptureCoordinator(repo, device, { interpret: () => new Promise(() => {}), image: () => new Promise(() => {}) }); coordinators.push(c)
    const save = repo.save.bind(repo); let fail = true
    repo.save = async reading => { if (fail) { fail = false; throw new Error('full') }; return save(reading) }
    c.start(p.id); await c.accept({ ...sample(), captureSessionId: c.getSnapshot().sessionId! })
    expect(c.getSnapshot().phase).toBe('save-failed'); await c.retrySave()
    expect((await repo.get(c.getSnapshot().recordId!))?.perfumeId).toBe(p.id)
    c.stop(); c.start(); await c.accept({ ...sample(), captureSessionId: c.getSnapshot().sessionId! })
    expect((await repo.get(c.getSnapshot().recordId!))?.perfumeId).toBeUndefined()
    c.stop(); c.start(p.id); await repo.deletePerfume(p.id); await c.accept({ ...sample(), captureSessionId: c.getSnapshot().sessionId! })
    expect(c.getSnapshot().phase).toBe('saved'); expect((await repo.get(c.getSnapshot().recordId!))?.perfumeId).toBeUndefined()
  })
})
