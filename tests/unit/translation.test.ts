import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import fixtures from '../fixtures/scent-translation.json'
import { completeTranslation, compileRecipe, nextVariant, parseJsonStrict, prepareReadingTranslation, prepareTranslation, sampleRequest, translateWithSceneProvider } from '../../server/scent-translation/index.ts'
import { canonicalJson, parseJsonWithNumbers, quantizeToUnits, sha256, weightedPick } from '../../server/scent-translation/primitives.ts'
import { catalog, planningCanonical, planningDigest, resourceSnapshot, templates } from '../../server/scent-translation/resources.ts'
import type { AtmospherePolicy, CompileRequest } from '../../server/scent-translation/types.ts'

function projection(request: unknown, asciiEnabled = true, atmospherePolicy: AtmospherePolicy = 'reference-runtime') {
  const plan = prepareTranslation(request, { asciiEnabled, atmospherePolicy })
  const prompt = plan.status === 'ready' ? completeTranslation(plan, fixtures.scene) : { scenePrompt: null, finalPrompt: null, promptHash: null }
  return { recipe: plan.recipe, sceneInput: plan.sceneInput, llmRequest: plan.llmRequest,
    scenePrompt: prompt.scenePrompt, finalPrompt: prompt.finalPrompt, promptHash: prompt.promptHash }
}

describe('Python reference → server translation', () => {
  it.each(fixtures.cases)('$name matches every deterministic recipe, SceneInput and Prompt field', c => {
    const options = c as typeof c & { ascii?: boolean; atmosphere?: boolean }
    expect(projection(c.request, options.ascii ?? true, options.atmosphere ? 'explicit-config-candidate' : 'reference-runtime')).toEqual(c.expected)
  })
  it('matches 256 independently generated recipe/SceneInput/Prompt digests', () => {
    for (const c of fixtures.corpus) expect(sha256(canonicalJson(projection(c.request))), `variant ${c.request.variant_index}`).toBe(c.sha256)
  })
  it('preserves the exact planning JSON and resource digest conventions', () => {
    expect(planningCanonical).toBe(fixtures.planningCanonical)
    expect(planningDigest).toBe(fixtures.planningDigest)
    expect(resourceSnapshot.prompt_runtime_sha256).toEqual(fixtures.runtimePromptDigests)
    expect(catalog.scents.flatMap(s => s.motifs)).toHaveLength(96)
    expect(templates.templates).toHaveLength(6)
    for (const [file, digest] of Object.entries(resourceSnapshot.asset_bytes_sha256)) {
      expect(sha256(readFileSync(new URL(`../../server/scent-translation/assets/${file}`, import.meta.url)))).toBe(digest)
    }
    expect(resourceSnapshot.asset_bytes_sha256['style_photographic.txt']).not.toBe(resourceSnapshot.prompt_runtime_sha256.style_photographic)
  })
  it('preserves Python float vs int tokens, negative zero, exponents and Unicode', () => {
    const parsed = parseJsonWithNumbers(fixtures.numeric.source)
    expect(canonicalJson(parsed.value, parsed.floatPaths)).toBe(fixtures.numeric.canonical)
    expect(canonicalJson({ '\u{10000}': 1, '\ue000': 2 })).toBe('{"":2,"𐀀":1}')
    expect(sha256(canonicalJson({ x: 1 }))).not.toBe(sha256(canonicalJson({ x: 1 }, new Set(['["x"]']))))
  })
  it.each(fixtures.quantization)('quantizes $input with decimal HALF_UP to $units', c => {
    expect(quantizeToUnits(c.input)).toBe(c.units)
  })
  it('preserves labeled weighted choice independent of candidate order', () => {
    for (const c of fixtures.weighted) {
      expect(weightedPick(c.seed, c.label, c.candidates).id).toBe(c.selected)
      expect(weightedPick(c.seed, c.label, [...c.candidates].reverse()).id).toBe(c.selected)
    }
  })
})

describe('input contract and App scale', () => {
  const invalid = [null, [], {}, { ...sampleRequest, sample_id: ' ' }, { ...sampleRequest, variant_index: null },
    ...[-1, 0.5, true, '1', Number.MAX_SAFE_INTEGER + 1].map(variant_index => ({ ...sampleRequest, variant_index })),
    ...[NaN, Infinity, -0.1, 1.1, true, '0.5', null].map(lemon => ({ ...sampleRequest, confidences: { ...sampleRequest.confidences, lemon } })),
    { ...sampleRequest, confidences: [] }, { ...sampleRequest, confidences: { ...sampleRequest.confidences, mint: 0.5 } },
    { ...sampleRequest, confidences: { lemon: 0.5 } }]
  it.each(invalid.map((value, i) => ({ value, i })))('rejects invalid request $i before provider access', async ({ value }) => {
    const provider = vi.fn()
    await expect(translateWithSceneProvider(value, provider)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(provider).not.toHaveBeenCalled()
  })
  it.each(['{"lemon":0.5,"lemon":0.6}', '{"a":{"b":1,"\\u0062":2}}', '[{"x":1,"x":2}]', '{"x":01}', '{"x":1,}', '[1,]', '{"x":NaN}', '{"x":1e999}', '{"x":9007199254740992}'])('rejects malformed or ambiguous JSON: %s', text => {
    expect(() => parseJsonStrict(text)).toThrow()
  })
  it('keeps prototype keys as data and permits repeated keys in separate objects', () => {
    const parsed = parseJsonStrict('{"__proto__":{"polluted":true},"a":[{"x":1},{"x":2}]}') as Record<string, unknown>
    expect(Object.getPrototypeOf(parsed)).toBeNull()
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
    expect(parsed.a).toEqual([{ x: 1 }, { x: 2 }])
  })
  it('maps explicit App scales and stable Reading.id without changing threshold rounding', () => {
    const scores = { ...sampleRequest.confidences, lemon: 0.24995, grass: 0.1, rose: 0.1 }
    const one = prepareReadingTranslation({ recordId: 'reading-1', variantIndex: 3, scores, scale: '0-1' })
    const hundred = prepareReadingTranslation({ recordId: 'reading-1', variantIndex: 3,
      scores: Object.fromEntries(Object.entries(scores).map(([key, v]) => [key, Number((v * 100).toFixed(6))])), scale: '0-100' })
    expect(hundred).toEqual(one)
    expect(one.recipe.normalized_confidences.lemon).toBe(0.25)
    expect(one.recipe.sample_id).toBe('reading-1')
    expect(() => prepareReadingTranslation({ recordId: 'r', variantIndex: 0, scores, scale: 'auto' as '0-1' })).toThrow()
  })
})

describe('Prompt and recovery boundary for TASK-05', () => {
  it('preserves quotes, whitespace, Markdown, Unicode and newlines verbatim with exactly one injected call', async () => {
    const provider = vi.fn(async () => fixtures.scene)
    const result = await translateWithSceneProvider(sampleRequest, provider)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected ready')
    expect(result.scenePrompt).toBe(fixtures.scene)
    expect(result.finalPrompt).toContain(`SCENE:\n${fixtures.scene}\n\nPRIMARY FORMS:`)
    expect(provider).toHaveBeenCalledOnce()
    expect(provider).toHaveBeenCalledWith(result.llmRequest)
    expect(result.llmRequest.input_text).not.toMatch(/confidence|raw_rank|warnings|omitted/)
  })
  it('returns a non-retryable empty outcome without invoking the provider or constructing a Prompt', async () => {
    const provider = vi.fn()
    const result = await translateWithSceneProvider({ ...sampleRequest, confidences: Object.fromEntries(Object.keys(sampleRequest.confidences).map(s => [s, 0.24])) }, provider)
    expect(result).toMatchObject({ status: 'empty', code: 'EMPTY_RECIPE', canGenerate: false, retryableWithSameInput: false, recovery: 'resample', sceneInput: null, llmRequest: null })
    expect(provider).not.toHaveBeenCalled()
    expect(() => completeTranslation(result, 'invented')).toThrow()
  })
  it.each(['', ' \n\t ', null, 3, { text: 'scene' }])('rejects non-text/empty provider output without retry: %j', async text => {
    const provider = vi.fn(async () => text)
    await expect(translateWithSceneProvider(sampleRequest, provider)).rejects.toMatchObject({ code: 'LLM_EMPTY_RESPONSE' })
    expect(provider).toHaveBeenCalledOnce()
  })
  it('does not retry or mask provider failures', async () => {
    const error = new Error('timeout'), provider = vi.fn(async () => { throw error })
    await expect(translateWithSceneProvider(sampleRequest, provider)).rejects.toBe(error)
    expect(provider).toHaveBeenCalledOnce()
  })
  it('restores serialized variant/config without any random change, and advances only explicitly', () => {
    const request = { ...sampleRequest, variant_index: 9 }
    const first = prepareTranslation(request), restored = JSON.parse(JSON.stringify(first))
    expect(completeTranslation(restored, fixtures.scene)).toEqual(completeTranslation(first, fixtures.scene))
    for (let i = 0; i < 20; i++) expect(prepareTranslation(request)).toEqual(first)
    const next = nextVariant(first.recipe)
    expect(next.status).toBe('ready')
    if (next.status !== 'ready') throw new Error('Expected new scene')
    expect(next.recipe.scene_signature).not.toBe(first.recipe.scene_signature)
    expect(next.recipe.variant_index).toBe(9 + next.variant_attempts)
    expect(next.recipe.entities.map(e => [e.scent_id, e.emphasis, e.placement])).toEqual(first.recipe.entities.map(e => [e.scent_id, e.emphasis, e.placement]))
    const missingConfig = structuredClone(first)
    missingConfig.configHash = 'old-config'
    expect(() => completeTranslation(missingConfig, fixtures.scene)).toThrow(/resources differ/)
    const empty = compileRecipe({ ...sampleRequest, confidences: Object.fromEntries(Object.keys(sampleRequest.confidences).map(s => [s, 0])) })
    expect(nextVariant(empty)).toEqual({ status: 'no_new_variant', tried: 5 })
  })
  it('records the atmosphere difference without changing seeds, objects or the default real-path request', () => {
    for (const scent of Object.keys(sampleRequest.confidences)) {
      const request: CompileRequest = { ...sampleRequest, confidences: { ...sampleRequest.confidences, [scent]: 1 } }
      const baseline = prepareTranslation(request), candidate = prepareTranslation(request, { atmospherePolicy: 'explicit-config-candidate' })
      expect(candidate.recipe).toEqual(baseline.recipe)
      expect(baseline.sceneInput?.atmosphere).toBeNull()
      expect(candidate.sceneInput?.atmosphere).toBeTruthy()
      expect({ ...candidate.sceneInput, atmosphere: null }).toEqual(baseline.sceneInput)
      expect(candidate.configHash).not.toBe(baseline.configHash)
      expect(completeTranslation(candidate, fixtures.scene).finalPrompt).toBe(completeTranslation(baseline, fixtures.scene).finalPrompt)
    }
  })
})
