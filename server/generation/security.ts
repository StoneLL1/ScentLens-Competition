import { createHmac, timingSafeEqual, createHash } from 'node:crypto'
import { GenerationFailure, type CloudInterpretation, type RequestIdentity } from '../../shared/generation.ts'
import type { Environment, ServerConfig } from './config.ts'

const mac = (key: string, text: string) => createHmac('sha256', key).update(text).digest('base64url')
export function sameSecret(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
export function callerId(config: ServerConfig, authorization: string | null) {
  if (!authorization?.startsWith('Bearer ') || !sameSecret(authorization.slice(7), config.accessKey)) throw new GenerationFailure('ACCESS_DENIED', '请先配置本次演示的访问码。', false)
  return createHash('sha256').update(config.accessKey).digest('hex').slice(0, 24)
}
export function interpretationPermit(interpretation: CloudInterpretation, caller: string, key: string) {
  const unsigned = { ...interpretation, cloud: { ...interpretation.cloud, permit: '' } }
  return mac(key, `scentlens-interpret-v1:${caller}:${JSON.stringify(unsigned)}`)
}
export function verifyPermit(interpretation: CloudInterpretation, caller: string, config: ServerConfig, recordId: string) {
  if (interpretation.cloud.identity.recordId !== recordId || !sameSecret(interpretation.cloud.permit, interpretationPermit(interpretation, caller, config.signingKey))) throw new GenerationFailure('INVALID_PERMIT', '解释凭据不匹配，请重新生成。', false)
  if (JSON.stringify(interpretation.cloud.imageConfig) !== JSON.stringify(config.image.config)) throw new GenerationFailure('CONFIG_CHANGED', '图像服务配置已改变，请重新生成以记录新配置。', false)
}
export interface Admission { claim(caller: string, stage: 'interpret' | 'image', ids: RequestIdentity, units: number, signal: AbortSignal): Promise<void> }
// Atomic across instances. Reservations are never refunded: an uncertain upstream
// outcome must not silently create another billable call. This is not a job store.
export const ADMISSION_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 'DUPLICATE' end
if tonumber(redis.call('GET', KEYS[3]) or '0') + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 'RATE_LIMITED' end
if tonumber(redis.call('GET', KEYS[4]) or '0') + tonumber(ARGV[1]) > tonumber(ARGV[3]) then return 'QUOTA_EXCEEDED' end
redis.call('SET', KEYS[1], '1', 'EX', 172800)
redis.call('SET', KEYS[2], '1', 'EX', 172800)
redis.call('INCRBY', KEYS[3], ARGV[1]); redis.call('EXPIRE', KEYS[3], 120)
redis.call('INCRBY', KEYS[4], ARGV[1]); redis.call('EXPIRE', KEYS[4], 172800)
return 'OK'`
export function admissionKeys(caller: string, stage: string, ids: RequestIdentity, now = Date.now()) {
  return [`sl:request:${caller}:${ids.requestId}`, `sl:attempt:${caller}:${ids.attemptId}:${stage}`, `sl:minute:${Math.floor(now / 60000)}`, `sl:day:${Math.floor(now / 86400000)}`]
}
export function requireAdmission(result: string) {
  const errors: Record<string, string> = { DUPLICATE: '这次请求已提交；如需再次调用，请手动开始新尝试。', RATE_LIMITED: '调用较频繁，请稍后手动重试。', QUOTA_EXCEEDED: '今天的调用额度已用完。' }
  if (result !== 'OK') throw new GenerationFailure(result in errors ? result : 'PROTECTION_UNAVAILABLE', errors[result] ?? '调用保护暂不可用，请稍后重试。', result !== 'QUOTA_EXCEEDED')
}
export function redisAdmission(env: Environment, config: ServerConfig): Admission {
  return { async claim(caller, stage, ids, units, signal) {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) throw new GenerationFailure('PROTECTION_UNAVAILABLE', '服务端调用保护尚未配置。', false)
    const url = new URL(env.UPSTASH_REDIS_REST_URL)
    if (url.protocol !== 'https:' || url.username || url.password) throw new GenerationFailure('PROTECTION_UNAVAILABLE', '服务端调用保护配置无效。', false)
    try {
      const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(['EVAL', ADMISSION_LUA, 4, ...admissionKeys(caller, stage, ids), units, config.minuteLimit, config.dailyLimit]), signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]), redirect: 'error' })
      const data = await response.json() as { result?: unknown }
      if (!response.ok || typeof data.result !== 'string') throw new Error('unavailable')
      requireAdmission(data.result)
    } catch (e) { if (e instanceof GenerationFailure) throw e; throw new GenerationFailure('PROTECTION_UNAVAILABLE', '调用保护暂不可用，未启动模型。') }
  } }
}
