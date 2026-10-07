// Return only to entries created in this process; cold links have explicit safe fallbacks.
const entries = new Map<string, { path: string; scroll: number }>()
export function libraryReturnState() {
  const libraryReturn = crypto.randomUUID()
  entries.set(libraryReturn, { path: location.pathname + location.search, scroll: window.scrollY })
  if (entries.size > 100) entries.delete(entries.keys().next().value!)
  return { libraryReturn }
}
export function libraryReturnEntry(state: unknown) {
  if (!state || typeof state !== 'object' || !('libraryReturn' in state) || typeof state.libraryReturn !== 'string') return undefined
  return entries.get(state.libraryReturn)
}
export function libraryScroll(path: string) { return [...entries.values()].reverse().find(entry => entry.path === path)?.scroll ?? 0 }
export const galleryPosition = { category: 'all', perfumeId: '', categoryScroll: 0, scroll: 0 }
export const historyPosition = { search: '', scroll: 0, limit: 40 }
const perfumeLimits = new Map<string, number>()
export function perfumeLimit(id: string) { return perfumeLimits.get(id) ?? 30 }
export function expandPerfume(id: string, limit: number) { perfumeLimits.set(id, limit) }
