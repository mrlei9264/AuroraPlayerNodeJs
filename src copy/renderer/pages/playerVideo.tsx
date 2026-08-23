import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { Icon, type IconName } from '../core/icons'
import { formatTime, type TrackInfo } from '../../shared/types'
import { I } from '../../shared/channels'
import { NetworkMediaLoader, formatNetworkSpeed } from './networkMediaLoader'
import { playbackErrorKey } from '../core/i18n'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const CHAPTER_RAIL_SIZE = 9

export function VideoPlayerPage() {
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
  const [hint, setHint] = useState<IconName | null>(null)
  const [controlsHover, setControlsHover] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [tracksOpen, setTracksOpen] = useState(false)
  const [selectedVideo, setSelectedVideo] = useState(0)
  const [selectedAudio, setSelectedAudio] = useState(0)
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1)
  const [chapterRailExpanded, setChapterRailExpanded] = useState(false)
  const keyboardStateRef = useRef({ position: 0, speed: 1, volume: 80, muted: false, fullscreen: false, phase: session.phase, tracksOpen: false })
  const keyboardActionsRef = useRef<{
    togglePlayback: () => void
    jump: (seconds: number) => void
    setVolume: (volume: number) => void
    setSpeed: (speed: number) => void
    setFullscreen: (fullscreen: boolean) => Promise<void>
    toggleMute: () => void
    stopPlayback: () => void
    showHint: (icon: IconName) => void
  }>({
    togglePlayback: () => void 0,
    jump: (_seconds: number) => void 0,
    setVolume: (_volume: number) => void 0,
    setSpeed: (_speed: number) => void 0,
    setFullscreen: (_fullscreen: boolean) => Promise.resolve(),
    toggleMute: () => void 0,
    stopPlayback: () => void 0,
    showHint: (_icon: IconName) => void 0
  })

  const item = library.find((candidate) => candidate.id === session.mediaId)
  const title = item?.title || item?.fileName || t('unknown')
  const networkMedia = Boolean(item && ((item.sourceId !== null) || item.protocol !== 'local'))
  const duration = session.duration || item?.duration || 0
  const isVideo = session.kind === 'video'
  const chapters = tracks.chapters
  const activeChapterIndex = chapters.reduce(
    (current, chapter, index) => chapter.time <= session.position ? index : current,
    -1
  )
  const activeChapter = activeChapterIndex >= 0 ? chapters[activeChapterIndex] : null
  const chapterFocusIndex = Math.max(0, activeChapterIndex)
  const chapterRailStart = Math.min(
    Math.max(0, chapterFocusIndex - Math.floor(CHAPTER_RAIL_SIZE / 2)),
    Math.max(0, chapters.length - CHAPTER_RAIL_SIZE)
  )
  const visibleChapters = chapterRailExpanded
    ? chapters
    : chapters.slice(chapterRailStart, chapterRailStart + CHAPTER_RAIL_SIZE)
  const progress = duration > 0 ? Math.min(100, Math.max(0, (session.position / duration) * 100)) : 0
  const qualityFeatures = useMemo(
    () => buildQualityFeatures(tracks, selectedVideo, selectedAudio, t),
    [tracks, selectedVideo, selectedAudio, t]
  )
  const uiLocked = tracksOpen || focusWithin || dragging
  const showChrome = controlsHover || uiLocked
  // Keep the entry point visible for every video. Some Chromium builds do not
  // expose native track lists until the media is inspected, so hiding the
  // button based on the current list would make the feature unreachable.
  const hasTrackChoices = isVideo

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

  const showHint = useCallback((icon: IconName) => {
    setHint(icon)
    window.setTimeout(() => setHint(null), 700)
  }, [])

  const togglePlayback = useCallback(() => {
    togglePlayPause()
    showHint(session.paused ? 'play' : 'pause')
  }, [togglePlayPause, session.paused, showHint])

  const jump = useCallback((seconds: number) => {
    seek(session.position + seconds)
    showHint(seconds > 0 ? 'forward10' : 'rewind10')
  }, [seek, session.position, showHint])

  keyboardStateRef.current = {
    position: session.position,
    speed: session.speed,
    volume: session.volume,
    muted: session.muted,
    fullscreen: win.fullscreen,
    phase: session.phase,
    tracksOpen
  }
  keyboardActionsRef.current = {
    togglePlayback,
    jump,
    setVolume,
    setSpeed,
    setFullscreen,
    toggleMute,
    stopPlayback,
    showHint
  }

  useEffect(() => {
    const stage = stageRef.current
    if (stage && isVideo) engine.attach(stage, session.muted, session.volume, session.speed)
    return () => engine.detach()
  }, [engine, isVideo]) // the engine preserves the active video element across attaches

  useEffect(() => {
    type DirectionHold = { key: 'ArrowLeft' | 'ArrowRight'; timer: number; long: boolean; originalSpeed: number }
    let directionHold: DirectionHold | null = null
    const textEntryTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'))
    }
    const activateDirectionHold = (hold: DirectionHold) => {
      if (hold.long || directionHold !== hold) return
      hold.long = true
      const temporarySpeed = hold.key === 'ArrowRight'
        ? Math.max(2, Math.min(4, hold.originalSpeed * 2))
        : Math.min(.5, Math.max(.25, hold.originalSpeed / 2))
      const actions = keyboardActionsRef.current
      actions.setSpeed(temporarySpeed)
      actions.showHint('speed')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (textEntryTarget(event.target)) return
      const state = keyboardStateRef.current
      const actions = keyboardActionsRef.current
      const key = event.key
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault()
        if (directionHold) {
          if (event.repeat && directionHold.key === key) activateDirectionHold(directionHold)
          return
        }
        const hold: DirectionHold = { key, timer: 0, long: false, originalSpeed: state.speed }
        hold.timer = window.setTimeout(() => activateDirectionHold(hold), 420)
        directionHold = hold
        return
      }
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === '+' || key === '-' || key === '=') {
        event.preventDefault()
        const increase = key === 'ArrowUp' || key === '+' || key === '='
        actions.setVolume(Math.max(0, Math.min(100, state.volume + (increase ? 5 : -5))))
        actions.showHint(increase || state.volume > 5 ? 'volume' : 'volumeMute')
        return
      }
      const focusedButton = Boolean((event.target as HTMLElement | null)?.closest('button'))
      if (focusedButton && (key === ' ' || key === 'Enter')) return
      if ((key === ' ' || key.toLowerCase() === 'k') && !event.repeat) {
        event.preventDefault()
        actions.togglePlayback()
      } else if (key.toLowerCase() === 'f' && !event.repeat) {
        event.preventDefault()
        void actions.setFullscreen(!state.fullscreen)
      } else if (key.toLowerCase() === 'm' && !event.repeat) {
        event.preventDefault()
        actions.toggleMute()
      } else if (key === 'Escape') {
        if (state.tracksOpen) setTracksOpen(false)
        else if (state.fullscreen) void actions.setFullscreen(false)
        else if (state.phase === 'error') actions.stopPlayback()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!directionHold || event.key !== directionHold.key) return
      event.preventDefault()
      window.clearTimeout(directionHold.timer)
      const actions = keyboardActionsRef.current
      if (directionHold.long) actions.setSpeed(directionHold.originalSpeed)
      else actions.jump(directionHold.key === 'ArrowRight' ? 10 : -10)
      directionHold = null
    }
    const onWindowBlur = () => {
      if (!directionHold) return
      window.clearTimeout(directionHold.timer)
      if (directionHold.long) keyboardActionsRef.current.setSpeed(directionHold.originalSpeed)
      directionHold = null
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      if (directionHold) {
        window.clearTimeout(directionHold.timer)
        if (directionHold.long) keyboardActionsRef.current.setSpeed(directionHold.originalSpeed)
      }
    }
  }, [])

  const buffering = session.phase !== 'error' && (session.buffering || session.phase === 'loading' || session.phase === 'buffering')
  const meta = useMemo(() => {
    const scraped = item?.scrapedMetadata
    const genres = scraped?.genres?.slice(0, 2).join(' / ')
    const parts = [formatMetaDuration(duration), scraped?.year, genres, item?.protocol || 'Local']
    return parts.filter(Boolean).join('  ·  ')
  }, [duration, item?.protocol, item?.scrapedMetadata])

  const cycleSpeed = useCallback(() => {
    const currentIndex = SPEEDS.indexOf(session.speed)
    setSpeed(SPEEDS[(currentIndex + 1) % SPEEDS.length])
  }, [session.speed, setSpeed])

  return (
    <div
      className={`player-root cinematic-player ${showChrome ? 'show-chrome' : 'hide-chrome'}`}
      onTouchStart={() => setControlsHover(true)}
      onMouseMove={(event) => {
        if (uiLocked) return
        const target = event.target instanceof Element ? event.target : null
        const overControls = Boolean(target?.closest('.cinematic-console, .cinematic-console-hover-zone'))
        setControlsHover((current) => current === overControls ? current : overControls)
      }}
      onMouseLeave={() => { if (!uiLocked) setControlsHover(false) }}
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
        <button type="button" className="cinematic-window-control" title={t('minimize')} aria-label={t('minimize')} onClick={windowMinimize}>
          <Icon name="minimize" size={15} />
        </button>
        <button type="button" className="cinematic-window-control" title={win.maximized ? t('restore') : t('maximize')} aria-label={win.maximized ? t('restore') : t('maximize')} onClick={() => void windowMaximizeToggle()}>
          <Icon name={win.maximized ? 'restore' : 'maximize'} size={14} />
        </button>
        <button type="button" className="cinematic-window-control close" title={t('close')} aria-label={t('close')} onClick={windowClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <header className="cinematic-identity">
        <div className="cinematic-title-row">
          <button className="cinematic-back" type="button" aria-label={t('back')} title={t('back')} onClick={leavePlayer}>
            <Icon name="chevronLeft" size={30} strokeWidth={1.55} />
          </button>
          <h1>{title}</h1>
        </div>
        <div className="cinematic-meta">
          <span>{meta}</span>
          {networkMedia && (
            <span className="cinematic-network-status">
              <span className="cinematic-network-speed" title={t('networkSpeed')}>{formatNetworkSpeed(session.networkSpeed ?? 0)}</span>
              <span className="cinematic-buffered" title={t('buffered')}>{t('buffered')} {formatBufferedSeconds(session.bufferedSeconds ?? 0)}</span>
            </span>
          )}
          {activeChapter && (
            <span className="cinematic-current-chapter-name" title={activeChapter.title}>{activeChapter.title}</span>
          )}
        </div>
        {qualityFeatures.length > 0 && (
          <div className="cinematic-quality-row" aria-label={t('videoQuality')}>
            {qualityFeatures.map((feature) => (
              <span
                className={`cinematic-quality-badge ${feature.active ? 'active' : 'inactive'}`}
                key={feature.id}
                aria-label={`${feature.label}: ${feature.active ? t('active') : t('inactive')}`}
              >
                {feature.icon && <Icon name={feature.icon} size={12} strokeWidth={1.7} />}
                <span>{feature.label}</span>
              </span>
            ))}
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

      {hint && <div className="vp-center-hint"><Icon name={hint} size={30} /></div>}

      {visibleChapters.length > 0 && (
        <nav
          className={`cinematic-chapter-rail ${chapterRailExpanded ? 'expanded' : ''}`}
          aria-label={t('chapters')}
          onMouseEnter={() => setChapterRailExpanded(true)}
          onMouseLeave={() => setChapterRailExpanded(false)}
          onFocusCapture={() => setChapterRailExpanded(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setChapterRailExpanded(false)
          }}
        >
          {visibleChapters.map((chapter, visibleIndex) => {
            const index = chapterRailExpanded ? visibleIndex : chapterRailStart + visibleIndex
            const active = index === activeChapterIndex
            const distance = Math.abs(index - chapterFocusIndex)
            const tickWidth = active ? 36 : distance === 1 ? 27 : distance === 2 ? 20 : distance === 3 ? 14 : 10
            return (
              <button
                key={`${chapter.time}-${index}`}
                type="button"
                className={`cinematic-chapter-item ${active ? 'active' : ''}`}
                style={{ '--chapter-tick-width': `${tickWidth}px` } as React.CSSProperties}
                aria-current={active ? 'step' : undefined}
                aria-label={`${t('chapter')} ${index + 1}: ${chapter.title}`}
                title={`${chapter.title} · ${formatTime(chapter.time)}`}
                onClick={() => seek(chapter.time)}
              >
                <span className="cinematic-chapter-tick" aria-hidden="true" />
                <span className="cinematic-chapter-label">{chapter.title}</span>
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
            title={t('seek')}
            style={{ '--vp-progress': `${progress}%` } as React.CSSProperties}
            onPointerDown={() => { beginSeek(); setDragging(true) }}
            onPointerUp={() => { commitSeek(); setDragging(false) }}
            onPointerCancel={() => { commitSeek(); setDragging(false) }}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <span className="cinematic-time total">{formatTime(duration)}</span>
        </div>

        <div className="cinematic-lower-row">
          <div className="cinematic-left-cluster">
            <div className="cinematic-volume-group">
              <ControlButton icon={session.muted || session.volume === 0 ? 'volumeMute' : 'volume'} label={session.muted ? t('unmute') : t('mute')} onClick={toggleMute} />
              <input
                className="cinematic-volume"
                type="range"
                min={0}
                max={100}
                value={session.muted ? 0 : session.volume}
                aria-label={t('volume')}
                title={t('volume')}
                style={{ '--vp-volume': `${session.muted ? 0 : session.volume}%` } as React.CSSProperties}
                onPointerDown={() => setDragging(true)}
                onPointerUp={() => setDragging(false)}
                onChange={(event) => setVolume(Number(event.currentTarget.value))}
              />
            </div>
          </div>

          <div className="cinematic-transport">
            <button className="seek-ten" type="button" aria-label={t('rewind10')} title={t('rewind10')} onClick={() => jump(-10)}>
              <Icon name="rewind10" size={39} strokeWidth={1.45} />
            </button>
            <button className="cinematic-play" type="button" aria-label={session.paused ? t('play') : t('pause')} title={session.paused ? t('play') : t('pause')} onClick={togglePlayback}>
              <Icon name={session.paused ? 'play' : 'pause'} size={29} strokeWidth={1.4} />
            </button>
            <button className="seek-ten" type="button" aria-label={t('forward10')} title={t('forward10')} onClick={() => jump(10)}>
              <Icon name="forward10" size={39} strokeWidth={1.45} />
            </button>
          </div>

          <div className="cinematic-right-cluster">
            <div className="cinematic-utility-group">
              {hasTrackChoices && <ControlButton icon="track" label={t('tracks')} active={tracksOpen} onClick={() => setTracksOpen((open) => !open)} />}
              <SpeedControl speed={session.speed} label={t('speed')} onClick={cycleSpeed} />
              <ControlButton icon={win.fullscreen ? 'fullscreenExit' : 'fullscreen'} label={win.fullscreen ? t('exitFullscreen') : t('fullscreen')} onClick={() => void setFullscreen(!win.fullscreen)} />
            </div>
          </div>
        </div>
      </div>

      {tracksOpen && hasTrackChoices && (
        <TrackDrawer
          tracks={tracks}
          selectedVideo={selectedVideo}
          selectedAudio={selectedAudio}
          selectedSubtitle={selectedSubtitle}
          onClose={() => setTracksOpen(false)}
          onVideo={(index) => { setSelectedVideo(index); selectVideoTrack(index) }}
          onAudio={(index) => { setSelectedAudio(index); selectAudioTrack(index) }}
          onSubtitle={(index) => { setSelectedSubtitle(index); selectSubtitleTrack(index) }}
          t={t}
        />
      )}
    </div>
  )
}

function ControlButton({ icon, label, active = false, onClick }: { icon: IconName; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button className={`cinematic-control-btn ${active ? 'active' : ''}`} type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick}>
      <Icon name={icon} size={23} strokeWidth={1.7} />
    </button>
  )
}

function SpeedControl({ speed, label, onClick }: { speed: number; label: string; onClick: () => void }) {
  return (
    <button className={`cinematic-speed-control ${speed !== 1 ? 'active' : ''}`} type="button" onClick={onClick} aria-label={`${label} ${speed}x`} title={label}>
      <Icon name="speed" size={19} strokeWidth={1.7} />
      <span>{speed}×</span>
    </button>
  )
}

function TrackDrawer({
  tracks,
  selectedVideo,
  selectedAudio,
  selectedSubtitle,
  onClose,
  onVideo,
  onAudio,
  onSubtitle,
  t
}: {
  tracks: { video: TrackInfo[]; audio: TrackInfo[]; subtitles: TrackInfo[] }
  selectedVideo: number
  selectedAudio: number
  selectedSubtitle: number
  onClose: () => void
  onVideo: (index: number) => void
  onAudio: (index: number) => void
  onSubtitle: (index: number) => void
  t: (key: string) => string
}) {
  return (
    <aside className="vp-drawer cinematic-track-drawer" aria-label={t('tracks')} onMouseEnter={(event) => event.stopPropagation()}>
      <div className="vd-head"><Icon name="track" size={18} /><span>{t('tracks')}</span><span className="spacer" /><button className="drawer-icon-btn" type="button" aria-label={t('close')} title={t('close')} onClick={onClose}><Icon name="close" size={18} /></button></div>
      <div className="vd-body">
        {tracks.video.length > 0 ? <TrackSection title={t('videoTracks')} tracks={tracks.video} selected={selectedVideo} onSelect={onVideo} /> : <TrackEmpty label={t('videoTracks')} />}
        {tracks.audio.length > 0 ? <TrackSection title={t('audioTracks')} tracks={tracks.audio} selected={selectedAudio} onSelect={onAudio} /> : <TrackEmpty label={t('audioTracks')} />}
        <div className="vd-section-title">{t('subtitleTracks')}</div>
        <TrackOption active={selectedSubtitle < 0} label={t('off')} onClick={() => onSubtitle(-1)} />
        {tracks.subtitles.map((track, index) => <TrackOption key={`subtitle-${track.id}`} active={selectedSubtitle === index} label={track.title || `${t('subtitleTracks')} ${index + 1}`} detail={track.language} onClick={() => onSubtitle(index)} />)}
        {tracks.subtitles.length === 0 && <TrackEmpty label={t('subtitleTracks')} />}
      </div>
    </aside>
  )
}

function TrackSection({ title, tracks, selected, onSelect }: { title: string; tracks: TrackInfo[]; selected: number; onSelect: (index: number) => void }) {
  return <><div className="vd-section-title">{title}</div>{tracks.map((track, index) => <TrackOption key={`${title}-${track.id}`} active={selected === index} label={track.title || `${title} ${index + 1}`} detail={track.language} onClick={() => onSelect(index)} />)}</>
}

function TrackOption({ active, label, detail, onClick }: { active: boolean; label: string; detail?: string; onClick: () => void }) {
  return <button className={`vd-item ${active ? 'active' : ''}`} type="button" aria-pressed={active} onClick={onClick}><span className="vd-main">{label}</span>{detail && <span className="vd-sub">{detail}</span>}{active && <Icon name="check" size={15} />}</button>
}

function TrackEmpty({ label }: { label: string }) {
  return <div className="vd-empty">{label}</div>
}

function formatMetaDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

type QualityFeature = { id: string; label: string; active: boolean; icon?: IconName }

function buildQualityFeatures(
  tracks: ReturnType<typeof useRuntime>['tracks'],
  selectedVideo: number,
  selectedAudio: number,
  t: (key: string) => string
): QualityFeature[] {
  const features: QualityFeature[] = []
  const currentVideo = tracks.video[selectedVideo]
  const currentAudio = tracks.audio[selectedAudio]
  const addVideo = (id: string, label: string, matches: (track: TrackInfo) => boolean, icon?: IconName) => {
    if (tracks.video.some(matches)) features.push({ id, label, icon, active: Boolean(currentVideo && matches(currentVideo)) })
  }
  const addAudio = (id: string, label: string, matches: (track: TrackInfo) => boolean, icon?: IconName) => {
    if (tracks.audio.some(matches)) features.push({ id, label, icon, active: Boolean(currentAudio && matches(currentAudio)) })
  }

  for (const hdrType of ['Dolby Vision', 'HDR10+', 'HDR10', 'HLG']) {
    addVideo(`hdr-${hdrType}`, hdrType, (track) => track.hdrType === hdrType, 'sun')
  }
  for (const resolution of ['8K', '4K', 'QHD', 'Full HD']) {
    addVideo(`resolution-${resolution}`, resolution, (track) => videoResolutionLabel(track) === resolution)
  }
  addVideo('high-frame-rate', t('highFrameRate'), (track) => (track.fps ?? 0) >= 59.5, 'speed')

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

function audioTrackEvidence(track: TrackInfo): string {
  return `${track.codec ?? ''} ${track.profile ?? ''}`.toLowerCase()
}

function formatBufferedSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  return `${Math.floor(seconds)}s`
}
