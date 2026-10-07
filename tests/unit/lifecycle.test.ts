import { describe, expect, it, vi } from 'vitest'
import { bindLifecycle } from '../../src/app/lifecycle'

function setup(initiallyHidden = false) {
  const document = Object.assign(new EventTarget(), { hidden: initiallyHidden }), window = new EventTarget()
  const stop = vi.fn(), setHidden = vi.fn(), listeners = new Map<string, () => void>(), remove = vi.fn(async () => {})
  const native = { addListener: vi.fn(async (event: 'pause' | 'resume', cb: () => void) => { listeners.set(event, cb); return { remove } }) }
  const dispose = bindLifecycle(stop, document, window, setHidden, native)
  return { document, window, stop, setHidden, listeners, remove, dispose }
}

describe('native and browser lifecycle boundary', () => {
  it('native pause alone stops work and animation; resume never restarts work', () => {
    const s = setup()
    s.listeners.get('pause')!()
    expect(s.stop).toHaveBeenCalledTimes(1); expect(s.setHidden).toHaveBeenLastCalledWith(true)
    s.listeners.get('resume')!()
    expect(s.setHidden).toHaveBeenLastCalledWith(false); expect(s.stop).toHaveBeenCalledTimes(1)
    s.dispose()
  })
  it('duplicate visibility/pagehide/pause events stop one attempt, then permit a later background transition', () => {
    const s = setup()
    s.document.hidden = true; s.document.dispatchEvent(new Event('visibilitychange'))
    s.window.dispatchEvent(new Event('pagehide')); s.listeners.get('pause')!()
    expect(s.stop).toHaveBeenCalledTimes(1)
    s.listeners.get('resume')!(); expect(s.setHidden).toHaveBeenLastCalledWith(true)
    s.document.hidden = false; s.document.dispatchEvent(new Event('visibilitychange'))
    expect(s.setHidden).toHaveBeenLastCalledWith(false)
    s.listeners.get('pause')!(); expect(s.stop).toHaveBeenCalledTimes(2)
    s.dispose()
  })
  it('initially hidden mounts stop work and a restored page clears its hidden flag', () => {
    const s = setup(true)
    expect(s.stop).toHaveBeenCalledTimes(1)
    s.window.dispatchEvent(new Event('pagehide'))
    s.document.hidden = false; s.document.dispatchEvent(new Event('visibilitychange'))
    expect(s.setHidden).toHaveBeenLastCalledWith(true)
    s.window.dispatchEvent(new Event('pageshow')); expect(s.setHidden).toHaveBeenLastCalledWith(false)
    s.dispose()
  })
  it('removes listeners even when React unmounts before native registration completes', async () => {
    const s = setup()
    s.dispose()
    await vi.waitFor(() => expect(s.remove).toHaveBeenCalledTimes(2))
    s.document.hidden = true; s.document.dispatchEvent(new Event('visibilitychange'))
    s.listeners.get('pause')!()
    expect(s.stop).not.toHaveBeenCalled(); expect(s.setHidden).toHaveBeenLastCalledWith(false)
  })
})
