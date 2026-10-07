import type { DeviceSample } from '../domain/reading'

import type { DeviceAdapter } from './DeviceAdapter'
export type { DeviceAdapter } from './DeviceAdapter'

// Delays are development controls, never hardware progress/ETA.
export class MockDeviceAdapter implements DeviceAdapter {
  delayMs: number | null = 3500
  rawScores: unknown = [.12, .08, .64, .62, .78, .21, .15, .71]
  private complete?: (sample: DeviceSample) => void
  private sessionId?: string
  private timer?: ReturnType<typeof setTimeout>
  start(sessionId: string, onComplete: (sample: DeviceSample) => void) {
    this.stop()
    this.sessionId = sessionId
    this.complete = onComplete
    if (this.delayMs !== null) this.timer = setTimeout(() => this.deliver(), this.delayMs)
  }
  deliver(rawScores = this.rawScores) {
    if (this.sessionId) this.complete?.({ captureSessionId: this.sessionId, source: 'mock', rawScores,
      rawScale: '0-1', resultValid: true, preview: false, quality: 'unknown', deviceMetadata: { adapter: 'TASK-02 Mock' } })
  }
  stop() { clearTimeout(this.timer); this.complete = undefined; this.sessionId = undefined }
}
