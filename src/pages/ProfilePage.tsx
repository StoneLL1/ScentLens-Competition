import { Link, useNavigate } from 'react-router'
import { useLibrary } from '../app/libraryHooks'
import { libraryReturnState } from '../app/libraryNavigation'
import { usePocket, pocketLabel } from '../app/pocketHooks'
import { pocketMode } from '../app/runtime'
import { profileStats } from '../domain/library'

function ProfileIcon({ name }: { name: string }) {
  if (name === 'gallery') return <img src="/assets/icons/nav-gallery-tree.svg" alt="" />
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{name === 'history' ? <><path d="M5 3h12v16H5z" /><path d="M8 7h6M8 11h6M8 15h4" strokeLinecap="round" /></> : <><ellipse cx="11" cy="5" rx="7" ry="3" /><path d="M4 5v6c0 4 14 4 14 0V5M4 11v6c0 4 14 4 14 0v-6" /></>}</svg>
}

export function ProfilePage() {
  const { data, error, retry } = useLibrary(), state = usePocket(), navigate = useNavigate()
  const stats = data ? profileStats(data) : undefined
  const open = (path: string) => navigate(path, { state: libraryReturnState() })
  return <main className="screen profile-screen" id="main-content">
    <header className="profile-header"><div><h1 tabIndex={-1}>我的</h1><p>PERSONAL SCENT COLLECTION</p></div><button className="icon-button" aria-label="设置" onClick={() => open('/settings')}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 5h8m3 0h3M3 10h3m3 0h8M3 15h9m3 0h2" strokeLinecap="round" /><circle cx="12.5" cy="5" r="1.5" /><circle cx="7.5" cy="10" r="1.5" /><circle cx="13.5" cy="15" r="1.5" /></svg></button></header>
    <div className="profile-content">
      <section className="profile-statistics" aria-label="我的统计">{error ? <button className="text-action" onClick={retry}>统计读取失败，重试</button> : <><div><strong data-testid="real-reading-count">{stats ? String(stats.readings).padStart(2, '0') : '—'}</strong><span>次真实识别</span></div><div><strong data-testid="perfume-count">{stats ? String(stats.perfumes).padStart(2, '0') : '—'}</strong><span>件收藏</span></div></>}</section>
      <p className="profile-count-note">留住每一次真实感知，收好你喜欢的香气。</p>
      <button className="profile-device" onClick={() => open('/device')}><span className="profile-device-icon" aria-hidden="true"><svg width="24" height="30" viewBox="0 0 24 30" fill="none"><rect x="5" y="2" width="14" height="26" rx="6" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.3" /><path d="M10 22h4" stroke="currentColor" strokeWidth="1.5" /></svg></span><span className="profile-device-copy"><strong>Pocket {pocketLabel(state)}</strong><span>{state.connection === 'connected' ? '电量与健康：设备未提供' : pocketMode ? '连接后，开始一次真实试香' : '此环境为开发模拟，真机可连接'}</span></span><i data-online={state.connection === 'connected' && state.fresh} aria-hidden="true" /></button>
      <nav className="profile-shortcuts" aria-label="我的快捷入口">{[
        { path: '/history', label: '识别记录', icon: 'history' },
        { path: '/gallery', label: '我的收藏', icon: 'gallery' },
        { path: '/settings/storage', label: '本地管理', icon: 'storage' },
      ].map(item => <Link to={item.path} key={item.path} onClick={event => { event.preventDefault(); open(item.path) }}><ProfileIcon name={item.icon} /><span>{item.label}</span></Link>)}</nav>
      <p className="profile-footnote">气味记忆，保存在此设备。<br />Demo 与开发模拟不计入真实识别。</p>
    </div>
  </main>
}
