import type { PluginListenerHandle } from '@capacitor/core'

type NativeLifecycle = { addListener(event: 'pause' | 'resume', callback: () => void): Promise<PluginListenerHandle> }

// Native pause can precede WebKit's visibility event. Keep one background state
// and never restart a capture/model request when the app becomes visible again.
export function bindLifecycle(
  stop: () => void,
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  setHidden: (hidden: boolean) => void,
  native?: NativeLifecycle,
) {
  let paused = false, hidden = false, disposed = false
  const handles: PluginListenerHandle[] = []
  const update = () => {
    if (disposed) return
    const next = paused || document.hidden
    setHidden(next)
    if (next && !hidden) stop()
    hidden = next
  }
  const pause = () => { paused = true; update() }
  const resume = () => { paused = false; update() }
  document.addEventListener('visibilitychange', update)
  window.addEventListener('pagehide', pause)
  window.addEventListener('pageshow', resume)
  update()
  if (native) for (const [event, listener] of [['pause', pause], ['resume', resume]] as const) {
    void native.addListener(event, listener).then(async handle => {
      if (disposed) await handle.remove()
      else handles.push(handle)
    }).catch(error => console.error('Native lifecycle listener unavailable', error))
  }
  return () => {
    disposed = true
    document.removeEventListener('visibilitychange', update)
    window.removeEventListener('pagehide', pause)
    window.removeEventListener('pageshow', resume)
    for (const handle of handles) void handle.remove().catch(error => console.error('Native lifecycle cleanup failed', error))
    setHidden(false)
  }
}
