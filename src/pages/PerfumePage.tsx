import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link, useLocation, useNavigate, useNavigationType, useParams } from 'react-router'
import { useLibrary } from '../app/libraryHooks'
import { useArtwork } from '../app/readingHooks'
import { expandPerfume, libraryReturnEntry, libraryReturnState, libraryScroll, perfumeLimit } from '../app/libraryNavigation'
import { repository } from '../app/runtime'
import { detailPath, galleryEntries, newestFirst } from '../domain/library'
import { readingTime } from '../domain/reading'
import { ArtworkFrame } from '../components/ArtworkFrame'
import { ScentProfile } from '../components/ScentProfile'
import { ReadingList } from '../components/ReadingList'
import { LibraryDialog, PerfumeFields } from '../components/LibraryDialogs'

export function PerfumePage() {
  const { perfumeId = '' } = useParams(), { data, error: loadError, retry } = useLibrary(), location = useLocation(), navigate = useNavigate()
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [limit, setLimit] = useState(() => perfumeLimit(perfumeId))
  const navigationType = useNavigationType(), restored = useRef(false)
  const lock = useRef(false), entry = data ? galleryEntries(data).find(e => e.perfume.id === perfumeId) : undefined
  const artwork = useArtwork(entry?.coverReading, entry?.cover?.id ?? null), perfume = entry?.perfume
  useLayoutEffect(() => {
    if (data && !restored.current) { restored.current = true; if (navigationType === 'POP') window.scrollTo(0, libraryScroll(location.pathname)) }
  }, [data, navigationType, location.pathname])
  async function act(work: () => Promise<unknown>, message: string) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await work(); setEditing(false); setNotice(message) }
    catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  const back = () => libraryReturnEntry(location.state) ? navigate(-1) : navigate('/gallery')
  if (!data || loadError || !perfume || !entry) return <main className="screen library-screen" id="main-content"><header className="library-header"><button className="text-action" onClick={back}>返回香廊</button><h1 tabIndex={-1}>香水档案</h1></header><section className="library-empty"><p role="status">{loadError ? '档案暂时无法读取。' : !data ? '正在打开档案…' : '这份档案已不存在，识别记录仍可在历史中查找。'}</p>{loadError ? <button className="button" onClick={retry}>重试读取</button> : <Link className="text-action" to="/history">查看识别记录</Link>}</section></main>
  const readings = data.readings.filter(r => r.perfumeId === perfume.id).sort(newestFirst)
  return <main className="screen library-screen perfume-screen" id="main-content"><header className="library-header"><button className="text-action" onClick={back}>返回香廊</button><span>香水档案</span><button className="text-action" disabled={busy} onClick={() => { setError(''); setEditing(true) }}>编辑档案</button></header>
    <div className="library-content"><section className="perfume-intro"><h1 tabIndex={-1}>{perfume.name}</h1>{perfume.brand && <p className="perfume-brand">{perfume.brand}</p>}<ArtworkFrame variant="gallery" src={artwork.url} alt={entry.cover?.textSnapshot.title ?? '尚未设置档案封面'} /><p className="library-hint">{entry.cover ? '香廊稳定封面' : perfume.initialCoverPending ? '等待首幅云端作品作为封面' : '封面已留空，可从识别版本中手动设置'}</p>
      {entry.cover && <button className="text-action" onClick={() => navigate(detailPath(entry), { state: libraryReturnState() })}>查看封面对应识别</button>}
      {perfume.notes && <p className="perfume-notes">{perfume.notes}</p>}
      <Link className="button" to={`/trial?perfume=${encodeURIComponent(perfume.id)}`}>再次试香</Link><p className="library-hint">新识别将自动收藏到「{perfume.name}」</p>
    </section>
    {error && !editing && <p role="alert" className="library-error">{error}</p>}{notice && <p role="status" className="library-hint">{notice}</p>}
    {entry.latest && <section className="perfume-latest"><h2>最近一次八维</h2><p className="library-hint">{readingTime(entry.latest)} · 封面保留原作品，分类随最近识别更新。</p><ScentProfile scores={entry.latest.scores100} /></section>}
    <section className="perfume-history"><h2>历次识别 <small>{readings.length}</small></h2>{readings.length ? <><ReadingList readings={readings.slice(0, limit)} perfumes={data.perfumes} />{readings.length > limit && <button className="text-action" onClick={() => { expandPerfume(perfumeId, limit + 30); setLimit(limit + 30) }}>显示更多记录</button>}</> : <p className="library-empty-copy">还没有识别记录。从这里再次试香，留下第一份八维。</p>}</section>
    <div className="perfume-management">{(perfume.coverGenerationId || perfume.initialCoverPending) && <button disabled={busy} className="text-action" onClick={() => { if (window.confirm('清空档案封面？今后不会自动补图，作品和本次主图仍保留，可从版本中手动设置封面。')) void act(() => repository.selectCover(perfume.id), '封面已清空，之后仅由你手动设置。') }}>清空档案封面</button>}<button disabled={busy} className="text-action danger-action" onClick={() => { if (window.confirm(`删除「${perfume.name}」档案？${readings.length} 次识别及作品将保留在历史中，并解除收藏归属。`)) void act(async () => { await repository.deletePerfume(perfume.id); navigate('/gallery', { replace: true }) }, '') }}>删除香水档案</button></div>
    </div>
    <AnimatePresence>{editing && <LibraryDialog title="编辑香水档案" close={() => setEditing(false)} busy={busy}>{error && <p role="alert" className="library-error">{error}</p>}<PerfumeFields perfume={perfume} busy={busy} submit={fields => void act(() => repository.editPerfume(perfume.id, fields), '档案已更新')} /></LibraryDialog>}</AnimatePresence>
  </main>
}
