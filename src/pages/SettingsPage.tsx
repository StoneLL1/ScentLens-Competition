import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Capacitor } from '@capacitor/core'
import { version } from '../../package.json'
import { ManagementLayout, ManagementLink } from '../components/ManagementLayout'
import { BrandMark } from '../components/BrandMark'
import { usePocket, pocketLabel } from '../app/pocketHooks'
import { libraryReturnState } from '../app/libraryNavigation'
import { openBluetoothSettings } from '../services/ble/transport'

let demoUnlocked = false
export const isDemoUnlocked = () => demoUnlocked

export function SettingsPage() {
  const pocket = usePocket()
  return <ManagementLayout title="设置"><section className="management-group" aria-label="设置项目">
    <ManagementLink to="/device" title="闻见 Pocket" detail={pocketLabel(pocket)} />
    <ManagementLink to="/permissions" title="权限说明" detail="蓝牙、本机存储与照片" />
    <ManagementLink to="/about" title="关于闻见" detail={`ScentLens ${version}`} />
  </section><p className="management-hint">无需账号。识别与收藏保存在当前设备。</p></ManagementLayout>
}
export function AboutPage() {
  const taps = useRef({ count: 0, at: 0 }), navigate = useNavigate()
  const tapVersion = () => {
    const now = Date.now()
    taps.current = { count: now - taps.current.at <= 1800 ? taps.current.count + 1 : 1, at: now }
    if (taps.current.count === 5) { demoUnlocked = true; taps.current.count = 0; navigate('/debug', { state: libraryReturnState() }) }
  }
  return <ManagementLayout title="关于闻见" fallback="/settings"><section className="about-identity"><BrandMark /><h2>闻见 ScentLens</h2><p>让气味被看见，让记忆有形。</p><button className="text-action" onClick={tapVersion}>版本 {version}</button></section><p className="management-hint">配合闻见 Pocket 读取气味，绘制八维图谱，并将气味转译为视觉作品。作品用于感官探索，不代表化学成分或健康检测结果。</p></ManagementLayout>
}
export function PermissionsPage() {
  const state = usePocket(), [error, setError] = useState('')
  return <ManagementLayout title="权限说明" fallback="/settings"><div className="permission-sections">
    <section><h2>蓝牙</h2><p>用于搜索、连接 Pocket 并接收八维数据。首次搜索时，iPhone 会询问蓝牙权限。</p><p>{state.connection === 'connected' ? `当前 Pocket ${pocketLabel(state)}。` : Capacitor.isNativePlatform() ? '当前未连接；连接状态不等于系统授权状态。可前往系统设置检查蓝牙授权。' : '当前浏览器不使用原生蓝牙。请在 iPhone App 中连接。'}</p><ManagementLink to="/device" title="查看 Pocket" />{Capacitor.isNativePlatform() && <button className="text-action" onClick={() => void openBluetoothSettings().catch(() => setError('无法打开系统设置。请手动前往 iPhone 设置 → 闻见 → 蓝牙。'))}>前往系统设置</button>}</section>
    <section><h2>本机存储</h2><p>记录与作品保存在 App 的私有空间，无需相册授权。清理缓存会保留业务原图；删除 App 会移除本地数据。</p></section>
    <section><h2>照片与分享</h2><p>保存原图时仅请求添加照片权限，不读取你的相册。拒绝后可从导出提示打开系统设置，授权后返回重试。分享使用独立方形品牌卡；取消不影响本机记录。App 内保存与系统相册保存分别反馈。</p></section>
    <section><h2>云端生成</h2><p>生成作品时会发送八维分数与生成所需信息。香水名称、品牌和备注保存在本机。离线仍可回看已有记录与作品。</p></section>
  </div>{error && <p role="alert" className="library-error">{error}</p>}</ManagementLayout>
}
