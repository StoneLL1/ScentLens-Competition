import { createHash } from 'node:crypto'
import { GenerationFailure, MAX_IMAGE_BYTES, assertDisplay, isObject, validText, type ModelCall } from '../../shared/generation.ts'
import type { ServerConfig } from './config.ts'
import { parseJsonStrict } from '../scent-translation/index.ts'

export async function limitedText(response: Response, max: number) {
  if (Number(response.headers.get('content-length')) > max) throw new GenerationFailure('RESPONSE_TOO_LARGE', '返回内容超过传输上限。', false)
  const reader = response.body?.getReader(); if (!reader) throw new GenerationFailure('INVALID_RESPONSE', '服务未返回内容。')
  const chunks: Uint8Array[] = []; let size = 0
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) throw new GenerationFailure('RESPONSE_TOO_LARGE', '返回内容超过传输上限。', false); chunks.push(value) } }
  catch (e) { await reader.cancel().catch(() => {}); throw e }
  return Buffer.concat(chunks).toString('utf8')
}
export const DISPLAY_INSTRUCTION = '根据所给八维、物象方案和英文场景，写一份简洁中文气味作品说明。只输出JSON，字段为title（最多20字的作品标题，不是香水名称）、keywords（1至3个中文短词，每个最多6字）、description（最多100字）。不要推断品牌、化学成分、准确率或健康影响。不要改写英文场景，不输出Markdown。'
export class ModelProvider {
  constructor(private config: ServerConfig, private request: typeof fetch = fetch) {}
  private async post(base: string, path: string, key: string, body: unknown, signal: AbortSignal, max: number) {
    let response: Response
    try { response = await this.request(`${base}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal, redirect: 'error' }) }
    catch { throw new GenerationFailure(signal.aborted ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE', signal.aborted ? '本次等待已结束。' : '暂时无法连接模型服务。') }
    if (!response.ok) { await response.body?.cancel(); throw new GenerationFailure(response.status === 429 ? 'UPSTREAM_LIMIT' : 'UPSTREAM_FAILED', response.status === 429 ? '模型服务额度不足或调用受限。' : '模型服务未完成这次请求。') }
    try { return parseJsonStrict(await limitedText(response, max)) }
    catch (e) { if (e instanceof GenerationFailure) throw e; throw new GenerationFailure('INVALID_RESPONSE', '模型返回格式无效。') }
  }
  async text(instruction: string, input: string, signal: AbortSignal) {
    const { base, key, model } = this.config.interpret, start = Date.now()
    const parameters = { temperature: 0.2, max_tokens: 1800 }
    const value = await this.post(base, 'chat/completions', key, { model, messages: [{ role: 'system', content: instruction }, { role: 'user', content: input }], ...parameters, stream: false }, signal, 100_000)
    if (!isObject(value) || !Array.isArray(value.choices) || !isObject(value.choices[0]) || !isObject(value.choices[0].message) || !validText(value.choices[0].message.content, 12000) || value.choices[0].finish_reason !== 'stop') throw new GenerationFailure('INVALID_SCENE', '场景文字未完整返回。')
    const call: ModelCall = { provider: new URL(base).hostname, modelRequested: model, modelActual: validText(value.model, 120) ? value.model : undefined, parameters, durationMs: Date.now() - start }
    return { text: value.choices[0].message.content, call }
  }
  async display(input: string, signal: AbortSignal) {
    const result = await this.text(DISPLAY_INSTRUCTION, input, signal)
    let value: unknown
    try { value = parseJsonStrict(result.text) } catch { throw new GenerationFailure('INVALID_DISPLAY', '中文说明格式不完整，请重新解释。') }
    assertDisplay(value)
    return { value, call: result.call }
  }
  async image(prompt: string, signal: AbortSignal) {
    const { base, key, config } = this.config.image, start = Date.now()
    const parameters = { size: config.size, quality: config.quality, output_format: config.output_format, n: 1 }
    const value = await this.post(base, 'images/generations', key, { model: config.model, prompt, ...parameters }, signal, 4_300_000)
    const item = isObject(value) && Array.isArray(value.data) && value.data.length === 1 ? value.data[0] : undefined
    if (!isObject(item) || typeof item.b64_json !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.b64_json)) throw new GenerationFailure('INVALID_IMAGE', '服务未返回约定的 PNG 图片。')
    const bytes = Buffer.from(item.b64_json, 'base64')
    if (bytes.length > MAX_IMAGE_BYTES) throw new GenerationFailure('IMAGE_TOO_LARGE', '图片超过本次传输上限，请调整服务端配置。', false)
    if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== 1024 || bytes.readUInt32BE(20) !== 1024) throw new GenerationFailure('INVALID_IMAGE', '返回图片不是约定的 1024×1024 PNG。')
    return { imageBase64: item.b64_json, mimeType: 'image/png' as const, width: 1024 as const, height: 1024 as const, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), call: { provider: config.provider, modelRequested: config.model, modelActual: isObject(value) && validText(value.model, 120) ? value.model : undefined, durationMs: Date.now() - start, parameters }, completedAt: new Date().toISOString() }
  }
}
