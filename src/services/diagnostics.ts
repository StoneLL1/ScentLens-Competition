export const diagnosticLabels = {
  reading: '读取未完成', validation: '八维校验未通过', api: '生成阶段未完成',
  save: '本地保存未完成', protection: '恢复保护未完成', cleanup: '文件清理未完成', recovery: '本地恢复需处理',
} as const
export interface DiagnosticEntry {
  id: number; at: string; kind: keyof typeof diagnosticLabels
  recordId?: string; attemptId?: string; sessionId?: string
}
// Memory only. No arbitrary messages, provider bodies, URLs, credentials or raw BLE frames.
let entries: DiagnosticEntry[] = [], sequence = 0
const listeners = new Set<() => void>()
const identity = (value?: string) => value && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : undefined
export const diagnostics = {
  record(kind: DiagnosticEntry['kind'], context: Pick<DiagnosticEntry, 'recordId' | 'attemptId' | 'sessionId'> = {}) {
    entries = [...entries.slice(-39), { id: ++sequence, at: new Date().toISOString(), kind,
      recordId: identity(context.recordId), attemptId: identity(context.attemptId), sessionId: identity(context.sessionId) }]
    listeners.forEach(fn => fn())
  },
  getSnapshot: () => entries,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
  clear() { entries = []; listeners.forEach(fn => fn()) },
}
