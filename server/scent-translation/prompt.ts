import { atmosphere, prompts } from './resources.ts'
import { sha256 } from './primitives.ts'
import type { AtmospherePolicy, Entity, Recipe, SceneInput } from './types.ts'
import { TranslationError } from './types.ts'

const primary = (e: Entity) => e.emphasis === 'primary' || e.emphasis === 'co_primary'
const envNouns: Record<string, string> = { grass: 'grassy field', lavender: 'lavender patch', cedarwood: 'cedarwood surface' }
const envRelations: Record<string, string> = {
  grass: 'rest on or beside the selected grassy field', cedarwood: 'rest on or beside the selected cedarwood form',
  lavender: 'sit beside the selected lavender patch, not inside the flower spikes',
}

export function buildSceneInput(recipe: Recipe, asciiEnabled = true, policy: AtmospherePolicy = 'reference-runtime'): SceneInput | null {
  if (recipe.status !== 'ready') return null
  if (!recipe.composition || !recipe.mode) throw new TranslationError('RECIPE_NOT_READY', 'Ready recipe requires a composition')
  const entities = recipe.entities, primaries = entities.filter(primary)
  const env = entities.find(e => e.placement === 'environment')
  const objects = entities.filter(e => e.placement === 'object')
  const noun = env ? envNouns[env.scent_id] ?? `${env.scent_id} area` : ''
  const relations: string[] = []
  if (env) {
    relations.push(objects.length ? `the grouped objects (${objects.map(o => o.phrase).join(', ')}) ${envRelations[env.scent_id] ?? `sit beside the selected ${noun}`}` : `the ${noun} is the only scent-bearing subject`)
  } else if (objects.length > 1) relations.push(recipe.compatibility?.generic_object_relation ?? 'objects form one coherent still-life group on the same surface')
  for (const e of entities) if (e.emphasis === 'accent' && e.placement === 'object') relations.push(`the ${e.phrase} lies nearby as a small accent`)
  return {
    mode: recipe.mode,
    focus_mode: recipe.mode === 'dual' ? 'dual_primary' : entities.length === 1 && env ? 'environment_only' :
      primaries[0]?.placement === 'environment' ? 'environment_primary' : 'object_primary',
    entities: entities.map(e => ({ entity_id: e.entity_id, scent_id: e.scent_id, motif_phrase: e.phrase,
      emphasis: e.emphasis, placement: e.placement, recognition_hint: e.recognition_hint_en || '' })),
    composition: { template_id: recipe.composition.template_id, view: recipe.composition.view,
      anchor: recipe.composition.anchor, layout: recipe.composition.layout },
    setting: env ? `the selected ${noun} with a quiet, indeterminate distant background` : 'a plain, indeterminate, softly blurred backdrop with a neutral support surface',
    relations, color_hint: entities.filter(e => e.color_hint).map(e => `${e.scent_id}: ${e.color_hint}`).join('; ') || null,
    atmosphere: policy === 'explicit-config-candidate' && primaries.length ? atmosphere.scents[primaries[0].scent_id] : null,
    ascii: { enabled: asciiEnabled, target_entity_ids: primaries.map(e => e.entity_id),
      // Preserve the reference builder's first-primary test (not the recipe's `any`).
      requires_bounded_environment_focal_region: primaries[0]?.placement === 'environment' },
  }
}
export function buildLlmRequest(sceneInput: SceneInput) {
  return { instruction: `${prompts.scene_simplifier_instruction}\n\n${prompts.project_scene_constraints}`,
    input_text: `INPUT:\n${JSON.stringify(sceneInput, null, 2)}` }
}
export function assemblePrompt(scenePrompt: unknown, recipe: Recipe, sceneInput: SceneInput) {
  if (recipe.status !== 'ready') throw new TranslationError('RECIPE_NOT_READY', 'Empty recipe cannot produce a Prompt')
  if (typeof scenePrompt !== 'string' || !scenePrompt.trim()) throw new TranslationError('LLM_EMPTY_RESPONSE', 'Expected non-empty scene text')
  const forms = recipe.entities.filter(primary).map(e => e.emphasis === 'co_primary' ? `${e.phrase} (co-primary, equally important)` :
    e.placement === 'environment' ? `${e.phrase} (primary scent-bearing environment, itself the main shape)` : e.phrase).join('; ') || '(no primary forms)'
  const parts = [prompts.style_photographic, `SCENE:\n${scenePrompt}`, `PRIMARY FORMS:\n${forms}`]
  if (sceneInput.ascii.enabled) {
    const bounded = sceneInput.ascii.requires_bounded_environment_focal_region ? '\nConstrain the ASCII to one bounded focal region inside the specified environment; keep the rest of the environment and background quiet.' : ''
    parts.push(`ASCII STYLE:\n${prompts.style_ascii}${bounded}`)
  }
  parts.push(`CONSTRAINTS:\n${prompts.scene_constraints}`)
  const finalPrompt = parts.join('\n\n')
  return { scenePrompt, finalPrompt, promptHash: sha256(finalPrompt) }
}
