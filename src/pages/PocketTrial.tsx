import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link, useSearchParams } from 'react-router'
import { BackLink } from '../components/ui'
import { CloudAccessDialog } from '../components/CloudAccessDialog'
import { pocket, coordinator, cloudMode, bleValidation } from '../app/runtime'
import { usePocket, pocketGuidance, pocketLabel } from '../app/pocketHooks'
import { useCapture } from '../app/readingHooks'
import { useLibrary } from '../app/libraryHooks'

export function PocketTrial() {
  const state = usePocket(), capture = useCapture(), guidance = pocketGuidance(state)
  const [params] = useSearchParams(), { data, error, retry } = useLibrary()
  const perfumeId = params.get('perfume'), perfume = data?.perfumes.find(p => p.id === perfumeId)
  const [accessOpen, setAccessOpen] = useState(false)
  const busy = coordinator.isBusy(), prepared = state.state?.offline_phase === 'prepared'
  const operation = !!state.command || busy
  return <main className="screen trial-screen pocket-trial" id="main-content">
    <header className="secondary-header"><BackLink /><span className="brand-wordmark">SCENTLENS</span></header>
    <section className="trial-content">
      <p className="eyebrow">SCENT CAPTURE</p><h1 tabIndex={-1}>准备一次试香</h1>
      <Link className="device-inline" to="/device">Pocket {pocketLabel(state)}</Link>
      {perfumeId && <p className="trial-archive" role="status">{perfume ? `本次将自动收藏到「${perfume.name}」` : error ? '无法读取档案，请重试。' : data ? '这份档案已不存在，请返回香廊重新选择。' : '正在确认香水档案…'}{error && <button className="text-action" onClick={retry}>重试</button>}</p>}
      <div className="trial-illustration" data-prepared={prepared && state.fresh} aria-hidden="true"><span /><i /><b /></div>
      <h2>{capture.phase === 'starting' ? '正在确认开始读取' : guidance.title}</h2>
      <p>{capture.phase === 'starting' ? '等待 Pocket 确认并进入采样阶段，请保持试香纸静止。' : guidance.body}</p>
      {(state.error || capture.error) && <p className="device-error" role="alert">{state.error ?? capture.error}</p>}
      {state.notice && <p className="device-note" role="status">{state.notice}</p>}
      {state.connection !== 'connected' ? <Link className="button" to={perfumeId ? `/connect?perfume=${encodeURIComponent(perfumeId)}` : "/connect"}>连接 Pocket</Link> : <>
        {prepared ? <button className="button" disabled={operation || !pocket.canStart() || !!perfumeId && !perfume} onClick={() => coordinator.start(perfume?.id)}>开始读取</button> :
          <button className="button" disabled={operation || !pocket.canPrepare()} onClick={() => void pocket.prepare()}>{state.state?.offline_phase === 'background' ? '等待背景准备完成' : '已移走样品，准备背景'}</button>}
        {['starting', 'reading', 'cancelling'].includes(capture.phase) ? <button className="text-action" disabled={capture.phase === 'cancelling'} onClick={() => void coordinator.cancelReading()}>{capture.phase === 'cancelling' ? '正在确认停止…' : '取消读取'}</button> :
          state.state?.offline_phase === 'background' && <button className="text-action" disabled={!!state.command} onClick={() => void pocket.stop().catch(() => {})}>停止背景准备</button>}
        <button className="text-action" disabled={!!state.command} onClick={() => void pocket.refresh().then(() => { if (pocket.canPrepare() || pocket.canStart()) coordinator.acknowledgeDeviceRecovery() })}>刷新设备状态</button>
      </>}
      {busy && capture.phase !== 'starting' && <Link className="text-action" to={capture.recordId ? `/result/${capture.recordId}` : '/capture'}>回到当前试香</Link>}
      {cloudMode && <button className="text-action" onClick={() => setAccessOpen(true)}>输入演示访问码</button>}
      {bleValidation && <p className="trial-disclosure">BLE 验收模式 · 真实设备输入与本地八维保存，本包不调用云端生成。</p>}
    </section>
    <AnimatePresence>{accessOpen && <CloudAccessDialog close={() => setAccessOpen(false)} />}</AnimatePresence>
  </main>
}
