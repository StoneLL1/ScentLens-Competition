import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { repository } from './runtime'

export function useStorageStatus() { return useSyncExternalStore(repository.subscribe, repository.getSnapshot) }

export function StorageNotice() {
  const status = useStorageStatus()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  if (status.protection !== 'pending' || status.phase !== 'ready') return null
  return <aside className="storage-notice" aria-label="本地保护提示"><p role="status">{error || status.message}</p><button className="text-action" disabled={busy} onClick={() => {
    setBusy(true); setError('')
    void repository.retryProtection().catch(e => setError(e instanceof Error ? e.message : '保护未完成，请重试。')).finally(() => setBusy(false))
  }}>{busy ? '正在保护…' : '重试保护'}</button></aside>
}

export function StorageGate({ children }: { children: ReactNode }) {
  const status = useStorageStatus()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { void repository.initialize() }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。') } finally { setBusy(false) }
  }
  if (status.phase === 'ready') return children
  return <main className="screen storage-recovery" id="main-content"><p className="eyebrow">SCENTLENS</p><h1>{status.phase === 'opening' ? '正在打开气味记忆' : '找回本地气味记忆'}</h1><p role="status">{error || status.message || '正在检查本地记录与作品…'}</p>
    {status.phase === 'recovery-choice' && <button className="button" disabled={busy} onClick={() => void run(() => repository.restore())}>恢复受保护的记录</button>}
    {status.phase !== 'opening' && <button className="text-action" disabled={busy} onClick={() => void run(() => repository.retryOpen())}>重新检查</button>}
    {['recovery-choice', 'recovery-blocked'].includes(status.phase) && <button className="text-action" disabled={busy} onClick={() => {
      if (window.confirm('重新开始将放弃旧保护副本及本地作品，无法撤销。确定继续？') && window.confirm('再次确认：清空这些本地记忆并重新开始？')) void run(() => repository.startFresh())
    }}>放弃旧副本，重新开始</button>}
  </main>
}
