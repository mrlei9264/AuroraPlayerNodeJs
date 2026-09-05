import React, { useCallback, useEffect, useState } from 'react'
import startupAnimationIconUrl from '../assets/icon/app_icon.png'

const INTRO_MS = 2200
const EXIT_MS = 260
const REDUCED_EXIT_MS = 100
const MAX_WAIT_MS = 4000

export function StartupAnimation({ ready, reducedMotion }: { ready: boolean; reducedMotion: boolean }) {
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const reduceMotion = reducedMotion || systemReducedMotion
  const [minimumElapsed, setMinimumElapsed] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [visible, setVisible] = useState(true)
  const finish = useCallback(() => setLeaving(true), [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumElapsed(true), reduceMotion ? 0 : INTRO_MS)
    return () => window.clearTimeout(timer)
  }, [reduceMotion])

  useEffect(() => {
    // Hand slow initialization back to the shell's loading state.
    const timer = window.setTimeout(finish, MAX_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [finish])

  useEffect(() => {
    if (ready && minimumElapsed) finish()
  }, [finish, minimumElapsed, ready])

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setVisible(false), reduceMotion ? REDUCED_EXIT_MS : EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, reduceMotion])

  useEffect(() => {
    if (!visible || leaving) return
    const skip = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finish()
    }
    window.addEventListener('keydown', skip, true)
    return () => window.removeEventListener('keydown', skip, true)
  }, [finish, leaving, visible])

  if (!visible) return null

  return (
    <div
      className={`startup-animation ${leaving ? 'is-leaving' : ''} ${reduceMotion ? 'is-reduced' : ''}`}
      style={{
        '--startup-duration': `${INTRO_MS}ms`,
        '--startup-exit-duration': `${reduceMotion ? REDUCED_EXIT_MS : EXIT_MS}ms`,
        '--startup-icon': `url("${startupAnimationIconUrl}")`
      } as React.CSSProperties}
      role="status"
      aria-label="Aurora Player"
      onClick={finish}
    >
      <div className="startup-atmosphere" aria-hidden="true" />
      <div className="startup-title" aria-hidden="true">
        {'AURORA'.split('').map((letter, index) => (
          <span key={index} style={{ '--letter-index': index } as React.CSSProperties}>{letter}</span>
        ))}
      </div>
      <div className="startup-brand" aria-hidden="true">
        <div className="startup-emblem">
          <img className="startup-logo" src={startupAnimationIconUrl} width="200" height="200" alt="" draggable={false} />
          <div className="startup-sheen" />
        </div>
        <div className="startup-wordmark"><strong>AURORA</strong><span>PLAYER</span></div>
      </div>
    </div>
  )
}
