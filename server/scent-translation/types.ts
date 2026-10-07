export const SCENT_IDS = ['lemon', 'rose', 'lavender', 'grass', 'peach', 'clove', 'cedarwood', 'vanilla'] as const
export type ScentId = typeof SCENT_IDS[number]
export type Confidences = Record<ScentId, number>
export type Band = 'Strong' | 'Medium' | 'Subtle'
export type Mode = 'single' | 'normal' | 'dual'
export type Emphasis = 'primary' | 'co_primary' | 'secondary' | 'accent'
export type Placement = 'object' | 'environment'
export interface CompileRequest { sample_id: string; variant_index?: number; confidences: Confidences }
export interface Dimension {
  scent_id: ScentId; raw: number; normalized: number; raw_rank: number
  activated: boolean; in_top_k: boolean; included: boolean; visible: boolean
  relative_score: number | null; signal_band: Band | null; reason: string | null
}
export interface Slot extends Dimension {
  units: number; emphasis: Emphasis; placement: Placement; motif_band: Band; tier_capped: boolean
}
export interface Entity {
  entity_id: string; scent_id: ScentId; rank: number; confidence: number; relative_score: number
  signal_band: Band; motif_band: Band; emphasis: Emphasis; placement: Placement
  motif_id: string; phrase: string; recognition_hint_en: string; color_hint: string; tier_capped_by_accent: boolean
}
export interface Composition { template_id: string; view: string; anchor: string; layout: string; is_fallback: boolean }
export interface Adjustment { entity_id?: string; kind: string; detail: string }
export interface Compatibility {
  version: string; max_environments: number; neutral_background: string; neutral_support: string
  environment_relations: Record<string, string>; generic_object_relation: string
  requirements: string[]; forbidden_unrequested_contexts: string[]
}
// Deterministic recipe content only. TASK-05 supplies storage identity and timestamps.
export interface Recipe {
  status: 'ready' | 'empty'; sample_id: string; variant_index: number
  engine_version: string; config_version: string
  raw_confidences: Confidences; normalized_confidences: Confidences; mode: Mode | null
  entities: Entity[]; composition: Composition | null
  per_dimension_explanation: Dimension[]; omitted: { scent_id: ScentId; reason: string }[]
  warnings: string[]; adjustments: Adjustment[]
  input_request: { sample_id: string; variant_index: number; config_version: string }
  llm_scene_input?: null; scene_signature: string | null; seed_key: string | null; planning_config_digest: string | null
  ascii_target_entity_ids?: string[]; requires_bounded_environment_focal_region?: boolean; compatibility?: Compatibility
}
export type AtmospherePolicy = 'reference-runtime' | 'explicit-config-candidate'
export interface SceneInput {
  mode: Mode; focus_mode: 'dual_primary' | 'environment_only' | 'environment_primary' | 'object_primary'
  entities: { entity_id: string; scent_id: ScentId; motif_phrase: string; emphasis: Emphasis; placement: Placement; recognition_hint: string }[]
  composition: Omit<Composition, 'is_fallback'>; setting: string; relations: string[]
  color_hint: string | null; atmosphere: string | null
  ascii: { enabled: boolean; target_entity_ids: string[]; requires_bounded_environment_focal_region: boolean }
}
export class TranslationError extends Error {
  readonly code: 'INVALID_INPUT' | 'INVALID_CONFIG' | 'RECIPE_NOT_READY' | 'LLM_EMPTY_RESPONSE' | 'CONFIG_MISMATCH'
  constructor(code: TranslationError['code'], message: string) { super(message); this.code = code }
}
