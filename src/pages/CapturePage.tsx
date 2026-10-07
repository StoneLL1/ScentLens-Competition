/* TASK-02 inherits 378:872: a translucent 342×414 signal card and luminous
 * blue/violet/coral fluid. Real stage text replaces the reference's fake 60%.
 * Reading owns the movement; results quiet down. The shell owns safe areas.
 */
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCapture } from '../app/readingHooks'
import { coordinator, mockDevice, pocketMode } from '../app/runtime'

export function CapturePage() {
  const capture = useCapture()
  const demo = capture.inputSource === 'demo'
  const navigate = useNavigate()
  useEffect(() => {
    if (capture.phase === 'saved' && capture.recordId) navigate(`/result/${capture.recordId}`, { replace: true })
  }, [capture.phase, capture.recordId, navigate])
  const active = ['reading', 'saving'].includes(capture.phase)
  const cancelling = capture.phase === 'cancelling'
  const cancel = async () => { if (await coordinator.cancelReading()) navigate(demo ? '/debug' : '/trial', { replace: true }) }
  const title = cancelling ? '正在确认停止' : capture.phase === 'stop-unknown' ? '还未确认停止' : capture.phase === 'save-failed' ? '八维还未保存' : capture.phase === 'invalid' ? '这次未能完整读取' : active ? demo ? '正在保存演示样本' : '正在读取试香纸' : '准备好再开始'
  return <main className={`screen capture-screen ${active ? 'is-reading' : ''}`} id="main-content">
    <header className="capture-header"><button className="icon-button reading-back" aria-label="取消并返回准备" disabled={cancelling} onClick={() => void cancel()}><img src="/assets/icons/back-reading-white.svg" alt="" /></button></header>
    <section className="capture-intro"><p className="eyebrow">{demo ? 'DEMO SAMPLE' : 'SCENT CAPTURE'}</p><h1 tabIndex={-1}>{title}</h1><p>{demo ? '预设八维 · 不计入真实识别' : active ? '请保持试香纸位置，不要取出' : '完整有效的八维，才会成为气味记忆。'}</p></section>
    <section className="signal-card" aria-label="气味信号">
      <header><span>气味信号</span><span className="eyebrow">{demo ? 'DEMO SAMPLE' : pocketMode ? 'POCKET SAMPLE' : 'MOCK SAMPLE'}</span></header>
      <div className="reading-fluid" aria-hidden="true"><img src="/assets/reading/reading-fluid.png" alt="" /></div>
      <div className="signal-status" role="status"><strong>{capture.phase === 'reading' ? '感知中' : capture.phase === 'saving' ? '保存中' : capture.phase === 'save-failed' ? '等待保存' : '等待重新读取'}</strong><span>{capture.phase === 'saving' ? '八维已收到，正在保存本机' : active ? '正在采集八维气味信号' : '请查看下方提示'}</span></div>
      <footer><p>{demo ? 'Demo 预设 · 非设备实测' : pocketMode ? 'Pocket 实时采样 · 完整八维到达后保存' : '开发模拟 · 非设备实测'}</p><span>{demo ? '演示数据与真实采样分别标记' : '本次读取仅分析试香纸样本'}</span></footer>
    </section>
    <section className="capture-hint"><img src="/assets/icons/paper-stable.svg" alt="" /><div><h2>{capture.error ? '需要你的操作' : demo ? '保存后即可收藏' : '保持试香纸静止'}</h2><p role={capture.error ? 'alert' : undefined}>{capture.error ?? (demo ? 'Demo 沿用同一套本地记录与作品流程' : '轻微移动可能影响气味曲线的稳定性')}</p></div></section>
    <div className="capture-actions">
      {cancelling ? <button className="button" disabled>正在等待 Pocket 确认…</button> : capture.phase === 'stop-unknown' ? <Link className="button" to="/device">查看设备并恢复</Link> : capture.phase === 'save-failed' ? <button className="button" onClick={() => void coordinator.retrySave()}>重试保存八维</button> : active ? <button className="button" disabled={cancelling} onClick={() => void cancel()}>取消读取</button> : <Link className="button" to="/trial" replace>重新准备</Link>}
      {import.meta.env.DEV && !pocketMode && active && mockDevice.delayMs === null && <button className="text-action" onClick={() => mockDevice.deliver()}>送达模拟八维</button>}
    </div>
  </main>
}
