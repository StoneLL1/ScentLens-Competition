import { assertCloudInterpretation, assertIdentity, assertModelCall, GenerationFailure, isObject, MAX_IMAGE_BYTES, MAX_IMAGE_JSON_BYTES, type CloudAttempt, type CloudInterpretation, type ImageResponse, type RequestIdentity } from '../../shared/generation'
import type { Reading } from '../domain/reading'
import { digest } from '../data/ImageStore'

export interface GenerationContext { attempt: CloudAttempt; interpretation?: CloudInterpretation }
export interface EmptyInterpretation { status: 'empty'; message: string }
export interface CloudImage { blob: Blob; metadata: Omit<ImageResponse, 'imageBase64'> }
// User-entered business access credential, memory-only; never a provider key.
export class CloudGenerationAdapter {
  readonly kind = 'cloud' as const
  private accessCode = ''
  constructor(readonly baseUrl: string, private request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  configureAccess(code: string) { this.accessCode = code.trim() }
  hasAccess() { return !!this.accessCode }
  private async post(path: string, payload: RequestIdentity & Record<string, unknown>, signal: AbortSignal, max: number) {
    if (!this.baseUrl) throw new GenerationFailure('NOT_CONFIGURED', '生成服务尚未连接，八维已保留。', false)
    if (!this.accessCode) throw new GenerationFailure('ACCESS_DENIED', '输入演示访问码后，即可生成作品。', false)
    const base = new URL(this.baseUrl)
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1')) throw new GenerationFailure('NOT_CONFIGURED', '生成服务地址需要 HTTPS。', false)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new GenerationFailure('OFFLINE', '当前离线，联网后可继续生成。')
    let response: Response
    try { response = await this.request(`${base.href.replace(/\/$/, '')}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.accessCode}` }, body: JSON.stringify(payload), signal, redirect: 'error', cache: 'no-store' }) }
    catch { throw new GenerationFailure(signal.aborted ? 'TIMEOUT' : 'NETWORK', signal.aborted ? '本次等待已结束。' : '暂时无法连接生成服务，请联网后重试。') }
    const reader = response.body?.getReader()
    if (!reader || Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new GenerationFailure('INVALID_RESPONSE', '返回内容无效或过大。') }
    let size = 0; const chunks: Uint8Array[] = []
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > max) throw new GenerationFailure('RESPONSE_TOO_LARGE', '图片超过传输上限。'); chunks.push(value) } }
    catch (e) { await reader.cancel().catch(() => {}); throw e }
    const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length }
    let value: unknown; try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new GenerationFailure('INVALID_RESPONSE', '服务返回了无效内容。') }
    if (!response.ok) {
      if (isObject(value) && isObject(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string' && (value.error.requestId === undefined || value.error.requestId === payload.requestId)) throw new GenerationFailure(value.error.code, value.error.message.slice(0, 240), value.error.retryable === true)
      throw new GenerationFailure('SERVER_ERROR', '生成服务暂不可用。')
    }
    assertIdentity(value, payload)
    return value as RequestIdentity & Record<string, unknown>
  }
  async interpret(reading: Reading, signal: AbortSignal, context?: GenerationContext): Promise<CloudInterpretation | EmptyInterpretation> {
    if (!context) throw new Error('Missing generation identity')
    const a = context.attempt, ids = { recordId: a.recordId, attemptId: a.attemptId, generationId: a.generationId, requestId: a.interpretRequestId }
    const response = await this.post('interpret', { ...ids, remainingBudgetMs: Math.max(0, a.deadline - Date.now()), confidenceScale: '0-100', scores: reading.scores100, source: reading.source, variantIndex: a.variantIndex }, signal, 180000)
    if (response.status === 'empty' && response.code === 'EMPTY_RECIPE') return { status: 'empty', message: '本次特征较弱，暂未形成可生成场景。' }
    if (response.status !== 'ready') throw new GenerationFailure('INVALID_RESPONSE', '解释返回状态无效。')
    assertCloudInterpretation(response.interpretation)
    assertIdentity(response.interpretation.cloud.identity, ids)
    if (response.interpretation.cloud.variantIndex !== a.variantIndex || await digest(new TextEncoder().encode(response.interpretation.finalImagePrompt)) !== response.interpretation.cloud.promptHash) throw new GenerationFailure('INVALID_RESPONSE', '场景身份或 Prompt 校验失败。')
    return response.interpretation
  }
  async image(_reading: Reading, signal: AbortSignal, context?: GenerationContext): Promise<CloudImage> {
    if (!context?.interpretation) throw new Error('Missing successful interpretation')
    const a = context.attempt
    const response = await this.post('generate-image', { recordId: a.recordId, attemptId: a.attemptId, generationId: a.generationId, requestId: a.imageRequestId, remainingBudgetMs: Math.max(0, a.deadline - Date.now()), interpretation: context.interpretation }, signal, MAX_IMAGE_JSON_BYTES)
    assertModelCall(response.call)
    if (response.mimeType !== 'image/png' || response.width !== 1024 || response.height !== 1024 || typeof response.imageBase64 !== 'string' || response.imageBase64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || response.promptHash !== context.interpretation.cloud.promptHash || response.call.modelRequested !== context.interpretation.cloud.imageConfig.model || response.call.provider !== context.interpretation.cloud.imageConfig.provider || typeof response.completedAt !== 'string' || !Number.isFinite(Date.parse(response.completedAt))) throw new GenerationFailure('INVALID_IMAGE', '图片内容或来源不匹配。')
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(response.imageBase64), c => c.charCodeAt(0)) } catch { throw new GenerationFailure('INVALID_IMAGE', '图片编码无效。') }
    if (bytes.byteLength !== response.byteSize || await digest(bytes) !== response.sha256) throw new GenerationFailure('INVALID_IMAGE', '图片完整性校验失败。')
    const { imageBase64: _, ...metadata } = response
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), metadata: metadata as unknown as CloudImage['metadata'] }
  }
}
