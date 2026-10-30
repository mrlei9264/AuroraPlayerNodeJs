import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsPresent } from 'motion/react'
import { useRuntime } from '../core/runtime'
import { Icon, type IconName } from '../core/icons'
import { displayMediaTitle, formatTime, type TrackInfo } from '../../shared/types'
import { I } from '../../shared/channels'
import { NetworkMediaLoader, formatNetworkSpeed } from './networkMediaLoader'
import { playbackErrorKey } from '../core/i18n'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
type PlayerHint = { icon: IconName; value?: string }
type PlayerMenu = 'tracks' | 'speed' | null

export function VideoPlayerPage() {
  const isPresent = useIsPresent()
  const {
    t,
    appIconUrl,
    session,
    engine,
    library,
    tracks,
    togglePlayPause,
    seek,
    beginSeek,
    commitSeek,
    setVolume,
    toggleMute,
    setSpeed,
    selectVideoTrack,
    selectAudioTrack,
    selectSubtitleTrack,
    retryPlayback,
    stopPlayback,
    leavePlayer,
    setFullscreen,
    win,
    windowMinimize,
    windowMaximizeToggle,
    windowClose
  } = useRuntime()

  const stageRef = useRef<HTMLDivElement>(null)
  const consoleRef = useRef<HTMLDivElement>(null)
  const trackDrawerRef = useRef<HTMLElement>(null)
  const speedMenuRef = useRef<HTMLDivElement>(null)
  const hintTimerRef = useRef<number | null>(null)
  const [hint, setHint] = useState<PlayerHint | null>(null)
  const [controlsHover, setControlsHover] = useState(false)
  const [topHover, setTopHover] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [openMenu, setOpenMenu] = useState<PlayerMenu>(null)
  const [selectedVideo, setSelectedVideo] = useState(0)
  const [selectedAudio, setSelectedAudio] = useState(0)
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1)
  const [hoveredChapterIndex, setHoveredChapterIndex] = useState<number | null>(null)
  const [focusedChapterIndex, setFocusedChapterIndex] = useState<number | null>(null)
  const tracksOpen = openMenu === 'tracks'
  const speedOpen = openMenu === 'speed'
  const keyboardStateRef = useRef({ volume: 80, muted: false, fullscreen: false, phase: session.phase, tracksOpen: false, speedOpen: false })
  const keyboardActionsRef = useRef<{
    togglePlayback: () => void
    jump: (seconds: number) => void
    setVolume: (volume: number) => void
    setFullscreen: (fullscreen: boolean) => Promise<void>
    toggleMute: () => void
    stopPlayback: () => void
    showHint: (icon: IconName, value?: string) => void
  }>({
    togglePlayback: () => void 0,
    jump: (_seconds: number) => void 0,
    setVolume: (_volume: number) => void 0,
    setFullscreen: (_fullscreen: boolean) => Promise.resolve(),
    toggleMute: () => void 0,
    stopPlayback: () => void 0,
    showHint: (_icon: IconName, _value?: string) => void 0
  })

  const item = library.find((candidate) => candidate.id === session.mediaId)
  const title = item ? displayMediaTitle(item.title, item.fileName) : t('unknown')
  const networkMedia = Boolean(item && ((item.sourceId !== null) || item.protocol !== 'local'))
  const duration = session.duration || item?.duration || 0
  const isVideo = session.kind === 'video'
  const chapters = tracks.chapters
  const activeChapterIndex = chapters.reduce(
    (current, chapter, index) => chapter.time <= session.position ? index : current,
    -1
  )
  const activeChapter = activeChapterIndex >= 0 ? chapters[activeChapterIndex] : null
  const previewChapterIndex = hoveredChapterIndex ?? focusedChapterIndex
  const chapterFocusIndex = previewChapterIndex ?? Math.max(0, activeChapterIndex)
  const progress = duration > 0 ? Math.min(100, Math.max(0, (session.position / duration) * 100)) : 0
  const qualityFeatures = useMemo(
    () => buildQualityFeatures(tracks, selectedVideo, selectedAudio),
    [tracks, selectedVideo, selectedAudio]
  )
  const activateQualityFeature = useCallback((feature: QualityFeature) => {
    if (!feature.target) return
    if (feature.target.kind === 'video') {
      setSelectedVideo(feature.target.index)
      selectVideoTrack(feature.target.index)
    } else {
      setSelectedAudio(feature.target.index)
      selectAudioTrack(feature.target.index)
    }
  }, [selectAudioTrack, selectVideoTrack])
  const uiLocked = openMenu !== null || focusWithin || dragging
  const showChrome = controlsHover || uiLocked
  // Keep the entry point visible for every video. Some Chromium builds do not
  // expose native track lists until the media is inspected, so hiding the
  // button based on the current list would make the feature unreachable.
  const hasTrackChoices = isVideo

  useEffect(() => {
    setHoveredChapterIndex(null)
    setFocusedChapterIndex(null)
  }, [session.mediaId])

  useEffect(() => {
    const defaultVideo = tracks.video.findIndex((track) => track.default)
    const defaultAudio = tracks.audio.findIndex((track) => track.default)
    setSelectedVideo(defaultVideo >= 0 ? defaultVideo : 0)
    setSelectedAudio(defaultAudio >= 0 ? defaultAudio : 0)
    setSelectedSubtitle(-1)
  }, [session.mediaId, tracks.video, tracks.audio, tracks.subtitles])

  useEffect(() => {
    let current = true
    if (session.mediaId == null) return () => { current = false }
    void window.aurora.invoke(I.mediaPlaybackDuration, session.mediaId)
      .then((value) => {
        const duration = Number(value)
        if (current && Number.isFinite(duration) && duration > 0) engine.setKnownDuration(duration)
      })
      .catch(() => void 0)
    return () => { current = false }
  }, [engine, session.mediaId])

  const showHint = useCallback((icon: IconName, value?: string) => {
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    setHint({ icon, value })
    hintTimerRef.current = window.setTimeout(() => {
      setHint(null)
      hintTimerRef.current = null
    }, 760)
  }, [])

  useEffect(() => () => {
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
  }, [])

  const togglePlayback = useCallback(() => {
    togglePlayPause()
    showHint(session.paused ? 'play' : 'pause')
  }, [togglePlayPause, session.paused, showHint])

  const jump = useCallback((seconds: number) => {
    // Read from the engine so rapid key repeats build on the latest seek target,
    // even before React has rendered the updated session position.
    seek(engine.position() + seconds)
    showHint(seconds > 0 ? 'forward10' : 'rewind10')
  }, [engine, seek, showHint])

  const toggleMutedWithHint = useCallback(() => {
    const nextMuted = !session.muted
    toggleMute()
    showHint(nextMuted ? 'volumeMute' : 'volume', `${Math.round(nextMuted ? 0 : session.volume)}%`)
  }, [session.muted, session.volume, showHint, toggleMute])

  keyboardStateRef.current = {
    volume: session.volume,
    muted: session.muted,
    fullscreen: win.fullscreen,
    phase: session.phase,
    tracksOpen,
    speedOpen
  }
  keyboardActionsRef.current = {
    togglePlayback,
    jump,
    setVolume,
    setFullscreen,
    toggleMute: toggleMutedWithHint,
    stopPlayback,
    showHint
  }

  // Keep the stage bound without tearing it down on volume/mute/speed changes:
  // detach() nulls container and can drop an in-flight mpv open.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (isPresent && isVideo && !session.idle) engine.attach(stage, session.muted, session.volume, session.speed)
    else engine.detach(stage)
  }, [engine, isPresent, isVideo, session.idle, session.mediaId, session.muted, session.volume, session.speed])

  useEffect(() => {
    const stage = stageRef.current
    return () => { if (stage) engine.detach(stage) }
  }, [engine])

  useEffect(() => {
    if (openMenu === null) return
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (trackDrawerRef.current?.contains(target) || speedMenuRef.current?.contains(target) || target.closest('[data-player-menu-trigger]')) return
      setOpenMenu(null)
    }
    window.addEventListener('pointerdown', closeFromOutside, true)
    return () => window.removeEventListener('pointerdown', closeFromOutside, true)
  }, [openMenu])

  useEffect(() => {
    if (!win.fullscreen) setTopHover(false)
  }, [win.fullscreen])

  useEffect(() => {
    const textEntryTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null
      const input = element?.closest('input') as HTMLInputElement | null
      if (input && input.type !== 'range') return true
      return Boolean(element?.closest('textarea, select, [contenteditable="true"]'))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (textEntryTarget(event.target)) return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const state = keyboardStateRef.current
      const actions = keyboardActionsRef.current
      const key = event.key
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault()
        actions.jump(key === 'ArrowRight' ? 10 : -10)
        return
      }
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === '+' || key === '-' || key === '=') {
        event.preventDefault()
        const increase = key === 'ArrowUp' || key === '+' || key === '='
        const nextVolume = Math.max(0, Math.min(100, state.volume + (increase ? 5 : -5)))
        actions.setVolume(nextVolume)
        state.volume = nextVolume
        state.muted = false
        actions.showHint(nextVolume > 0 ? 'volume' : 'volumeMute', `${nextVolume}%`)
        return
      }
      const focusedButton = Boolean((event.target as HTMLElement | null)?.closest('button'))
      if (focusedButton && key === ' ') return
      if ((key === ' ' || key.toLowerCase() === 'k') && !event.repeat) {
        event.preventDefault()
        actions.togglePlayback()
      } else if ((key === 'Enter' || key.toLowerCase() === 'f') && !event.repeat) {
        event.preventDefault()
        void (async () => {
          await actions.setFullscreen(!state.fullscreen)
          state.fullscreen = !state.fullscreen
        })()
      } else if (key.toLowerCase() === 'm' && !event.repeat) {
        event.preventDefault()
        actions.toggleMute()
      } else if (key === 'Escape') {
        event.preventDefault()
        if (state.tracksOpen || state.speedOpen) setOpenMenu(null)
        else if (state.fullscreen) void actions.setFullscreen(false)
        else if (state.phase === 'error') actions.stopPlayback()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const buffering = session.phase !== 'error' && (session.buffering || session.phase === 'loading' || session.phase === 'buffering')
  const meta = useMemo(() => {
    const parts = [formatMetaDuration(duration), item?.protocol || 'Local']
    return parts.filter(Boolean).join('  ·  ')
  }, [duration, item?.protocol])

  return (
    <div
      className={`player-root cinematic-player ${showChrome ? 'show-chrome' : 'hide-chrome'} ${win.fullscreen ? 'is-fullscreen' : ''} ${topHover ? 'show-top-chrome' : 'hide-top-chrome'}`}
      onTouchStart={() => setControlsHover(true)}
      onMouseMove={(event) => {
        if (win.fullscreen) {
          const topRevealBoundary = Math.min(190, window.innerHeight * 0.25)
          const overTop = event.clientY <= topRevealBoundary
          setTopHover((current) => current === overTop ? current : overTop)
        }
        if (uiLocked) return
        const target = event.target instanceof Element ? event.target : null
        const overControls = Boolean(target?.closest('.cinematic-console, .cinematic-console-hover-zone'))
        setControlsHover((current) => current === overControls ? current : overControls)
      }}
      onMouseLeave={() => {
        setTopHover(false)
        if (!uiLocked) setControlsHover(false)
      }}
    >
      <div
        ref={stageRef}
        className="video-stage cinematic-stage"
        onClick={(event) => {
          if (event.target === event.currentTarget || ['VIDEO', 'CANVAS'].includes((event.target as HTMLElement).tagName)) togglePlayback()
        }}
        onDoubleClick={() => void setFullscreen(!win.fullscreen)}
      />
      <div className="cinematic-vignette" aria-hidden="true" />
      <div className="cinematic-bottom-shade" aria-hidden="true" />
      <div className="cinematic-window-drag" aria-hidden="true" />

      <div className="cinematic-window-controls" aria-label={t('windowControls')}>
        <button type="button" className="cinematic-window-control minimize window-control-button" data-tooltip={t('minimize')} aria-label={t('minimize')} onClick={windowMinimize}>
          <Icon name="minimize" size={15} />
        </button>
        <button type="button" className="cinematic-window-control maximize window-control-button" data-tooltip={win.maximized ? t('restore') : t('maximize')} aria-label={win.maximized ? t('restore') : t('maximize')} onClick={() => void windowMaximizeToggle()}>
          <Icon name={win.maximized ? 'restore' : 'maximize'} size={14} />
        </button>
        <button type="button" className="cinematic-window-control close window-control-button" data-tooltip={t('close')} aria-label={t('close')} onClick={windowClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <header className="cinematic-identity">
        <div className="cinematic-title-row">
          <button className="page-back-button cinematic-back" type="button" aria-label={t('back')} data-tooltip={t('back')} onClick={leavePlayer}>
            <Icon name="chevronLeft" size={19} />
          </button>
          <h1>{title}</h1>
        </div>
        <div className="cinematic-meta">
          <span>{meta}</span>
          {networkMedia && (
            <span className="cinematic-network-status">
              <span className="cinematic-network-speed" data-tooltip={t('networkSpeed')}>{formatNetworkSpeed(session.networkSpeed ?? 0)}</span>
              <span className="cinematic-buffered" data-tooltip={t('buffered')}>{t('buffered')} {formatBufferedSeconds(session.bufferedSeconds ?? 0)}</span>
            </span>
          )}
          {activeChapter && (
            <span className="cinematic-current-chapter-name" data-tooltip={activeChapter.title}>{activeChapter.title}</span>
          )}
        </div>
        {qualityFeatures.length > 0 && (
          <div className="cinematic-quality-row" aria-label={t('videoQuality')}>
            {qualityFeatures.map((feature) => {
              const content = <>{feature.icon && <Icon name={feature.icon} size={15} strokeWidth={1.7} />}<span>{feature.label}</span></>
              const label = `${feature.label}: ${feature.active ? t('active') : t('inactive')}`
              return feature.target ? (
                <button
                  className={`cinematic-quality-badge ${feature.active ? 'active' : 'inactive'} switchable`}
                  key={feature.id}
                  type="button"
                  aria-label={label}
                  data-tooltip={feature.label}
                  onClick={() => activateQualityFeature(feature)}
                >
                  {content}
                </button>
              ) : (
                <span
                  className={`cinematic-quality-badge ${feature.active ? 'active' : 'inactive'}`}
                  key={feature.id}
                  aria-label={label}
                >
                  {content}
                </span>
              )
            })}
          </div>
        )}
      </header>

      {buffering && (
        <NetworkMediaLoader
          label={networkMedia ? t('loadingNetworkMedia') : t('buffering')}
          bytesPerSecond={session.networkSpeed ?? 0}
          showSpeed={networkMedia}
          iconUrl={appIconUrl}
        />
      )}

      {hint && (
        <div className={`vp-center-hint ${hint.value ? 'has-value' : ''}`}>
          <Icon name={hint.icon} size={hint.icon === 'forward10' || hint.icon === 'rewind10' ? 50 : 34} />
          {hint.value && <span className="vp-center-hint-value">{hint.value}</span>}
        </div>
      )}

      {chapters.length > 0 && (
        <nav
          className="cinematic-chapter-rail"
          aria-label={t('chapters')}
          onMouseLeave={() => setHoveredChapterIndex(null)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedChapterIndex(null)
          }}
        >
          {chapters.map((chapter, index) => {
            const active = index === activeChapterIndex
            const preview = index === previewChapterIndex
            const distance = Math.abs(index - chapterFocusIndex)
            // Only the hovered/focused chapter gets the surrounding taper while browsing.
            // The playback chapter remains a separate, long accent marker.
            const tickWidth = active || distance === 0 ? 36 : distance === 1 ? 27 : distance === 2 ? 20 : distance === 3 ? 14 : 6
            return (
              <button
                key={`${chapter.time}-${index}`}
                type="button"
                className={`cinematic-chapter-item ${active ? 'active' : ''} ${preview ? 'preview' : ''}`}
                style={{ '--chapter-tick-width': `${tickWidth}px` } as React.CSSProperties}
                aria-current={active ? 'step' : undefined}
                aria-label={`${t('chapter')} ${index + 1}: ${chapter.title}`}
                data-tooltip={`${chapter.title} · ${formatTime(chapter.time)}`}
                onMouseEnter={() => setHoveredChapterIndex(index)}
                onFocus={(event) => setFocusedChapterIndex(event.currentTarget.matches(':focus-visible') ? index : null)}
                onClick={() => seek(chapter.time)}
              >
                <span className="cinematic-chapter-tick" aria-hidden="true" />
              </button>
            )
          })}
        </nav>
      )}

      {session.phase === 'error' && (
        <div className="vp-error">
          <Icon name="alert" size={42} />
          <div className="vp-error-title">{t('playbackError')}</div>
          <div className="vp-error-message">{t(playbackErrorKey(session.error))}</div>
          {session.error && session.error !== 'Playback error' && (
            <div className="vp-error-detail">{session.error}</div>
          )}
          <button type="button" onClick={() => void retryPlayback()}>{t('retry')}</button>
        </div>
      )}

      <div
        className="cinematic-console-hover-zone"
        aria-hidden="true"
        onMouseEnter={() => setControlsHover(true)}
        onMouseMove={() => setControlsHover(true)}
        onMouseLeave={() => { if (!uiLocked) setControlsHover(false) }}
      />

      <div
        ref={consoleRef}
        className="cinematic-console"
        onMouseEnter={() => setControlsHover(true)}
        onMouseLeave={() => { if (!uiLocked) setControlsHover(false) }}
        onFocusCapture={(event) => {
          const target = event.target instanceof HTMLElement ? event.target : null
          // Mouse clicks focus buttons too, but should not pin the chrome open.
          // Keep it locked only for keyboard-visible focus so tab navigation remains usable.
          setFocusWithin(Boolean(target?.matches(':focus-visible')))
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false)
        }}
      >
        <div className="cinematic-timeline">
          <span className="cinematic-time current">{formatTime(session.position)}</span>
          <input
            className="cinematic-seek"
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={0.1}
            value={Math.min(session.position, Math.max(duration, 1))}
            aria-label={t('seek')}
            data-tooltip={t('seek')}
            style={{ '--vp-progress': `${progress}%` } as React.CSSProperties}
            onPointerDown={() => { beginSeek(); setDragging(true) }}
            onPointerUp={() => { commitSeek(); setDragging(false) }}
            onPointerCancel={() => { commitSeek(); setDragging(false) }}
            onBlur={() => { commitSeek(); setDragging(false) }}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <span className="cinematic-time total">{formatTime(duration)}</span>
        </div>

        <div className="cinematic-lower-row">
          <div className="cinematic-left-cluster">
            <div className="cinematic-volume-group">
              <ControlButton icon={session.muted || session.volume === 0 ? 'volumeMute' : 'volume'} label={session.muted ? t('unmute') : t('mute')} onClick={toggleMutedWithHint} />
              <input
                className="cinematic-volume"
                type="range"
                min={0}
                max={100}
                value={session.muted ? 0 : session.volume}
                aria-label={t('volume')}
                data-tooltip={t('volume')}
                style={{ '--vp-volume': `${session.muted ? 0 : session.volume}%` } as React.CSSProperties}
                onPointerDown={() => setDragging(true)}
                onPointerUp={() => setDragging(false)}
                onChange={(event) => {
                  const nextVolume = Number(event.currentTarget.value)
                  setVolume(nextVolume)
                  showHint(nextVolume > 0 ? 'volume' : 'volumeMute', `${Math.round(nextVolume)}%`)
                }}
              />
            </div>
          </div>

          <div className="cinematic-transport">
            <button className="seek-ten" type="button" aria-label={t('rewind10')} data-tooltip={t('rewind10')} onClick={() => jump(-10)}>
              <Icon name="rewind10" size={39} strokeWidth={1.45} />
            </button>
            <button className="cinematic-play" type="button" aria-label={session.paused ? t('play') : t('pause')} data-tooltip={session.paused ? t('play') : t('pause')} onClick={togglePlayback}>
              <Icon name={session.paused ? 'play' : 'pause'} size={29} strokeWidth={1.4} />
            </button>
            <button className="seek-ten" type="button" aria-label={t('forward10')} data-tooltip={t('forward10')} onClick={() => jump(10)}>
              <Icon name="forward10" size={39} strokeWidth={1.45} />
            </button>
          </div>

          <div className="cinematic-right-cluster">
            <div className="cinematic-utility-group">
              {hasTrackChoices && <ControlButton icon="track" label={t('tracks')} active={tracksOpen} menu="tracks" onClick={() => setOpenMenu((current) => current === 'tracks' ? null : 'tracks')} />}
              <SpeedControl speed={session.speed} label={t('speed')} open={speedOpen} onClick={() => setOpenMenu((current) => current === 'speed' ? null : 'speed')} />
              <ControlButton icon={win.fullscreen ? 'fullscreenExit' : 'fullscreen'} label={win.fullscreen ? t('exitFullscreen') : t('fullscreen')} onClick={() => void setFullscreen(!win.fullscreen)} />
            </div>
          </div>
        </div>
      </div>

      {tracksOpen && hasTrackChoices && (
        <TrackDrawer
          drawerRef={trackDrawerRef}
          tracks={tracks}
          selectedVideo={selectedVideo}
          selectedAudio={selectedAudio}
          selectedSubtitle={selectedSubtitle}
          onVideo={(index) => { setSelectedVideo(index); selectVideoTrack(index) }}
          onAudio={(index) => { setSelectedAudio(index); selectAudioTrack(index) }}
          onSubtitle={(index) => { setSelectedSubtitle(index); selectSubtitleTrack(index) }}
          t={t}
        />
      )}

      {speedOpen && (
        <SpeedMenu
          menuRef={speedMenuRef}
          speed={session.speed}
          label={t('speed')}
          onSelect={(nextSpeed) => {
            setSpeed(nextSpeed)
            setOpenMenu(null)
          }}
        />
      )}
    </div>
  )
}

function ControlButton({ icon, label, active = false, menu, onClick }: { icon: IconName; label: string; active?: boolean; menu?: Exclude<PlayerMenu, null>; onClick?: () => void }) {
  return (
    <button
      className={`cinematic-control-btn ${active ? 'active' : ''}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      aria-expanded={menu ? active : undefined}
      aria-controls={menu === 'tracks' ? 'video-track-menu' : undefined}
      data-player-menu-trigger={menu ? menu : undefined}
      data-tooltip={label}
      onClick={onClick}
    >
      <Icon name={icon} size={23} strokeWidth={1.7} />
    </button>
  )
}

function SpeedControl({ speed, label, open, onClick }: { speed: number; label: string; open: boolean; onClick: () => void }) {
  return (
    <button
      className={`cinematic-speed-control ${open ? 'active' : ''}`}
      type="button"
      onClick={onClick}
      aria-label={`${label} ${speed}x`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls="video-speed-menu"
      data-player-menu-trigger="speed"
      data-tooltip={label}
    >
      <Icon name="speed" size={19} strokeWidth={1.7} />
      <span>{speed}×</span>
    </button>
  )
}

function SpeedMenu({ menuRef, speed, label, onSelect }: { menuRef: React.RefObject<HTMLDivElement | null>; speed: number; label: string; onSelect: (speed: number) => void }) {
  return (
    <div ref={menuRef} id="video-speed-menu" className="cinematic-speed-menu" role="menu" aria-label={label}>
      {SPEEDS.map((option) => {
        const selected = option === speed
        return (
          <button key={option} type="button" role="menuitemradio" aria-checked={selected} className={selected ? 'active' : ''} onClick={() => onSelect(option)}>
            <span>{option}×</span>
            {selected && <Icon name="check" size={17} />}
          </button>
        )
      })}
    </div>
  )
}

function TrackDrawer({
  drawerRef,
  tracks,
  selectedVideo,
  selectedAudio,
  selectedSubtitle,
  onVideo,
  onAudio,
  onSubtitle,
  t
}: {
  drawerRef: React.RefObject<HTMLElement | null>
  tracks: { video: TrackInfo[]; audio: TrackInfo[]; subtitles: TrackInfo[] }
  selectedVideo: number
  selectedAudio: number
  selectedSubtitle: number
  onVideo: (index: number) => void
  onAudio: (index: number) => void
  onSubtitle: (index: number) => void
  t: (key: string) => string
}) {
  return (
    <aside ref={drawerRef} id="video-track-menu" className="vp-drawer cinematic-track-drawer" aria-label={t('tracks')}>
      <div className="vd-body">
        <TrackSection icon="video" kind="video" title={t('videoTracks')} tracks={tracks.video} selected={selectedVideo} emptyLabel={t('noTracks')} onSelect={onVideo} />
        <TrackSection icon="music" kind="audio" title={t('audioTracks')} tracks={tracks.audio} selected={selectedAudio} emptyLabel={t('noTracks')} onSelect={onAudio} />
        <section className="vd-track-section">
          <div className="vd-section-title"><span className="vd-section-icon"><Icon name="subtitle" size={17} /></span><span>{t('subtitleTracks')}</span><span className="vd-section-count">{tracks.subtitles.length}</span></div>
          <div className="vd-options">
            <TrackOption active={selectedSubtitle < 0} label={t('off')} onClick={() => onSubtitle(-1)} />
            {tracks.subtitles.map((track, index) => <TrackOption key={`subtitle-${track.id}`} active={selectedSubtitle === index} label={track.title || `${t('subtitleTracks')} ${index + 1}`} detail={formatTrackDetail(track, 'subtitle')} onClick={() => onSubtitle(index)} />)}
          </div>
        </section>
      </div>
    </aside>
  )
}

function TrackSection({ icon, kind, title, tracks, selected, emptyLabel, onSelect }: { icon: IconName; kind: 'video' | 'audio'; title: string; tracks: TrackInfo[]; selected: number; emptyLabel: string; onSelect: (index: number) => void }) {
  return (
    <section className="vd-track-section">
      <div className="vd-section-title"><span className="vd-section-icon"><Icon name={icon} size={17} /></span><span>{title}</span><span className="vd-section-count">{tracks.length}</span></div>
      <div className="vd-options">
        {tracks.length > 0
          ? tracks.map((track, index) => <TrackOption key={`${title}-${track.id}`} active={selected === index} label={track.title || `${title} ${index + 1}`} detail={formatTrackDetail(track, kind)} onClick={() => onSelect(index)} />)
          : <TrackEmpty label={emptyLabel} />}
      </div>
    </section>
  )
}

function TrackOption({ active, label, detail, onClick }: { active: boolean; label: string; detail?: string; onClick: () => void }) {
  return <button className={`vd-item ${active ? 'active' : ''}`} type="button" aria-pressed={active} onClick={onClick}><span className="vd-copy"><span className="vd-main">{label}</span>{detail && <span className="vd-sub">{detail}</span>}</span><span className="vd-selection-indicator" aria-hidden="true">{active && <Icon name="check" size={17} />}</span></button>
}

function TrackEmpty({ label }: { label: string }) {
  return <div className="vd-empty">{label}</div>
}

function formatTrackDetail(track: TrackInfo, kind: 'video' | 'audio' | 'subtitle'): string {
  const parts: string[] = []
  if (track.language) parts.push(track.language.toUpperCase())
  if (track.codec) parts.push(track.codec.toUpperCase())
  if (kind === 'video' && track.width && track.height) parts.push(`${track.width}×${track.height}`)
  if (kind === 'video' && track.fps) parts.push(formatFrameRate(track.fps))
  if (kind === 'audio' && track.channels) parts.push(`${track.channels}ch`)
  return parts.join(' · ')
}

function formatMetaDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

type QualityFeatureTarget = { kind: 'video' | 'audio'; index: number }
type QualityFeature = { id: string; label: string; active: boolean; icon?: IconName; target?: QualityFeatureTarget }

function buildQualityFeatures(
  tracks: ReturnType<typeof useRuntime>['tracks'],
  selectedVideo: number,
  selectedAudio: number
): QualityFeature[] {
  const features: QualityFeature[] = []
  const currentVideo = tracks.video[selectedVideo]
  const currentAudio = tracks.audio[selectedAudio]
  const addVideo = (id: string, label: string, matches: (track: TrackInfo) => boolean, icon?: IconName) => {
    const matchingIndex = tracks.video.findIndex(matches)
    if (matchingIndex < 0) return
    const active = Boolean(currentVideo && matches(currentVideo))
    features.push({
      id,
      label,
      icon,
      active,
      target: active || matchingIndex === selectedVideo ? undefined : { kind: 'video', index: matchingIndex }
    })
  }
  const addAudio = (id: string, label: string, matches: (track: TrackInfo) => boolean, icon?: IconName) => {
    const matchingIndex = tracks.audio.findIndex(matches)
    if (matchingIndex < 0) return
    const active = Boolean(currentAudio && matches(currentAudio))
    features.push({
      id,
      label,
      icon,
      active,
      target: active || matchingIndex === selectedAudio ? undefined : { kind: 'audio', index: matchingIndex }
    })
  }

  for (const hdrType of ['Dolby Vision', 'HDR10+', 'HDR10', 'HLG']) {
    addVideo(`hdr-${hdrType}`, hdrType, (track) => track.hdrType === hdrType, 'sun')
  }
  for (const resolution of ['8K', '4K', 'QHD', 'Full HD']) {
    addVideo(`resolution-${resolution}`, resolution, (track) => videoResolutionLabel(track) === resolution)
  }
  const highFrameRateIndex = tracks.video.findIndex((track) => (track.fps ?? 0) >= 59.5)
  if (highFrameRateIndex >= 0) {
    const active = Boolean(currentVideo && (currentVideo.fps ?? 0) >= 59.5)
    const displayTrack = active ? currentVideo : tracks.video[highFrameRateIndex]
    features.push({
      id: 'high-frame-rate',
      label: formatFrameRate(displayTrack.fps ?? 0),
      icon: 'speed',
      active,
      target: active || highFrameRateIndex === selectedVideo ? undefined : { kind: 'video', index: highFrameRateIndex }
    })
  }

  const bitDepths = [...new Set(tracks.video.map((track) => track.bitDepth ?? 0).filter((depth) => depth >= 10))].sort((a, b) => b - a)
  for (const depth of bitDepths) addVideo(`bit-depth-${depth}`, `${depth}-bit`, (track) => track.bitDepth === depth)

  addVideo('codec-av1', 'AV1', (track) => /^av1$/i.test(track.codec ?? ''))
  addVideo('codec-hevc', 'HEVC', (track) => /hevc|h265|h\.265/i.test(`${track.codec ?? ''} ${track.profile ?? ''}`))

  addAudio('dolby-atmos', 'Dolby Atmos', (track) => track.atmos === true, 'disc')
  addAudio('dolby-truehd', 'Dolby TrueHD', (track) => /truehd/i.test(audioTrackEvidence(track)), 'disc')
  addAudio('dolby-digital-plus', 'Dolby Digital Plus', (track) => /eac3|e-ac-3/i.test(audioTrackEvidence(track)), 'disc')
  addAudio('dolby-digital', 'Dolby Digital', (track) => /(?:^|\s)(?:ac3|ac-3)(?:\s|$)/i.test(audioTrackEvidence(track)), 'disc')
  addAudio('dts-hd-ma', 'DTS-HD MA', (track) => /dts.?hd|dts.?ma/i.test(audioTrackEvidence(track)), 'disc')
  addAudio('dts', 'DTS', (track) => /(?:^|\s)dts(?:\s|$)/i.test(audioTrackEvidence(track)) && !/dts.?hd|dts.?ma/i.test(audioTrackEvidence(track)), 'disc')
  addAudio('flac', 'FLAC', (track) => /flac/i.test(audioTrackEvidence(track)), 'disc')
  return features
}

function videoResolutionLabel(track: TrackInfo): string {
  const width = track.width ?? 0
  const height = track.height ?? 0
  if (width >= 7000 || height >= 4000) return '8K'
  if (width >= 3800 || height >= 2100) return '4K'
  if (height >= 1400) return 'QHD'
  if (height >= 1000) return 'Full HD'
  return ''
}

function formatFrameRate(fps: number): string {
  const normalized = Math.round(fps * 100) / 100
  return `${Number.isInteger(normalized) ? normalized.toFixed(0) : normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}fps`
}

function audioTrackEvidence(track: TrackInfo): string {
  return `${track.codec ?? ''} ${track.profile ?? ''}`.toLowerCase()
}

function formatBufferedSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  return `${Math.floor(seconds)}s`
}
