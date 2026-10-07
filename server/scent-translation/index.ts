// Server-only: Node crypto/filesystem and frozen resources. No network, storage,
// credentials or App UI imports. TASK-05 owns HTTP/auth, providers and persistence.
import { compileRecipe } from './planner.ts'
import { assemblePrompt, buildLlmRequest, buildSceneInput } from './prompt.ts'
import { canonicalJson, sha256 } from './primitives.ts'
import { resourceSnapshot, rules } from './resources.ts'
import { SCENT_IDS, TranslationError } from './types.ts'
import type { AtmospherePolicy, CompileRequest, SceneInput } from './types.ts'

export { compileRecipe, nextVariant } from './planner.ts'
export { canonicalJson, parseJsonStrict } from './primitives.ts'
export { SCENT_IDS, TranslationError } from './types.ts'
export type { Recipe, SceneInput, CompileRequest, AtmospherePolicy } from './types.ts'

export function prepareTranslation(request: unknown, options: { asciiEnabled?: boolean; atmospherePolicy?: AtmospherePolicy } = {}) {
  const asciiEnabled = options.asciiEnabled ?? rules.ascii_enabled
  const atmospherePolicy = options.atmospherePolicy ?? 'reference-runtime'
  if (typeof asciiEnabled !== 'boolean' || !['reference-runtime', 'explicit-config-candidate'].includes(atmospherePolicy)) {
    throw new TranslationError('INVALID_INPUT', 'Invalid presentation settings')
  }
  const recipe = compileRecipe(request)
  const configSnapshot = { ...structuredClone(resourceSnapshot), ascii_enabled: asciiEnabled,
    aspect_ratio: rules.aspect_ratio, atmosphere_policy: atmospherePolicy }
  const configHash = sha256(canonicalJson(configSnapshot))
  if (recipe.status === 'empty') return {
    status: 'empty' as const, code: 'EMPTY_RECIPE' as const, recipe, sceneInput: null, llmRequest: null,
    configSnapshot, configHash, canGenerate: false as const, retryableWithSameInput: false as const,
    message: '本次特征较弱，暂未形成可生成场景', recovery: 'resample' as const,
  }
  const sceneInput = buildSceneInput(recipe, asciiEnabled, atmospherePolicy) as SceneInput
  return { status: 'ready' as const, recipe, sceneInput, llmRequest: buildLlmRequest(sceneInput), configSnapshot, configHash }
}
export type TranslationPlan = ReturnType<typeof prepareTranslation>

export function completeTranslation(plan: TranslationPlan, scenePrompt: unknown) {
  if (plan.status !== 'ready') throw new TranslationError('RECIPE_NOT_READY', 'Empty recipe cannot call LLM or image generation')
  const current = { ...resourceSnapshot, ascii_enabled: plan.configSnapshot.ascii_enabled,
    aspect_ratio: rules.aspect_ratio, atmosphere_policy: plan.configSnapshot.atmosphere_policy }
  if (sha256(canonicalJson(current)) !== plan.configHash || sha256(canonicalJson(plan.configSnapshot)) !== plan.configHash) {
    throw new TranslationError('CONFIG_MISMATCH', 'Frozen resources differ; resume with the saved successful Prompt/configuration')
  }
  return { ...plan, ...assemblePrompt(scenePrompt, plan.recipe, plan.sceneInput) }
}

export type SceneProvider = (request: { instruction: string; input_text: string }) => Promise<unknown>
export async function translateWithSceneProvider(request: unknown, provider: SceneProvider) {
  const plan = prepareTranslation(request)
  if (plan.status === 'empty') return plan
  // Deliberately one call, no content rewrite, automatic retry or offline fallback.
  return completeTranslation(plan, await provider(plan.llmRequest))
}

// App boundary: explicit scale and stable Reading.id. Default variant allocation
// would lose restore identity, so this adapter requires the persisted index.
export function prepareReadingTranslation(input: { recordId: string; variantIndex: number; scores: unknown; scale: '0-1' | '0-100' }) {
  if (input.scale !== '0-1' && input.scale !== '0-100') throw new TranslationError('INVALID_INPUT', 'An explicit score scale is required')
  if (input.variantIndex === undefined) throw new TranslationError('INVALID_INPUT', 'The persisted variantIndex is required')
  let confidences = input.scores
  if (input.scale === '0-100' && confidences && typeof confidences === 'object' && !Array.isArray(confidences)) {
    // Decimal scaling avoids turning 24.995 into 0.24994999999999998 at a HALF_UP boundary.
    confidences = Object.fromEntries(Object.entries(confidences).map(([key, value]) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new TranslationError('INVALID_INPUT', `Invalid score: ${key}`)
      const [digits, exp = '0'] = value.toString().split('e')
      return [key, Number(`${digits}e${Number(exp) - 2}`)]
    }))
  }
  return prepareTranslation({ sample_id: input.recordId, variant_index: input.variantIndex, confidences })
}

export const sampleRequest: CompileRequest = {
  sample_id: 'task04-fixed-reading', variant_index: 0,
  confidences: Object.fromEntries(SCENT_IDS.map(s => [s, s === 'lemon' ? 0.84 : s === 'grass' ? 0.73 : s === 'rose' ? 0.39 : 0.1])) as CompileRequest['confidences'],
}
