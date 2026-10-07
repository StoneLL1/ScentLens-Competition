import { rules } from './resources.ts'
import { quantizeToUnits } from './primitives.ts'
import { SCENT_IDS, TranslationError } from './types.ts'
import type { Band, CompileRequest, Dimension, Mode, Slot } from './types.ts'

export function validateRequest(value: unknown): asserts value is CompileRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TranslationError('INVALID_INPUT', 'Request must be an object')
  const r = value as Record<string, unknown>
  if (typeof r.sample_id !== 'string' || !r.sample_id.trim()) throw new TranslationError('INVALID_INPUT', 'sample_id must be a non-empty string')
  const variant = r.variant_index ?? 0
  if ((r.variant_index !== undefined && r.variant_index === null) || !Number.isSafeInteger(variant) || (variant as number) < 0) {
    throw new TranslationError('INVALID_INPUT', 'variant_index must be a non-negative safe integer')
  }
  const scores = r.confidences
  if (!scores || typeof scores !== 'object' || Array.isArray(scores) || Object.keys(scores).length !== 8 ||
    SCENT_IDS.some(s => !Object.hasOwn(scores, s))) throw new TranslationError('INVALID_INPUT', 'Exactly eight named confidences are required')
  for (const s of SCENT_IDS) {
    const v = (scores as Record<string, unknown>)[s]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new TranslationError('INVALID_INPUT', `Invalid confidence: ${s}`)
  }
}

export function runRules(request: CompileRequest): { mode: Mode | null; slots: Slot[]; explanation: Dimension[]; warnings: string[] } {
  const units = Object.fromEntries(SCENT_IDS.map(s => [s, quantizeToUnits(request.confidences[s])]))
  const order = [...SCENT_IDS].sort((a, b) => units[b] - units[a] || rules.tie_break_order.indexOf(a) - rules.tie_break_order.indexOf(b))
  type Working = Dimension & Partial<Pick<Slot, 'emphasis' | 'placement' | 'motif_band' | 'tier_capped'>> & { units: number }
  const dims: Working[] = SCENT_IDS.map(scent_id => ({
    scent_id, raw: request.confidences[scent_id], normalized: units[scent_id] / 10000, raw_rank: order.indexOf(scent_id) + 1,
    units: units[scent_id], activated: false, in_top_k: false, included: false, visible: false,
    relative_score: null, signal_band: null, reason: null,
  }))
  const explanation = (): Dimension[] => dims.map(d => ({
    scent_id: d.scent_id, raw: d.raw, normalized: d.normalized, raw_rank: d.raw_rank,
    activated: d.activated, in_top_k: d.in_top_k, included: d.included, visible: d.visible,
    relative_score: d.relative_score, signal_band: d.signal_band, reason: d.reason,
  }))
  const warnings: string[] = []
  for (const d of dims) {
    d.activated = d.units >= quantizeToUnits(rules.activation_threshold)
    if (!d.activated) d.reason = 'below_activation_threshold'
  }
  const activated = dims.filter(d => d.activated).sort((a, b) => a.raw_rank - b.raw_rank)
  if (!activated.length) return { mode: null, slots: [], explanation: explanation(), warnings }
  const topK = activated.slice(0, rules.max_scents)
  topK.forEach(d => { d.in_top_k = true })
  activated.slice(rules.max_scents).forEach(d => { d.reason = 'outside_top_k' })
  if (activated.length > rules.max_scents && topK.at(-1)!.units === activated[rules.max_scents].units) warnings.push('top_k_boundary_tie')
  const top = topK[0].units
  for (const d of topK) {
    const bands: [Band, number][] = [['Strong', rules.strong_min], ['Medium', rules.medium_min], ['Subtle', rules.relative_min]]
    d.signal_band = bands.find(([, min]) => d.units * 10000 >= quantizeToUnits(min) * top)?.[0] ?? null
    if (!d.signal_band) { d.reason = 'below_relative_threshold'; continue }
    d.relative_score = d.units / top
    d.included = true
  }
  const retained = topK.filter(d => d.included)
  const gap = retained.length > 1 ? retained[0].units - retained[1].units : Infinity
  const mode = gap < quantizeToUnits(rules.dual_gap) ? 'dual' : gap > quantizeToUnits(rules.single_gap) ? 'single' : 'normal'
  retained.forEach((d, i) => {
    if (mode === 'single' && i > 1) { d.reason ??= 'suppressed_by_single_mode'; return }
    d.visible = true
    d.emphasis = mode === 'dual' ? (i < 2 ? 'co_primary' : 'accent') : i === 0 ? 'primary' : mode === 'single' || i === 2 ? 'accent' : 'secondary'
  })
  const visible = retained.filter(d => d.visible)
  const environment = visible.find(d => d.scent_id === 'grass') ?? visible.find(d =>
    ['lavender', 'cedarwood'].includes(d.scent_id) && ['secondary', 'accent'].includes(d.emphasis!))
  for (const d of visible) {
    d.placement = d === environment ? 'environment' : 'object'
    d.motif_band = d.emphasis === 'accent' ? 'Subtle' : d.signal_band!
    d.tier_capped = d.emphasis === 'accent' && d.signal_band !== 'Subtle'
  }
  if (activated[0].units < quantizeToUnits(rules.low_confidence_warning_threshold)) warnings.push('low_absolute_confidence')
  if (activated.length >= 3 && activated[0].units - activated[2].units < quantizeToUnits(rules.dual_gap)) warnings.push('crowded_profile')
  return { mode, slots: visible as Slot[], explanation: explanation(), warnings }
}
