// Wire contract shared by the App and Node endpoints. No provider credentials here.
// Text, image and transfer share one deadline; a stage change never renews it.
export const GENERATION_BUDGET_MS = 120_000

export interface RequestIdentity {
  recordId: string
  attemptId: string
  generationId: string
  requestId: string
}
export interface ModelCall {
  provider: string
  modelRequested: string
  modelActual?: string
  durationMs: number
  parameters: Record<string, string | number>
}
export interface CloudProvenance {
  identity: RequestIdentity
  variantIndex: number
  configHash: string
  promptHash: string
  sceneCall: ModelCall
  displayCall: ModelCall
  displayPromptVersion: 'zh-display-v1'
  imageConfig: ImageConfig
  // Signs the complete interpretation, bound to caller + Reading. Not a model key.
  permit: string
}
export interface ImageConfig {
  provider: string
  model: string
  size: '1024x1024'
  quality: 'low' | 'medium' | 'high' | 'auto'
  output_format: 'png'
}
export interface CloudInterpretation {
  title: string
  keywords: string[]
  description: string
  displayTextOrigin: 'cloud'
  finalImagePrompt: string
  recipeSnapshot: unknown
  sceneInputSnapshot: unknown
  scenePrompt: string
  generationConfigSnapshot: unknown
  model?: string
  promptVersion?: string
  completedAt: string
  cloud: CloudProvenance
}
export type InterpretResponse = RequestIdentity & ({ status: 'ready'; interpretation: CloudInterpretation } | { status: 'empty'; code: 'EMPTY_RECIPE'; message: string })
export interface ImageResponse extends RequestIdentity {
  imageBase64: string
  mimeType: 'image/png'
  width: 1024
  height: 1024
  byteSize: number
  sha256: string
  promptHash: string
  call: ModelCall
  completedAt: string
}
export type CloudPhase = 'interpreting' | 'generating' | 'saving-artwork' | 'save-failed' | 'ready' | 'interrupted' | 'timeout' | 'failed' | 'empty'
export interface CloudAttempt {
  recordId: string
  attemptId: string
  generationId: string
  interpretRequestId: string
  imageRequestId: string
  variantIndex: number
  startedAt: number
  deadline: number
  phase: CloudPhase
  interpretation?: CloudInterpretation
  errorCode?: string
  error?: string
}
export class GenerationFailure extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = true) { super(message) }
}
export function isObject(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) }
export function validText(v: unknown, max: number): v is string { return typeof v === 'string' && !!v.trim() && v.length <= max }
export function assertIdentity(v: unknown, expected?: RequestIdentity): asserts v is RequestIdentity {
  if (!isObject(v) || !['recordId', 'attemptId', 'generationId', 'requestId'].every(k => typeof v[k] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v[k] as string) && (!expected || v[k] === expected[k as keyof RequestIdentity]))) throw new GenerationFailure('IDENTITY_MISMATCH', '生成响应与本次记录不匹配。')
}
export function assertDisplay(v: unknown): asserts v is { title: string; keywords: string[]; description: string } {
  if (!isObject(v) || !validText(v.title, 40) || !validText(v.description, 240) || !Array.isArray(v.keywords) || v.keywords.length < 1 || v.keywords.length > 3 || !v.keywords.every(k => validText(k, 12)) || !/[\u3400-\u9fff]/u.test(`${v.title}${v.description}`)) throw new GenerationFailure('INVALID_DISPLAY', '中文文字未完整返回，请重新解释。')
}
export function assertCloudInterpretation(v: unknown): asserts v is CloudInterpretation {
  assertDisplay(v)
  const o = v as unknown as Record<string, unknown>, c = o.cloud
  if (o.displayTextOrigin !== 'cloud' || !validText(o.finalImagePrompt, 24000) || !validText(o.scenePrompt, 12000) || !isObject(o.recipeSnapshot) || !isObject(o.sceneInputSnapshot) || !isObject(o.generationConfigSnapshot) || typeof o.completedAt !== 'string' || !Number.isFinite(Date.parse(o.completedAt)) || !isObject(c) || !validText(c.permit, 512) || !Number.isSafeInteger(c.variantIndex) || Number(c.variantIndex) < 0 || !isObject(c.imageConfig) || c.imageConfig.size !== '1024x1024' || c.imageConfig.output_format !== 'png' || !['auto','low','medium','high'].includes(String(c.imageConfig.quality)) || !validText(c.imageConfig.provider, 120) || !validText(c.imageConfig.model, 120) || !/^[a-f0-9]{64}$/.test(String(c.promptHash)) || !/^[a-f0-9]{64}$/.test(String(c.configHash)) || c.displayPromptVersion !== 'zh-display-v1') throw new GenerationFailure('INVALID_RESPONSE', '解释响应不完整，八维仍保留。')
  assertIdentity(c.identity)
  assertModelCall(c.sceneCall); assertModelCall(c.displayCall)
}
export function assertModelCall(v: unknown): asserts v is ModelCall {
  if (!isObject(v) || !validText(v.provider, 120) || !validText(v.modelRequested, 120) || (v.modelActual !== undefined && !validText(v.modelActual, 120)) || typeof v.durationMs !== 'number' || !Number.isFinite(v.durationMs) || v.durationMs < 0 || !isObject(v.parameters) || Object.values(v.parameters).some(x => typeof x !== 'string' && (typeof x !== 'number' || !Number.isFinite(x)))) throw new GenerationFailure('INVALID_RESPONSE', '模型来源信息无效。')
}
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024
export const MAX_IMAGE_JSON_BYTES = 4_300_000
