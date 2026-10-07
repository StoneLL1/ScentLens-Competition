import type { FallbackPresentation, Interpretation } from './artwork'
import type { CloudAttempt } from '../../shared/generation'

export const SCENT_KEYS = ['lemon', 'rose', 'lavender', 'grass', 'peach', 'clove', 'cedarwood', 'vanilla'] as const
export type ScentKey = typeof SCENT_KEYS[number]
export type Scores100 = Readonly<Record<ScentKey, number>>
export const HARDWARE_ORDER = ['vanilla', 'peach', 'clove', 'lemon', 'lavender', 'rose', 'cedarwood', 'grass'] as const
export const DISPLAY_ORDER = ['vanilla', 'lemon', 'rose', 'lavender', 'grass', 'peach', 'clove', 'cedarwood'] as const
export const SCENT_LABELS: Record<ScentKey, string> = { vanilla: '香草', lemon: '柠檬', rose: '玫瑰', lavender: '薰衣草', grass: '青草', peach: '桃子', clove: '丁香', cedarwood: '雪松' }

export function parseScores(input: unknown, scale: '0-1' | '0-100'): Scores100 {
  if (scale !== '0-1' && scale !== '0-100') throw new Error('八维数据量纲无效')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('八维数据必须为具名对象')
  const data = input as Record<string, unknown>
  return Object.freeze(Object.fromEntries(SCENT_KEYS.map(key => {
    const value = data[key]
    if (!Object.hasOwn(data, key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (scale === '0-1' ? 1 : 100)) {
      throw new Error(`气味维度缺失或无效：${SCENT_LABELS[key]}`)
    }
    return [key, scale === '0-1' ? value * 100 : value]
  }))) as Scores100
}

export function fromHardware(input: unknown): Scores100 {
  if (!Array.isArray(input) || input.length !== 8) throw new Error('需要完整的八维数据')
  return parseScores(Object.fromEntries(HARDWARE_ORDER.map((key, i) => [key, input[i]])), '0-1')
}

export function toConfidences(scores: Scores100): Readonly<Record<ScentKey, number>> {
  const valid = parseScores(scores, '0-100')
  return Object.freeze(Object.fromEntries(SCENT_KEYS.map(key => [key, valid[key] / 100]))) as Scores100
}

export interface DeviceSample {
  captureSessionId: string
  source: 'device' | 'demo' | 'mock'
  rawScores: unknown
  rawScale: '0-1'
  resultValid: boolean
  preview: boolean
  quality: 'unknown' | 'weak' | 'normal'
  deviceCapturedAt?: string
  deviceMetadata?: Readonly<Record<string, string>>
}

// Explicitly separate development text from a real Interpretation/Generation.
export interface DevelopmentText {
  title: string
  keywords: string[]
  description: string
  origin: 'mock'
  completedAt: string
}

export interface Reading {
  schemaVersion: 1
  id: string
  captureSessionId: string
  source: DeviceSample['source']
  rawScores: number[]
  rawScale: '0-1'
  scores100: Scores100
  capturedAt: string
  capturedAtSource: 'device' | 'phone-received'
  receivedAt: string
  quality: DeviceSample['quality']
  deviceMetadata?: Readonly<Record<string, string>>
  perfumeId?: string
  selectedGenerationId?: string
  developmentText?: DevelopmentText
  interpretation?: Interpretation
  fallbackPresentation?: FallbackPresentation
  cloudAttempt?: CloudAttempt
}

export function createReading(sample: DeviceSample, now = new Date()): Reading {
  if (!sample.captureSessionId || !sample.resultValid || sample.preview || sample.rawScale !== '0-1') throw new Error('这份数据不是本次完整有效结果')
  if (!['device', 'demo', 'mock'].includes(sample.source) || !['unknown', 'weak', 'normal'].includes(sample.quality)) throw new Error('数据来源或质量标识无效')
  const scores100 = fromHardware(sample.rawScores)
  if (sample.deviceCapturedAt && !Number.isFinite(Date.parse(sample.deviceCapturedAt))) throw new Error('设备时间无效')
  return {
    schemaVersion: 1, id: crypto.randomUUID(), captureSessionId: sample.captureSessionId,
    source: sample.source, rawScores: [...sample.rawScores as number[]], rawScale: '0-1', scores100,
    capturedAt: sample.deviceCapturedAt ? new Date(sample.deviceCapturedAt).toISOString() : now.toISOString(),
    capturedAtSource: sample.deviceCapturedAt ? 'device' : 'phone-received', receivedAt: now.toISOString(),
    quality: sample.quality, deviceMetadata: sample.deviceMetadata ? { ...sample.deviceMetadata } : undefined,
  }
}

export function formatScore(score: number) {
  return Number(score.toFixed(2)).toString().padStart(2, '0')
}
export function readingTitle(reading: Reading) { return reading.interpretation?.title ?? reading.developmentText?.title ?? '未命名气味' }
export function readingTime(reading: Reading) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(reading.capturedAt))
}
