import { flushSync } from 'react-dom'

interface ThemeViewTransition {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition: () => void
}

let activeTransition: ThemeViewTransition | null = null
let pendingUpdate = Promise.resolve()
let fallbackTimer: number | undefined

export function stopThemeTransition(): void {
  activeTransition?.skipTransition()
  activeTransition = null
  window.clearTimeout(fallbackTimer)
  document.documentElement.classList.remove('theme-transition', 'theme-transition-fallback')
}

/** One document snapshot includes the shell, current route and portaled overlays.
 * Only the DOM update is awaited: saving preferences never waits for animation.
 * https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition
 */
export function transitionTheme(update: () => void, reducedMotion: boolean): Promise<void> {
  // Record the source before awaiting anything; keyboard activation uses the
  // focused control's center, and programmatic changes use the window center.
  const source = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest('button, [role="option"]')?.getBoundingClientRect()
    : null
  const x = source ? source.left + source.width / 2 : window.innerWidth / 2
  const y = source ? source.top + source.height / 2 : window.innerHeight / 2

  const run = async () => {
    // Finish any pending DOM commit before starting the next snapshot. Rapid
    // selections interrupt the old animation without applying themes out of order.
    if (activeTransition) {
      activeTransition.skipTransition()
      await activeTransition.updateCallbackDone.catch(() => undefined)
    }
    stopThemeTransition()
    const root = document.documentElement
    const commit = () => flushSync(update)
    if (reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) {
      commit()
      return
    }

    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    root.style.setProperty('--theme-origin-x', `${x}px`)
    root.style.setProperty('--theme-origin-y', `${y}px`)
    root.style.setProperty('--theme-reveal-radius', `${Math.ceil(radius) + 2}px`)
    const transitionDocument = document as unknown as {
      startViewTransition?: (callback: () => void) => ThemeViewTransition
    }
    if (!transitionDocument.startViewTransition) {
      root.classList.add('theme-transition-fallback')
      // Commit the old computed colors before changing the shared palette.
      void root.offsetWidth
      commit()
      fallbackTimer = window.setTimeout(() => root.classList.remove('theme-transition-fallback'), 720)
      return
    }

    let committed = false
    const commitOnce = () => {
      if (committed) return
      committed = true
      commit()
    }
    root.classList.add('theme-transition')
    try {
      const transition = transitionDocument.startViewTransition(commitOnce)
      activeTransition = transition
      // Snapshot capture can be skipped (hidden windows, a newer transition).
      // The preference still applies and no rejected animation promise escapes.
      void transition.ready.catch(() => undefined)
      const cleanup = () => {
        if (activeTransition !== transition) return
        activeTransition = null
        root.classList.remove('theme-transition')
      }
      void transition.finished.then(cleanup, cleanup)
      await transition.updateCallbackDone
    } catch {
      stopThemeTransition()
      commitOnce()
    }
  }

  const applied = pendingUpdate.then(run, run)
  pendingUpdate = applied.catch(() => undefined)
  return applied
}
