import { DISPLAY_ORDER, SCENT_LABELS, type DevelopmentText, type Reading } from '../domain/reading'
import type { CloudImage, EmptyInterpretation, GenerationContext } from './CloudGenerationAdapter'
import type { CloudInterpretation } from '../../shared/generation'

export interface GenerationAdapter {
  kind?: 'cloud' | 'mock'
  interpret(reading: Reading, signal: AbortSignal, context?: GenerationContext): Promise<DevelopmentText | CloudInterpretation | EmptyInterpretation>
  image(reading: Reading, signal: AbortSignal, context?: GenerationContext): Promise<string | CloudImage>
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export class MockGenerationAdapter implements GenerationAdapter {
  textDelayMs = 1200
  imageDelayMs = 6500
  async interpret(reading: Reading, signal: AbortSignal): Promise<DevelopmentText> {
    await wait(this.textDelayMs, signal)
    const strongest = [...DISPLAY_ORDER].sort((a, b) => reading.scores100[b] - reading.scores100[a]).filter(key => reading.scores100[key] > 0).slice(0, 3)
    return {
      title: strongest.length ? `${SCENT_LABELS[strongest[0]]}里的气味片刻` : '安静的气味片刻',
      keywords: strongest.map(key => SCENT_LABELS[key]),
      description: '这段文字与稍后出现的固定作品用于开发演示，帮助预览气味结果逐步呈现的过程。',
      origin: 'mock', completedAt: new Date().toISOString(),
    }
  }
  async image(_reading: Reading, signal: AbortSignal) {
    await wait(this.imageDelayMs, signal)
    return '/assets/development/sample-a.png'
  }
}
