import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { animate, motion, useMotionValue } from 'motion/react'
import { Link, useNavigate } from 'react-router'
import { useLibrary } from '../app/libraryHooks'
import { useArtwork } from '../app/readingHooks'
import { galleryPosition, libraryReturnState } from '../app/libraryNavigation'
import { detailPath, galleryEntries, type GalleryEntry } from '../domain/library'
import { DISPLAY_ORDER, SCENT_LABELS, type ScentKey } from '../domain/reading'
import { ArtworkFrame } from '../components/ArtworkFrame'
import { settleSpring, useReducedMotionPreference } from '../components/motion'

function GalleryCard({ entry, depth, open }: { entry: GalleryEntry; depth: number; open: () => void }) {
  const artwork = useArtwork(entry.coverReading, entry.cover?.id ?? null)
  return <button className={`gallery-card gallery-card--${depth}`} tabIndex={depth ? -1 : 0} aria-hidden={depth ? true : undefined} aria-label={`查看 ${entry.perfume.name} 的八维详情`} onClick={open} style={{ '--cover-background': artwork.url ? `url("${artwork.url}")` : 'none' } as CSSProperties}>
    <div className="gallery-card-copy"><h2>{entry.perfume.name}</h2><p>{entry.perfume.brand ? `${entry.perfume.brand} · ` : ''}{entry.cover?.textSnapshot.description ?? (entry.perfume.initialCoverPending ? '气味已收藏，等待第一幅作品。' : '为这款香气留一处空白。')}</p></div>
    <ArtworkFrame variant="gallery" src={artwork.url} alt={entry.cover?.textSnapshot.title ?? '尚未设置档案封面'} />
    {!artwork.url && <span className="gallery-no-cover">{artwork.missing ? '封面文件暂不可用' : '封面待留存'}</span>}
  </button>
}

export function GalleryPage() {
  const { data, error, retry } = useLibrary(), navigate = useNavigate()
  const [category, setCategory] = useState(galleryPosition.category), [activeId, setActiveId] = useState(galleryPosition.perfumeId)
  const track = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ x: number; y: number; base: number; time: number; axis?: 'x' | 'y' } | null>(null)
  const suppressClick = useRef(false), dragX = useMotionValue(0), reducedMotion = useReducedMotionPreference()
  const restored = useRef(false)
  const all = data ? galleryEntries(data) : [], entries = category === 'all' ? all : all.filter(e => e.categories.includes(category as ScentKey))
  const index = Math.max(0, entries.findIndex(e => e.perfume.id === activeId)), current = entries[index]
  useEffect(() => () => dragX.stop(), [dragX])
  useEffect(() => { if (reducedMotion) dragX.jump(0) }, [dragX, reducedMotion])
  useLayoutEffect(() => {
    if (data && !restored.current) { restored.current = true; if (track.current) track.current.scrollLeft = galleryPosition.categoryScroll; window.scrollTo(0, galleryPosition.scroll) }
  }, [data])
  function remember() { galleryPosition.category = category; galleryPosition.perfumeId = current?.perfume.id ?? ''; galleryPosition.scroll = window.scrollY; galleryPosition.categoryScroll = track.current?.scrollLeft ?? 0 }
  function open(entry: GalleryEntry, archive = false) { remember(); navigate(archive ? `/gallery/${entry.perfume.id}` : detailPath(entry), { state: libraryReturnState() }) }
  function settle() {
    if (reducedMotion) dragX.jump(0)
    else void animate(dragX, 0, { ...settleSpring, velocity: Math.max(-800, Math.min(800, dragX.getVelocity())) })
  }
  function move(delta: number, withMotion = true) {
    const next = entries[index + delta]
    if (next) {
      setActiveId(next.perfume.id); galleryPosition.perfumeId = next.perfume.id
      // This is a new card, so the previous card's release velocity must not carry over.
      dragX.jump(reducedMotion || !withMotion ? 0 : delta * 28)
    }
    settle()
  }
  return <main className="screen gallery-screen" id="main-content">
    <header className="gallery-header"><h1 tabIndex={-1}>香水画廊</h1><p>SCENT GALLERY</p></header>
    <div className="gallery-categories" ref={track} aria-label="气味分类" onScroll={event => { galleryPosition.categoryScroll = event.currentTarget.scrollLeft }}>
      {(['all', ...DISPLAY_ORDER] as const).map(key => <button key={key} aria-pressed={category === key} onClick={event => {
        setCategory(key); setActiveId(''); galleryPosition.category = key; galleryPosition.perfumeId = ''
        dragX.jump(0)
        // Keep the selected category visible without scrolling the page vertically.
        const button = event.currentTarget, rail = track.current
        if (rail) { const a = button.getBoundingClientRect(), b = rail.getBoundingClientRect(); rail.scrollBy({ left: a.left < b.left ? a.left - b.left : a.right > b.right ? a.right - b.right : 0, behavior: 'instant' }) }
      }}><span>{key === 'all' ? '全部' : SCENT_LABELS[key]}</span></button>)}
    </div>
    {error ? <section className="library-empty"><h2>香廊暂时未能打开</h2><button className="button" onClick={retry}>重试读取</button></section> : !data ? <p className="library-empty" role="status">正在打开香廊…</p> : !current ? <section className="library-empty"><ArtworkFrame variant="gallery" alt="香廊尚无作品" /><h2>{all.length ? '这里还没有这类香气' : '留住第一款香气'}</h2><p>{all.length ? '分类取自最近一次识别，新的气味会带来新的归属。' : '试香后，把八维与作品收进自己的香水档案。'}</p>{all.length ? <button className="button" onClick={() => { setCategory('all'); galleryPosition.category = 'all' }}>查看全部</button> : <Link className="button" to="/trial">开始试香</Link>}<Link className="text-action" to="/history" state={libraryReturnState()}>从历史中收藏</Link></section> : <>
      <div className="gallery-stage" onPointerDown={() => { suppressClick.current = false }} onTouchStart={event => {
        if (event.touches.length !== 1) { gesture.current = null; settle(); return }
        dragX.stop(); gesture.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, base: dragX.get(), time: Date.now() }; suppressClick.current = false
      }} onTouchMove={event => {
        const start = gesture.current
        if (!start || event.touches.length !== 1) { gesture.current = null; settle(); return }
        const dx = event.touches[0].clientX - start.x, dy = event.touches[0].clientY - start.y
        if (!start.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) start.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y'
        if (start.axis !== 'x') return
        suppressClick.current = true
        const atEdge = dx > 0 ? index === 0 : index === entries.length - 1
        if (!reducedMotion) dragX.set(start.base + (atEdge ? dx / (1 + Math.abs(dx) / 32) : dx))
      }} onTouchEnd={event => {
        const start = gesture.current; gesture.current = null
        if (!start) return
        const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y
        const horizontal = start.axis !== 'y' && Math.abs(dx) > Math.abs(dy) * 1.4
        const committed = Math.abs(dx) > 50 || Math.abs(dx) > 20 && Math.abs(dx) / Math.max(Date.now() - start.time, 1) > 0.5
        if (horizontal && committed) { event.preventDefault(); suppressClick.current = true; move(dx < 0 ? 1 : -1) }
        else { if (suppressClick.current) event.preventDefault(); settle() }
      }} onTouchCancel={() => { gesture.current = null; settle() }} onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false } }}>
        <div className="gallery-controls" onTouchStart={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}><button aria-label="上一款" disabled={index === 0} onClick={event => move(-1, event.detail !== 0)}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="m12 5-5 5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button><span aria-live="polite">{index + 1} <span className="gallery-count-divider">/</span> {entries.length}</span><button aria-label="下一款" disabled={index === entries.length - 1} onClick={event => move(1, event.detail !== 0)}><svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="m8 5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button><button className="text-action" onClick={() => open(current, true)}>香水档案</button></div>
        {entries.slice(index + 1, index + 3).reverse().map((entry, i, siblings) => <GalleryCard key={entry.perfume.id} entry={entry} depth={siblings.length - i} open={() => {}} />)}
        <motion.div className="gallery-current" style={{ x: dragX }}>
          <GalleryCard key={current.perfume.id} entry={current} depth={0} open={() => open(current)} />
          <button className="button gallery-detail" onClick={() => open(current)}>查看气味档案</button>
        </motion.div>
      </div>
    </>}
  </main>
}
