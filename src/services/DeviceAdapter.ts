import type { DeviceSample } from '../domain/reading'
export interface DeviceAdapter {
  start(sessionId: string, complete: (sample: DeviceSample) => void, failed?: (message: string) => void, started?: () => void): void
  stop(): void | Promise<void>
  /** End local receipt after a valid sample without stopping the physical heater. */
  release?(): void
  readonly waitsForSampling?: boolean
}
