import { createReading } from './reading'

// Authored named fixtures, in HARDWARE_ORDER; no device measurement claims.
export const demoPresets = [
  { id: 'garden', name: '雨后花园', description: '青草、玫瑰与一缕柠檬', scores: [.18, .12, .08, .54, .38, .72, .24, .88] },
  { id: 'woods', name: '温暖木香', description: '雪松、香草与丁香', scores: [.76, .16, .62, .10, .22, .12, .91, .28] },
  { id: 'quiet', name: '无明显气味', description: '全零有效八维，验证待生成与中性展示', scores: [0, 0, 0, 0, 0, 0, 0, 0] },
] as const
export function createDemoReading(presetId: string) {
  const preset = demoPresets.find(p => p.id === presetId)
  if (!preset) throw new Error('演示预设不存在')
  return createReading({ captureSessionId: crypto.randomUUID(), source: 'demo', rawScores: [...preset.scores], rawScale: '0-1', resultValid: true, preview: false, quality: 'unknown', deviceMetadata: { demoPreset: preset.id, demoPresetVersion: '1', inputOrigin: 'scentlens-authored-demo' } })
}
