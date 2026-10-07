import { canonicalJson, sha256, weightedPick } from './primitives.ts'
import { catalog, compatibility, planningDigest, rules, templates } from './resources.ts'
import { runRules, validateRequest } from './rules.ts'
import type { Adjustment, Band, Composition, Entity, Mode, Placement, Recipe, Slot } from './types.ts'
import { SCENT_IDS, TranslationError } from './types.ts'

function selectMotif(slot: Slot, visibleIds: string[], seed: string, adjustments: Adjustment[]) {
  const scent = catalog.scents.find(s => s.id === slot.scent_id)!
  const eligible = (placement: Placement) => scent.motifs.map(m => ({ ...catalog.motif_defaults, ...m })).filter(m =>
    m.band === slot.motif_band && m.placements.includes(placement) &&
    (!['primary', 'co_primary'].includes(slot.emphasis) || m.primary_safe) &&
    m.requires_scent_ids.every(s => visibleIds.includes(s)) && m.enabled && m.weight > 0)
  let placement = slot.placement
  let pool = eligible(placement)
  if (!pool.length) {
    const alternate = placement === 'object' ? 'environment' : 'object'
    pool = eligible(alternate)
    if (pool.length) {
      adjustments.push({ entity_id: `scent_${slot.scent_id}`, kind: 'motif_fallback', detail: `no eligible ${placement} candidate; used same band on ${alternate} placement` })
      placement = alternate
    } else {
      // The frozen catalog's S01 phrases equal the reference's fixed BASE_MOTIFS.
      const base = scent.motifs.find(m => m.id === `${slot.scent_id}_S01`)!
      adjustments.push({ entity_id: `scent_${slot.scent_id}`, kind: 'motif_fallback', detail: `no eligible candidate; used fixed base motif ${base.id}` })
      return { motif: base, placement, scent }
    }
  }
  // The reference label keeps the original placement even after a fallback.
  return { motif: weightedPick(seed, `motif:${slot.scent_id}:${slot.motif_band}:${slot.placement}`, pool), placement, scent }
}

function selectComposition(mode: Mode, entities: Entity[], seed: string, adjustments: Adjustment[]): Composition {
  const primaries = entities.filter(e => ['primary', 'co_primary'].includes(e.emphasis))
  const primaryEnvironment = primaries.some(e => e.placement === 'environment')
  const compatible = templates.templates.filter(t => t.modes.includes(mode) && (
    t.primary_placement === 'object' ? !primaryEnvironment && primaries.length === 1 :
      t.primary_placement === 'all_objects' ? !primaryEnvironment && primaries.length > 0 : primaryEnvironment))
  if (!compatible.length) {
    const fb = primaryEnvironment ? 'environment' : 'object'
    adjustments.push({ kind: 'composition_fallback', detail: `no compatible template; used fallback ${fb}` })
    return { template_id: `FALLBACK_${fb.toUpperCase()}`, view: primaryEnvironment ? 'low oblique view' : 'front view', anchor: 'center', layout: templates.fallbacks[fb], is_fallback: true }
  }
  const focus = primaries.length >= 2 ? 'dual_primary' : primaryEnvironment ? 'environment_primary' : 'object_primary'
  const chosen = weightedPick(seed, `composition:${mode}:${focus}`, compatible)
  const anchor = weightedPick(seed, `anchor:${chosen.id}`, templates.anchor_positions.map(id => ({ id }))).id
  return { template_id: chosen.id, view: chosen.view, anchor, layout: chosen.layout, is_fallback: false }
}

export function compileRecipe(request: unknown): Recipe {
  validateRequest(request)
  const { mode, slots, explanation, warnings } = runRules(request)
  const variant = request.variant_index ?? 0
  const recipe: Recipe = {
    status: mode ? 'ready' : 'empty', sample_id: request.sample_id, variant_index: variant,
    engine_version: rules.engine_version, config_version: rules.config_version,
    raw_confidences: Object.fromEntries(SCENT_IDS.map(s => [s, request.confidences[s]])) as Recipe['raw_confidences'],
    normalized_confidences: Object.fromEntries(explanation.map(d => [d.scent_id, d.normalized])) as Recipe['normalized_confidences'],
    mode, entities: [], composition: null, per_dimension_explanation: explanation,
    omitted: explanation.filter(d => !d.visible && d.reason).map(d => ({ scent_id: d.scent_id, reason: d.reason! })),
    warnings, adjustments: [], input_request: { sample_id: request.sample_id, variant_index: variant, config_version: rules.config_version },
    scene_signature: null, seed_key: null, planning_config_digest: null,
  }
  if (!mode) { recipe.llm_scene_input = null; return recipe }
  const seed = sha256(canonicalJson({ sample_id: request.sample_id, variant_index: variant,
    engine_version: rules.engine_version, planning_config_digest: planningDigest }))
  recipe.seed_key = seed; recipe.planning_config_digest = planningDigest
  recipe.entities = slots.map((slot, i) => {
    const { motif, placement, scent } = selectMotif(slot, slots.map(s => s.scent_id), seed, recipe.adjustments)
    return { entity_id: `scent_${slot.scent_id}`, scent_id: slot.scent_id, rank: i + 1,
      confidence: slot.normalized, relative_score: slot.relative_score!, signal_band: slot.signal_band as Band,
      motif_band: slot.motif_band, emphasis: slot.emphasis, placement, motif_id: motif.id, phrase: motif.phrase,
      recognition_hint_en: scent.recognition_hint_en, color_hint: scent.color_hint, tier_capped_by_accent: slot.tier_capped }
  })
  recipe.composition = selectComposition(mode, recipe.entities, seed, recipe.adjustments)
  recipe.ascii_target_entity_ids = recipe.entities.filter(e => ['primary', 'co_primary'].includes(e.emphasis)).map(e => e.entity_id)
  recipe.requires_bounded_environment_focal_region = recipe.entities.some(e => ['primary', 'co_primary'].includes(e.emphasis) && e.placement === 'environment')
  recipe.scene_signature = [mode, ...recipe.entities.map(e => `${e.scent_id}:${e.emphasis}:${e.motif_id}:${e.placement}`),
    recipe.composition.template_id, recipe.composition.anchor].join('|')
  recipe.compatibility = compatibility
  validateInvariants(recipe)
  return recipe
}

function validateInvariants(recipe: Recipe) {
  const e = recipe.entities
  const primaries = e.filter(x => x.emphasis === 'primary').length
  if (e.length > 3 || e.filter(x => x.placement === 'environment').length > 1 ||
    (recipe.mode === 'single' && e.length > 2) ||
    (recipe.mode === 'dual' ? e.filter(x => x.emphasis === 'co_primary').length !== 2 : primaries !== 1) ||
    e.some(x => !x.motif_id.startsWith(`${x.scent_id}_`) || (x.emphasis === 'accent' && x.motif_band !== 'Subtle'))) {
    throw new TranslationError('INVALID_CONFIG', 'Recipe invariants violated')
  }
}

// Explicit variation only. Restoration calls compileRecipe with its saved variant.
export function nextVariant(base: Recipe): { status: 'ready'; recipe: Recipe; variant_attempts: number } | { status: 'no_new_variant'; tried: number } {
  if (base.config_version !== rules.config_version || (base.status === 'ready' && base.planning_config_digest !== planningDigest)) {
    throw new TranslationError('CONFIG_MISMATCH', 'Use the saved configuration/Prompt to resume this recipe')
  }
  for (let attempt = 1; attempt <= rules.max_variant_attempts; attempt++) {
    const candidate = compileRecipe({ sample_id: base.sample_id, variant_index: base.variant_index + attempt, confidences: base.raw_confidences })
    if (candidate.scene_signature !== base.scene_signature) return { status: 'ready', recipe: candidate, variant_attempts: attempt }
  }
  return { status: 'no_new_variant', tried: rules.max_variant_attempts }
}
