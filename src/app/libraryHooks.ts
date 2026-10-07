import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { repository } from './runtime'
import type { LibraryView } from '../domain/library'

export function useLibrary() {
  const [data, setData] = useState<LibraryView>()
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    setError(false)
    const subscription = liveQuery(() => repository.library()).subscribe({ next: setData, error: () => setError(true) })
    return () => subscription.unsubscribe()
  }, [revision])
  return { data, error, retry: () => setRevision(n => n + 1) }
}
