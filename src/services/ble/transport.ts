import { BleClient } from '@capacitor-community/bluetooth-le'
import { Capacitor } from '@capacitor/core'
import { BLE, DeviceError } from './protocol'
export interface PocketIdentity { deviceId: string; name: string }
export interface PocketTransport {
  scan(found: (device: PocketIdentity) => void): Promise<void>
  stopScan(): Promise<void>
  connect(deviceId: string, disconnected: () => void): Promise<void>
  readMetadata(): Promise<DataView>
  subscribe(receive: (bytes: DataView) => void): Promise<void>
  write(bytes: Uint8Array): Promise<void>
  disconnect(): Promise<void>
}
export class NativePocketTransport implements PocketTransport {
  private deviceId?: string
  private initialized?: Promise<void>
  private async initialize() {
    if (!Capacitor.isNativePlatform()) throw new DeviceError('native_required')
    // On iOS initialize creates a new CBCentralManager. Repeating it after scan
    // strands the cached peripheral on the old manager and connection times out.
    this.initialized ??= BleClient.initialize().catch(error => { this.initialized = undefined; throw error })
    await this.initialized
    if (!await BleClient.isEnabled()) throw new DeviceError('bluetooth_off')
  }
  async scan(found: (device: PocketIdentity) => void) {
    await this.initialize()
    await BleClient.requestLEScan({ services: [BLE.service], allowDuplicates: false }, result => {
      found({ deviceId: result.device.deviceId, name: result.localName || result.device.name || '闻见 Pocket' })
    })
  }
  async stopScan() { await BleClient.stopLEScan() }
  async connect(deviceId: string, disconnected: () => void) {
    await this.initialize()
    // A remembered UUID survives app restarts; the plugin's Device map does not.
    const devices = await BleClient.getDevices([deviceId])
    if (!devices.some(device => device.deviceId === deviceId)) throw new DeviceError('device_not_found', '没有找到已记住的 Pocket，请重新搜索。')
    this.deviceId = deviceId
    await BleClient.connect(deviceId, disconnected, { timeout: 12_000 })
    const services = await BleClient.getServices(deviceId)
    if (!services.some(service => service.uuid.toLowerCase() === BLE.service)) throw new DeviceError('wrong_service')
  }
  private id() { if (!this.deviceId) throw new DeviceError('disconnected'); return this.deviceId }
  readMetadata() { return BleClient.read(this.id(), BLE.service, BLE.metadata) }
  subscribe(receive: (bytes: DataView) => void) { return BleClient.startNotifications(this.id(), BLE.service, BLE.events, receive) }
  write(bytes: Uint8Array) { return BleClient.write(this.id(), BLE.service, BLE.command, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)) }
  async disconnect() {
    const id = this.deviceId; this.deviceId = undefined
    if (id) await BleClient.disconnect(id)
  }
}
export const openBluetoothSettings = () => BleClient.openAppSettings()
