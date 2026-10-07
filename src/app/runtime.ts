import { Capacitor } from '@capacitor/core'
import { PocketDevice } from '../services/ble/PocketDevice'
import { NativePocketTransport } from '../services/ble/transport'
import { RecordRepository } from '../data/RecordRepository'
import { CaptureCoordinator } from '../services/CaptureCoordinator'
import { MockDeviceAdapter } from '../services/MockDeviceAdapter'
import { MockGenerationAdapter } from '../services/MockGenerationAdapter'
import { CloudGenerationAdapter } from '../services/CloudGenerationAdapter'

export const repository = new RecordRepository()
export const mockDevice = new MockDeviceAdapter()
export const mockGeneration = new MockGenerationAdapter()
export const cloudGeneration = new CloudGenerationAdapter(import.meta.env.VITE_API_BASE_URL ?? '')
// A bundled, offline fixture build exercises native storage without a dev server
// or paid model calls. It retains production guards (no fault-injection console).
export const bleValidation = import.meta.env.MODE === 'ble-validation'
export const pocketMode = import.meta.env.MODE !== 'native-fixture' && (Capacitor.isNativePlatform() || bleValidation)
let deviceStorage: Storage | undefined
try { deviceStorage = localStorage } catch { /* Optional remembered device. */ }
export const pocketTransport = new NativePocketTransport()
export const pocket = new PocketDevice(pocketTransport, deviceStorage)
export const cloudMode = !bleValidation && import.meta.env.MODE !== 'native-fixture' && (import.meta.env.PROD || import.meta.env.MODE === 'cloud' || !!import.meta.env.VITE_API_BASE_URL)
export const coordinator = new CaptureCoordinator(repository, pocketMode ? pocket : mockDevice, cloudMode ? cloudGeneration : mockGeneration, undefined, input => repository.commitArtwork(input), !bleValidation)
pocket.bind({
  started: id => coordinator.adoptHardware(id),
  result: (sample, active) => { void (active ? coordinator.accept(sample) : coordinator.acceptPassive(sample)) },
  failed: (id, message) => coordinator.deviceFailed(id, message),
})
repository.onReadingDeleted(id => coordinator.readingDeleted(id))

if (import.meta.env.DEV) {
  // Development-only control surface for fault and timing acceptance; absent from production.
  void import('../dev/task02').then(({ installControls }) => installControls())
}
