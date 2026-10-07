import { PocketTrial } from './PocketTrial'
import { pocketMode } from '../app/runtime'
import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { BackLink } from '../components/ui'
import { coordinator, mockDevice, cloudMode } from '../app/runtime'
import { CloudAccessDialog } from '../components/CloudAccessDialog'
import { useCapture } from '../app/readingHooks'
import { useLibrary } from '../app/libraryHooks'

export function TrialPage() { return pocketMode ? <PocketTrial /> : <MockTrial /> }

function MockTrial() {
  const navigate = useNavigate()
  const capture = useCapture()
  const [params] = useSearchParams(), { data, error, retry } = useLibrary()
  const perfumeId = params.get('perfume'), perfume = data?.perfumes.find(p => p.id === perfumeId)
  const [prepared, setPrepared] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const busy = coordinator.isBusy()
  return <main className="screen trial-screen" id="main-content">
    <header className="secondary-header"><BackLink /><span className="brand-wordmark">SCENTLENS</span></header>
    <section className="trial-content">
      <p className="eyebrow">SCENT CAPTURE</p>
      <h1 tabIndex={-1}>准备一次试香</h1>
      <p className="source-note">开发模拟 · 无需连接 Pocket</p>
      {perfumeId && <p className="trial-archive" role="status">{perfume ? `本次将自动收藏到「${perfume.name}」` : error ? '无法读取档案，请重试。' : data ? '这份档案已不存在，请返回香廊重新选择。' : '正在确认香水档案…'}{error && <button className="text-action" onClick={retry}>重试</button>}</p>}
      <div className="trial-illustration" data-prepared={prepared} aria-hidden="true"><span /><i /><b /></div>
      <h2>{prepared ? '放入你的试香纸' : '为新的气味留出空间'}</h2>
      <p>{prepared ? '喷香后，让试香纸自然静置。准备好时再开始，没有固定倒计时。' : '移走上一次的样品，确认 Pocket 中没有试香纸，再进行下一步。'}</p>
      <p className="trial-disclosure">{cloudMode ? '本次使用模拟八维。配置访问码后将调用真实生成服务；尚未连接 Pocket。' : '本次使用模拟八维，文字与作品为开发演示；不会连接设备或调用云端模型。'}</p>
      {cloudMode && <button className="text-action" onClick={() => setAccessOpen(true)}>输入演示访问码</button>}
      {!prepared ? <button className="button" onClick={() => setPrepared(true)}>已移走样品，准备好了</button> :
        <button className="button" disabled={busy || !!perfumeId && !perfume} onClick={() => { if (coordinator.start(perfume?.id)) navigate('/capture') }}>开始读取</button>}
      {busy && <Link className="text-action" to={capture.recordId ? `/result/${capture.recordId}` : '/capture'}>回到当前试香</Link>}
      {import.meta.env.DEV && <details className="mock-options"><summary>开发模拟选项</summary>
        <label>八维样本<select defaultValue="design" onChange={event => {
          mockDevice.rawScores = event.target.value === 'zero' ? Array(8).fill(0) : event.target.value === 'mapping' ? [.01,.02,.03,.04,.05,.06,.07,.08] : event.target.value === 'invalid' ? [1, 2] : [.12,.08,.64,.62,.78,.21,.15,.71]
        }}><option value="design">设计样例（非对称）</option><option value="mapping">协议映射样例</option><option value="zero">完整全零</option><option value="invalid">缺失数据</option></select></label>
        <label><input type="checkbox" onChange={event => { mockDevice.delayMs = event.target.checked ? null : 3500 }} />手动送达读取结果</label>
      </details>}
    </section>
    <AnimatePresence>{accessOpen && <CloudAccessDialog close={() => setAccessOpen(false)} />}</AnimatePresence>
  </main>
}
