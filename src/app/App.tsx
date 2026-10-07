import { DevicePage } from '../pages/DevicePage'
import { useCapture } from './readingHooks'
import '../styles/device.css'
import { useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType, useNavigate } from 'react-router'
import { MotionConfig } from 'motion/react'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { BottomNav } from '../components/BottomNav'
import { LaunchPage } from '../pages/LaunchPage'
import { HomePage } from '../pages/HomePage'
import { NotFoundPage } from '../pages/ComingSoonPage'
import { ProfilePage } from '../pages/ProfilePage'
import { SettingsPage, AboutPage, PermissionsPage } from '../pages/SettingsPage'
import { StoragePage } from '../pages/StoragePage'
import { DemoPage, DebugPage } from '../pages/DemoPage'
import { markEntered } from './onboarding'
import { AssetPreview } from '../dev/AssetPreview'
import { TrialPage } from '../pages/TrialPage'
import { CapturePage } from '../pages/CapturePage'
import { ReadingPage, resultScroll } from '../pages/ReadingPage'
import { coordinator, pocket, pocketMode } from './runtime'
import { StorageGate, StorageNotice } from './StorageGate'
import { GalleryPage } from '../pages/GalleryPage'
import { PerfumePage } from '../pages/PerfumePage'
import { HistoryPage } from '../pages/HistoryPage'
import { bindLifecycle } from './lifecycle'
import '../styles/library.css'
import '../styles/profile.css'

function Shell() {
  const { pathname } = useLocation()
  const navigate = useNavigate(), capture = useCapture(), routedSession = useRef<string>(undefined)
  useEffect(() => { if (pocketMode) void pocket.reconnect() }, [])
  const navigationType = useNavigationType()
  const hasNav = ['/home', '/trial', '/gallery', '/me'].includes(pathname)
  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])
  useEffect(() => {
    const keyboard = () => { document.documentElement.dataset.input = 'keyboard' }
    const pointer = () => { delete document.documentElement.dataset.input }
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('pointerdown', pointer, true)
    return () => { document.removeEventListener('keydown', keyboard, true); document.removeEventListener('pointerdown', pointer, true); pointer() }
  }, [])
  useEffect(() => {
    // BrowserRouter updates history before its transition commits. An older
    // route/state effect must not cancel a session already entering /capture.
    const current = coordinator.getSnapshot()
    if (pathname !== window.location.pathname || current.sessionId !== capture.sessionId || current.phase !== capture.phase) return
    if (['reading', 'saving', 'save-failed'].includes(capture.phase) && capture.sessionId !== routedSession.current) {
      routedSession.current = capture.sessionId
      if (pathname !== '/capture') navigate('/capture')
      return
    }
    coordinator.routeChanged(pathname)
    window.scrollTo(0, navigationType === 'POP' && pathname.startsWith('/result/') ? resultScroll(pathname.slice(8)) : 0)
    document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
    const title = document.querySelector('h1')?.textContent
    document.title = title ? `${title} · 闻见 ScentLens` : '闻见 ScentLens'
    if (pathname === '/home') markEntered()
  }, [pathname, navigationType, capture.phase, capture.sessionId, capture.inputSource, navigate])
  useEffect(() => bindLifecycle(
    () => coordinator.stop(), document, window,
    hidden => { document.documentElement.toggleAttribute('data-app-hidden', hidden); if (pocketMode) pocket.setForeground(!hidden) },
    Capacitor.isNativePlatform() ? NativeApp : undefined,
  ), [])

  return <div className="app-shell" data-has-nav={hasNav}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {!pathname.startsWith('/result/') && !pathname.startsWith('/scent/') && <StorageNotice />}
    {capture.passiveNotice && <aside className="passive-notice" role="status">{capture.passiveNotice}{capture.passiveSaveFailed ? <button className="text-action" onClick={() => void coordinator.retryPassiveSave()}>重试保存</button> : <button className="text-action" onClick={() => coordinator.dismissPassiveNotice()}>知道了</button>}</aside>}
    <Routes>
      <Route path="/connect" element={<DevicePage first />} />
      <Route path="/device" element={<DevicePage />} />
      <Route path="/" element={<Navigate to="/launch" replace />} />
      <Route path="/launch" element={<LaunchPage />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/trial" element={<TrialPage />} />
      <Route path="/capture" element={<CapturePage />} />
      <Route path="/result/:recordId" element={<ReadingPage />} />
      <Route path="/scent/:recordId" element={<ReadingPage detail />} />
      <Route path="/gallery" element={<GalleryPage />} />
      <Route path="/gallery/:perfumeId" element={<PerfumePage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/me" element={<ProfilePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/storage" element={<StoragePage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/permissions" element={<PermissionsPage />} />
      <Route path="/debug" element={<DemoPage />} />
      <Route path="/debug/errors" element={<DebugPage />} />
      {import.meta.env.DEV && <Route path="/__assets" element={<AssetPreview />} />}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    {hasNav && <BottomNav />}
  </div>
}

export function App() {
  return <MotionConfig reducedMotion="user"><StorageGate><BrowserRouter><Shell /></BrowserRouter></StorageGate></MotionConfig>
}
