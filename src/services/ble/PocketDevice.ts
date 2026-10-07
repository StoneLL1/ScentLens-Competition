import { fromHardware, type DeviceSample } from '../../domain/reading'
import type { DeviceAdapter } from '../DeviceAdapter'
import { DeviceError, ScentLensProtocol, type Command, type Packet } from './protocol'
import type { PocketIdentity, PocketTransport } from './transport'

export const STATE_TTL = 6500
export interface PocketSnapshot {
  connection: 'disconnected' | 'scanning' | 'connecting' | 'connected'
  devices: PocketIdentity[]
  device?: PocketIdentity
  state?: Packet
  fresh: boolean
  command?: Command
  error?: string
  notice?: string
  uncertain: boolean
}
interface Session {
  id: string; phone: boolean; ack: boolean; sampling: boolean; delivered: boolean
  complete: (sample: DeviceSample) => void; failed: (message: string) => void; started: () => void
  result?: DeviceSample
}
export interface PocketEvents {
  started: (id: string) => boolean
  result: (sample: DeviceSample, active: boolean) => void
  failed: (id: string, message: string) => void
}
const errors: Record<string, string> = {
  native_required: '请在 iPhone 的闻见 App 中连接 Pocket；浏览器可继续查看本地记录。',
  bluetooth_off: '蓝牙未开启，请开启蓝牙后重新连接。',
  kit_not_ready: 'Pocket 已连接，传感器 Kit 尚未就绪。请检查 Kit 电源与连接。',
  wrong_service: '这不是兼容的 Pocket 圆屏，请重新搜索。',
  unsupported_protocol: '设备协议不兼容，请连接当前 Pocket 圆屏。',
  disconnected: 'Pocket 已断开。已有记录仍保留，请重连后重新准备。',
  timeout: '未收到设备确认，执行结果未知。正在查询状态，请勿重复开始。',
  stop_not_confirmed: '设备未确认停止。请检查 Pocket，并刷新状态。',
  capture_active: '设备正在用于训练采集，请结束占用后再试。',
  busy: '设备正在处理上一项操作，请稍后刷新状态。',
  stale: '设备状态已过期，请刷新状态后重新准备。',
  invalid_frame: '设备状态未完整收到；本轮归属无法确认，请更新状态后重新采样。',
  frame_too_long: '设备数据帧过长；本轮归属无法确认，请刷新后重新采样。',
}
export function deviceMessage(error: unknown) {
  const code = error instanceof DeviceError ? error.code : error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  if (/permission|authoriz|denied/i.test(code)) return '未获得蓝牙权限，请到系统设置允许闻见使用蓝牙，再重新连接。'
  if (/connection timeout/i.test(code)) return '连接 Pocket 超时。请确认圆屏没有被其他客户端连接，重新上电后再搜索。'
  return errors[code] ?? `设备操作未完成（${code}）。请检查 Pocket 后重试。`
}

/** One connection epoch, one observable sampling boundary, one result submission.
 * Neither equal scores, uptime nor RPC IDs are treated as hardware sample IDs.
 */
export class PocketDevice implements DeviceAdapter {
  readonly waitsForSampling = true
  private snapshot: PocketSnapshot = { connection: 'disconnected', devices: [], fresh: false, uncertain: false }
  private listeners = new Set<() => void>()
  private protocol?: ScentLensProtocol
  private epoch = ''
  private serial = 0
  private lastStateAt?: number
  private freshnessTimer?: ReturnType<typeof setTimeout>
  private scanTimer?: ReturnType<typeof setTimeout>
  private boundaryTimer?: ReturnType<typeof setTimeout>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private session?: Session
  private foreground = true
  private connecting = false
  private opening?: Promise<void>
  private teardown: Promise<void> = Promise.resolve()
  private suppressRound = false
  private frameRecovery?: Promise<void>
  private lastFrameRecovery = -Infinity
  private scanToken = 0
  private events?: PocketEvents
  private remembered?: PocketIdentity
  private trace: { at: string; epoch: string; kind: string; data: unknown }[] = []
  constructor(private transport: PocketTransport, private storage?: Pick<Storage, 'getItem' | 'setItem'>, private timeout = 26_000, private now = () => Date.now()) {
    try {
      const value = JSON.parse(storage?.getItem('scentlens:pocket') ?? 'null')
      if (value && typeof value.deviceId === 'string' && typeof value.name === 'string') this.remembered = value
    } catch { /* Device memory is optional; browsing and manual scan remain available. */ }
  }
  getSnapshot = () => this.snapshot
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  bind(events: PocketEvents) { this.events = events }
  private update(patch: Partial<PocketSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()) }
  private log(kind: string, data: unknown) {
    this.trace.push({ at: new Date(this.now()).toISOString(), epoch: this.epoch, kind, data })
    if (this.trace.length > 160) this.trace.shift()
  }
  diagnostics() { return { protocol: 1, timeSource: 'phone-received', entries: this.trace.slice() } }
  private failSession(message: string) {
    clearTimeout(this.boundaryTimer)
    const session = this.session; this.session = undefined
    if (session && !session.delivered) session.failed(message)
  }
  private reset(message: string) {
    clearTimeout(this.freshnessTimer); clearTimeout(this.boundaryTimer)
    this.failSession(message); this.protocol?.close(); this.protocol = undefined
    this.lastStateAt = undefined; this.suppressRound = false; this.epoch = crypto.randomUUID()
    this.update({ connection: 'disconnected', fresh: false, state: undefined, command: undefined })
  }
  async scan() {
    if (this.connecting || this.snapshot.connection === 'connected' || this.snapshot.connection === 'scanning') return
    clearTimeout(this.reconnectTimer)
    const token = ++this.scanToken
    this.update({ connection: 'scanning', devices: [], error: undefined })
    try {
      await this.transport.scan(device => {
        if (token !== this.scanToken) return
        if (!this.snapshot.devices.some(d => d.deviceId === device.deviceId)) this.update({ devices: [...this.snapshot.devices, device] })
      })
      if (token !== this.scanToken) { await this.transport.stopScan(); return }
      this.scanTimer = setTimeout(() => { void this.stopScan() }, 10_000)
    } catch (error) { if (token === this.scanToken) this.update({ connection: 'disconnected', error: deviceMessage(error) }) }
  }
  async stopScan() {
    ++this.scanToken; clearTimeout(this.scanTimer)
    try { await this.transport.stopScan() } catch { /* No active scanner is harmless. */ }
    if (this.snapshot.connection === 'scanning') this.update({ connection: 'disconnected', notice: this.snapshot.devices.length ? undefined : '没有找到 Pocket。请检查电源、距离，以及是否被其他客户端连接。' })
  }
  connect(device: PocketIdentity): Promise<void> {
    if (this.connecting || !this.foreground) return Promise.resolve()
    this.connecting = true
    const requestedEpoch = this.epoch
    const operation = this.teardown.then(async () => {
      if (this.foreground && this.epoch === requestedEpoch) await this.open(device)
    })
    this.opening = operation
    return operation.finally(() => { if (this.opening === operation) { this.connecting = false; this.opening = undefined } })
  }
  private async open(device: PocketIdentity) {
    clearTimeout(this.reconnectTimer)
    await this.stopScan()
    this.reset('连接已重建，请重新采样。')
    const epoch = this.epoch
    this.update({ connection: 'connecting', device, error: undefined, notice: undefined, uncertain: false })
    const current = () => this.epoch === epoch && this.foreground
    try {
      await this.transport.connect(device.deviceId, () => {
        if (!current()) return
        this.log('disconnect', {})
        this.reset(errors.disconnected)
        this.update({ error: errors.disconnected })
        // A single bounded attempt. A failed handshake requires a manual retry.
        if (this.foreground) this.reconnectTimer = setTimeout(() => { void this.reconnect() }, 1200)
      })
      if (!current()) throw new DeviceError('disconnected')
      const metadata = await this.transport.readMetadata()
      const meta: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadata))
      if (!meta || typeof meta !== 'object' || (meta as Packet).v !== 1) throw new DeviceError('unsupported_protocol')
      this.log('metadata', meta)
      if (!current()) throw new DeviceError('disconnected')
      const protocol = new ScentLensProtocol({
        timeout: this.timeout,
        write: bytes => { if (!current()) throw new DeviceError('disconnected'); return this.transport.write(bytes) },
        onState: state => { if (current()) this.receive(state) },
        onError: error => {
          if (!current()) return
          this.log('protocol-error', { code: error.code, details: error.details }); this.failSession(deviceMessage(error))
          this.update({ fresh: false, uncertain: true, error: deviceMessage(error) })
          this.recoverFrame()
        },
      })
      this.protocol = protocol
      await this.transport.subscribe(bytes => { if (current()) protocol.feed(bytes) })
      await protocol.request('INFO')
      await this.waitForState(epoch)
      if (!current()) throw new DeviceError('disconnected')
      this.remembered = device
      try { this.storage?.setItem('scentlens:pocket', JSON.stringify(device)) } catch { /* Reconnection can still use this session's identity. */ }
      this.update({ connection: 'connected', error: undefined, uncertain: false })
      this.log('handshake', this.snapshot.state)
    } catch (error) {
      if (this.epoch === epoch) { this.reset(deviceMessage(error)); this.update({ error: deviceMessage(error) }); await this.transport.disconnect().catch(() => {}) }
    }
  }
  private waitForState(epoch: string, after = -Infinity) {
    if (this.lastStateAt !== undefined && this.lastStateAt >= after && this.snapshot.fresh) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); unsubscribe() }
      const unsubscribe = this.subscribe(() => {
        if (this.epoch !== epoch) { cleanup(); reject(new DeviceError('disconnected')) }
        else if (this.lastStateAt !== undefined && this.lastStateAt >= after && this.snapshot.fresh) { cleanup(); resolve() }
      })
      const timer = setTimeout(() => { cleanup(); reject(new DeviceError('stale')) }, STATE_TTL)
    })
  }
  async reconnect() {
    await this.teardown
    await this.opening
    if (this.remembered && this.foreground && this.snapshot.connection === 'disconnected') await this.connect(this.remembered)
  }
  disconnect() {
    clearTimeout(this.reconnectTimer)
    // Invalidate receipt synchronously. Platform cleanup may finish after resume.
    this.reset(errors.disconnected)
    const opening = this.opening, previous = this.teardown
    this.teardown = previous.then(async () => {
      await this.stopScan()
      await opening?.catch(() => {})
      await this.transport.disconnect().catch(() => {})
    })
    return this.teardown
  }
  setForeground(foreground: boolean) {
    if (this.foreground === foreground) return
    this.foreground = foreground
    if (!foreground) { this.failSession('App 已离开前台，请重新准备。'); void this.disconnect() }
    else void this.reconnect()
  }
  private ready() {
    const s = this.snapshot
    if (s.connection !== 'connected' || !this.protocol) throw new DeviceError('disconnected')
    if (!s.fresh) throw new DeviceError('stale')
    if (s.command || s.uncertain || s.state?.pending !== false) throw new DeviceError('busy')
    if (s.state?.capture_active !== false) throw new DeviceError('capture_active')
    if (s.state?.kit_ready !== true) throw new DeviceError('kit_not_ready')
    if (s.state?.preview !== false) throw new DeviceError('preview_active', '请先在设备上退出演示模式，再重新采样。')
    return s.state
  }
  canPrepare() {
    try { return ['idle', 'failed', 'done', 'waiting_removal'].includes(String(this.ready().offline_phase)) } catch { return false }
  }
  canStart() { try { return this.ready().offline_phase === 'prepared' } catch { return false } }
  async prepare() {
    try {
      const state = this.ready()
      if (!this.canPrepare()) return
      await this.command(['done', 'waiting_removal'].includes(String(state.offline_phase)) ? 'REMOVED' : 'START')
    } catch (error) {
      this.update({ error: deviceMessage(error) })
      if (error instanceof DeviceError && error.code === 'timeout') void this.refreshAfterUnknown()
    }
  }
  private async command(command: Command) {
    const protocol = this.protocol, epoch = this.epoch
    if (!protocol || this.snapshot.command) throw new DeviceError('busy')
    this.update({ command, error: undefined }); this.log('command', command)
    try { const ack = await protocol.request(command); if (this.epoch !== epoch) throw new DeviceError('disconnected'); this.log('ack', ack); return ack }
    catch (error) {
      if (this.epoch === epoch) { this.log('command-error', { command, message: String(error) }); this.update({ uncertain: true, error: deviceMessage(error) }) }
      throw error
    } finally {
      if (this.epoch === epoch && this.snapshot.command === command) this.update({ command: undefined })
    }
  }
  async refresh() {
    if (this.snapshot.connection !== 'connected' || this.snapshot.command) return
    const epoch = this.epoch
    // Invalidate previous ready state; INFO/STATUS ACK alone does not make it fresh.
    this.update({ fresh: false })
    const at = this.now()
    try { await this.command('STATUS'); await this.waitForState(epoch, at); if (epoch === this.epoch) this.update({ uncertain: false, error: undefined }) }
    catch (error) { if (epoch === this.epoch) this.update({ error: deviceMessage(error) }) }
  }
  private recoverFrame() {
    // Discarded notification fragments cannot reconstruct a sample. Resync only
    // device state, once per burst, and never replay START or interrupt its ACK.
    if (this.frameRecovery || this.snapshot.command || this.snapshot.connection !== 'connected' || this.now() - this.lastFrameRecovery < 15_000) return
    this.lastFrameRecovery = this.now()
    this.log('frame-recovery', { action: 'STATUS' })
    const recovery = this.refresh()
    this.frameRecovery = recovery
    void recovery.finally(() => { if (this.frameRecovery === recovery) this.frameRecovery = undefined })
  }
  start(id: string, complete: Session['complete'], failed: Session['failed'] = () => {}, started = () => {}) {
    try {
      if (!this.canStart()) { this.ready(); throw new DeviceError('not_prepared', '背景还未准备好，请先移走样品并完成准备。') }
      this.session = { id, phone: true, ack: false, sampling: false, delivered: false, complete, failed, started }
      const session = this.session
      void this.command('START').then(() => {
        if (this.session !== session) return
        session.ack = true
        if (session.sampling) { session.started(); this.deliver(session) }
        else this.boundaryTimer = setTimeout(() => {
          if (this.session !== session || session.sampling) return
          this.failSession('设备已确认命令，但未观察到本轮采样开始。请刷新状态后重新准备。')
          this.update({ uncertain: true }); void this.refresh()
        }, STATE_TTL)
      }).catch(error => {
        if (this.session !== session) return
        this.failSession(deviceMessage(error))
        if (error instanceof DeviceError && error.code === 'timeout') void this.refreshAfterUnknown()
      })
    } catch (error) { failed(deviceMessage(error)) }
  }
  private async refreshAfterUnknown() {
    const message = this.snapshot.error
    await this.refresh()
    // A STATUS reply describes the device, but cannot retroactively ACK START/STOP.
    this.update({ error: message ?? errors.timeout })
  }
  release() { /* Completed session stays as a deduplication boundary until the next phase. */ }
  async stop() {
    this.suppressRound = true
    this.failSession('本轮已取消接收。')
    if (this.snapshot.connection !== 'connected') throw new DeviceError('disconnected')
    // STOP must wait for an outstanding START; protocol serialization prevents interleaving.
    const protocol = this.protocol!, epoch = this.epoch
    this.update({ command: 'STOP', error: undefined }); this.log('command', 'STOP')
    try {
      const ack = await protocol.request('STOP')
      if (epoch !== this.epoch) throw new DeviceError('disconnected')
      this.log('ack', ack); this.update({ command: undefined, uncertain: false, notice: 'Pocket 已确认停止。' })
    } catch (error) {
      if (epoch === this.epoch) {
        this.update({ command: undefined, uncertain: true, error: deviceMessage(error) })
        await this.refreshAfterUnknown()
      }
      throw error
    }
  }
  private receive(state: Packet) {
    const now = this.now(), previous = this.snapshot.state
    const contiguous = this.lastStateAt !== undefined && now - this.lastStateAt <= STATE_TTL && this.snapshot.fresh
    if (!contiguous && this.session) this.failSession(errors.stale)
    this.lastStateAt = now
    clearTimeout(this.freshnessTimer)
    this.freshnessTimer = setTimeout(() => {
      this.failSession(errors.stale); this.update({ fresh: false, error: errors.stale })
    }, STATE_TTL + 1)
    this.update({ state, fresh: true }); this.log('state', state)
    // Handshake observations establish a baseline only, even if the device is mid-cycle.
    if (!this.foreground || this.snapshot.connection !== 'connected') return
    if (this.suppressRound && !this.snapshot.command && !this.snapshot.uncertain && ['idle', 'background', 'prepared', 'waiting_removal'].includes(String(state.offline_phase))) this.suppressRound = false
    const safe = state.kit_ready === true && state.capture_active === false && state.preview === false
    const sampling = state.offline_phase === 'sampling'
    if (sampling && safe && !this.suppressRound && this.snapshot.command !== 'STOP' && contiguous && previous?.offline_phase === 'prepared' && !this.snapshot.uncertain) {
      if (!this.session || this.session.delivered) {
        const id = `${this.epoch}:${++this.serial}`
        const active = this.events?.started(id) ?? false
        this.session = { id, phone: false, ack: true, sampling: true, delivered: false,
          started: () => {}, complete: sample => this.events?.result(sample, active), failed: message => this.events?.failed(id, message) }
        this.log('hardware-session', { id, active })
      } else if (this.session.phone && !this.session.sampling) {
        this.session.sampling = true; clearTimeout(this.boundaryTimer)
        if (this.session.ack) this.session.started()
      }
    }
    const session = this.session
    if (state.offline_phase === 'failed' || state.capture_active === true || state.kit_ready === false) {
      this.failSession(state.capture_active === true ? errors.capture_active : state.kit_ready === false ? errors.kit_not_ready : `读取未完成：${String(state.offline_reason ?? '设备报告失败')}。请重新准备。`)
      return
    }
    if (state.offline_phase === 'done') {
      if (!session?.sampling) {
        this.update({ notice: '设备保留了一份结果，但无法确认采样归属。请移走样品后重新准备；本次未自动保存。' })
        if (session) this.failSession('未观察到本轮 sampling 边界，请重新采样。')
        return
      }
      if (session.delivered) return
      if (!safe || state.result_valid !== true || state.preview !== false) { this.failSession('这不是完整有效的设备结果，请重新采样。'); return }
      try { fromHardware(state.result) }
      catch { this.failSession('收到的八维不完整或数值无效，请重新采样。'); return }
      const metadata = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
      session.result = { captureSessionId: session.id, source: 'device', rawScores: state.result, rawScale: '0-1', resultValid: true, preview: false,
        quality: state.result_quality === 'clear' ? 'normal' : 'unknown',
        deviceMetadata: { ...metadata, adapter: 'Pocket BLE', connectionEpoch: this.epoch, receivedTimeSource: 'phone-received' } }
      this.deliver(session)
    } else if (session?.sampling && !sampling && state.offline_phase !== 'done') {
      this.failSession('采样阶段已变化，未收到可确认的完整结果。请重新准备。')
    }
  }
  private deliver(session: Session) {
    if (session !== this.session || session.delivered || !session.ack || !session.sampling || !session.result) return
    session.delivered = true; this.log('accepted', { captureSessionId: session.id, rawScores: session.result.rawScores })
    this.update({ notice: undefined }); session.complete(session.result)
  }
}
