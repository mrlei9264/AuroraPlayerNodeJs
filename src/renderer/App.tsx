import React, { useEffect, useRef } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { RuntimeProvider, useRuntime } from './core/runtime'
import { WindowChrome, Sidebar, ToastHost, DialogHost, CtxMenuHost, HudHost, MiniPlayer, GlobalShortcuts, DragDropImporter } from './shell/shell'
import { HomePage } from './pages/home'
import { BrowsePage } from './pages/browse'
import { LibraryPage } from './pages/library'
import { PlaylistsPage } from './pages/playlists'
import { RemotePage } from './pages/remote'
import { DownloadsPage } from './pages/downloads'
import { SettingsPage } from './pages/settings'
import { VideoPlayerPage } from './pages/playerVideo'
import { MusicPlayerPage } from './pages/playerMusic'
import { MediaDetailsPage } from './pages/mediaDetails'
import { applyTypographySettings } from './core/appearance'
import { StartupAnimation } from './shell/startupAnimation'
import { MotionLabPage } from './pages/motionLab'

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
      {settings == null
        ? <div className="startup-animation" aria-hidden="true" />
        : settings.startupAnimationEnabled
          ? <StartupAnimation ready={booted} reducedMotion={settings.reducedMotion} />
          : null}
      <AnimatePresence initial={false}>
        {!isPlayer && <WindowChrome key="window-chrome" />}
      </AnimatePresence>
      <motion.div
        layout={!reducedMotion}
        className={`shell ${isCinema ? 'home-shell' : ''} ${isLibrary ? 'library-shell' : ''} ${isNetwork ? 'network-shell' : ''} ${isSettings ? 'settings-shell' : ''}`}
        transition={routeTransition}
      >
        <AnimatePresence initial={false}>
          {!isPlayer && <Sidebar key="sidebar" />}
        </AnimatePresence>
        <motion.div className="main" layout={!reducedMotion} transition={routeTransition}>
          {!isPlayer && !booted ? (
            <div className="center" style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: 420, height: 120, borderRadius: 20 }} />
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={routeKey}
                className="route-stage"
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.998 }}
                transition={routeTransition}
              >
                <MainView />
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
