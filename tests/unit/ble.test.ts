import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScentLensProtocol } from '../../src/services/ble/protocol'
import { PocketDevice, STATE_TTL } from '../../src/services/ble/PocketDevice'
import { ReplayPocketTransport, identity, state } from '../fixtures/pocket'
import incomplete from '../fixtures/pocket-incomplete-frame.json'
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve() }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Pocket byte framing and RPC', () => {
  it('buffers split UTF-8, multiple lines, malformed/oversize/NUL frames, then recovers at LF', () => {
    const states = vi.fn(), errors = vi.fn()
    const p = new ScentLensProtocol({ write: async () => {}, onState: states, onError: errors })
    const bytes = new TextEncoder().encode(JSON.stringify(state('prepared', { offline_reason: '空气已准备好' })) + '\n')
    for (const byte of bytes) p.feed(new Uint8Array([byte]))
    expect(states).toHaveBeenCalledWith(expect.objectContaining({ offline_reason: '空气已准备好' }))
    p.feed(new TextEncoder().encode('bad\n' + 'x'.repeat(2048) + '\n' + '\u0000oops\n'))
    p.feed(bytes); p.feed(bytes)
    expect(states).toHaveBeenCalledTimes(3); expect(errors).toHaveBeenCalledTimes(3)
    p.close(); p.feed(bytes); expect(states).toHaveBeenCalledTimes(3)
  })
  it('does not complete writes on wrong id, command or non-boolean ok; commands never interleave', async () => {
    const t = new ReplayPocketTransport(); t.autoAck = false
    const p = new ScentLensProtocol({ write: bytes => t.write(bytes), onState: () => {}, onError: () => {}, timeout: 100 })
    t.receive = bytes => p.feed(bytes)
    const a = p.request('START'), b = p.request('STOP'); await flush()
    expect(t.commands.map(c => c.command)).toEqual(['START'])
    const done = vi.fn(); void a.then(done)
    t.ack(t.commands[0], { id: 20 }); t.ack(t.commands[0], { command: 'STATUS' }); t.ack(t.commands[0], { ok: 'true' }); await flush()
    expect(done).not.toHaveBeenCalled(); t.ack(t.commands[0]); await a; await flush()
    expect(t.commands.map(c => c.command)).toEqual(['START', 'STOP']); t.ack(t.commands[1]); await b
    expect(t.writes.every(chunk => chunk.length <= 20)).toBe(true)
  })
  it('times out without replay and rejects pending/queued operations on disconnect; half-frames never cross connections', async () => {
    const p = new ScentLensProtocol({ write: async () => {}, onState: vi.fn(), onError: vi.fn(), timeout: 100 })
    const a = p.request('START'); const rejection = expect(a).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(100); await rejection
    const b = p.request('STOP'), c = p.request('STATUS')
    const rb = expect(b).rejects.toMatchObject({ code: 'disconnected' }), rc = expect(c).rejects.toMatchObject({ code: 'disconnected' })
    await flush(); p.feed(new TextEncoder().encode('{"v":1')); p.close(); await rb; await rc
    const onState = vi.fn(), next = new ScentLensProtocol({ write: async () => {}, onState, onError: vi.fn() })
    next.feed(new TextEncoder().encode(',"type":"state"}\n')); expect(onState).not.toHaveBeenCalled()
  })
})

async function setup(phase = 'idle') {
  const transport = new ReplayPocketTransport(); transport.current = state(phase)
  const storage = { getItem: () => null, setItem: vi.fn() }
  const device = new PocketDevice(transport, storage, 100)
  const events = { started: vi.fn(() => true), result: vi.fn(), failed: vi.fn() }; device.bind(events)
  await device.connect(identity)
  return { device, transport, events, storage }
}
describe('Pocket session ownership', () => {
  it('resynchronizes an actual incomplete iPhone notification without accepting or replaying its result', async () => {
    const { device, transport, events } = await setup('prepared')
    transport.emit(state('sampling'))
    transport.autoAck = false
    const bytes = new TextEncoder().encode(incomplete.frame + '\n')
    transport.receive?.(new DataView(bytes.buffer)); await flush()
    expect(events.failed).toHaveBeenCalledOnce()
    expect(events.result).not.toHaveBeenCalled()
    expect(device.getSnapshot().uncertain).toBe(true)
    expect(transport.commands.map(c => c.command)).toEqual(['INFO', 'STATUS'])
    // A burst of bad frames does not create a command storm.
    transport.receive?.(new DataView(bytes.buffer)); await flush()
    expect(transport.commands).toHaveLength(2)
    transport.ack(transport.commands.at(-1)!); transport.emit(state('done')); await flush()
    expect(device.getSnapshot()).toMatchObject({ fresh: true, uncertain: false, error: undefined })
    expect(events.result).not.toHaveBeenCalled()
    expect(device.getSnapshot().notice).toContain('未自动保存')
    transport.emit(state('prepared')); transport.emit(state('sampling')); transport.emit(state('done'))
    expect(events.result).toHaveBeenCalledOnce()
  })
  it('handshakes metadata, INFO and fresh state; an initial old done is never saved', async () => {
    const { device, transport, events, storage } = await setup('done')
    expect(device.getSnapshot().connection).toBe('connected'); expect(storage.setItem).toHaveBeenCalledTimes(1)
    transport.emit(state('done')); expect(events.result).not.toHaveBeenCalled(); expect(events.started).not.toHaveBeenCalled()
    expect(device.getSnapshot().notice).toContain('未自动保存')
  })
  it('background START is not sampling; prepared START requires both ACK and sampling and preserves raw diagnostics', async () => {
    const { device, transport, events } = await setup()
    await device.prepare(); expect(transport.commands.map(c => c.command)).toEqual(['INFO', 'START']); expect(events.started).not.toHaveBeenCalled()
    transport.emit(state('prepared')); transport.autoAck = false
    const complete = vi.fn(), started = vi.fn(), failed = vi.fn()
    device.start('phone', complete, failed, started); await flush()
    transport.emit(state('sampling')); transport.emit(state('done', { score_basis: 'model', raw_result: [.1], background: [.2] }))
    expect(complete).not.toHaveBeenCalled(); expect(started).not.toHaveBeenCalled()
    transport.ack(transport.commands.at(-1)!); await flush()
    expect(started).toHaveBeenCalledOnce(); expect(complete).toHaveBeenCalledOnce()
    expect(complete.mock.calls[0][0]).toMatchObject({ captureSessionId: 'phone', source: 'device', rawScale: '0-1', deviceMetadata: { firmware: 'fixture-4.5.3', raw_result: '[0.1]', score_basis: 'model' } })
    transport.emit(state('done')); expect(complete).toHaveBeenCalledOnce()
  })
  it('two confirmed equal-score hardware cycles have different sessions; repeated done has one result', async () => {
    const { transport, events } = await setup('prepared')
    for (let i = 0; i < 2; i++) { transport.emit(state('sampling')); transport.emit(state('done')); transport.emit(state('done')); transport.emit(state('prepared')) }
    expect(events.result).toHaveBeenCalledTimes(2)
    expect(events.result.mock.calls[0][0].captureSessionId).not.toBe(events.result.mock.calls[1][0].captureSessionId)
    expect(events.result.mock.calls[0][0].rawScores).toEqual(events.result.mock.calls[1][0].rawScores)
  })
  it.each([{ result: [0,1] }, { result: [2,0,0,0,0,0,0,0] }, { result_valid: false }, { preview: true }])('rejects invalid completed input %j', async patch => {
    const { transport, events } = await setup('prepared')
    transport.emit(state('sampling')); transport.emit(state('done', patch))
    expect(events.result).not.toHaveBeenCalled(); expect(events.failed).toHaveBeenCalledOnce()
  })
  it('rejects missing phases, expired state, reconnect old done and a baseline mid-sampling', async () => {
    const { device, transport, events } = await setup('prepared')
    transport.emit(state('done')); expect(events.result).not.toHaveBeenCalled()
    transport.emit(state('prepared')); transport.emit(state('sampling'))
    await vi.advanceTimersByTimeAsync(STATE_TTL + 1); transport.emit(state('done')); expect(events.result).not.toHaveBeenCalled()
    await device.disconnect(); transport.current = state('sampling'); await device.connect(identity); transport.emit(state('done'))
    expect(events.result).not.toHaveBeenCalled()
  })
  it('stops receipt immediately, waits for exact STOP ACK, queries STATUS after timeout without repeating START', async () => {
    const { device, transport, events } = await setup('prepared')
    transport.emit(state('sampling')); transport.autoAck = false
    const stopping = device.stop(), rejection = expect(stopping).rejects.toMatchObject({ code: 'timeout' }); await flush()
    transport.emit(state('done')); expect(events.result).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(101); await flush()
    expect(transport.commands.map(c => c.command)).toEqual(['INFO', 'STOP', 'STATUS'])
    transport.ack(transport.commands.at(-1)!); transport.emit(state('idle', { running: false })); await rejection
    expect(device.getSnapshot().error).toContain('未知')
  })
  it.each([{ pending: true }, { capture_active: true }, { kit_ready: false }, { pending: undefined }, { preview: true }])('blocks phone commands while state is not ready %j', async patch => {
    const { device, transport } = await setup('prepared'); transport.emit(state('prepared', patch))
    expect(device.canStart()).toBe(false); device.start('bad', vi.fn(), vi.fn()); await flush()
    expect(transport.commands).toHaveLength(1)
  })
  it('foreground loss invalidates sessions and requires a new handshake', async () => {
    const { device, transport, events } = await setup('prepared')
    transport.emit(state('sampling')); device.setForeground(false); await flush(); transport.emit(state('done'))
    expect(events.result).not.toHaveBeenCalled(); device.setForeground(true); await flush()
    expect(transport.commands.filter(c => c.command === 'INFO')).toHaveLength(2)
    expect(events.result).not.toHaveBeenCalled()
  })
  it('blocks an expired prepared phase and waits for explicit sample removal before preparing again', async () => {
    const { device, transport, events } = await setup('prepared')
    expect(device.canStart()).toBe(true)
    transport.emit(state('waiting_removal', { offline_reason: '准备已过期' }))
    expect(device.canStart()).toBe(false)
    expect(transport.commands.map(c => c.command)).toEqual(['INFO'])
    await device.prepare()
    expect(transport.commands.map(c => c.command)).toEqual(['INFO', 'REMOVED'])
    expect(events.started).not.toHaveBeenCalled()
    transport.emit(state('background'))
    expect(device.canStart()).toBe(false)
    transport.emit(state('prepared'))
    expect(device.canStart()).toBe(true)
  })
  it('does not reclassify a cancelled phone START as a hardware cycle while STOP is queued', async () => {
    const { device, transport, events } = await setup('prepared')
    transport.autoAck = false
    const complete = vi.fn(); device.start('cancel-before-sampling', complete, vi.fn()); await flush()
    const start = transport.commands.at(-1)!
    const stopping = device.stop(); await flush()
    transport.emit(state('sampling')); transport.emit(state('done'))
    expect(events.started).not.toHaveBeenCalled(); expect(events.result).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled()
    transport.ack(start); await flush(); transport.ack(transport.commands.at(-1)!); await stopping
    transport.emit(state('idle')); transport.emit(state('prepared')); transport.emit(state('sampling')); transport.emit(state('done'))
    expect(events.result).toHaveBeenCalledOnce()
  })
  it('serializes slow native teardown with a rapid foreground return', async () => {
    const { device, transport } = await setup('prepared')
    let release!: () => void
    const original = transport.stopScan.bind(transport)
    transport.stopScan = () => new Promise<void>(resolve => { release = resolve })
    device.setForeground(false); device.setForeground(true); await flush()
    expect(device.getSnapshot().connection).toBe('disconnected')
    transport.stopScan = original; release(); await flush()
    expect(device.getSnapshot().connection).toBe('connected')
    expect(transport.commands.filter(c => c.command === 'INFO')).toHaveLength(2)
  })

})
