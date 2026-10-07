const key = 'scentlens:has-entered'
let enteredThisSession = false

export function hasEntered(): boolean {
  try { return enteredThisSession || localStorage.getItem(key) === 'true' }
  catch { return enteredThisSession }
}

export function markEntered(): void {
  enteredThisSession = true
  try { localStorage.setItem(key, 'true') }
  catch { /* Browsing remains available when storage is unavailable. */ }
}
