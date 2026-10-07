import type { ImageConfig } from '../../shared/generation.ts'
import { GenerationFailure } from '../../shared/generation.ts'

export type Environment = Record<string, string | undefined>
export interface ServerConfig {
  interpret: { base: string; key: string; model: string }
  image: { base: string; key: string; config: ImageConfig }
  signingKey: string
  accessKey: string
  origins: string[]
  dailyLimit: number
  minuteLimit: number
}
export function configFromEnv(env: Environment): ServerConfig {
  const required = (key: string) => { const value = env[key]?.trim(); if (!value || /[\r\n]/.test(value)) throw new GenerationFailure('NOT_CONFIGURED', '云端服务尚未配置完整。', false); return value }
  const base = (key: string) => { const url = new URL(required(key)); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new GenerationFailure('NOT_CONFIGURED', '模型地址需要不含凭据的 HTTPS 地址。', false); return url.href.replace(/\/$/, '') }
  const number = (key: string, max: number) => { const n = Number(required(key)); if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new GenerationFailure('NOT_CONFIGURED', '请设置有效的调用限额。', false); return n }
  const quality = required('IMAGE_QUALITY')
  if (!['auto','low','medium','high'].includes(quality) || required('IMAGE_SIZE') !== '1024x1024') throw new GenerationFailure('NOT_CONFIGURED', '图像需要明确的质量与 1024×1024 尺寸。', false)
  const signingKey = required('SCENT_SIGNING_KEY'), accessKey = required('SCENT_ACCESS_KEY')
  if (signingKey.length < 32 || accessKey.length < 32) throw new GenerationFailure('NOT_CONFIGURED', '服务端访问保护尚未完成。', false)
  const imageBase = base('IMAGE_API_BASE_URL')
  return { interpret: { base: base('INTERPRET_API_BASE_URL'), key: required('INTERPRET_API_KEY'), model: required('INTERPRET_MODEL') },
    image: { base: imageBase, key: required('IMAGE_API_KEY'), config: { provider: new URL(imageBase).hostname, model: required('IMAGE_MODEL'), size: '1024x1024', quality: quality as ImageConfig['quality'], output_format: 'png' } },
    signingKey, accessKey, origins: required('SCENT_ALLOWED_ORIGINS').split(',').map(s => s.trim()), dailyLimit: number('SCENT_DAILY_CALL_LIMIT', 1000), minuteLimit: number('SCENT_MINUTE_CALL_LIMIT', 30) }
}
