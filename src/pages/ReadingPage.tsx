import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArtworkFrame } from '../components/ArtworkFrame'
import { ScentProfile } from '../components/ScentProfile'
import { useArtwork, useCapture, useReading } from '../app/readingHooks'
import { coordinator, cloudMode, bleValidation } from '../app/runtime'
import { DISPLAY_ORDER, SCENT_LABELS, formatScore, readingTime, readingTitle } from '../domain/reading'
import { fallbackAssets } from '../assets/fallbacks'
import { StorageNotice } from '../app/StorageGate'
import { useLibrary } from '../app/libraryHooks'
import { libraryReturnEntry, libraryReturnState } from '../app/libraryNavigation'
import { ArchiveDialog } from '../components/LibraryDialogs'
import { VersionPanel } from '../components/VersionPanel'
import { CloudAccessDialog } from '../components/CloudAccessDialog'
import { ExportDialog } from '../components/ExportDialog'
import type { ExportSelection } from '../services/export/snapshot'
import { localScentLabels } from '../domain/fallback'
import { InterfaceIcon } from '../components/InterfaceIcon'

// Only entries minted in this running App are trusted. Reload/deep-link falls back to this record.
const detailEntries = new Map<string, { recordId: string; scroll: number }>()

export function ReadingPage({ detail = false }: { detail?: boolean }) {
  const { recordId = '' } = useParams()
  const query = useReading(recordId)
  const capture = useCapture()
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [archiveOpen, setArchiveOpen] = useState(false), [versionsOpen, setVersionsOpen] = useState(false), [archiveNotice, setArchiveNotice] = useState('')
  const [accessOpen, setAccessOpen] = useState(false)
  const [exporting, setExporting] = useState<{ selection: ExportSelection; mode: 'album' | 'share' }>()
  const { data: library } = useLibrary()
  const touchStart = useRef<number | null>(null)
  const preview = capture.preview?.recordId === recordId ? capture.preview : undefined
  const waiting = preview?.phase === 'interpreting' || preview?.phase === 'generating' || preview?.phase === 'saving-artwork'
  const reading = query.reading
  const explicit = params.get('generation')
  const explicitRemoved = !!explicit && !!library && !library.generations.some(g => g.id === explicit && g.readingId === recordId)
  const artwork = useArtwork(reading, explicit === 'none' || explicitRemoved ? null : explicit ?? undefined)
  const imageUrl = artwork.url ?? (!explicit && !reading?.selectedGenerationId && reading?.fallbackPresentation ? fallbackAssets[reading.fallbackPresentation.resourceKey] : undefined)
  const selectedId = explicit && explicit !== 'none' ? explicit : !explicit ? reading?.selectedGenerationId : undefined
  const selectedText = selectedId ? library?.generations.find(g => g.id === selectedId && g.readingId === recordId)?.textSnapshot : undefined
  const displayText = artwork.generation?.textSnapshot ?? selectedText ?? (selectedId ? undefined : reading?.interpretation ?? reading?.developmentText)
  const perfume = library?.perfumes.find(p => p.id === reading?.perfumeId)
  const sourceEntry = libraryReturnEntry(location.state)

  useEffect(() => {
    if (reading) document.title = `${readingTitle(reading)} · 闻见 ScentLens`
  }, [reading])
  useEffect(() => {
    if (reading?.id) document.querySelector<HTMLElement>('.reading-copy h1')?.focus({ preventScroll: true })
  }, [reading?.id, detail])

  useEffect(() => {
    if (query.loaded && !query.error && !reading) navigate(sourceEntry?.path ?? '/home', { replace: true, state: { notice: '这条气味记录已不可用。' } })
  }, [query.loaded, query.error, reading, navigate])

  if (!query.loaded || query.error || !reading) return <main className="screen reading-loading" id="main-content"><h1 tabIndex={-1}>气味记录</h1><p role="status">{query.error ?? '正在打开本地八维…'}</p>{query.error && <button className="button" onClick={query.retry}>重试读取</button>}<Link to="/home" className="text-action">返回首页</Link></main>

  const openExport = (mode: 'album' | 'share') => {
    if (!imageUrl) return
    setExporting({ mode, selection: { reading: structuredClone(reading), generationId: selectedId, preset: !selectedId ? reading.fallbackPresentation?.resourceKey : undefined } })
  }
  const openDetail = () => {
    const entryKey = crypto.randomUUID()
    detailEntries.clear()
    detailEntries.set(entryKey, { recordId, scroll: window.scrollY })
    navigate(`/scent/${recordId}${location.search}`, { state: { entryKey } })
  }
  const back = () => {
    if (sourceEntry) { if (canLeave()) { coordinator.stopPreview(); navigate(-1) }; return }
    if (detail) {
      const entry = detailEntries.get(location.state?.entryKey)
      if (entry?.recordId === recordId) navigate(-1)
      else navigate(`/result/${recordId}`, { replace: true })
    } else {
      if (!canLeave()) return
      coordinator.stopPreview()
      navigate('/home')
    }
  }
  const canLeave = () => !waiting || window.confirm('离开会结束本次作品等待，已保存的八维、文字和作品仍会保留。继续离开？')
  const attempt = preview ?? reading.cloudAttempt
  const empty = attempt?.phase === 'empty'
  const coldInterrupted = !preview && !!attempt && ['interpreting','generating','saving-artwork'].includes(attempt.phase)
  const failed = coldInterrupted || !!attempt && ['failed','timeout','interrupted','save-failed'].includes(attempt.phase)
  const status = bleValidation && !artwork.url ? '真实八维已保存本机 · BLE 验收包不生成作品' : waiting ? preview.phase === 'saving-artwork' ? '正在保存作品，八维已保留…' : preview.phase === 'interpreting' ? '正在将气味转译为视觉…' : selectedId ? '正在描绘新作品，原作仍保留…' : '文字已到，正在描绘气味…' : preview?.canRetrySave ? preview.error : coldInterrupted ? '上次生成已中断，可手动继续' : attempt?.phase === 'timeout' ? '等待已超时，八维与已有作品仍保留' : attempt?.phase === 'interrupted' ? '本次等待已结束，可手动继续生成' : attempt?.phase === 'failed' || empty ? attempt.error ?? '生成未完成，八维仍已保留' : artwork.missing ? '本地图片缺失或损坏 · 八维与文字仍保留' : artwork.url ? artwork.generation?.imageOrigin === 'development_fixture' ? '固定测试作品 · 已保存本机，可离线回看' : '作品已保存本机，可离线回看' : '图片待生成 · 八维已保存在本机'
  const source = reading.source === 'mock' ? '开发模拟' : reading.source === 'demo' ? 'Demo 样本' : 'Pocket 读取'

  return <main className={`screen ${detail ? 'analysis-screen' : 'result-screen'} ${detail && location.state?.entryKey ? 'analysis-from-result' : ''} ${imageUrl ? 'has-artwork' : ''}`} id="main-content" style={{ '--artwork-background': imageUrl ? `url("${imageUrl}")` : 'none' } as CSSProperties}>
    <header className="reading-header"><button className="icon-button" onClick={back} aria-label={sourceEntry ? sourceEntry.path.startsWith('/gallery') ? '返回香廊' : '返回识别记录' : detail ? '返回识别结果' : '返回首页'}><img src={`/assets/icons/${detail ? 'back-analysis' : 'back-result'}.svg`} alt="" /></button>{!detail && <span className="brand-wordmark">SCENTLENS · {source}</span>}</header>
    <section className="reading-artwork" aria-label={imageUrl ? artwork.generation?.imageOrigin === 'development_fixture' ? '开发测试作品' : '气味作品' : '作品等待区'}>
      <ArtworkFrame variant={detail ? 'compact' : 'large'} src={imageUrl} alt={imageUrl ? `${artwork.generation?.imageOrigin === 'development_fixture' ? '固定测试作品 · ' : ''}${displayText?.title ?? '气味作品'}` : '尚无作品，八维可立即查看'} />
      {!imageUrl && <div className={`artwork-pending ${waiting ? 'is-waiting' : ''}`} aria-hidden="true"><span /><span /><span /></div>}
    </section>
    <section className="reading-copy" aria-live="polite">
      <h1 tabIndex={-1}>{displayText?.title ?? (explicit && explicit !== 'none' ? '此作品暂不可用' : readingTitle(reading))}</h1>
      <p className="reading-meta">{source} · {displayText?.keywords.join(' / ') || localScentLabels(reading.scores100).join(' / ')}</p>
      {detail && <p className="reading-description">{displayText?.description ?? '本地标签来自本次八维。联网后可生成气味文字与作品，现在可以先探索完整图谱。'}</p>}
      <p className={detail ? 'sr-only' : `generation-status ${preview?.canRetrySave || artwork.missing || failed || empty ? 'needs-attention' : ''}`} role="status">{status}</p>
      {reading.quality === 'weak' && <p className="source-note">信号偏弱，本次完整八维已保留。</p>}
    </section>
    <StorageNotice />
    {!detail && <div className="reading-controls" role="group" aria-label="管理气味作品">
      <div className="reading-library-actions">{perfume ? <button className="text-action archived-action" title={`已收藏 · ${perfume.name}`} onClick={() => { if (canLeave()) { coordinator.stopPreview(); navigate(`/gallery/${perfume.id}`, { state: libraryReturnState() }) } }}><InterfaceIcon name="check" /><span>已收藏 · {perfume.name}</span></button> : <button className="button" onClick={() => setArchiveOpen(true)}><InterfaceIcon name="bookmark" />收藏到香廊</button>}<button className="text-action" onClick={() => setVersionsOpen(true)}><InterfaceIcon name="versions" />图像版本</button>{archiveNotice && <p role="status">{archiveNotice}</p>}</div>
      {coordinator.generationEnabled && <div className="result-actions">{waiting ? <button className="button" onClick={() => coordinator.stopPreview()}>取消等待</button> : preview?.canRetrySave ? <button className="button" onClick={() => void coordinator.retryArtworkSave()}>重试保存作品</button> : cloudMode ? <>
        {empty ? <Link className="button" to="/trial">重新试香</Link> : <button className="button" disabled={coordinator.isBusy()} onClick={() => { setParams({}, { replace: true, state: location.state }); void coordinator.beginPreview(reading, !!selectedId && !failed) }}>{failed || !selectedId ? attempt && 'interpretation' in attempt && attempt.interpretation ? '继续生成作品' : '生成气味作品' : '重新生成'}</button>}
        {failed && !!reading.cloudAttempt?.interpretation && !empty && <button className="text-action" onClick={() => { setParams({}, { replace: true, state: location.state }); void coordinator.beginPreview(reading, true) }}>重新解释并生成</button>}
        {['ACCESS_DENIED','NOT_CONFIGURED'].includes(attempt?.errorCode ?? '') && <button className="text-action" onClick={() => setAccessOpen(true)}>输入演示访问码</button>}
      </> : !imageUrl && <button className="button" onClick={() => void coordinator.beginPreview(reading)}>继续开发演示</button>}</div>}
    </div>}
    <div className="reading-export-actions" role="group" aria-label="导出当前作品"><button className="text-action" disabled={!imageUrl} onClick={() => openExport('album')}><InterfaceIcon name="save" />保存原图</button><button className="text-action" disabled={!imageUrl} onClick={() => openExport('share')}><InterfaceIcon name="share" />分享品牌卡</button></div>
    {!detail ? <button className="analysis-entry" onClick={openDetail} onTouchStart={event => { touchStart.current = event.touches[0].clientY }} onTouchEnd={event => { if (touchStart.current !== null && touchStart.current - event.changedTouches[0].clientY > 40) { event.preventDefault(); openDetail() }; touchStart.current = null }} onTouchCancel={() => { touchStart.current = null }}>
      <i aria-hidden="true" /><span><strong>上滑查看八维气味图谱</strong><small>完整分析 · 8 个气味维度</small></span><img src="/assets/icons/swipe-up.svg" alt="" /><em>点击或向上滑动进入完整分析</em>
    </button> : <>
      <section className="analysis-profile"><p className="analysis-kicker">SCENT ANALYSIS · 8D SENSOR PROFILE</p><h2>气味八维图谱</h2><p>形状与强度来自八维数据，沿用气味云原有配色。</p><ScentProfile scores={reading.scores100} /></section>
      <section className="dimension-section"><p className="analysis-kicker">{source} · {readingTime(reading)}</p><h2>八个气味维度</h2><p>横向长度代表本次样本的展示分数，量纲 0–100。</p>
        <dl className="dimension-rows">{DISPLAY_ORDER.map(key => <div className="dimension-row" key={key}><dt>{SCENT_LABELS[key]} <span>/ {key.toUpperCase()}</span></dt><dd>{formatScore(reading.scores100[key])}</dd><div className="dimension-track" aria-hidden="true"><i style={{ width: `${reading.scores100[key]}%` }} /></div></div>)}</dl>
      </section><footer className="analysis-footer"><p>{status}</p>分数不代表化学成分含量或识别准确率。<br />{reading.capturedAtSource === 'device' ? '时间来自设备' : '时间为手机接收时间'} · {source}</footer>
    </>}
    <AnimatePresence>{exporting && <ExportDialog key="export" {...exporting} close={() => setExporting(undefined)} />}</AnimatePresence>
    <AnimatePresence>{archiveOpen && <ArchiveDialog key="archive" reading={reading} close={() => setArchiveOpen(false)} saved={p => { setArchiveOpen(false); setArchiveNotice(`已收藏到「${p.name}」`) }} />}</AnimatePresence>
    <AnimatePresence>{versionsOpen && <VersionPanel key="versions" reading={reading} close={() => setVersionsOpen(false)} selected={() => { setParams({}, { replace: true, state: location.state }); setVersionsOpen(false) }} />}</AnimatePresence>
    <AnimatePresence>{accessOpen && <CloudAccessDialog key="access" close={() => setAccessOpen(false)} />}</AnimatePresence>
  </main>
}

export function resultScroll(recordId: string) {
  return [...detailEntries.values()].find(entry => entry.recordId === recordId)?.scroll ?? 0
}
