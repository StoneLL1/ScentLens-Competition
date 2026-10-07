import type { PocketTransport, PocketIdentity } from '../../src/services/ble/transport'
import type { Packet } from '../../src/services/ble/protocol'
export const identity = { deviceId: 'test-pocket', name: 'ScentLens-132' }
export const state = (phase: string, patch: Packet = {}): Packet => ({ v: 1, type: 'state', firmware: 'fixture-4.5.3', model_id: 'fixture-model', offline_phase: phase, kit_ready: true, kit_connected: true, capture_active: false, pending: false, preview: false, result_valid: phase === 'done', result: [.01,.02,.03,.04,.05,.06,.07,.08], running: true, ...patch })
export class ReplayPocketTransport implements PocketTransport {
  receive?: (bytes: DataView) => void
  disconnected?: () => void
  writes: Uint8Array[] = []
  commands: Packet[] = []
  bytes: number[] = []
  current = state('idle')
  autoAck = true
  startSampling = true
  metadata = { v: 1, device: 'ScentLens-132', chunk: 20, max_command: 767 }
  async scan(found: (device: PocketIdentity) => void) { found(identity) }
  async stopScan() {}
  async connect(_id: string, disconnected: () => void) { this.disconnected = disconnected }
  async disconnect() { this.receive = undefined }
  async readMetadata() { return new DataView(new TextEncoder().encode(JSON.stringify(this.metadata)).buffer) }
  async subscribe(receive: (bytes: DataView) => void) { this.receive = receive }
  emit(packet: Packet) {
    if (packet.type === 'state') this.current = packet
    const bytes = new TextEncoder().encode(JSON.stringify(packet) + '\n')
    for (let at = 0; at < bytes.length; at += 7) { const part = bytes.slice(at, at + 7); this.receive?.(new DataView(part.buffer)) }
  }
  ack(command: Packet, patch: Packet = {}) { this.emit({ v: 1, type: 'ack', id: command.id, command: command.command, ok: true, ...patch }) }
  async write(chunk: Uint8Array) {
    this.writes.push(chunk)
    for (const byte of chunk) {
      if (byte !== 10) { this.bytes.push(byte); continue }
      const command: Packet = JSON.parse(new TextDecoder().decode(new Uint8Array(this.bytes))); this.bytes = []; this.commands.push(command)
      if (!this.autoAck) continue
      this.ack(command)
      if (command.command === 'INFO' || command.command === 'STATUS') this.emit(this.current)
      else if (command.command === 'START') this.emit(state(this.current.offline_phase === 'prepared' && this.startSampling ? 'sampling' : 'background'))
      else if (command.command === 'REMOVED') this.emit(state('background'))
      else if (command.command === 'STOP') this.emit(state('idle', { running: false }))
    }
  }
}
