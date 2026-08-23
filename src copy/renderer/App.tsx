import React, { useEffect, useRef, useState } from 'react'
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
import { ImageViewerPage } from './pages/imageViewer'
import { MediaDetailsPage } from './pages/mediaDetails'
import { applyTypographySettings } from './core/appearance'

function MainView() {
  const { nav, session, imageSession } = useRuntime()
  switch (nav.section) {
    case 'home':
      return <HomePage />
    case 'videos':
      return <BrowsePage kind="video" />
    case 'music':
      return <BrowsePage kind="audio" />
    case 'images':
      return <BrowsePage kind="image" />
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
      if (imageSession) return <ImageViewerPage />
      if (session.kind === 'audio' && !session.idle) return <MusicPlayerPage />
      return <VideoPlayerPage />
    default:
      return <HomePage />
  }
}

function ShellInner() {
  const { nav, settings, booted, session } = useRuntime()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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

  const isPlayer = nav.section === 'player' && !session.idle
  const isHome = nav.section === 'home'
  const isLibrary = nav.section === 'library'
  const isNetwork = nav.section === 'remote'
  const isSettings = nav.section === 'settings'
  const isCinema = isHome || isLibrary || isNetwork || isSettings

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
    <>
      {!isPlayer && <WindowChrome />}
      <div className={`shell ${isCinema ? 'home-shell' : ''} ${isLibrary ? 'library-shell' : ''} ${isNetwork ? 'network-shell' : ''} ${isSettings ? 'settings-shell' : ''}`}>
        {!isPlayer && <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)} />}
        <div className="main">
          {!isPlayer && !booted ? (
            <div className="center" style={{ flex: 1 }}>
              <div className="skeleton" style={{ width: 420, height: 120, borderRadius: 20 }} />
            </div>
          ) : (
            <MainView />
          )}
          {!isPlayer && !isHome && !isLibrary && !isNetwork && !isSettings && <MiniPlayer />}
        </div>
        <div ref={hiddenHostRef} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }} />
      </div>
      <ToastHost showNotificationCenter={!isPlayer} />
      <DialogHost />
      <CtxMenuHost />
      <HudHost />
      <GlobalShortcuts />
      <DragDropImporter />
    </>
  )
}

export default function App() {
  return (
    <RuntimeProvider>
      <ShellInner />
    </RuntimeProvider>
  )
}
