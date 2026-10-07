import { describe, expect, it, vi } from 'vitest'
import type { RecordRepository } from '../../src/data/RecordRepository'
import { createReading } from '../../src/domain/reading'
import { captureExport } from '../../src/services/export/snapshot'
import { wrapText } from '../../src/services/export/card'
import { exportError } from '../../src/services/export/platform'

const reading = () => createReading({ captureSessionId: crypto.randomUUID(), source: 'demo', rawScores: [.1,.2,.3,.4,.5,.6,.7,.8], rawScale: '0-1', resultValid: true, preview: false, quality: 'unknown' })
const blob = new Blob(['original'], { type: 'image/png' })
function repo(r: ReturnType<typeof reading>, artwork?: unknown) {
  return { get: vi.fn(async () => r), artwork: vi.fn(async () => artwork) } as unknown as RecordRepository
}
describe('TASK-09 export snapshot', () => {
  it('exports the explicit version and its immutable text, never the new attempt or current main image', async () => {
    const r = { ...reading(), selectedGenerationId: 'new', developmentText: { title: 'new attempt', keywords: ['new'], description: '', origin: 'mock' as const, completedAt: '' } }
    const repository = repo(r, { blob, generation: { textSnapshot: { title: 'old version', keywords: ['old'] }, imageOrigin: 'cloud' } })
    const result = await captureExport(repository, { reading: r, generationId: 'old' })
    expect(repository.artwork).toHaveBeenCalledWith(r.id, 'old')
    expect(result.blob).toBe(blob); expect(result.title).toBe('old version'); expect(result.keywords).toEqual(['old']); expect(result.source).toBe('Demo 样本 · 气味视觉作品')
  })
  it('does not fall back to the main image when the selected generation is unavailable', async () => {
    const r = reading()
    await expect(captureExport(repo(r), { reading: r, generationId: 'deleted' })).rejects.toThrow('不可用')
  })
  it('rejects deleted readings even if original bytes are still available', async () => {
    const r = reading(), repository = repo(r); vi.mocked(repository.get).mockResolvedValue(undefined)
    await expect(captureExport(repository, { reading: r, generationId: 'old' })).rejects.toThrow('已删除')
  })
  it('no visible image does not silently export the selected main image', async () => {
    const r = { ...reading(), selectedGenerationId: 'main' }, repository = repo(r)
    await expect(captureExport(repository, { reading: r })).rejects.toThrow('尚不可用'); expect(repository.artwork).not.toHaveBeenCalled()
  })
  it('preset exports preserve frozen reading text and source without creating a generation', async () => {
    const r = { ...reading(), fallbackPresentation: { origin: 'preset_fallback' as const, resourceKey: 'neutral' as const } }
    const repository = repo(r); const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { headers: { 'Content-Type': 'image/png' } }))
    try { const result = await captureExport(repository, { reading: r, preset: 'neutral' }); expect(result.source).toBe('Demo 样本 · 预置配图'); expect(result.title).toContain('图片待生成'); expect(result.generationId).toBeUndefined(); expect(repository.artwork).not.toHaveBeenCalled() }
    finally { fetchMock.mockRestore() }
  })
  it('long CJK, unbroken Latin, and emoji fit measured lines', () => {
    const measure = (text: string) => [...new Intl.Segmenter().segment(text)].length * 10
    for (const text of ['非常长的中文标题'.repeat(10), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(4), '🍋🌿'.repeat(30)]) {
      const lines = wrapText(text, 120, 2, measure)
      expect(lines).toHaveLength(2); expect(lines[1].endsWith('…')).toBe(true); expect(lines.every(line => measure(line) <= 120)).toBe(true)
    }
  })
  it('distinguishes recoverable denial from device restrictions', () => {
    expect(exportError({ code: 'PHOTO_DENIED' }).settings).toBe(true)
    expect(exportError({ code: 'PHOTO_RESTRICTED' }).settings).toBe(false)
  })
})
