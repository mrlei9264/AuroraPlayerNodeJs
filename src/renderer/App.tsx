import React, { useEffect, useRef, lazy, Suspense } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { RuntimeProvider, useRuntime } from './core/runtime'
import { WindowChrome, Sidebar, ToastHost, DialogHost, CtxMenuHost, HudHost, MiniPlayer, GlobalShortcuts, DragDropImporter } from './shell/shell'
const HomePage = lazy(() => import('./pages/home').then((module) => ({ default: module.HomePage })))
const BrowsePage = lazy(() => import('./pages/browse').then((module) => ({ default: module.BrowsePage })))
const LibraryPage = lazy(() => import('./pages/library').then((module) => ({ default: module.LibraryPage })))
const PlaylistsPage = lazy(() => import('./pages/playlists').then((module) => ({ default: module.PlaylistsPage })))
const RemotePage = lazy(() => import('./pages/remote').then((module) => ({ default: module.RemotePage })))
const DownloadsPage = lazy(() => import('./pages/downloads').then((module) => ({ default: module.DownloadsPage })))
const SettingsPage = lazy(() => import('./pages/settings').then((module) => ({ default: module.SettingsPage })))
const VideoPlayerPage = lazy(() => import('./pages/playerVideo').then((module) => ({ default: module.VideoPlayerPage })))
const MusicPlayerPage = lazy(() => import('./pages/playerMusic').then((module) => ({ default: module.MusicPlayerPage })))
const MediaDetailsPage = lazy(() => import('./pages/mediaDetails').then((module) => ({ default: module.MediaDetailsPage })))
import { applyTypographySettings } from './core/appearance'
import { StartupAnimation } from './shell/startupAnimation'
const MotionLabPage = lazy(() => import('./pages/motionLab').then((module) => ({ default: module.MotionLabPage })))
import { TahoeLighting } from './shared/tahoeLighting'
import { CinematicBackground } from './shared/cinematicBackground'

function MainView() {
  const { nav, session } = useRuntime()
  switch (nav.section) {
    case 'home':
      return <HomePage />
    case 'videos':
      return <BrowsePage kind="video" />
    case 'music':
      return <BrowsePage kind="audio" />
    case 'playlists':
      return <PlaylistsPage />
    case 'remote':
      return <RemotePage />
    case 'downloads':
      return <DownloadsPage />
    case 'settings':
      return <SettingsPage />
    case 'library':
      if (nav.mediaId != null) return <MediaDetailsPage mediaId={nav.mediaId} />
      return <LibraryPage />
    case 'player':
      if (session.kind === 'audio' && !session.idle) return <MusicPlayerPage />
      return <VideoPlayerPage />
    default:
      return <HomePage />
  }
}

function ShellInner() {
  const { nav, settings, booted, session } = useRuntime()
  const hiddenHostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!settings) return
    applyTypographySettings(settings)
  }, [settings?.fontFamily, settings?.fontSize])

  useEffect(() => {
    if (!settings) return
    document.documentElement.lang = settings.language === 'zh' ? 'zh-CN' : 'en'
  }, [settings?.language])

  useEffect(() => {
    const manageGlobalKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        if (event.target instanceof HTMLElement && event.target.closest('.theme-choices, .theme-settings-popover, .theme-settings-button')) return
        event.preventDefault()
        return
      }
      if (event.key !== 'Escape') return
      window.requestAnimationFrame(() => {
        const focused = document.activeElement
        if (focused instanceof HTMLElement && focused.matches('button, a[href], [role="button"], [role="tab"], [role="option"]')) focused.blur()
      })
    }
    document.addEventListener('keydown', manageGlobalKeyboardFocus, true)
    return () => document.removeEventListener('keydown', manageGlobalKeyboardFocus, true)
  }, [])

  useEffect(() => {
    if (!settings) return
    document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion)
    document.documentElement.classList.toggle('reduce-transparency', settings.reduceTransparency)
    return () => {
      document.documentElement.classList.remove('reduce-motion', 'reduce-transparency')
    }
  }, [settings?.reducedMotion, settings?.reduceTransparency])

  const isPlayer = nav.section === 'player'
  const isHome = nav.section === 'home'
  const isLibrary = nav.section === 'library'
  const isNetwork = nav.section === 'remote'
  const isSettings = nav.section === 'settings'
  const isCinema = !isPlayer
  const reducedMotion = settings?.reducedMotion ?? true
  const routeKey = nav.section === 'library' && nav.mediaId != null
    ? `library:${nav.mediaId}`
    : nav.section === 'playlists' && nav.playlistId != null
      ? `playlists:${nav.playlistId}`
      : nav.section === 'remote'
        ? `remote:${nav.remoteTab ?? 'sources'}:${nav.sourceId ?? ''}`
        : nav.section === 'player'
          ? `player:${session.kind}`
          : nav.section
  const routeTransition = reducedMotion
    ? { duration: 0.1, ease: 'linear' as const }
    : { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const }

  useEffect(() => {
    document.body.classList.toggle('home-mode', isCinema)
    document.body.classList.toggle('library-mode', isLibrary)
    document.body.classList.toggle('network-mode', isNetwork)
    document.body.classList.toggle('settings-mode', isSettings)
    return () => {
      document.body.classList.remove('home-mode')
      document.body.classList.remove('library-mode')
      document.body.classList.remove('network-mode')
      document.body.classList.remove('settings-mode')
    }
  }, [isCinema, isLibrary, isNetwork, isSettings])

  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      {(isHome || isLibrary) && <CinematicBackground />}
      <TahoeLighting enabled={true} reducedMotion={reducedMotion} reduceTransparency={settings?.reduceTransparency ?? false} routeKey={routeKey} />
      {settings == null
        ? <div className="startup-animation" aria-hidden="true" />
        : settings.startupAnimationEnabled
          ? <StartupAnimation ready={booted} reducedMotion={settings.reducedMotion} />
          : null}
      <AnimatePresence initial={false}>
        {!isPlayer && <WindowChrome key="window-chrome" />}
      </AnimatePresence>
      <motion.div
        layout={reducedMotion ? false : 'position'}
        className={`shell ${isCinema ? 'home-shell' : ''} ${isHome ? 'cinema-home-shell' : ''} ${isLibrary ? 'library-shell cinema-library-shell' : ''} ${isNetwork ? 'network-shell' : ''} ${isSettings ? 'settings-shell' : ''}`}
        transition={routeTransition}
      >
        <AnimatePresence initial={false}>
          {!isPlayer && <Sidebar key="sidebar" />}
        </AnimatePresence>
        <motion.div className="main" layout={reducedMotion ? false : 'position'} transition={routeTransition}>
          {!isPlayer && !booted ? (
            <div className="center" style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: 420, height: 120, borderRadius: 20 }} />
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={routeKey}
                className="route-stage"
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={routeTransition}
              >
                <Suspense fallback={<div className="center" role="status">{settings?.language === 'zh' ? '正在加载…' : 'Loading…'}</div>}><MainView /></Suspense>
              </motion.div>
            </AnimatePresence>
          )}
          <AnimatePresence initial={false}>
            {!isPlayer && !session.idle && !isHome && !isLibrary && !isNetwork && !isSettings && <MiniPlayer key="mini-player" />}
          </AnimatePresence>
        </motion.div>
        <div ref={hiddenHostRef} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }} />
      </motion.div>
      <ToastHost showNotificationCenter={!isPlayer} />
      <DialogHost />
      <CtxMenuHost />
      <HudHost />
      <GlobalShortcuts />
      <DragDropImporter />
    </MotionConfig>
  )
}

export default function App() {
  if (new URLSearchParams(window.location.search).get('page') === 'motion-lab') {
    return <MotionLabPage />
  }

  return (
    <RuntimeProvider>
      <ShellInner />
    </RuntimeProvider>
  )
}
