import { useNavigate } from 'react-router'
import { BrandMark } from '../components/BrandMark'
import { hasEntered } from '../app/onboarding'

export function LaunchPage() {
  const navigate = useNavigate()
  return <main className="screen launch-screen" id="main-content">
    <div className="launch-background" aria-hidden="true" />
    <div className="launch-content">
      <p className="brand-wordmark">SCENTLENS</p>
      <div className="launch-identity">
        <BrandMark />
        <p className="eyebrow">SCENT, VISUALIZED.</p>
        <h1 tabIndex={-1}>闻见气味，<br />看见记忆。</h1>
      </div>
      <p className="launch-description">插入试香纸，开始一次气味探索。<br />让每一种香气，都拥有可被看见的形状。</p>
      <button className="button launch-button" onClick={() => navigate(hasEntered() ? '/home' : '/connect', { replace: true })}>开始探索</button>
    </div>
  </main>
}
