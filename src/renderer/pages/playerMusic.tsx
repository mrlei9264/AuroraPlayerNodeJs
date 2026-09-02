import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { Icon } from '../core/icons'
import { I } from '../../shared/channels'
import { formatTime, isAudioExt, type MediaAudioFeatures } from '../../shared/types'
import { shapeAudioVisualizerSpectrum } from './audioVisualizerSpectrum'
import { audioVisualizerThemeForColorTheme } from './audioVisualizerThemes'
import { NetworkMediaLoader } from './networkMediaLoader'
import { fontFamilyStack } from '../core/appearance'
import {
  activeAudioTitleGlyphIndex,
  audioTitleScaleTargets,
  buildAudioTitleGlyphSpans,
  layoutAudioTitleGlyphs,
  type AudioTitleGlyphSpan
} from './audioTitleLayout'

const visualizerUrl = new URL('./sonic-topography/index.html', window.location.href).toString()

export function MusicPlayerPage() {
  const {
    t, session, library, lyrics, spectrum, theme, settings, engine, appIconUrl,
    togglePlayPause, playPrevious, playNext, setVolume, toggleMute,
    setRepeat, setShuffle, loadLyrics, leavePlayer, windowMinimize, windowMaximizeToggle, windowClose, win
  } = useRuntime()
  const visualizerRef = useRef<HTMLIFrameElement>(null)
  const previousVisualizerSpectrumRef = useRef<number[]>([])
  const [visualizerReady, setVisualizerReady] = useState(false)
  const [audioFeatures, setAudioFeatures] = useState<MediaAudioFeatures | null>(null)

  const item = library.find((candidate) => candidate.id === session.mediaId)
  const fallbackTitle = displayFileName(item?.fileName)
  const title = displayMediaText(item?.title) || fallbackTitle || t('unknown')
  const fileTitle = fallbackTitle || title
  const artist = item?.artist || t('unknown')
  const duration = session.duration || item?.duration || 0
  const progress = duration > 0 ? Math.min(100, Math.max(0, (session.position / duration) * 100)) : 0
  const volume = session.muted ? 0 : session.volume
  const playing = session.loaded && !session.paused
  const playbackMode = session.repeatMode === 'one' ? 'one' : session.shuffle ? 'shuffle' : 'sequential'
  const playbackModeLabel = t(playbackMode === 'one' ? 'singleRepeat' : playbackMode === 'shuffle' ? 'shufflePlayback' : 'sequentialPlayback')
  const networkMedia = Boolean(item && (item.sourceId !== null || item.protocol !== 'local'))
  const buffering = session.phase !== 'error' && (session.buffering || session.phase === 'loading' || session.phase === 'buffering')
  const blackGold = theme.isDark && theme.variant === 'classic' && settings.accentIndex % 6 === 2
  const titleFontFamily = useMemo(() => fontFamilyStack(settings.fontFamily), [settings.fontFamily])

  useEffect(() => {
    if (!item) return
    void loadLyrics(item.id, item.url, networkMedia, item.sourceId, item.remotePath)
  }, [item?.id, item?.remotePath, item?.sourceId, item?.url, loadLyrics, networkMedia])

  useEffect(() => {
    let current = true
    setAudioFeatures(null)
    if (session.mediaId == null) return () => { current = false }
    void window.aurora.invoke(I.mediaAudioFeatures, session.mediaId)
      .then((value) => { if (current) setAudioFeatures(value as MediaAudioFeatures) })
      .catch(() => { if (current) setAudioFeatures(null) })
    return () => { current = false }
  }, [session.mediaId])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === visualizerRef.current?.contentWindow && event.data?.type === 'aurora-visualizer-ready') setVisualizerReady(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const visualizerTheme = useMemo(() => {
    return audioVisualizerThemeForColorTheme(theme.accentIndex)
  }, [theme.accentIndex])

  useEffect(() => {
    const frame = visualizerRef.current?.contentWindow
    if (!frame) return
    const properties = {
      theme: { value: visualizerTheme }, showPlayerController: { value: false }, showAlbumCover: { value: false },
      gridSize: { value: 160 }, audioIntensity: { value: 0.82 }, responseRange: { value: 0.86 },
      cameraDistance: { value: 88 }, cameraAngleX: { value: 116 }, cameraAngleY: { value: 24 },
      autoRotateEnabled: { value: false }, pulseEnabled: { value: true }, pulseSensitivity: { value: 0.46 }, pulseCooldown: { value: 30 }, meteorEnabled: { value: false },
      meteorClickEnabled: { value: false }, idleWaveEnabled: { value: false }, peakColorEnabled: { value: true },
      peakColorIntensity: { value: 0.3 }
    }
    frame.postMessage({ type: 'aurora-visualizer-config', properties }, '*')
    const retry = window.setTimeout(() => frame.postMessage({ type: 'aurora-visualizer-config', properties }, '*'), 500)
    return () => window.clearTimeout(retry)
  }, [visualizerReady, visualizerTheme])

  useEffect(() => {
    const frame = visualizerRef.current?.contentWindow
    if (!frame || !visualizerReady) return
    const samples = shapeAudioVisualizerSpectrum(spectrum, playing, previousVisualizerSpectrumRef.current)
    previousVisualizerSpectrumRef.current = playing
      ? Array.from(spectrum, (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)))
      : []
    frame.postMessage({ type: 'aurora-audio-spectrum', samples }, '*')
  }, [playing, spectrum, visualizerReady])

  const technical = useMemo(
    () => technicalLabels(item?.fileName ?? '', item?.fileSize ?? 0, duration, audioFeatures),
    [audioFeatures, duration, item?.fileName, item?.fileSize]
  )
  const visibleLyrics = useMemo(() => {
    const lines = lyrics?.lines.filter((line) => line.text.trim()) ?? []
    if (!lines.length) return { activeIndex: -1, lines: [] }
    const lyricPosition = session.position - (lyrics?.offsetMs ?? 0) / 1000
    let activeIndex = -1
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].time >= 0 && lines[index].time <= lyricPosition) activeIndex = index
      if (lines[index].time > lyricPosition) break
    }
    if (activeIndex < 0) {
      const untimedIndex = lines.findIndex((line) => line.time < 0)
      activeIndex = untimedIndex >= 0 ? untimedIndex : 0
    }
    const start = Math.max(0, Math.min(activeIndex - 2, Math.max(0, lines.length - 5)))
    return {
      activeIndex,
      lines: lines.slice(start, start + 5).map((line, index) => ({ line, index: start + index }))
    }
  }, [lyrics, session.position])
  const titleColors = useMemo(() => blackGold
    ? { outline: '#ffbd28', head: '#ffe0a3', base: '#ffe3a3' }
    : { outline: theme.colors.accent, head: theme.colors.accentEnd, base: theme.colors.fg0 },
  [blackGold, theme.colors.accent, theme.colors.accentEnd, theme.colors.fg0])
  const rootStyle = {
    '--audio-progress': `${progress}%`, '--audio-volume': `${volume}%`, '--audio-accent': theme.colors.accent,
    '--audio-accent-start': theme.colors.accentStart, '--audio-accent-end': theme.colors.accentEnd,
    '--audio-accent-soft': blackGold ? 'rgba(255,184,0,.12)' : theme.colors.accentSoft,
    '--audio-ink': blackGold ? '#ffe3a3' : theme.colors.fg0,
    '--audio-copy': blackGold ? 'rgba(255,205,111,.82)' : theme.colors.fg1,
    '--audio-muted': blackGold ? 'rgba(218,158,62,.64)' : theme.colors.fg2,
    '--audio-bg': blackGold ? '#030201' : theme.colors.bg0,
    '--audio-surface': blackGold ? '#120c04' : theme.colors.surface,
    '--audio-border': blackGold ? 'rgba(255,184,0,.28)' : theme.colors.borderStrong
  } as React.CSSProperties
  const cyclePlaybackMode = () => {
    if (playbackMode === 'sequential') {
      setRepeat('all')
      setShuffle(true)
    } else if (playbackMode === 'shuffle') {
      setShuffle(false)
      setRepeat('one')
    } else {
      setShuffle(false)
      setRepeat('all')
    }
  }
  const releasePointerFocus = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.blur()
  }

  return (
    <div className={`music-player immersive-audio-player ${theme.isDark ? 'audio-dark' : 'audio-light'} ${blackGold ? 'audio-black-gold' : ''}`} style={rootStyle}>
      <div className="audio-player-drag-region" />
      <div className="audio-ambient" aria-hidden="true" />

      <div className="audio-window-actions">
        <button type="button" onClick={leavePlayer} aria-label={t('back')} title={t('back')}><Icon name="chevronLeft" size={21} /></button>
        <div className="audio-window-spacer" />
        <button type="button" onClick={windowMinimize} aria-label={t('minimize')} title={t('minimize')}><Icon name="minimize" size={15} /></button>
        <button type="button" onClick={() => void windowMaximizeToggle()} aria-label={win.maximized ? t('restore') : t('maximize')} title={win.maximized ? t('restore') : t('maximize')}><Icon name={win.maximized ? 'restore' : 'maximize'} size={14} /></button>
        <button type="button" className="audio-window-close" onClick={windowClose} aria-label={t('close')} title={t('close')}><Icon name="close" size={16} /></button>
      </div>

      <div className="audio-visualizer-shell" aria-hidden="true">
        <iframe ref={visualizerRef} className={visualizerReady ? 'ready' : ''} src={visualizerUrl} title="Audio spectrum visualization" tabIndex={-1} />
        <div className="audio-visualizer-scrim" />
      </div>

      {networkMedia && buffering && (
        <NetworkMediaLoader label={t('loadingNetworkMedia')} bytesPerSecond={session.networkSpeed ?? 0} iconUrl={appIconUrl} />
      )}

      <main className="audio-content">
        <section className="audio-track-info" aria-label={fileTitle}>
          <ProgressiveTitleOutline
            title={fileTitle}
            progress={progress}
            colors={titleColors}
            fontFamily={titleFontFamily}
            reducedMotion={settings.reducedMotion}
            snapToProgress={session.paused || session.seeking}
          />
          <div className="audio-artist">{artist}</div>
          <div className="audio-technical" aria-label="Audio technical information">
            {technical.map((label, index) => (
              <React.Fragment key={label}>
                {index > 0 && <span className="audio-technical-dot">•</span>}
                <span className={index === 0 ? 'audio-format-badge' : ''}>{label}</span>
              </React.Fragment>
            ))}
          </div>
        </section>

        <section className="audio-lyrics-panel" aria-label={t('lyrics')}>
          {visibleLyrics.lines.length > 0 ? visibleLyrics.lines.map(({ line, index }) => (
            <div
              className={`audio-lyric-line ${index === visibleLyrics.activeIndex ? 'active' : index < visibleLyrics.activeIndex ? 'played' : 'upcoming'}`}
              key={`${line.time}-${index}`}
            >
              {line.text}
            </div>
          )) : (
            <div className="audio-lyrics-empty">{t('lyricsNotFound')}</div>
          )}
        </section>
      </main>

      <section className="audio-control-console" aria-label="Playback controls">
        <div className="audio-progress-row">
          <span>{formatTime(session.position)}</span>
          <input className="audio-progress-input" type="range" min={0} max={Math.max(duration, 0.01)} step={0.05}
            value={Math.min(session.position, Math.max(duration, 0.01))} aria-label="Playback progress"
            onChange={(event) => engine.seekTo(Number(event.target.value))} />
          <span>{formatTime(duration)}</span>
        </div>

        <div className="audio-transport-controls">
          <button type="button" className="audio-control-icon audio-skip-control" onPointerUp={releasePointerFocus} onClick={() => void playPrevious()} aria-label={t('previous')} title={t('previous')}>
            <Icon name="prev" size={23} strokeWidth={1.55} />
          </button>
          <button type="button" className="audio-play-control" onPointerUp={releasePointerFocus} onClick={togglePlayPause} aria-label={playing ? t('pause') : t('play')} title={playing ? t('pause') : t('play')}>
            <Icon name={playing ? 'pause' : 'play'} size={27} strokeWidth={1.45} />
          </button>
          <button type="button" className="audio-control-icon audio-skip-control" onPointerUp={releasePointerFocus} onClick={() => void playNext()} aria-label={t('next')} title={t('next')}>
            <Icon name="next" size={23} strokeWidth={1.55} />
          </button>
          <button
            type="button"
            className={`audio-control-icon audio-playback-mode ${playbackMode !== 'sequential' ? 'active' : ''}`}
            data-mode={playbackMode}
            onPointerUp={releasePointerFocus}
            onClick={cyclePlaybackMode}
            aria-label={playbackModeLabel}
            title={playbackModeLabel}
          >
            <Icon name={playbackMode === 'one' ? 'repeatOne' : playbackMode === 'shuffle' ? 'shuffle' : 'repeat'} size={21} strokeWidth={1.55} />
          </button>
        </div>

        <div className="audio-volume-control">
          <span className="audio-volume-value">{Math.round(volume)}%</span>
          <input type="range" min={0} max={100} value={volume} aria-label="Volume" onChange={(event) => {
            if (session.muted) toggleMute()
            setVolume(Number(event.target.value))
          }} />
          <button
            type="button"
            className="audio-volume-icon"
            onPointerUp={releasePointerFocus}
            onClick={toggleMute}
            aria-label={session.muted ? t('unmute') : t('mute')}
            title={session.muted ? t('unmute') : t('mute')}
          >
            <Icon name={session.muted || session.volume === 0 ? 'volumeMute' : 'volume'} size={22} strokeWidth={1.65} />
          </button>
        </div>
      </section>
    </div>
  )
}

function ProgressiveTitleOutline({ title, progress, colors, fontFamily, reducedMotion, snapToProgress }: {
  title: string
  progress: number
  colors: TitleCanvasColors
  fontFamily: string
  reducedMotion: boolean
  snapToProgress: boolean
}) {
  const normalizedProgress = Math.min(1, Math.max(0, progress / 100))
  const outlineFont = useMemo(() => titleOutlineFont(fontFamily), [fontFamily])
  const glyphs = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context) context.font = outlineFont
    let progressIndex = 0
    return Array.from(title).map((char) => {
      const measured = context?.measureText(char).width ?? 42
      return { char, width: Math.max(12, measured), progressIndex: char.trim() ? progressIndex++ : null }
    })
  }, [outlineFont, title])
  const [outlines, setOutlines] = useState<Record<number, GlyphContour[]> | null>(null)

  useEffect(() => {
    let active = true
    setOutlines(null)
    void document.fonts.load(outlineFont, title).catch(() => []).then(() => {
      if (!active) return
      const entries = glyphs.flatMap((glyph, index) => glyph.progressIndex === null
        ? []
        : [[index, traceGlyphContours(glyph.char, 0, glyph.width, fontFamily)] as const])
      setOutlines(Object.fromEntries(entries) as Record<number, GlyphContour[]>)
    })
    return () => { active = false }
  }, [fontFamily, glyphs, outlineFont, title])

  return (
    <div
      className="audio-title-wrap"
      data-outline-progress={normalizedProgress.toFixed(4)}
      data-outline-ready={outlines ? 'true' : 'false'}
    >
      <h1 className="audio-title-accessible">{title}</h1>
      {outlines && (
        <AnimatedTitleCanvas
          key={title}
          title={title}
          glyphs={glyphs}
          outlines={outlines}
          progress={normalizedProgress}
          colors={colors}
          outlineFont={outlineFont}
          reducedMotion={reducedMotion}
          snapToProgress={snapToProgress}
        />
      )}
    </div>
  )
}

interface TitleGlyph {
  char: string
  width: number
  progressIndex: number | null
}

interface TitleCanvasColors {
  outline: string
  head: string
  base: string
}

interface PreparedCanvasContour {
  points: OutlinePoint[]
  cumulative: number[]
  length: number
  glyphIndex: number
}

interface TitleCanvasMetrics {
  cssWidth: number
  cssHeight: number
  pixelRatio: number
  viewScale: number
  virtualWidth: number
  offsetX: number
  offsetY: number
}

interface TitleGlyphMotionTransition {
  startedAt: number
  fromScales: number[]
  toScales: number[]
  fromOffset: number
  toOffset: number
}

interface TitleGlyphMotionState {
  activeGlyphIndex: number
  scales: number[]
  offset: number
  transition: TitleGlyphMotionTransition | null
}

interface TitleGlyphMotionSnapshot {
  activeGlyphIndex: number
  scales: number[]
  offset: number
  animating: boolean
}

function AnimatedTitleCanvas({ title, glyphs, outlines, progress, colors, outlineFont, reducedMotion, snapToProgress }: {
  title: string
  glyphs: TitleGlyph[]
  outlines: Record<number, GlyphContour[]>
  progress: number
  colors: TitleCanvasColors
  outlineFont: string
  reducedMotion: boolean
  snapToProgress: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const displayedProgressRef = useRef(progress)
  const initializedRef = useRef(false)
  const glyphMotionRef = useRef<TitleGlyphMotionState | null>(null)
  const canvasSizeRef = useRef<{ width: number; height: number } | null>(null)
  const preparedContours = useMemo(() => glyphs.flatMap((_, glyphIndex) => (
    (outlines[glyphIndex] ?? []).map((contour) => prepareCanvasContour(contour, glyphIndex))
  )), [glyphs, outlines])
  const glyphSpans = useMemo(() => buildAudioTitleGlyphSpans(glyphs.map((_, glyphIndex) => (
    (outlines[glyphIndex] ?? []).reduce((sum, contour) => sum + contour.length, 0)
  ))), [glyphs, outlines])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = 0
    const totalOutlineLength = glyphSpans.at(-1)?.end ?? 0
    const mediaReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const shouldReduceMotion = reducedMotion || mediaReducedMotion

    const draw = (value: number, now: number, snapLayout = false) => {
      const bounded = Math.min(1, Math.max(0, value))
      displayedProgressRef.current = bounded
      const metrics = prepareTitleCanvas(canvas)
      const drawnLength = Math.min(totalOutlineLength, Math.max(0, bounded * totalOutlineLength))
      const motion = resolveTitleGlyphMotion(
        glyphMotionRef,
        glyphs,
        glyphSpans,
        drawnLength,
        metrics.virtualWidth,
        now,
        snapLayout || shouldReduceMotion
      )
      drawTitleCanvas(canvas, title, glyphs, preparedContours, bounded, totalOutlineLength, colors, outlineFont, metrics, motion)
      return motion.animating
    }

    canvasSizeRef.current = { width: canvas.clientWidth, height: canvas.clientHeight }
    const resizeObserver = new ResizeObserver(() => {
      const nextSize = { width: canvas.clientWidth, height: canvas.clientHeight }
      const previousSize = canvasSizeRef.current
      if (previousSize?.width === nextSize.width && previousSize.height === nextSize.height) return
      canvasSizeRef.current = nextSize
      draw(displayedProgressRef.current, performance.now(), true)
    })
    resizeObserver.observe(canvas)

    const progressDelta = Math.abs(progress - displayedProgressRef.current)
    const shouldSnap = !initializedRef.current || shouldReduceMotion || snapToProgress || progressDelta >= TITLE_SEEK_SNAP_THRESHOLD
    if (shouldSnap) {
      initializedRef.current = true
      draw(progress, performance.now(), true)
      return () => resizeObserver.disconnect()
    }

    const from = displayedProgressRef.current
    const startedAt = performance.now()
    draw(from, startedAt)
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / TITLE_PROGRESS_TRANSITION_MS)
      const layoutAnimating = draw(from + (progress - from) * elapsed, now)
      if (elapsed < 1 || layoutAnimating) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [colors, glyphSpans, glyphs, outlineFont, preparedContours, progress, reducedMotion, snapToProgress, title])

  return <canvas ref={canvasRef} className="audio-title-canvas" aria-hidden="true" />
}

function prepareCanvasContour(contour: GlyphContour, glyphIndex: number): PreparedCanvasContour {
  const cumulative = [0]
  for (let index = 1; index < contour.points.length; index += 1) {
    const previous = contour.points[index - 1]
    const point = contour.points[index]
    cumulative.push(cumulative[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y))
  }
  return { points: contour.points, cumulative, length: Math.max(.001, cumulative.at(-1) ?? contour.length), glyphIndex }
}

function prepareTitleCanvas(canvas: HTMLCanvasElement): TitleCanvasMetrics {
  const cssWidth = Math.max(1, canvas.clientWidth)
  const cssHeight = Math.max(1, canvas.clientHeight)
  const pixelRatio = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
  const bitmapWidth = Math.max(1, Math.round(cssWidth * pixelRatio))
  const bitmapHeight = Math.max(1, Math.round(cssHeight * pixelRatio))
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth
    canvas.height = bitmapHeight
  }

  const usableWidth = Math.max(1, cssWidth - TITLE_CANVAS_PADDING_X * 2)
  const usableHeight = Math.max(1, cssHeight - TITLE_CANVAS_PADDING_Y * 2)
  const viewScale = Math.max(.001, Math.min(usableWidth / TITLE_STAGE_WIDTH, usableHeight / TITLE_STAGE_HEIGHT))
  const renderedHeight = TITLE_STAGE_HEIGHT * viewScale
  return {
    cssWidth,
    cssHeight,
    pixelRatio,
    viewScale,
    virtualWidth: usableWidth / viewScale,
    offsetX: TITLE_CANVAS_PADDING_X,
    offsetY: TITLE_CANVAS_PADDING_Y + (usableHeight - renderedHeight) / 2
  }
}

function resolveTitleGlyphMotion(
  motionRef: React.MutableRefObject<TitleGlyphMotionState | null>,
  glyphs: TitleGlyph[],
  spans: AudioTitleGlyphSpan[],
  drawnLength: number,
  virtualWidth: number,
  now: number,
  snap: boolean
): TitleGlyphMotionSnapshot {
  const fallbackIndex = glyphs.findIndex((glyph) => glyph.progressIndex !== null)
  const resolvedActiveGlyphIndex = activeAudioTitleGlyphIndex(spans, drawnLength)
  const activeGlyphIndex = resolvedActiveGlyphIndex >= 0 ? resolvedActiveGlyphIndex : Math.max(0, fallbackIndex)
  const targetScales = audioTitleScaleTargets(glyphs.length, activeGlyphIndex)
  const targetLayout = layoutAudioTitleGlyphs(glyphs.map((glyph) => glyph.width), targetScales, virtualWidth, activeGlyphIndex)
  const targetOffset = targetLayout.contentWidth <= virtualWidth
    ? 0
    : targetLayout.targetOffset
  let state = motionRef.current

  if (!state || state.scales.length !== glyphs.length) {
    state = { activeGlyphIndex, scales: targetScales, offset: targetOffset, transition: null }
    motionRef.current = state
    return { activeGlyphIndex, scales: [...state.scales], offset: state.offset, animating: false }
  }

  sampleTitleGlyphTransition(state, now)
  if (snap) {
    state.activeGlyphIndex = activeGlyphIndex
    state.scales = targetScales
    state.offset = targetOffset
    state.transition = null
  } else if (state.activeGlyphIndex !== activeGlyphIndex) {
    state.activeGlyphIndex = activeGlyphIndex
    state.transition = {
      startedAt: now,
      fromScales: [...state.scales],
      toScales: targetScales,
      fromOffset: state.offset,
      toOffset: targetOffset
    }
  }

  sampleTitleGlyphTransition(state, now)
  return {
    activeGlyphIndex: state.activeGlyphIndex,
    scales: [...state.scales],
    offset: state.offset,
    animating: state.transition !== null
  }
}

function sampleTitleGlyphTransition(state: TitleGlyphMotionState, now: number): void {
  const transition = state.transition
  if (!transition) return
  const elapsed = Math.min(1, Math.max(0, (now - transition.startedAt) / TITLE_GLYPH_TRANSITION_MS))
  const eased = titleGlyphEase(elapsed)
  state.scales = transition.toScales.map((target, index) => (
    (transition.fromScales[index] ?? target) + (target - (transition.fromScales[index] ?? target)) * eased
  ))
  state.offset = transition.fromOffset + (transition.toOffset - transition.fromOffset) * eased
  if (elapsed >= 1) state.transition = null
}

function titleGlyphEase(value: number): number {
  const inverse = 1 - Math.min(1, Math.max(0, value))
  return 1 - inverse * inverse * inverse * inverse
}

function drawTitleCanvas(
  canvas: HTMLCanvasElement,
  title: string,
  glyphs: TitleGlyph[],
  contours: PreparedCanvasContour[],
  progress: number,
  totalOutlineLength: number,
  colors: TitleCanvasColors,
  outlineFont: string,
  metrics: TitleCanvasMetrics,
  motion: TitleGlyphMotionSnapshot
) {
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)

  const { pixelRatio, viewScale } = metrics
  context.setTransform(
    pixelRatio * viewScale,
    0,
    0,
    pixelRatio * viewScale,
    pixelRatio * metrics.offsetX,
    pixelRatio * metrics.offsetY
  )
  context.lineCap = 'round'
  context.lineJoin = 'round'

  const titleLayout = layoutAudioTitleGlyphs(
    glyphs.map((glyph) => glyph.width),
    motion.scales,
    metrics.virtualWidth,
    motion.activeGlyphIndex
  )
  const glyphPositions = titleLayout.glyphs.map((position) => ({ ...position, x: position.x + motion.offset }))

  const styles = getComputedStyle(canvas)
  const outlineColor = colors.outline || styles.color || '#38d9ff'
  const headColor = colors.head || styles.outlineColor || outlineColor
  const baseColor = colors.base || styles.textDecorationColor || outlineColor

  // A nearly invisible fill preserves the original title mass while the full
  // low-energy contour shows the remaining route, as in the visual reference.
  context.save()
  context.font = outlineFont
  context.textBaseline = 'alphabetic'
  context.fillStyle = baseColor
  context.globalAlpha = .045
  glyphs.forEach((glyph, glyphIndex) => {
    const position = glyphPositions[glyphIndex]
    if (glyph.progressIndex === null || !position) return
    withTitleGlyphTransform(context, glyph, position, () => context.fillText(glyph.char, 0, TITLE_BASELINE))
  })
  context.restore()

  context.save()
  context.strokeStyle = outlineColor
  context.globalAlpha = .14
  context.lineWidth = .9 / viewScale
  contours.forEach((contour) => {
    const glyph = glyphs[contour.glyphIndex]
    const position = glyphPositions[contour.glyphIndex]
    if (glyph && position) withTitleGlyphTransform(context, glyph, position, () => strokeCanvasContour(context, contour, 0, contour.length))
  })
  context.restore()

  const totalDrawnLength = Math.min(totalOutlineLength, Math.max(0, progress * totalOutlineLength))
  let precedingLength = 0
  let active: { contour: PreparedCanvasContour; distance: number } | null = null

  context.save()
  context.strokeStyle = outlineColor
  context.globalAlpha = .84
  context.lineWidth = 1.65 / viewScale
  contours.forEach((contour, contourIndex) => {
    const start = precedingLength
    const end = start + contour.length
    const drawn = Math.min(contour.length, Math.max(0, totalDrawnLength - start))
    const glyph = glyphs[contour.glyphIndex]
    const position = glyphPositions[contour.glyphIndex]
    if (drawn > 0 && glyph && position) {
      withTitleGlyphTransform(context, glyph, position, () => strokeCanvasContour(context, contour, 0, drawn))
    }
    const isLastContour = contourIndex === contours.length - 1
    if ((totalDrawnLength >= start && totalDrawnLength < end) || (isLastContour && totalDrawnLength >= end)) {
      active = { contour, distance: drawn }
    }
    precedingLength = end
  })
  context.restore()

  if (active) {
    const activeContour = active as { contour: PreparedCanvasContour; distance: number }
    const activeGlyph = glyphs[activeContour.contour.glyphIndex]
    const activePosition = glyphPositions[activeContour.contour.glyphIndex]
    if (!activeGlyph || !activePosition) return
    const boundaryOpacity = Math.min(1, activeContour.distance / 4)
    const tailStart = Math.max(0, activeContour.distance - Math.min(64, activeContour.contour.length * .24))
    const tailMid = tailStart + (activeContour.distance - tailStart) * .58

    withTitleGlyphTransform(context, activeGlyph, activePosition, () => {
      context.save()
      context.globalCompositeOperation = 'lighter'
      context.strokeStyle = headColor
      context.globalAlpha = .36 * boundaryOpacity
      context.lineWidth = 3.4 / viewScale
      strokeCanvasContour(context, activeContour.contour, tailStart, activeContour.distance)
      context.globalAlpha = .9 * boundaryOpacity
      context.lineWidth = 1.7 / viewScale
      strokeCanvasContour(context, activeContour.contour, tailMid, activeContour.distance)
      context.restore()

      const head = pointOnCanvasContour(activeContour.contour, activeContour.distance)
      context.save()
      context.globalCompositeOperation = 'lighter'
      context.fillStyle = headColor
      context.globalAlpha = .42 * boundaryOpacity
      context.beginPath()
      context.arc(head.x, head.y, 5.4 / viewScale, 0, Math.PI * 2)
      context.fill()
      context.globalAlpha = boundaryOpacity
      context.beginPath()
      context.arc(head.x, head.y, 1.9 / viewScale, 0, Math.PI * 2)
      context.fill()
      context.restore()
    })
  }

  canvas.dataset.title = title
  canvas.dataset.renderedProgress = progress.toFixed(4)
  canvas.dataset.activeGlyphIndex = String(motion.activeGlyphIndex)
}

function withTitleGlyphTransform(
  context: CanvasRenderingContext2D,
  glyph: TitleGlyph,
  position: { x: number; width: number; scale: number },
  draw: () => void
): void {
  context.save()
  context.translate(position.x + position.width / 2, TITLE_BASELINE)
  context.scale(position.scale, position.scale)
  context.translate(-glyph.width / 2, -TITLE_BASELINE)
  draw()
  context.restore()
}

function strokeCanvasContour(
  context: CanvasRenderingContext2D,
  contour: PreparedCanvasContour,
  startDistance: number,
  endDistance: number
) {
  const start = Math.min(contour.length, Math.max(0, startDistance))
  const end = Math.min(contour.length, Math.max(start, endDistance))
  if (end - start < .001) return
  const startPoint = pointOnCanvasContour(contour, start)
  const endPoint = pointOnCanvasContour(contour, end)
  context.beginPath()
  context.moveTo(startPoint.x, startPoint.y)
  for (let index = 1; index < contour.points.length; index += 1) {
    const distance = contour.cumulative[index]
    if (distance <= start) continue
    if (distance >= end) break
    context.lineTo(contour.points[index].x, contour.points[index].y)
  }
  context.lineTo(endPoint.x, endPoint.y)
  context.stroke()
}

function pointOnCanvasContour(contour: PreparedCanvasContour, distance: number): OutlinePoint {
  const bounded = Math.min(contour.length, Math.max(0, distance))
  for (let index = 1; index < contour.cumulative.length; index += 1) {
    const segmentEnd = contour.cumulative[index]
    if (segmentEnd < bounded) continue
    const segmentStart = contour.cumulative[index - 1]
    const span = Math.max(.001, segmentEnd - segmentStart)
    const ratio = Math.min(1, Math.max(0, (bounded - segmentStart) / span))
    const previous = contour.points[index - 1]
    const point = contour.points[index]
    return {
      x: previous.x + (point.x - previous.x) * ratio,
      y: previous.y + (point.y - previous.y) * ratio
    }
  }
  return contour.points.at(-1) ?? { x: 0, y: 0 }
}

const TITLE_FONT_SIZE = 82
const TITLE_BASELINE = 82
const TITLE_STAGE_WIDTH = 660
const TITLE_STAGE_HEIGHT = 104
const TITLE_CANVAS_PADDING_X = 8
const TITLE_CANVAS_PADDING_Y = 5
const TITLE_PROGRESS_TRANSITION_MS = 235
const TITLE_GLYPH_TRANSITION_MS = 220
const TITLE_SEEK_SNAP_THRESHOLD = .015

function titleOutlineFont(fontFamily: string): string {
  return `540 ${TITLE_FONT_SIZE}px ${fontFamily}`
}

interface OutlinePoint {
  x: number
  y: number
}

interface GlyphContour {
  points: OutlinePoint[]
  length: number
  minX: number
  minY: number
}

interface PixelEdge {
  fromX: number
  fromY: number
  toX: number
  toY: number
}

function traceGlyphContours(char: string, originX: number, glyphWidth: number, fontFamily: string): GlyphContour[] {
  const scale = 4
  const padding = 7
  const width = Math.max(1, Math.ceil((glyphWidth + padding * 2 + 6) * scale))
  const height = TITLE_STAGE_HEIGHT * scale
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []

  context.clearRect(0, 0, width, height)
  context.fillStyle = '#fff'
  context.font = `540 ${TITLE_FONT_SIZE * scale}px ${fontFamily}`
  context.textBaseline = 'alphabetic'
  context.fillText(char, padding * scale, TITLE_BASELINE * scale)

  const pixels = context.getImageData(0, 0, width, height).data
  const mask = new Uint8Array(width * height)
  for (let index = 0; index < mask.length; index += 1) mask[index] = pixels[index * 4 + 3] >= 80 ? 1 : 0
  const isFilled = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1
  const edges: PixelEdge[] = []
  const addEdge = (fromX: number, fromY: number, toX: number, toY: number) => edges.push({ fromX, fromY, toX, toY })

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isFilled(x, y)) continue
      if (!isFilled(x, y - 1)) addEdge(x, y, x + 1, y)
      if (!isFilled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1)
      if (!isFilled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1)
      if (!isFilled(x - 1, y)) addEdge(x, y + 1, x, y)
    }
  }

  const edgeMap = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const key = `${edge.fromX},${edge.fromY}`
    const bucket = edgeMap.get(key)
    if (bucket) bucket.push(index)
    else edgeMap.set(key, [index])
  })
  const used = new Uint8Array(edges.length)
  const contours: GlyphContour[] = []
  for (let startIndex = 0; startIndex < edges.length; startIndex += 1) {
    if (used[startIndex]) continue
    const startEdge = edges[startIndex]
    const pixelPoints: OutlinePoint[] = [{ x: startEdge.fromX, y: startEdge.fromY }]
    let edgeIndex = startIndex
    let closed = false
    for (let guard = 0; guard <= edges.length; guard += 1) {
      if (used[edgeIndex]) break
      const edge = edges[edgeIndex]
      used[edgeIndex] = 1
      pixelPoints.push({ x: edge.toX, y: edge.toY })
      if (edge.toX === startEdge.fromX && edge.toY === startEdge.fromY) {
        closed = true
        break
      }
      const next = edgeMap.get(`${edge.toX},${edge.toY}`)
        ?.filter((candidate) => !used[candidate])
        .sort((left, right) => edgeContinuationScore(edge, edges[right]) - edgeContinuationScore(edge, edges[left]))[0]
      if (next === undefined) break
      edgeIndex = next
    }
    if (!closed || pixelPoints.length < 6) continue
    pixelPoints.pop()
    const ordered = rotateContourFromTop(pixelPoints)
    const svgPoints = ordered.map((point) => ({
      x: originX + point.x / scale - padding,
      y: point.y / scale
    }))
    svgPoints.push(svgPoints[0])
    const simplified = simplifyPath(svgPoints, 0.22)
    const length = pathLength(simplified)
    if (simplified.length < 4 || length < 2.5) continue
    const minX = Math.min(...simplified.map((point) => point.x))
    const minY = Math.min(...simplified.map((point) => point.y))
    contours.push({ points: simplified, length, minX, minY })
  }
  return contours.sort((left, right) => left.minY - right.minY || left.minX - right.minX || right.length - left.length)
}

function edgeContinuationScore(current: PixelEdge, next: PixelEdge): number {
  const currentX = current.toX - current.fromX
  const currentY = current.toY - current.fromY
  const nextX = next.toX - next.fromX
  const nextY = next.toY - next.fromY
  const cross = currentX * nextY - currentY * nextX
  const dot = currentX * nextX + currentY * nextY
  if (cross > 0) return 3
  if (dot > 0) return 2
  if (cross < 0) return 1
  return 0
}

function rotateContourFromTop(points: OutlinePoint[]): OutlinePoint[] {
  let startIndex = 0
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    const start = points[startIndex]
    if (point.y < start.y || (point.y === start.y && point.x < start.x)) startIndex = index
  }
  const forward = [...points.slice(startIndex), ...points.slice(0, startIndex)]
  const reverse = [forward[0], ...forward.slice(1).reverse()]
  return contourStartDirectionScore(reverse) > contourStartDirectionScore(forward) ? reverse : forward
}

function contourStartDirectionScore(points: OutlinePoint[]): number {
  const start = points[0]
  let end = start
  let distance = 0
  for (let index = 1; index < points.length && distance < 20; index += 1) {
    const previous = points[index - 1]
    end = points[index]
    distance += Math.hypot(end.x - previous.x, end.y - previous.y)
  }
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  return deltaY * 3 - Math.abs(deltaX)
}

function simplifyPath(points: OutlinePoint[], tolerance: number): OutlinePoint[] {
  if (points.length <= 2) return points
  let furthestIndex = 0
  let furthestDistance = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(points[index], first, last)
    if (distance > furthestDistance) {
      furthestDistance = distance
      furthestIndex = index
    }
  }
  if (furthestDistance <= tolerance) return [first, last]
  const left = simplifyPath(points.slice(0, furthestIndex + 1), tolerance)
  const right = simplifyPath(points.slice(furthestIndex), tolerance)
  return [...left.slice(0, -1), ...right]
}

function distanceToSegment(point: OutlinePoint, start: OutlinePoint, end: OutlinePoint): number {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  if (deltaX === 0 && deltaY === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const ratio = Math.min(1, Math.max(0, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / (deltaX ** 2 + deltaY ** 2)))
  return Math.hypot(point.x - (start.x + deltaX * ratio), point.y - (start.y + deltaY * ratio))
}

function pathLength(points: OutlinePoint[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  return Math.max(0.001, length)
}

function technicalLabels(fileName: string, fileSize: number, duration: number, features: MediaAudioFeatures | null): string[] {
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toUpperCase() : ''
  const codec = features?.codec ? features.codec.toUpperCase().replace('PCM_', 'PCM ') : extension || 'AUDIO'
  const labels = [codec]
  if ((features?.bitDepth ?? 0) > 0) labels.push(`${features!.bitDepth}-bit`)
  else {
    const bitrate = (features?.bitrate ?? 0) || (fileSize > 0 && duration > 0 ? (fileSize * 8) / duration : 0)
    if (bitrate > 0) labels.push(`${Math.round(bitrate / 1000)} kbps`)
  }
  if ((features?.sampleRate ?? 0) > 0) labels.push(`${formatKHz(features!.sampleRate)} kHz`)
  else if ((features?.channels ?? 0) > 0) labels.push(features!.channels === 2 ? 'Stereo' : `${features!.channels} ch`)
  return labels.slice(0, 3)
}

function displayMediaText(value: string | null | undefined): string {
  const text = value?.trim() ?? ''
  if (!text) return ''
  const dot = text.lastIndexOf('.')
  const extension = dot >= 0 ? text.slice(dot + 1) : ''
  return dot > 0 && isAudioExt(extension) ? text.slice(0, dot).trim() : text
}

function displayFileName(fileName: string | null | undefined): string {
  const name = fileName?.split(/[\\/]/).pop() ?? ''
  return displayMediaText(name)
}

function formatKHz(sampleRate: number): string {
  const value = sampleRate / 1000
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
