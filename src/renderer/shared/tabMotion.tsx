import React, { useLayoutEffect, useRef } from 'react'
import { motion } from 'motion/react'

export const TAB_CONTENT_TRANSITION = { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const }
export const tabContentEnter = (direction: number) => ({ opacity: 0, x: direction * 14, scale: 0.994 })
export const tabContentExit = (direction: number) => ({ opacity: 0, x: direction * -8, scale: 0.997 })
export const TAB_CONTENT_VISIBLE = { opacity: 1, x: 0, scale: 1 }

export function TabHighlight({ reducedMotion }: { reducedMotion: boolean }) {
  return <motion.span className="tab-active-motion" layoutId="tab-active" aria-hidden="true"
    transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 390, damping: 34, mass: 0.74 }} />
}

// Match settings-depth-enter without remounting cards or animating measured rows.
export function useItemRevealAnimation(key: string, reducedMotion: boolean, ref: React.RefObject<HTMLElement | null>) {
  const phase = useRef<string | null>(null)
  const seen = useRef(new Set<string>())
  const running = useRef(new Map<HTMLElement, Animation>())
  useLayoutEffect(() => {
    const grid = ref.current
    if (phase.current !== key || reducedMotion) {
      for (const animation of running.current.values()) animation.cancel()
      running.current.clear()
      if (phase.current !== key) seen.current.clear()
      phase.current = key
    }
    if (!grid) return
    for (const [node, animation] of running.current) {
      if (!grid.contains(node)) { animation.cancel(); running.current.delete(node) }
    }
    let order = 0
    for (const node of grid.querySelectorAll<HTMLElement>('[data-item-reveal]')) {
      const entry = node.dataset.itemReveal
      if (!entry || seen.current.has(entry)) continue
      seen.current.add(entry)
      if (reducedMotion) continue
      const animation = node.animate([
        { opacity: 0, transform: 'translateY(9px) scale(.992)' },
        { opacity: 1, transform: 'none' }
      ], { duration: 420, delay: Math.min(order++, 6) * 34, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' })
      running.current.set(node, animation)
      animation.onfinish = () => {
        if (running.current.get(node) === animation) running.current.delete(node)
      }
    }
  })
  useLayoutEffect(() => () => {
    for (const animation of running.current.values()) animation.cancel()
    running.current.clear()
    seen.current.clear()
    phase.current = null
  }, [])
}
