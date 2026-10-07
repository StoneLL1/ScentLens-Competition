import { useEffect, useRef } from 'react'
import type { Scores100 } from '../domain/reading'
import { createScentProfile } from '../vendor/scent-profile'
import type { ProfileHandle } from '../vendor/scent-profile/types'
import { DISPLAY_ORDER } from '../domain/reading'
import '../vendor/scent-profile/styles.css'

export function ScentProfile({ scores }: { scores: Scores100 }) {
  const container = useRef<HTMLDivElement>(null)
  const handle = useRef<ProfileHandle | null>(null)
  const lastScores = useRef<string | null>(null)
  useEffect(() => {
    const isHidden = () => document.hidden || document.documentElement.hasAttribute('data-app-hidden')
    const profile = createScentProfile(container.current!, { motion: isHidden() ? 'off' : 'auto', quality: 'auto' })
    handle.current = profile
    // The App supplies its own heading, source and eight accessible score rows.
    container.current!.querySelector('.sp-header')?.remove()
    container.current!.querySelector('.sp-caption')?.remove()
    // Capacitor can pause before WebKit emits visibilitychange. Reuse the Shell's
    // combined state; stopping motion settles once and cancels the pending RAF.
    const visibility = () => profile.setMotion(isHidden() ? 'off' : 'auto')
    const observer = new MutationObserver(visibility)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-hidden'] })
    document.addEventListener('visibilitychange', visibility)
    return () => {
      observer.disconnect(); document.removeEventListener('visibilitychange', visibility)
      profile.destroy(); handle.current = null; lastScores.current = null
    }
  }, [])
  useEffect(() => {
    const key = DISPLAY_ORDER.map(dimension => scores[dimension]).join(',')
    // A live query returns new objects when text/artwork changes. Preserve the
    // settled cloud when the actual eight values have not changed.
    if (key !== lastScores.current) { handle.current?.setData(scores, { mode: 'discrete' }); lastScores.current = key }
  }, [scores])
  return <div className="profile-host" ref={container} aria-label="八维连续气味云图" />
}
