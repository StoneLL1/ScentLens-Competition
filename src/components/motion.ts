import { useSyncExternalStore } from 'react'

// Quiet, critically damped motion; shared by navigation and touch surfaces.
export const settleSpring = { type: 'spring', stiffness: 420, damping: 42, mass: 1 } as const
export const surfaceEase = [0.22, 1, 0.36, 1] as const

// Motion 14's hook snapshots the preference at mount. Keep live OS changes reactive.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const subscribe = (notify: () => void) => {
  reducedMotion.addEventListener('change', notify)
  return () => reducedMotion.removeEventListener('change', notify)
}
export function useReducedMotionPreference() {
  return useSyncExternalStore(subscribe, () => reducedMotion.matches)
}
