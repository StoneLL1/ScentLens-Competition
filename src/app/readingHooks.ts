import { useEffect, useState, useSyncExternalStore } from 'react'
import { liveQuery } from 'dexie'
import type { Reading } from '../domain/reading'
import { coordinator, repository } from './runtime'
import type { Generation } from '../domain/artwork'

export function useCapture() { return useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot) }

export function useArtwork(reading?: Reading, generationId?: string | null) {
  const [artwork, setArtwork] = useState<{ key?: string; url?: string; generation?: Generation; missing?: boolean }>({})
  const selected = generationId === undefined ? reading?.selectedGenerationId : generationId
  const key = `${reading?.id ?? ''}/${selected ?? ''}`
  useEffect(() => {
    let disposed = false, url: string | undefined
    setArtwork({ key })
    if (reading && selected) void repository.artwork(reading.id, selected).then(result => {
      if (disposed) return
      if (result?.blob) url = URL.createObjectURL(result.blob)
      setArtwork({ key, url, generation: result?.generation, missing: result?.missing })
    }).catch(() => { if (!disposed) setArtwork({ key, missing: true }) })
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  // Metadata/interpretation updates must not replace an already displayed version.
  }, [key])
  return artwork.key === key ? artwork : {}
}

export function useReading(id?: string) {
  const [query, setQuery] = useState<{ key?: string; reading?: Reading; loaded: boolean; error?: string }>({ loaded: false })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    setQuery({ key: id, loaded: false })
    const subscription = liveQuery(() => id ? repository.get(id) : repository.latest()).subscribe({
      next: reading => setQuery({ key: id, reading, loaded: true }),
      error: () => setQuery({ key: id, loaded: true, error: '暂时无法读取本地记录，请重试。' }),
    })
    return () => subscription.unsubscribe()
  }, [id, revision])
  return { ...(query.key === id ? query : { loaded: false }), retry: () => setRevision(value => value + 1) }
}
