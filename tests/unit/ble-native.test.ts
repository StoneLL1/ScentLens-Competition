import { beforeEach, describe, expect, it, vi } from 'vitest'
const client = vi.hoisted(() => ({ initialize: vi.fn(async () => {}), isEnabled: vi.fn(async () => true), requestLEScan: vi.fn(async () => {}), stopLEScan: vi.fn(async () => {}), getDevices: vi.fn(async (ids: string[]) => ids.map(deviceId => ({ deviceId }))), connect: vi.fn(async () => {}), getServices: vi.fn(), disconnect: vi.fn(async () => {}), read: vi.fn(), write: vi.fn(), startNotifications: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: client }))
import { NativePocketTransport } from '../../src/services/ble/transport'
import { BLE } from '../../src/services/ble/protocol'
beforeEach(() => { vi.clearAllMocks(); client.getServices.mockResolvedValue([{ uuid: BLE.service }]) })
describe('native CoreBluetooth bridge contract', () => {
  it('keeps one central manager across scan, connect and reconnect, rehydrates a remembered peripheral', async () => {
    const transport = new NativePocketTransport()
    await transport.scan(() => {}); await transport.stopScan(); await transport.connect('pocket', () => {})
    await transport.disconnect(); await transport.connect('pocket', () => {})
    expect(client.initialize).toHaveBeenCalledTimes(1)
    expect(client.getDevices).toHaveBeenCalledTimes(2)
    expect(client.getDevices).toHaveBeenCalledWith(['pocket'])
    expect(client.requestLEScan).toHaveBeenCalledWith({ services: [BLE.service], allowDuplicates: false }, expect.any(Function))
  })
  it('rejects Kit service, and uses only circular-screen characteristics and response writes', async () => {
    const transport = new NativePocketTransport()
    client.getServices.mockResolvedValueOnce([{ uuid: 'ea907001-8c09-4c72-b375-19fabc688001' }])
    await expect(transport.connect('kit', () => {})).rejects.toMatchObject({ code: 'wrong_service' })
    await transport.connect('pocket', () => {})
    await transport.readMetadata(); await transport.subscribe(() => {}); await transport.write(new Uint8Array([1,2,3]))
    expect(client.read).toHaveBeenCalledWith('pocket', BLE.service, BLE.metadata)
    expect(client.startNotifications).toHaveBeenCalledWith('pocket', BLE.service, BLE.events, expect.any(Function))
    expect(client.write).toHaveBeenCalledWith('pocket', BLE.service, BLE.command, expect.any(DataView))
  })
  it('retries initialization after denied permission without caching rejection', async () => {
    const transport = new NativePocketTransport()
    client.initialize.mockRejectedValueOnce(new Error('BLE permission denied'))
    await expect(transport.scan(() => {})).rejects.toThrow('permission denied')
    await transport.scan(() => {})
    expect(client.initialize).toHaveBeenCalledTimes(2)
  })
})
