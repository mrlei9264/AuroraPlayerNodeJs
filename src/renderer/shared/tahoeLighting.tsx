import React, { memo, useEffect, useRef } from 'react'

const PANELS = '.settings-category-panel, .settings-detail-panel, .network-source-section, .network-config-form-v2, .network-protocol-rail, .network-browser-shell, .media-details-panel, .theme-settings-popover, .dialog, .audio-transport-controls'
const CONTROLS = '.network-source-card, .audio-play-control'
const DEPTH_TARGETS = '.network-source-symbol, .home-playback-icon'
const PROPERTIES = ['--glass-x', '--glass-y', '--glass-energy', '--glass-angle', '--glass-axis-x', '--glass-axis-y', '--glass-lift', '--glass-shadow-x']

interface LitSurface {
  element: HTMLElement
  depth: HTMLElement | null
  rect: DOMRect
  x: number
  y: number
  energy: number
  targetEnergy: number
}

/** Pointer lighting is imperative and frame-bounded: it never puts coordinates
 * into React state, never transforms forms/sliders and never touches media pixels. */
export const TahoeLighting = memo(function TahoeLighting({ enabled, reducedMotion, reduceTransparency, routeKey }: {
  enabled: boolean
  reducedMotion: boolean
  reduceTransparency: boolean
  routeKey: string
}) {
  const sceneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return
    const scene = sceneRef.current
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const transparencyPreference = window.matchMedia('(prefers-reduced-transparency: reduce)')
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const surfaces = new Map<HTMLElement, LitSurface>()
    let frame = 0
    let disposed = false
    let lastTime = 0
    let pointerX = window.innerWidth / 2
    let pointerY = window.innerHeight / 2
    let sceneX = 0
    let sceneY = 0
    let targetSceneX = 0
    let targetSceneY = 0

    const canAnimate = () => !reducedMotion && !reduceTransparency && !motionPreference.matches && !transparencyPreference.matches && finePointer.matches && !document.hidden
    const clearSurface = (surface: LitSurface) => {
      surface.element.removeAttribute('data-glass-lit')
      surface.depth?.removeAttribute('data-glass-depth')
      for (const property of PROPERTIES) {
        surface.element.style.removeProperty(property)
        surface.depth?.style.removeProperty(property)
      }
    }
    const reset = () => {
      window.cancelAnimationFrame(frame)
      frame = 0
      lastTime = 0
      for (const surface of surfaces.values()) clearSurface(surface)
      surfaces.clear()
      sceneX = sceneY = targetSceneX = targetSceneY = 0
      scene?.style.removeProperty('transform')
    }

    const paint = (time: number) => {
      frame = 0
      if (disposed || !canAnimate()) { reset(); return }
      const dt = lastTime ? Math.min(time - lastTime, 48) : 16
      lastTime = time
      const ease = 1 - Math.exp(-dt / 70)
      let moving = false
      sceneX += (targetSceneX - sceneX) * ease
      sceneY += (targetSceneY - sceneY) * ease
      if (Math.abs(sceneX - targetSceneX) + Math.abs(sceneY - targetSceneY) > .03) moving = true
      scene?.style.setProperty('transform', `translate3d(${sceneX.toFixed(2)}px, ${sceneY.toFixed(2)}px, 0)`)

      for (const [element, surface] of surfaces) {
        if (!element.isConnected) { clearSurface(surface); surfaces.delete(element); continue }
        const targetX = surface.targetEnergy ? Math.max(0, Math.min(1, (pointerX - surface.rect.left) / Math.max(1, surface.rect.width))) : .5
        const targetY = surface.targetEnergy ? Math.max(0, Math.min(1, (pointerY - surface.rect.top) / Math.max(1, surface.rect.height))) : .15
        surface.x += (targetX - surface.x) * ease
        surface.y += (targetY - surface.y) * ease
        surface.energy += (surface.targetEnergy - surface.energy) * ease
        const remaining = Math.abs(surface.x - targetX) + Math.abs(surface.y - targetY) + Math.abs(surface.energy - surface.targetEnergy)
        if (remaining > .003) moving = true
        if (!surface.targetEnergy && surface.energy < .003) { clearSurface(surface); surfaces.delete(element); continue }
        element.style.setProperty('--glass-x', `${(surface.x * 100).toFixed(2)}%`)
        element.style.setProperty('--glass-y', `${(surface.y * 100).toFixed(2)}%`)
        element.style.setProperty('--glass-energy', surface.energy.toFixed(3))
        element.style.setProperty('--glass-shadow-x', `${((.5 - surface.x) * 5 * surface.energy).toFixed(2)}px`)
        if (surface.depth) {
          const nx = (surface.x - .5) * 2
          const ny = (surface.y - .5) * 2
          surface.depth.style.setProperty('--glass-axis-x', (-ny).toFixed(3))
          surface.depth.style.setProperty('--glass-axis-y', (nx || .001).toFixed(3))
          surface.depth.style.setProperty('--glass-angle', `${(Math.min(1, Math.hypot(nx, ny)) * 4 * surface.energy).toFixed(2)}deg`)
          surface.depth.style.setProperty('--glass-lift', `${(-1.5 * surface.energy).toFixed(2)}px`)
        }
      }
      // No ambient loop: the frame pump sleeps once lighting has settled.
      if (moving) frame = window.requestAnimationFrame(paint)
      else lastTime = 0
    }
    const schedule = () => { if (!frame && !disposed) frame = window.requestAnimationFrame(paint) }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons || !canAnimate()) return
      pointerX = event.clientX
      pointerY = event.clientY
      targetSceneX = (pointerX / window.innerWidth - .5) * -12
      targetSceneY = (pointerY / window.innerHeight - .5) * -8
      const target = event.target instanceof Element ? event.target : null
      const candidates = new Set<HTMLElement>()
      const panel = target?.closest<HTMLElement>(PANELS)
      const control = target?.closest<HTMLElement>(CONTROLS)
      const artwork = target?.closest('.library-file-card, .cinema-card')?.querySelector<HTMLElement>('.library-file-art, .cinema-card-image')
      if (panel) candidates.add(panel)
      if (control && !control.matches(':disabled, [aria-disabled="true"]')) candidates.add(control)
      if (artwork) candidates.add(artwork)
      // Geometry is read only when entering a surface, never in the frame loop.
      const newSurfaces = [...candidates].filter((element) => !surfaces.has(element)).map((element) => ({ element, rect: element.getBoundingClientRect() }))
      for (const surface of surfaces.values()) surface.targetEnergy = candidates.has(surface.element) ? 1 : 0
      for (const { element, rect } of newSurfaces) {
        const depth = element.matches('.library-file-art, .cinema-card-image, .cinematic-play, .audio-play-control')
          ? element : element.matches(CONTROLS) ? element.querySelector<HTMLElement>(DEPTH_TARGETS) : null
        element.dataset.glassLit = ''
        if (depth) depth.dataset.glassDepth = ''
        surfaces.set(element, { element, depth, rect, x: .5, y: .15, energy: 0, targetEnergy: 1 })
      }
      // Bound work even when quickly sweeping across a large media grid.
      for (const [element, surface] of surfaces) {
        if (surfaces.size <= 6) break
        if (!surface.targetEnergy) { clearSurface(surface); surfaces.delete(element) }
      }
      schedule()
    }
    const release = () => {
      for (const surface of surfaces.values()) surface.targetEnergy = 0
      targetSceneX = targetSceneY = 0
      schedule()
    }
    const onPointerOut = (event: PointerEvent) => { if (!event.relatedTarget) release() }

    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerout', onPointerOut, { passive: true })
    // Reset before dragging, scrolling or resizing so hit targets never drift.
    document.addEventListener('pointerdown', reset, { passive: true })
    document.addEventListener('pointercancel', reset, { passive: true })
    document.addEventListener('scroll', reset, true)
    document.addEventListener('visibilitychange', reset)
    window.addEventListener('resize', reset)
    window.addEventListener('blur', reset)
    motionPreference.addEventListener('change', reset)
    transparencyPreference.addEventListener('change', reset)
    finePointer.addEventListener('change', reset)
    return () => {
      disposed = true
      reset()
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('pointerdown', reset)
      document.removeEventListener('pointercancel', reset)
      document.removeEventListener('scroll', reset, true)
      document.removeEventListener('visibilitychange', reset)
      window.removeEventListener('resize', reset)
      window.removeEventListener('blur', reset)
      motionPreference.removeEventListener('change', reset)
      transparencyPreference.removeEventListener('change', reset)
      finePointer.removeEventListener('change', reset)
    }
  }, [enabled, reducedMotion, reduceTransparency, routeKey])

  if (!enabled) return null
  return <div ref={sceneRef} className="tahoe-light-scene" aria-hidden="true"><i /><i /><i /></div>
})
