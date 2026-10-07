import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { motion, useIsPresent } from 'motion/react'
import { repository } from '../app/runtime'
import { useLibrary } from '../app/libraryHooks'
import type { Perfume } from '../domain/artwork'
import type { Reading } from '../domain/reading'
import { settleSpring, surfaceEase, useReducedMotionPreference } from './motion'

export function LibraryDialog({ title, close, children, busy = false }: { title: string; close: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  const reducedMotion = useReducedMotionPreference(), isPresent = useIsPresent()
  const quietMotion = reducedMotion || document.documentElement.dataset.input === 'keyboard'
  useEffect(() => {
    const dialog = ref.current!, previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.showModal()
    const header = dialog.querySelector('header')!
    const measureHeader = () => dialog.style.setProperty('--dialog-header-height', `${header.getBoundingClientRect().height}px`)
    measureHeader()
    const observer = new ResizeObserver(measureHeader)
    observer.observe(header)
    return () => { observer.disconnect(); dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  return <motion.dialog className="library-dialog" ref={ref} aria-labelledby={id} inert={!isPresent} data-exiting={!isPresent || undefined}
    initial={{ y: quietMotion ? 0 : 36, opacity: quietMotion ? 1 : 0 }} animate={{ y: 0, opacity: 1 }}
    exit={{ y: quietMotion ? 0 : 24, opacity: 0, transition: { duration: quietMotion ? 0 : 0.16 } }}
    transition={{ duration: quietMotion ? 0 : 0.28, ease: surfaceEase }}
    onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    <header><h2 id={id} tabIndex={-1} autoFocus>{title}</h2><button type="button" className="text-action" onClick={close} disabled={busy}>取消</button></header>{children}
  </motion.dialog>
}

export function PerfumeFields({ perfume, busy, submit, label = '保存档案' }: { perfume?: Perfume; busy: boolean; submit: (fields: { name: string; brand: string; notes: string }) => void; label?: string }) {
  return <form className="perfume-form" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    submit({ name: String(form.get('name')), brand: String(form.get('brand')), notes: String(form.get('notes')) })
  }}>
    <label>香水名称（必填）<input name="name" required maxLength={120} defaultValue={perfume?.name} placeholder="给这款香气一个名字" enterKeyHint="next" disabled={busy} /></label>
    <label>品牌<input name="brand" maxLength={120} defaultValue={perfume?.brand} placeholder="选填" enterKeyHint="next" disabled={busy} /></label>
    <label>备注<textarea name="notes" maxLength={2000} defaultValue={perfume?.notes} placeholder="记下想留住的气味与时刻" rows={3} disabled={busy} /></label>
    <button className="button" type="submit" disabled={busy}>{busy ? '正在保存…' : label}</button>
  </form>
}

export function ArchiveDialog({ reading, close, saved }: { reading: Reading; close: () => void; saved: (perfume: Perfume) => void }) {
  const { data, error: loadError, retry } = useLibrary()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const reducedMotion = useReducedMotionPreference()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const inFlight = useRef(false)
  async function archive(target: Parameters<typeof repository.archive>[1]) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { saved(await repository.archive(reading.id, target)) }
    catch (e) { setError(e instanceof Error ? e.message : '收藏未完成，请重试。') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <LibraryDialog title="收藏到香廊" close={close} busy={busy}>
    <p className="library-hint">八维已保存。把这次识别收进一个香水档案，作品可以稍后补上。</p>
    <div className="library-segment">
      <motion.span className="segment-indicator" aria-hidden="true" initial={false} animate={{ x: mode === 'new' ? '0%' : '100%' }} transition={reducedMotion || document.documentElement.dataset.input === 'keyboard' ? { duration: 0 } : settleSpring} />
      <button aria-pressed={mode === 'new'} disabled={busy} onClick={() => setMode('new')}>新建档案</button><button aria-pressed={mode === 'existing'} disabled={busy} onClick={() => setMode('existing')}>已有档案</button>
    </div>
    {error && <p role="alert" className="library-error">{error}</p>}
    {mode === 'new' ? <PerfumeFields busy={busy} submit={fields => void archive(fields)} label="创建并收藏" /> : <div className="archive-choices">
      {loadError ? <button className="text-action" onClick={retry}>档案读取失败，重试</button> : !data ? <p role="status">正在打开档案…</p> : data.perfumes.length === 0 ? <p>还没有档案，请先新建。</p> : data.perfumes.map(p => <button key={p.id} disabled={busy} onClick={() => void archive({ perfumeId: p.id })}><strong>{p.name}</strong><span>{p.brand || '香水档案'}</span></button>)}
    </div>}
  </LibraryDialog>
}
