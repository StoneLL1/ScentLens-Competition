import { useSyncExternalStore } from 'react'
import { pocket } from './runtime'
import type { PocketSnapshot } from '../services/ble/PocketDevice'
export const usePocket = () => useSyncExternalStore(pocket.subscribe, pocket.getSnapshot)
export function pocketLabel(s: PocketSnapshot) {
  if (s.connection === 'scanning') return '搜索中'
  if (s.connection === 'connecting') return '连接中'
  if (s.connection !== 'connected') return '未连接'
  if (!s.fresh) return '状态过期'
  return '已连接'
}
export function pocketGuidance(s: PocketSnapshot): { title: string; body: string } {
  if (s.connection !== 'connected') return { title: '先连接你的 Pocket', body: '给圆屏和 Kit 上电，放在手机附近，连接后再准备试香。' }
  if (!s.fresh) return { title: '需要更新设备状态', body: '暂时没有收到新鲜状态。刷新后再操作，已有气味记录不受影响。' }
  if (s.state?.capture_active !== false) return { title: '设备暂不可用于试香', body: s.state?.capture_active === true ? '训练采集正在占用设备，结束后刷新状态。' : '尚无法确认设备是否被占用，请刷新状态。' }
  if (s.state?.kit_ready !== true) return { title: '等待传感器就绪', body: '圆屏已连接，请检查 Kit 的电源和连接。只有 Kit 就绪后才能读取。' }
  if (s.state?.preview !== false) return { title: '请退出设备演示', body: '演示分数不会保存为真实识别。请在圆屏退出演示，再刷新状态。' }
  if (s.command === 'STOP') return { title: '正在确认停止', body: '已停止接纳本轮结果，等待 Pocket 确认。' }
  if (s.uncertain) return { title: '上次操作还需确认', body: '设备执行结果未知。请查看 Pocket 并刷新状态，勿重复开始。' }
  if (s.command || s.state?.pending !== false) return { title: '等待设备确认', body: 'Pocket 正在处理操作，请保持连接。' }
  const phases: Record<string, { title: string; body: string }> = {
    idle: { title: '为新的气味留出空间', body: '移走上一次的样品，确认 Pocket 中没有试香纸，再准备背景。' },
    background: { title: '正在准备空气背景', body: '请保持 Pocket 中没有试香纸。设备会在背景稳定后告诉你何时放入样品。' },
    prepared: { title: '放入你的试香纸', body: '空气背景已准备好。喷香后，让试香纸自然静置；放入 Pocket，准备好时再开始。' },
    sampling: { title: '正在读取气味', body: '请保持试香纸位置，不要取出。' },
    done: { title: '为下一次试香做准备', body: '移走当前样品，确认后重新准备空气背景。已有结果会保留。' },
    waiting_removal: { title: '请先移走样品', body: '背景需要重新准备。确认 Pocket 中没有试香纸后继续。' },
    failed: { title: '这次读取未完成', body: '请移走样品，检查 Kit 后重新准备。' },
  }
  return phases[String(s.state?.offline_phase)] ?? { title: '需要确认设备状态', body: '尚未识别当前阶段，请刷新状态后继续。' }
}
