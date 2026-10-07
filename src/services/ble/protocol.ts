/** TypeScript adaptation of trainer/web/scentlens-ble.mjs (hardware baseline 4.5.3).
 * Retains LF byte framing, bounded frames, serial 20-byte response writes and ACK identity.
 * The browser ScentLensDevice transport is deliberately not imported.
 */
export const BLE = Object.freeze({
  service: 'ea908001-8c09-4c72-b375-19fabc688001',
  command: 'ea908002-8c09-4c72-b375-19fabc688001',
  events: 'ea908003-8c09-4c72-b375-19fabc688001',
  metadata: 'ea908004-8c09-4c72-b375-19fabc688001',
})
export class DeviceError extends Error {
  constructor(public code: string, message = code, public details?: unknown) { super(message); this.name = 'DeviceError' }
}
export type Packet = Record<string, unknown>
export type Command = 'INFO' | 'STATUS' | 'START' | 'REMOVED' | 'STOP'
interface Pending { id: number; command: Command; resolve: (p: Packet) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }
export class ScentLensProtocol {
  private bytes: number[] = []
  private discard = false
  private nextId = 0
  private pending?: Pending
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  constructor(private options: { write: (chunk: Uint8Array) => Promise<void>; onState: (state: Packet) => void; onError: (error: DeviceError) => void; timeout?: number }) {}
  feed(chunk: DataView | Uint8Array) {
    if (this.closed) return
    const data = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    for (const byte of data) {
      if (byte === 10) {
        if (!this.discard && this.bytes.length) {
          let parsed: unknown
          try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(this.bytes))) }
          catch (error) {
            const details = { reason: String(error), byteLength: this.bytes.length, frame: new TextDecoder().decode(new Uint8Array(this.bytes)) }
            this.options.onError(new DeviceError('invalid_frame', 'invalid_frame', details))
          }
          // Subscriber failures are application errors, not malformed BLE bytes.
          if (parsed !== undefined) this.packet(parsed)
        }
        this.bytes = []; this.discard = false
      } else if (!this.discard) {
        if (byte === 0 || this.bytes.length >= 2047) {
          this.bytes = []; this.discard = true
          this.options.onError(new DeviceError(byte === 0 ? 'invalid_frame' : 'frame_too_long'))
        } else this.bytes.push(byte)
      }
    }
  }
  private packet(p: unknown) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return
    const packet = p as Packet
    if (packet.v !== 1) return
    if (packet.type === 'state') { this.options.onState(packet); return }
    const q = this.pending
    if (packet.type !== 'ack' || !q || packet.id !== q.id || packet.command !== q.command || typeof packet.ok !== 'boolean') return
    clearTimeout(q.timer); this.pending = undefined
    if (packet.ok) q.resolve(packet)
    else q.reject(new DeviceError(typeof packet.reason === 'string' ? packet.reason : 'rejected'))
  }
  request(command: Command) {
    const operation = async () => {
      if (this.closed) throw new DeviceError('disconnected')
      const id = this.nextId = this.nextId % 65535 + 1
      const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, id, command }) + '\n')
      if (bytes.length > 768) throw new DeviceError('command_too_long')
      let resolve!: (p: Packet) => void, reject!: (e: unknown) => void
      const response = new Promise<Packet>((a, b) => { resolve = a; reject = b })
      void response.catch(() => {})
      const timer = setTimeout(() => {
        if (this.pending?.id === id) { this.pending = undefined; reject(new DeviceError('timeout')) }
      }, this.options.timeout ?? 26_000)
      this.pending = { id, command, resolve, reject, timer }
      const failure = response.then(() => new Promise<never>(() => {}))
      void failure.catch(() => {})
      try {
        for (let at = 0; at < bytes.length; at += 20) {
          if (this.closed) throw new DeviceError('disconnected')
          await Promise.race([Promise.resolve().then(() => this.options.write(bytes.slice(at, at + 20))), failure])
        }
      } catch (error) { this.close(error) }
      return response
    }
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }
  close(error: unknown = new DeviceError('disconnected')) {
    this.closed = true; this.bytes = []; this.discard = false
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined }
  }
}
