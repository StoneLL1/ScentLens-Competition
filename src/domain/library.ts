import type { Generation, Perfume } from './artwork'
import { DISPLAY_ORDER, type Reading, type ScentKey } from './reading'

export interface LibraryView { readings: Reading[]; perfumes: Perfume[]; generations: Generation[] }
export function profileStats(library: LibraryView) {
  return { readings: library.readings.filter(r => r.source === 'device').length, perfumes: library.perfumes.length }
}
export interface GalleryEntry { perfume: Perfume; latest?: Reading; cover?: Generation; coverReading?: Reading; categories: ScentKey[] }
export function newestFirst(a: Reading, b: Reading) { return b.capturedAt.localeCompare(a.capturedAt) || b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id) }
export function galleryEntries(library: LibraryView): GalleryEntry[] {
  return library.perfumes.map(perfume => {
    const readings = library.readings.filter(r => r.perfumeId === perfume.id).sort(newestFirst)
    const latest = readings[0]
    const cover = library.generations.find(g => g.id === perfume.coverGenerationId && g.imageOrigin === 'cloud' && readings.some(r => r.id === g.readingId))
    const max = latest ? Math.max(...Object.values(latest.scores100)) : 0
    return { perfume, latest, cover, coverReading: readings.find(r => r.id === cover?.readingId), categories: max > 0 ? DISPLAY_ORDER.filter(key => latest!.scores100[key] === max) : [] }
  }).sort((a, b) => a.latest && b.latest ? newestFirst(a.latest, b.latest) : a.latest ? -1 : b.latest ? 1 : a.perfume.id.localeCompare(b.perfume.id))
}
export function detailPath(entry: GalleryEntry) {
  return entry.cover && entry.coverReading ? `/scent/${entry.coverReading.id}?generation=${encodeURIComponent(entry.cover.id)}` : entry.latest ? `/scent/${entry.latest.id}?generation=none` : `/gallery/${entry.perfume.id}`
}
export function historyEntries(library: LibraryView, search: string) {
  const needle = search.trim().toLocaleLowerCase()
  return library.readings.filter(r => (library.perfumes.find(p => p.id === r.perfumeId)?.name ?? '未命名气味').toLocaleLowerCase().includes(needle)).sort(newestFirst)
}
