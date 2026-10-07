import { useState, useSyncExternalStore } from 'react'
import { Navigate } from 'react-router'
import { AnimatePresence } from 'motion/react'
import { ManagementLayout, ManagementLink } from '../components/ManagementLayout'
import { CloudAccessDialog } from '../components/CloudAccessDialog'
import { coordinator, cloudMode, cloudGeneration, bleValidation } from '../app/runtime'
import { useCapture } from '../app/readingHooks'
import { demoPresets } from '../domain/demo'
import { diagnosticLabels, diagnostics } from '../services/diagnostics'
import { isDemoUnlocked } from './SettingsPage'

export function DemoPage() {
  const capture = useCapture(), [preset, setPreset] = useState<string>(demoPresets[0].id), [accessOpen, setAccessOpen] = useState(false), [error, setError] = useState('')
  if (!isDemoUnlocked()) return <Navigate to="/about" replace />
  return <ManagementLayout title="演示样本" fallback="/about"><p className="management-intro">用预设八维体验闻见。<br />保存为 Demo，收藏与历史照常可用。</p>
    <fieldset className="demo-presets"><legend>选择一份气味</legend>{demoPresets.map(p => <label key={p.id}><input type="radio" name="preset" value={p.id} checked={p.id === preset} onChange={() => setPreset(p.id)} /><span><strong>{p.name}</strong><small>{p.description}</small></span></label>)}</fieldset>
    <p className="management-hint">{bleValidation ? '当前为 BLE 验收包：仅保存演示八维，不生成作品。' : cloudMode ? '使用已配置的真实生成服务。开始后会发起云端请求，可能产生费用；未连接服务时保留八维，可稍后继续。' : '当前为开发替身：文字与固定测试作品均非真实云端生成。'}</p>
    {cloudMode && <button className="text-action" onClick={() => setAccessOpen(true)}>{cloudGeneration.hasAccess() ? '更新演示访问码' : '输入演示访问码'}</button>}
    <button className="button demo-start" disabled={coordinator.isBusy()} onClick={() => {
      try { if (!coordinator.startDemo(preset)) setError('当前试香尚未结束，请先完成当前操作。') }
      catch { setError('演示样本未能开始，请重新选择后重试。') }
    }}>{cloudMode ? '保存 Demo 并开始生成' : '开始演示'}</button>
    {coordinator.isBusy() && <p role="status" className="management-hint">当前试香仍在处理。{capture.recordId ? '请先回到该记录完成操作。' : '请先结束当前读取。'}</p>}{error && <p role="alert" className="library-error">{error}</p>}
    <div className="management-section"><ManagementLink to="/debug/errors" title="近期错误" detail="当前运行中的有限诊断" /></div>
    <AnimatePresence>{accessOpen && <CloudAccessDialog close={() => setAccessOpen(false)} />}</AnimatePresence>
  </ManagementLayout>
}
export function DebugPage() {
  const entries = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot)
  if (!isDemoUnlocked()) return <Navigate to="/about" replace />
  return <ManagementLayout title="近期错误" fallback="/debug"><p className="management-hint">仅保留本次运行最近 40 条错误的类型、时间与关联标识。关闭 App 后清除；不记录密钥、请求正文或原始通知。</p>{entries.length ? <><ol className="debug-entries">{[...entries].reverse().map(entry => <li key={entry.id}><strong>{diagnosticLabels[entry.kind]}</strong><time>{new Date(entry.at).toLocaleString('zh-CN')}</time>{entry.recordId && <small>Reading · {entry.recordId}</small>}{entry.attemptId && <small>Attempt · {entry.attemptId}</small>}{entry.sessionId && <small>Session · {entry.sessionId}</small>}</li>)}</ol><button className="text-action" onClick={() => diagnostics.clear()}>清除近期错误</button></> : <p className="management-empty">本次运行还没有记录错误。</p>}</ManagementLayout>
}
