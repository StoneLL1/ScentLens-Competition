import { assertCloudInterpretation, assertIdentity, GENERATION_BUDGET_MS, GenerationFailure, isObject, MAX_IMAGE_JSON_BYTES, type CloudInterpretation, type RequestIdentity } from '../../shared/generation.ts'
import { completeTranslation, parseJsonStrict, prepareReadingTranslation, TranslationError } from '../scent-translation/index.ts'
import { configFromEnv, type Environment, type ServerConfig } from './config.ts'
import { ModelProvider, limitedText } from './provider.ts'
import { callerId, interpretationPermit, redisAdmission, verifyPermit, type Admission } from './security.ts'

type Dependencies = { env?: Environment; admission?: (config: ServerConfig) => Admission; provider?: (config: ServerConfig) => ModelProvider }
export function generationHandler(stage: 'interpret' | 'image', dependencies: Dependencies = {}) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' })
    let requestId: string | undefined
    try {
      const env = dependencies.env ?? process.env
      const origin = request.headers.get('origin')
      const origins = (env.SCENT_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim())
      if (origin && !origins.includes(origin)) return new Response(null, { status: 403, headers })
      if (origin) headers.set('access-control-allow-origin', origin)
      headers.set('access-control-allow-methods', 'POST, OPTIONS')
      headers.set('access-control-allow-headers', 'Authorization, Content-Type')
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...Object.fromEntries(headers), allow: 'POST, OPTIONS' } })
      const config = configFromEnv(env), caller = callerId(config, request.headers.get('authorization'))
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new GenerationFailure('INVALID_INPUT', '请求需要 JSON。', false)
      const raw = await limitedText(new Response(request.body), 180_000)
      let data: unknown
      try { data = parseJsonStrict(raw) } catch { throw new GenerationFailure('INVALID_INPUT', '请求 JSON 无效或包含重复字段。', false) }
      assertIdentity(data); requestId = data.requestId
      const body = data as RequestIdentity & Record<string, unknown>
      const ids: RequestIdentity = { recordId: data.recordId, attemptId: data.attemptId, generationId: data.generationId, requestId: data.requestId }
      if (!Number.isSafeInteger(body.remainingBudgetMs) || Number(body.remainingBudgetMs) <= 0 || Number(body.remainingBudgetMs) > GENERATION_BUDGET_MS) throw new GenerationFailure('TIMEOUT', '本次等待预算已结束。')
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Number(body.remainingBudgetMs))])
      const provider = dependencies.provider?.(config) ?? new ModelProvider(config)
      const admission = dependencies.admission?.(config) ?? redisAdmission(env, config)
      let result: unknown
      if (stage === 'interpret') {
        if (Object.keys(body).some(k => !['recordId','attemptId','generationId','requestId','remainingBudgetMs','confidenceScale','scores','source','variantIndex'].includes(k)) || !['device','demo','mock'].includes(String(body.source)) || !['0-1','0-100'].includes(String(body.confidenceScale)) || !Number.isSafeInteger(body.variantIndex) || Number(body.variantIndex) < 0) throw new GenerationFailure('INVALID_INPUT', '识别输入或量纲无效。', false)
        const plan = prepareReadingTranslation({ recordId: ids.recordId, variantIndex: Number(body.variantIndex), scores: body.scores, scale: body.confidenceScale as '0-1' | '0-100' })
        if (plan.status === 'empty') result = { ...ids, status: 'empty', code: 'EMPTY_RECIPE', message: plan.message }
        else {
          await admission.claim(caller, stage, ids, 2, signal)
          signal.throwIfAborted()
          const scene = await provider.text(plan.llmRequest.instruction, plan.llmRequest.input_text, signal)
          const translated = completeTranslation(plan, scene.text)
          signal.throwIfAborted()
          const display = await provider.display(JSON.stringify({ scores: body.scores, scale: body.confidenceScale, scene: scene.text, recipe: plan.recipe }), signal)
          const interpretation: CloudInterpretation = { ...display.value, displayTextOrigin: 'cloud', finalImagePrompt: translated.finalPrompt, scenePrompt: translated.scenePrompt, recipeSnapshot: { ...plan.recipe, recipe_id: ids.attemptId, created_at: new Date().toISOString() }, sceneInputSnapshot: plan.sceneInput, generationConfigSnapshot: plan.configSnapshot, model: scene.call.modelActual, promptVersion: plan.configSnapshot.llm_instruction_version, completedAt: new Date().toISOString(), cloud: { identity: ids, variantIndex: Number(body.variantIndex), configHash: plan.configHash, promptHash: translated.promptHash, sceneCall: scene.call, displayCall: display.call, displayPromptVersion: 'zh-display-v1', imageConfig: config.image.config, permit: '' } }
          interpretation.cloud.permit = interpretationPermit(interpretation, caller, config.signingKey)
          result = { ...ids, status: 'ready', interpretation }
        }
      } else {
        if (Object.keys(body).some(k => !['recordId','attemptId','generationId','requestId','remainingBudgetMs','interpretation'].includes(k))) throw new GenerationFailure('INVALID_INPUT', '图像请求包含不支持的参数。', false)
        assertCloudInterpretation(body.interpretation)
        verifyPermit(body.interpretation, caller, config, ids.recordId)
        await admission.claim(caller, stage, ids, 1, signal)
        signal.throwIfAborted()
        result = { ...ids, ...await provider.image(body.interpretation.finalImagePrompt, signal), promptHash: body.interpretation.cloud.promptHash }
      }
      signal.throwIfAborted()
      const json = JSON.stringify(result)
      if (Buffer.byteLength(json) > MAX_IMAGE_JSON_BYTES) throw new GenerationFailure('RESPONSE_TOO_LARGE', '返回内容超过传输预算。', false)
      return new Response(json, { headers })
    } catch (error) {
      const e = error instanceof GenerationFailure ? error : error instanceof TranslationError ? new GenerationFailure('INVALID_INPUT', '八维数据或转译配置无效。', false) : isObject(error) && ['AbortError', 'TimeoutError'].includes(String(error.name)) ? new GenerationFailure('TIMEOUT', '本次等待已结束。') : new GenerationFailure('SERVER_ERROR', '服务暂时不可用，请稍后重试。')
      const status = e.code === 'ACCESS_DENIED' ? 401 : ['RATE_LIMITED','QUOTA_EXCEEDED'].includes(e.code) ? 429 : ['NOT_CONFIGURED','PROTECTION_UNAVAILABLE'].includes(e.code) ? 503 : e.code === 'DUPLICATE' ? 409 : ['INVALID_INPUT','INVALID_PERMIT','CONFIG_CHANGED','IDENTITY_MISMATCH'].includes(e.code) ? 400 : e.code === 'TIMEOUT' ? 504 : 502
      return new Response(JSON.stringify({ error: { code: e.code, message: e.message, retryable: e.retryable, requestId } }), { status, headers })
    }
  }
}
