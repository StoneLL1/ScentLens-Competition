import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Capacitor } from '@capacitor/core'
import { savePocketDiagnostics } from '../services/ble/diagnostics'
import { BackLink } from '../components/ui'
import { pocket, pocketMode, coordinator } from '../app/runtime'
import { usePocket, pocketGuidance, pocketLabel } from '../app/pocketHooks'
import { useCapture } from '../app/readingHooks'
import { markEntered } from '../app/onboarding'
import { openBluetoothSettings } from '../services/ble/transport'
import { libraryReturnEntry } from '../app/libraryNavigation'

export function DevicePage({ first = false }: { first?: boolean }) {
  const location = useLocation(), navigate = useNavigate()
  const state = usePocket(), capture = useCapture(), guidance = pocketGuidance(state)
  const [params] = useSearchParams(), perfumeId = params.get('perfume')
  const trialPath = perfumeId ? `/trial?perfume=${encodeURIComponent(perfumeId)}` : '/trial'
  const [feedback, setFeedback] = useState<string>()
  const busy = state.connection === 'connecting' || !!state.command
  const exportDiagnostics = async () => {
    try {
      await savePocketDiagnostics(pocket.diagnostics())
      setFeedback('设备诊断已保存到本机。')
    } catch { setFeedback('诊断保存失败，请重试。') }
  }
  return <main className="screen device-screen" id="main-content">
    <header className="secondary-header">{libraryReturnEntry(location.state) ? <button className="text-action" onClick={() => navigate(-1)}>返回</button> : <BackLink />}<span className="brand-wordmark">SCENTLENS</span></header>
    <section className="device-content">
      <h1 tabIndex={-1}>{first ? '连接闻见 Pocket' : '闻见 Pocket'}</h1>
      <p className="device-lead">让身边的气味，成为一份记忆。</p>
      <div className="device-emblem" aria-hidden="true"><svg viewBox="0 0 80 100" fill="none"><rect x="17" y="6" width="46" height="88" rx="21" /><circle cx="40" cy="34" r="13" /><path d="M34 76h12M34 34h12M40 28v12" /></svg></div>
      <p className="device-connection" data-connected={state.connection === 'connected'} role="status"><i />Pocket {pocketLabel(state)}</p>
      <h2>{guidance.title}</h2><p className="device-description">{guidance.body}</p>
      {state.error && <p className="device-error" role="alert">{state.error}</p>}
      {state.notice && <p className="device-note" role="status">{state.notice}</p>}
      {state.connection === 'connected' ? <>
        <Link className="button" to={coordinator.isBusy() ? capture.recordId ? `/result/${capture.recordId}` : '/capture' : trialPath}>{coordinator.isBusy() ? '回到当前试香' : '准备试香'}</Link>
        <button className="text-action" disabled={busy} onClick={() => void pocket.refresh().then(() => { if (pocket.canPrepare() || pocket.canStart()) coordinator.acknowledgeDeviceRecovery() })}>刷新设备状态</button>
      </> : <>
        <div className="device-list" aria-label="发现的 Pocket">{state.devices.map(device => <button className="device-choice" key={device.deviceId} disabled={busy} onClick={() => void pocket.connect(device)}><span>{device.name}</span><span>连接</span></button>)}</div>
        <button className="button" disabled={busy || state.connection === 'scanning'} onClick={() => void pocket.scan()}>{state.connection === 'scanning' ? '正在搜索 Pocket…' : '搜索 Pocket'}</button>
        {!pocketMode && <p className="device-note">此环境使用开发模拟。真实蓝牙请在 iPhone App 中连接。</p>}
      </>}
      {Capacitor.isNativePlatform() && state.error && <button className="text-action" onClick={() => void openBluetoothSettings().catch(() => setFeedback('请在 iPhone 设置中允许闻见使用蓝牙。'))}>前往系统设置</button>}
      <Link className="text-action" to="/home" replace={first} onClick={() => { markEntered(); void pocket.stopScan() }}>{first ? '先逛逛' : '返回首页'}</Link>
      {(state.state || state.error) && <details className="device-diagnostics"><summary>设备信息与诊断</summary><dl>
        <dt>固件</dt><dd>{String(state.state?.firmware ?? '未知')}</dd>
        <dt>模型</dt><dd>{String(state.state?.model_id ?? '未知')}</dd>
        <dt>阶段</dt><dd>{String(state.state?.offline_phase ?? '未知')}</dd>
        <dt>电量 / 健康</dt><dd>设备未提供</dd>
      </dl>{Capacitor.isNativePlatform() && <button className="text-action" onClick={() => void exportDiagnostics()}>保存诊断到本机</button>}
      <button className="text-action" disabled={busy || coordinator.isBusy()} onClick={() => void pocket.disconnect()}>断开 Pocket</button></details>}
      {feedback && <p className="device-note" role="status">{feedback}</p>}
    </section>
  </main>
}
