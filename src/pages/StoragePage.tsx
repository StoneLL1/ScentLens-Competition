import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence } from 'motion/react'
import { ManagementLayout, ManagementLink } from '../components/ManagementLayout'
import { LibraryDialog } from '../components/LibraryDialogs'
import { useLibrary } from '../app/libraryHooks'
import { useStorageStatus } from '../app/StorageGate'
import { libraryReturnState } from '../app/libraryNavigation'
import { repository } from '../app/runtime'
import { newestFirst } from '../domain/library'
import { readingTime, type Reading } from '../domain/reading'

export function StoragePage() {
  const { data, error: loadError, retry } = useLibrary(), status = useStorageStatus(), navigate = useNavigate()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<Reading>(), [clearStep, setClearStep] = useState(0), [limit, setLimit] = useState(20)
  const lock = useRef(false)
  async function act(work: () => Promise<unknown>, message: string) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await work(); setDeleting(undefined); setClearStep(0)
      const current = repository.getSnapshot()
      setNotice(`${message}${current.cleanupPending ? '部分已删除文件仍占用空间，请重试文件清理。' : ''}${current.protection === 'pending' ? '恢复保护仍待完成，请重试保护。' : ''}`)
    } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请检查空间后重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  const versions = data?.generations.filter(g => g.readingId === deleting?.id) ?? []
  const affected = data?.perfumes.filter(p => versions.some(g => g.id === p.coverGenerationId)) ?? []
  return <ManagementLayout title="本地管理">
    <p className="management-intro">气味记忆只在这台设备上。<br />整理记录前，我们会说明影响。</p>
    {notice && <p role="status" className="management-feedback">{notice}</p>}{error && !deleting && !clearStep && <p role="alert" className="library-error">{error}</p>}
    <section className="management-section"><h2>存储与保护</h2><p className="management-hint">{status.protection === 'protected' ? '本地记录已完成恢复保护。' : '记录可用，恢复保护尚未完成。'}清缓存保留作品原图与记录。</p>
      <div className="management-group"><button className="management-row" disabled={busy} onClick={() => void act(() => repository.clearCache(), '缓存已清理。作品原图和记录仍保留。')}><span><strong>清理缓存</strong><small>仅删除可重新建立的临时内容</small></span></button>
      {status.protection === 'pending' && <button className="management-row" disabled={busy} onClick={() => void act(() => repository.retryProtection(), '保护检查已完成。')}><strong>重试保护</strong></button>}
      {status.cleanupPending && <button className="management-row" disabled={busy} onClick={() => void act(() => repository.cleanupFiles(), '文件清理检查已完成。')}><strong>重试文件清理</strong></button>}</div>
      {status.missingImages > 0 && <p className="management-hint">部分作品文件无法读取，八维记录仍保留。可打开对应记录查看或重新生成作品。</p>}
    </section>
    <section className="management-section"><h2>识别与作品</h2><p className="management-hint">打开记录可管理图像版本。删除识别会一并删除其作品，香水档案仍保留。</p>
      {loadError ? <button className="text-action" onClick={retry}>记录读取失败，重试</button> : !data ? <p role="status">正在读取记录…</p> : data.readings.length ? <><ul className="management-records">{[...data.readings].sort(newestFirst).slice(0, limit).map(r => <li key={r.id}><button className="management-record-open" onClick={() => navigate(`/result/${r.id}`, { state: libraryReturnState() })}><strong>{data.perfumes.find(p => p.id === r.perfumeId)?.name ?? '未命名气味'}</strong><small>{readingTime(r)} · {r.source === 'device' ? 'Pocket' : r.source === 'demo' ? 'Demo' : '开发模拟'}</small></button><button className="text-action danger-action" disabled={busy} aria-label={`删除 ${readingTime(r)} 的识别`} onClick={() => { setError(''); setDeleting(r) }}>删除</button></li>)}</ul>{data.readings.length > limit && <button className="text-action" onClick={() => setLimit(n => n + 20)}>显示更多记录</button>}</> : <p className="management-hint">还没有本地识别记录。</p>}
    </section>
    <section className="management-section"><h2>香水档案</h2><p className="management-hint">删除档案会解除收藏，识别和作品仍在历史中。</p><div className="management-group">{data?.perfumes.map(p => <ManagementLink key={p.id} to={`/gallery/${p.id}`} title={p.name} detail="编辑或删除档案" />)}{data && !data.perfumes.length && <p className="management-hint">还没有收藏的香水。</p>}</div></section>
    <div className="management-danger"><button className="text-action danger-action" disabled={busy || !data} onClick={() => { setError(''); setClearStep(1) }}>清空全部本地数据</button><p className="management-hint">移除本机识别、作品、档案及临时缓存，不影响系统相册。</p></div>
    <AnimatePresence>{deleting && <LibraryDialog title="删除这次识别？" close={() => setDeleting(undefined)} busy={busy}><p className="management-confirm-copy">将删除 {readingTime(deleting)} 的八维记录和 {versions.length} 个本地作品，并结束这条记录的生成等待。{affected.length > 0 && `「${affected.map(p => p.name).join('、')}」的封面会留空，其他作品需手动选择。`}香水档案仍保留。此操作无法撤销。</p>{error && <p className="library-error" role="alert">{error}</p>}<button className="button" disabled={busy} onClick={() => void act(() => repository.deleteReading(deleting.id), '识别及其作品已从记录中删除。')}>{busy ? '正在删除…' : '确认删除识别'}</button></LibraryDialog>}
    {clearStep > 0 && <LibraryDialog title={clearStep === 1 ? '清空本地气味记忆？' : '最后确认：全部清空'} close={() => setClearStep(0)} busy={busy}><p className="management-confirm-copy">{clearStep === 1 ? `将删除 ${data?.readings.length ?? 0} 次识别、${data?.generations.length ?? 0} 个本地作品和 ${data?.perfumes.length ?? 0} 个香水档案。` : '清空后无法撤销，也无法用旧的本地副本找回。当前等待会结束，已分享或存入系统相册的文件不受影响。'}</p>{error && <p className="library-error" role="alert">{error}</p>}<button className="button" disabled={busy} onClick={() => clearStep === 1 ? setClearStep(2) : void act(async () => { await repository.clearAll(); try { await repository.clearCache() } catch { throw new Error('记录、作品与档案已清空，但缓存尚未清完。关闭此提示后重试清理缓存。') } }, '本地识别、作品与档案已清空。')}>{busy ? '正在清空…' : clearStep === 1 ? '继续确认' : '确认全部清空'}</button></LibraryDialog>}</AnimatePresence>
  </ManagementLayout>
}
