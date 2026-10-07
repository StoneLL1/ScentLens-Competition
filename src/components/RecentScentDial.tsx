import { Link } from 'react-router'
import { BrandMark } from './BrandMark'
import { useReading } from '../app/readingHooks'
import { readingTime, readingTitle } from '../domain/reading'
import { InterfaceIcon } from './InterfaceIcon'

export function RecentScentDial() {
  const { reading, loaded, error, retry } = useReading()
  return <section className="recent-section" aria-labelledby="recent-title">
    <div className="recent-heading">
      <h2 id="recent-title">最近识别</h2>
      <Link to="/history" aria-label="查看全部识别记录">查看全部<InterfaceIcon name="next" width="12" height="12" /></Link>
    </div>
    <div className="dial">
      <div className="dial-knob"><BrandMark /></div>
      <div className="dial-axis" aria-hidden="true" />
      <img className="dial-surface" src="/assets/decorative/home-dial-surface.svg" alt="" />
      <div className="dial-seam" aria-hidden="true" />
      <svg className="dial-ticks" viewBox="0 0 402 210" fill="none" aria-hidden="true">
        {[-60, -40, -20, 0, 20, 40, 60].map((angle) => <path key={angle} d="M201 2v13" transform={`rotate(${angle} 201 230)`} stroke="white" strokeWidth="2" />)}
      </svg>
      <div className="dial-empty">
        {error ? <><p role="alert">{error}</p><button className="text-action" onClick={retry}>重试读取</button></> : reading ?
          <Link className="dial-reading" to={`/result/${reading.id}`} aria-label="查看最近一次气味结果"><p>{readingTitle(reading)}</p><span>{readingTime(reading)} · {reading.source === 'mock' ? '开发模拟' : reading.source === 'demo' ? 'Demo' : 'Pocket'}</span><span>{(reading.interpretation ?? reading.developmentText)?.keywords.join(' · ') || '八维已保存 · 查看气味结果'} <InterfaceIcon name="outward" width="14" height="14" /></span></Link> :
          <><p>{loaded ? '还没有留下气味记忆' : '正在打开气味记忆'}</p><span>{loaded ? '从第一次试香开始' : '读取本地记录中'}</span></>}
      </div>
    </div>
  </section>
}
