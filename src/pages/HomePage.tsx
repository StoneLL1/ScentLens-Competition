/* TASK-01: inherit 418:909, the near-white sensory interface and full-width dial.
 * The Hero owns the first action. The dial honestly shows an empty collection.
 * At 402px: 30px gutters, 342×228 Hero, 66px knob, 342×64 floating navigation.
 * Brand glyph and Pocket replace the reference's account/notification hints.
 * No whole-screen scaling or simulated system chrome; the shell owns safe areas.
 */
import { BrandMark } from '../components/BrandMark'
import { ButtonLink, GlassSurface, PocketStatus } from '../components/ui'
import { RecentScentDial } from '../components/RecentScentDial'
import { useLocation } from 'react-router'
import { InterfaceIcon } from '../components/InterfaceIcon'

export function HomePage() {
  const location = useLocation()
  return <main className="screen home-screen" id="main-content">
    <header className="home-header">
      <div className="home-brand"><BrandMark /></div>
      <div className="home-greeting"><p>闻见 ScentLens</p><span>今天想闻见什么？</span></div>
      <PocketStatus />
    </header>
    {location.state?.notice && <p className="home-notice" role="status">{location.state.notice}</p>}
    <GlassSurface className="home-hero">
      <p className="eyebrow">SCENT CAPTURE</p>
      <h1 tabIndex={-1}>开始一次试香</h1>
      <p className="hero-description">插入试香纸，识别八维气味信号，<br />生成属于这款香气的沉浸影像。</p>
      <ButtonLink to="/trial" className="hero-button">开始试香<InterfaceIcon name="next" width="16" height="16" /></ButtonLink>
    </GlassSurface>
    <RecentScentDial />
  </main>
}
