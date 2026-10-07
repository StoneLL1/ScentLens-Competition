import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { completeTranslation, prepareReadingTranslation } from '../../server/scent-translation/index.ts'
import { interpretationPermit } from '../../server/generation/security.ts'
import { configFromEnv } from '../../server/generation/config.ts'
import type { CloudInterpretation, ImageResponse, RequestIdentity } from '../../shared/generation'

export const testEnv = { INTERPRET_API_BASE_URL: 'https://text.example/v1', INTERPRET_API_KEY: 'test-text-secret', INTERPRET_MODEL: 'test-scene-model', IMAGE_API_BASE_URL: 'https://image.example/v1', IMAGE_API_KEY: 'test-image-secret', IMAGE_MODEL: 'test-image-model', IMAGE_SIZE: '1024x1024', IMAGE_QUALITY: 'medium', SCENT_SIGNING_KEY: 'test-signing-key-at-least-32-chars-long', SCENT_ACCESS_KEY: 'test-access-key-at-least-32-chars-long', SCENT_ALLOWED_ORIGINS: 'http://127.0.0.1:5173,capacitor://localhost', SCENT_DAILY_CALL_LIMIT: '30', SCENT_MINUTE_CALL_LIMIT: '15' }
export const fixedScores = { lemon: 84, rose: 39, lavender: 10, grass: 73, peach: 10, clove: 10, cedarwood: 10, vanilla: 10 }
export function ids(recordId = 'test-reading'): RequestIdentity { return { recordId, attemptId: crypto.randomUUID(), generationId: crypto.randomUUID(), requestId: crypto.randomUUID() } }
export function interpretation(identity: RequestIdentity, variantIndex = 0): CloudInterpretation {
  const plan = prepareReadingTranslation({ recordId: identity.recordId, variantIndex, scores: fixedScores, scale: '0-100' })
  if (plan.status !== 'ready') throw new Error('fixture must be ready')
  const translated = completeTranslation(plan, 'A lemon rests in grass beside scattered rose petals.')
  const config = configFromEnv(testEnv), call = { provider: 'text.example', modelRequested: 'test-scene-model', modelActual: 'test-scene-actual', durationMs: 10, parameters: { temperature: .2 } }
  const result: CloudInterpretation = { title: '晨光里的柑橘与青草', keywords: ['柑橘','青草','晨光'], description: '柔和晨光洒落，一枚柠檬静卧青草之间。', displayTextOrigin: 'cloud', finalImagePrompt: translated.finalPrompt, recipeSnapshot: plan.recipe, sceneInputSnapshot: plan.sceneInput, scenePrompt: translated.scenePrompt, generationConfigSnapshot: plan.configSnapshot, completedAt: new Date().toISOString(), cloud: { identity, variantIndex, configHash: plan.configHash, promptHash: translated.promptHash, sceneCall: call, displayCall: call, displayPromptVersion: 'zh-display-v1', imageConfig: config.image.config, permit: '' } }
  const caller = createHash('sha256').update(config.accessKey).digest('hex').slice(0,24)
  result.cloud.permit = interpretationPermit(result, caller, config.signingKey)
  return result
}
function crc(bytes: Buffer) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i=0;i<8;i++) c = c & 1 ? (c>>>1)^0xedb88320 : c>>>1 }; return (c^0xffffffff)>>>0 }
function chunk(type: string, data: Buffer) { const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name,data]))); return Buffer.concat([size,name,data,checksum]) }
export function png(width = 1024, height = 1024) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=2
  const raw = Buffer.alloc(height*(1+width*3)); for(let y=0;y<height;y++) for(let x=0;x<width;x++){const i=y*(width*3+1)+1+x*3;raw[i]=170;raw[i+1]=140;raw[i+2]=90}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}
export function imageResponse(identity: RequestIdentity, text: CloudInterpretation): ImageResponse {
  const bytes = png()
  return { ...identity, imageBase64: bytes.toString('base64'), mimeType: 'image/png', width: 1024, height: 1024, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), promptHash: text.cloud.promptHash, call: { provider: 'image.example', modelRequested: 'test-image-model', durationMs: 10, parameters: { size:'1024x1024', quality:'medium', n:1, output_format:'png' } }, completedAt: new Date().toISOString() }
}
