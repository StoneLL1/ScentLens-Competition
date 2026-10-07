import { useEffect, useRef, useState } from 'react'
import { repository } from '../app/runtime'
import { LibraryDialog } from './LibraryDialogs'
import { captureExport, type ExportSelection, type ExportSnapshot } from '../services/export/snapshot'
import { renderShareCard } from '../services/export/card'
import { canShareCard, exportError, nativeAlbum, openPhotoSettings, saveToAlbum, shareCard } from '../services/export/platform'
import '../styles/export.css'

export function ExportDialog({ selection, mode, close }: { selection: ExportSelection; mode: 'album' | 'share'; close: () => void }) {
  const [snapshot, setSnapshot] = useState<ExportSnapshot>()
  const [image, setImage] = useState<{ blob: Blob; url: string }>()
  const [error, setError] = useState<{ message: string; settings: boolean }>()
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  useEffect(() => {
    let disposed = false, url: string | undefined
    setLoading(true); setError(undefined); setImage(undefined); setSnapshot(undefined)
    void (async () => {
      const captured = await captureExport(repository, selection)
      const blob = mode === 'share' ? await renderShareCard(captured) : captured.blob
      if (disposed) return
      url = URL.createObjectURL(blob); setSnapshot(captured); setImage({ blob, url })
    })().catch(e => { if (!disposed) setError(exportError(e)) }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  }, [selection, mode, revision])
  async function action() {
    if (!image || inFlight.current) return
    inFlight.current = true; setBusy(true); setError(undefined); setNotice('')
    try {
      if (mode === 'album') { await saveToAlbum(image.blob); setNotice('原图已保存到系统相册。') }
      else {
        const result = await shareCard(image.blob)
        setNotice(result === 'cancelled' ? '已取消分享，本机作品仍保留。' : result === 'downloaded' ? '品牌卡已交给浏览器下载；这不代表已存入相册。' : '品牌卡已交给系统分享。')
      }
    } catch (e) { setError(exportError(e)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <LibraryDialog title={mode === 'share' ? '分享气味作品' : '保存作品原图'} close={close} busy={busy}>
    <div className="export-preview" aria-busy={loading}>{image ? <img src={image.url} alt={mode === 'share' ? `闻见 ScentLens 品牌卡：${snapshot?.title}` : snapshot?.title} /> : <p role="status">{loading ? '正在准备图片与字体…' : '暂时无法准备图片'}</p>}</div>
    <p className="library-hint">{mode === 'share' ? '独立方形品牌卡 · 保留当前作品与配文' : '保存当前作品原图，不含品牌卡排版'}<br />{snapshot?.source}</p>
    {mode === 'album' && !nativeAlbum && <p className="library-hint">请在 iPhone App 中保存到系统相册。</p>}
    {error && <p role="alert" className="library-error">{error.message}</p>}
    {notice && <p role="status" className="export-notice">{notice}</p>}
    <div className="export-dialog-actions">
      {error?.settings && <button className="text-action" disabled={busy} onClick={() => void openPhotoSettings().catch(e => setError(exportError(e)))}>打开系统设置</button>}
      {!image && !loading && <button className="button" onClick={() => setRevision(n => n + 1)}>重新准备</button>}
      <button className="button" disabled={loading || busy || !image || (mode === 'album' && !nativeAlbum)} onClick={() => void action()}>{busy ? '正在处理…' : mode === 'album' ? '保存到相册' : canShareCard(image?.blob) ? '系统分享' : '下载品牌卡'}</button>
      <button className="text-action" disabled={busy} onClick={close}>返回作品</button>
    </div>
  </LibraryDialog>
}
