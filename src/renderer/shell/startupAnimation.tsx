import React, { useCallback, useEffect, useState } from 'react'
import startupAnimationIconUrl from '../assets/icon/app_icon_4096.png'

const FULL_SEQUENCE_MS = 6000
const REDUCED_SEQUENCE_MS = 520
const EXIT_MS = 480
const MAX_WAIT_MS = 9000

export function StartupAnimation({ ready, reducedMotion }: { ready: boolean; reducedMotion: boolean }) {
  const [minimumElapsed, setMinimumElapsed] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [visible, setVisible] = useState(true)
  const finish = useCallback(() => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(() => setVisible(false), reducedMotion ? 180 : EXIT_MS)
  }, [leaving, reducedMotion])

  useEffect(() => {
    const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reducedMotion || systemReducedMotion ? REDUCED_SEQUENCE_MS : FULL_SEQUENCE_MS
    const minimumTimer = window.setTimeout(() => setMinimumElapsed(true), duration)
    const maximumTimer = window.setTimeout(finish, MAX_WAIT_MS)
    return () => {
      window.clearTimeout(minimumTimer)
      window.clearTimeout(maximumTimer)
    }
  }, [finish, reducedMotion])

  useEffect(() => {
    if (ready && minimumElapsed) finish()
  }, [finish, minimumElapsed, ready])

  if (!visible) return null

  return (
    <div
      className={`startup-animation ${leaving ? 'is-leaving' : ''} ${reducedMotion ? 'is-reduced' : ''}`}
      aria-label="Aurora Player"
      onClick={finish}
    >
      <div className="startup-backdrop" aria-hidden="true" />

      <div className="startup-title-flash" aria-hidden="true">
        <span className="startup-title-word">
          <span className="startup-title-letter">A</span>
          <span className="startup-title-letter">U</span>
          <span className="startup-title-letter">R</span>
          <strong className="startup-title-letter startup-title-origin">O</strong>
          <span className="startup-title-letter">R</span>
          <span className="startup-title-letter">A</span>
          <i className="startup-title-gap" />
          <strong className="startup-title-letter">P</strong>
          <strong className="startup-title-letter">L</strong>
          <strong className="startup-title-letter">A</strong>
          <strong className="startup-title-letter">Y</strong>
          <strong className="startup-title-letter">E</strong>
          <strong className="startup-title-letter">R</strong>
        </span>
      </div>

      <div className="startup-core" aria-hidden="true" />

      <div className="startup-logo-continuum" aria-hidden="true">
        <img className="startup-continuum-depth startup-continuum-depth-far" src={startupAnimationIconUrl} alt="" />
        <img className="startup-continuum-depth startup-continuum-depth-near" src={startupAnimationIconUrl} alt="" />
        <img className="startup-continuum-outline" src={startupAnimationIconUrl} alt="" />
        <img className="startup-continuum-color" src={startupAnimationIconUrl} alt="" />
        <div className="startup-continuum-edge-glint" />
        <div className="startup-continuum-scan" />
      </div>

      <div className="startup-energy-ring" aria-hidden="true" />

      <div className="startup-wordmark" aria-hidden="true">
        <strong>AURORA</strong>
        <span>PLAYER</span>
      </div>

      <div className="startup-skip-hint" aria-hidden="true">点击鼠标跳过动画</div>
    </div>
  )
}
