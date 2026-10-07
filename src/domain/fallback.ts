import { DISPLAY_ORDER, SCENT_LABELS, type Scores100 } from './reading'
import type { FallbackPresentation } from './artwork'

export function localScentLabels(scores: Scores100) {
  return [...DISPLAY_ORDER].sort((a,b) => scores[b] - scores[a]).slice(0,3).map(key => SCENT_LABELS[key])
}
export function chooseFallback(scores: Scores100): FallbackPresentation {
  const key = [...DISPLAY_ORDER].sort((a,b) => scores[b] - scores[a])[0]
  return { origin: 'preset_fallback', resourceKey: scores[key] > 0 ? key : 'neutral' }
}
