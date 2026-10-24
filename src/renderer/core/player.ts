import type { MpvVideoElement, MpvVideoState } from 'electron-mpv-video/renderer'
import { I } from '../../shared/channels'
import type { Chapter, MediaTrackCatalog, PlayPlan, SessionState, TrackInfo } from '../../shared/types'

let mediaBase = ''

export async function initMediaBase(): Promise<void> {
  try {
    const base = (await window.aurora.invoke(I.mediaBase)) as string
    if (base) mediaBase = base
  } catch { void 0 }
}

export const mediaUrl = (value: string) => (/^https?:\/\//.test(value) ? value : `${mediaBase}${encodeURIComponent(value)}`)
export const coverUrl = (coverPath?: string | null) => (coverPath ? mediaUrl(coverPath) : '')

export interface EngineEvents {
  onSession?: (state: SessionState) => void
  onTracks?: (info: MediaTrackCatalog) => void
  onFps?: (fps: number) => void
  onEnded?: () => void
  onPlaybackError?: (message: string) => void
  onLoaded?: () => void
  onBuffering?: (buffering: boolean) => void
}

type MpvProperty = 'speed' | 'mute' | 'vid' | 'aid' | 'sid'
type AuroraMpvElement = MpvVideoElement & { setProperty?: (name: MpvProperty, value: string) => Promise<void> }
type MpvEvent = { playerId: string; type: string; name?: string; data?: unknown; error?: string }

const EMPTY_TRACKS: MediaTrackCatalog = { video: [], audio: [], subtitles: [], chapters: [], width: 0, height: 0, fps: 0 }
const SESSION_SYNC_INTERVAL = 5000
const MEDIA_LOAD_TIMEOUT = 30_000

/**
 * Browser-supported audio uses one HTMLAudioElement so Web Audio can feed the
 * visualizer. Video, and the fallback for other audio codecs, use one libmpv
 * instance for demuxing, decoding, audio, subtitles, caching,
 * seeking and the playback clock. A video must never create a companion audio
 * element or a second FFmpeg frame stream.
 */
export class PlayerEngine {
  /** Audio-only element. Video pixels and sound are owned by mpvElement. */
  video: HTMLAudioElement | null = null
  ev: EngineEvents = {}

  private mpvElement: AuroraMpvElement | null = null
  /** True only while an audio file is being decoded by the hidden mpv element. */
  private mpvAudio = false
  private container: HTMLElement | null = null
  private readonly hiddenHost: HTMLDivElement
  private plan: PlayPlan | null = null
  private disposed = true
  private audioEvents: AbortController | null = null
  private frequencyData = new Uint8Array(256)
  private loadEpoch = 0
  private trackEpoch = 0
  private loadTimeout = 0
  private knownDuration = 0
  private pendingResume = 0
  private loadedMpvSource = ''
  private mpvLoadTask: { epoch: number; playerId: string } | null = null
  private mpvDestroyTask: Promise<void> | null = null
  private mpvOpenTask: Promise<void> | null = null
  private mpvOpenEpoch = -1
  private needsMpvOpen = false
  private seekTarget: number | null = null
  private seekWasPlaying = false
  private seekingGesture = false
  private seekRequestEpoch = 0
  private seekCommandPending = false
  private seekAcceptAfter = 0
  private seekConfirmUntil = 0
  private seekDisplayFloor: number | null = null
  private seekDisplayFloorUntil = 0
  private playbackRequestEpoch = 0
  private desiredPaused: boolean | null = null
  private playbackConfirmUntil = 0
  private ended = false
  private selectedVideoTrack = 0
  private selectedAudioTrack = 0
  private selectedSubtitleTrack = -1
  private detectedTracks: MediaTrackCatalog = { ...EMPTY_TRACKS }

  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null
  private spectrum = new Float32Array(128)
  private readonly spectrumListeners = new Set<(samples: Float32Array) => void>()
  private lastSpectrumAt = 0
  private raf = 0
  private lastFrameAt = 0
  private frameCount = 0
  private lastSessionEmitAt = 0
  private lastSyncAt = 0
  private backendBuffering = false
  private clockStalled = false
  private clockWatchPosition = 0
  private clockAdvancedAt = 0

  private networkMedia = false
  private networkStatsPending = false
  private networkStatsEpoch = 0
  private networkSampleAt = 0
  private networkSampleBytes = 0
  private lastNetworkUpdateAt = 0
  private cacheEndTime = 0
  private cacheDuration = 0

  private volume = 80
  private muted = false
  private speed = 1
  private session: SessionState = {
    phase: 'idle', kind: 'video', mediaId: null, position: 0, duration: 0,
    paused: true, loaded: false, buffering: false, bufferedSeconds: 0,
    networkSpeed: 0, seeking: false, idle: true, error: null, volume: 80,
    muted: false, speed: 1, repeatMode: 'none', shuffle: false,
    lastPositionKnown: 0
  }

  constructor(events?: EngineEvents) {
    if (events) this.ev = events
    this.hiddenHost = document.createElement('div')
    this.hiddenHost.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;top:0'
  }

  private get usesMpv(): boolean { return this.session.kind === 'video' || this.mpvAudio }

  mount(): void {
    if (!this.disposed) return
    this.disposed = false
    document.body.appendChild(this.hiddenHost)
    this.raf = requestAnimationFrame(this.loop)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ev = {}
    this.stop()
    this.hiddenHost.remove()
  }

  onSpectrum(listener: (samples: Float32Array) => void): () => void {
    this.spectrumListeners.add(listener)
    return () => this.spectrumListeners.delete(listener)
  }

  private emitSpectrum(samples: Float32Array): void {
    for (const listener of this.spectrumListeners) listener(samples)
  }

  attach(container: HTMLElement, muted: boolean, volume: number, speed: number): void {
    this.container = container
    this.muted = muted
    this.volume = normalizeVolume(volume)
    this.speed = normalizeSpeed(speed)
    if (this.session.kind !== 'video' || !this.plan || this.session.phase === 'error') return
    void this.openMpvIfNeeded()
  }

  detach(): void {
    // Reparenting a custom element disconnects it and destroys its native mpv
    // session. The player route calls stop() before the stage is unmounted.
    this.container = null
  }

  private openMpvIfNeeded(): Promise<void> {
    const epoch = this.loadEpoch
    if (this.mpvOpenTask && this.mpvOpenEpoch === epoch) return this.mpvOpenTask
    const task = this.openMpvIfNeededInternal(epoch).finally(() => {
      if (this.mpvOpenTask === task) {
        this.mpvOpenTask = null
        this.mpvOpenEpoch = -1
        // Bail-out with a null/detached container can finish after attach rebinds the stage.
        if (this.needsMpvOpen && this.plan && this.loadEpoch === epoch && this.session.phase !== 'error') {
          const container = this.mpvAudio ? this.hiddenHost : this.container
          if (container?.isConnected) void this.openMpvIfNeeded()
        }
      }
    })
    this.mpvOpenTask = task
    this.mpvOpenEpoch = epoch
    return task
  }

  load(plan: PlayPlan, volume: number, muted: boolean, speed: number): void {
    if (this.disposed) return
    const epoch = ++this.loadEpoch
    this.clearLoadTimeout()
    this.stopBackends('replace')
    this.mpvAudio = false
    this.plan = plan
    this.volume = normalizeVolume(volume)
    this.muted = muted
    this.speed = normalizeSpeed(speed)
    this.knownDuration = Number.isFinite(plan.item?.duration) && (plan.item?.duration ?? 0) > 0 ? plan.item!.duration : 0
    this.pendingResume = finiteOrZero(plan.resumePosition)
    this.loadedMpvSource = ''
    this.needsMpvOpen = false
    this.seekTarget = null
    this.seekWasPlaying = false
    this.seekingGesture = false
    this.seekRequestEpoch += 1
    this.seekCommandPending = false
    this.seekAcceptAfter = 0
    this.seekConfirmUntil = 0
    this.seekDisplayFloor = null
    this.seekDisplayFloorUntil = 0
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
    this.ended = false
    this.selectedVideoTrack = 0
    this.selectedAudioTrack = 0
    this.selectedSubtitleTrack = -1
    this.detectedTracks = { ...EMPTY_TRACKS }
    this.trackEpoch += 1
    this.networkMedia = Boolean(
      (plan.item?.sourceId !== null && plan.item?.sourceId !== undefined) ||
      (plan.item?.protocol && plan.item.protocol !== 'local')
    )
    this.backendBuffering = true
    this.clockStalled = false
    this.clockWatchPosition = 0
    this.clockAdvancedAt = performance.now()
    this.resetNetworkStats()
    this.session = {
      ...this.session, phase: 'loading', kind: plan.kind,
      mediaId: plan.item?.id ?? null, position: 0, duration: this.knownDuration,
      paused: true, loaded: false, buffering: true, bufferedSeconds: 0,
      networkSpeed: 0, seeking: false, idle: false, error: null,
      lastPositionKnown: 0
    }
    this.emitSession()
    this.ev.onTracks?.({ ...EMPTY_TRACKS })
    this.armLoadTimeout()

    try {
      if (!plan.ok || !plan.url.trim()) throw new Error('Invalid media source')
      if (plan.kind === 'audio') {
        this.loadAudio(plan, epoch)
      } else if (plan.kind === 'video') {
        if (plan.item?.id != null) void this.loadTrackCatalog(plan.item.id)
        if (this.container) void this.openMpvIfNeeded()
        else this.needsMpvOpen = true
      }
    } catch (error) {
      this.failPlayback(errorMessage(error))
    }
  }

  private loadAudio(plan: PlayPlan, epoch: number): void {
    const audio = document.createElement('audio')
    this.audioEvents = new AbortController()
    const options = { signal: this.audioEvents.signal }
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.volume = this.volume / 100
    audio.muted = this.muted
    audio.playbackRate = this.speed
    audio.addEventListener('loadedmetadata', () => {
      if (epoch !== this.loadEpoch || this.video !== audio) return
      const nativeDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
      this.session.duration = this.knownDuration || nativeDuration || this.session.duration
      const resumePosition = this.pendingResume
      this.pendingResume = 0
      if (resumePosition > 0.5 && resumePosition < this.session.duration - 0.5) {
        this.runCommand(() => { audio.currentTime = resumePosition })
      }
      this.emitSession()
    }, options)
    audio.addEventListener('playing', () => {
      if (epoch !== this.loadEpoch || audio.paused) return
      this.markLoaded()
      this.applyAudioPaused(false)
      this.setBuffering(false)
      this.ensureAudioGraph()
      this.emitSession()
    }, options)
    audio.addEventListener('pause', () => {
      if (epoch !== this.loadEpoch || this.session.idle || this.session.phase === 'error') return
      this.updateAudioPosition(audio)
      this.applyAudioPaused(true)
      this.emitSession()
    }, options)
    audio.addEventListener('waiting', () => { if (epoch === this.loadEpoch && this.video === audio) this.setBuffering(true) }, options)
    audio.addEventListener('canplay', () => {
      if (epoch !== this.loadEpoch || this.video !== audio) return
      this.markLoaded()
      this.setBuffering(false)
    }, options)
    audio.addEventListener('seeking', () => {
      if (epoch !== this.loadEpoch || this.video !== audio) return
      this.session.seeking = true
      this.emitSession()
    }, options)
    audio.addEventListener('seeked', () => {
      if (epoch !== this.loadEpoch || this.video !== audio || this.seekingGesture) return
      this.session.seeking = false
      this.seekTarget = null
      this.updateAudioPosition(audio)
      this.emitSession()
    }, options)
    audio.addEventListener('ended', () => {
      if (epoch === this.loadEpoch && this.video === audio) this.handleEnded()
    }, options)
    audio.addEventListener('error', () => {
      if (epoch !== this.loadEpoch || this.video !== audio) return
      const code = audio.error?.code
      if (code === 3 || code === 4) { this.fallbackToMpvAudio(); return }
      this.failPlayback(code === 2 ? 'Network error while loading media' : code === 3 ? 'Could not decode this media' : code === 4 ? 'This media is not supported' : 'Playback error')
    }, options)
    this.hiddenHost.appendChild(audio)
    this.video = audio
    audio.src = plan.url
    this.runCommand(() => this.requestAudioPaused(false))
  }

  /**
   * Chromium cannot decode every format accepted by the library (for example
   * WMA, APE, DTS and DSD). Preserve the audio UI and retry through libmpv
   * instead of presenting an unsupported-format error for a playable file.
   */
private fallbackToMpvAudio(): void {
    if (this.mpvAudio || this.session.kind !== 'audio' || !this.plan || this.disposed || this.session.phase === 'error') return
    const resumePosition = Math.max(this.pendingResume, finiteOrZero(this.video?.currentTime), this.session.position)
    this.loadEpoch += 1
    this.trackEpoch += 1
    this.seekRequestEpoch += 1
    this.playbackRequestEpoch += 1
    this.clearLoadTimeout()
    this.stopBackends('replace')
    if (this.video && this.video.parentElement === this.hiddenHost) {
      this.hiddenHost.removeChild(this.video)
    }
    this.mpvAudio = true
    this.pendingResume = resumePosition
    this.loadedMpvSource = ''
    this.seekTarget = null
    this.seekingGesture = false
    this.seekWasPlaying = false
    this.seekCommandPending = false
    this.seekAcceptAfter = 0
    this.seekConfirmUntil = 0
    this.seekDisplayFloor = null
    this.seekDisplayFloorUntil = 0
    this.backendBuffering = true
    this.clockStalled = false
    this.clockWatchPosition = 0
    this.clockAdvancedAt = performance.now()
    this.resetNetworkStats()
    this.session = {
      ...this.session, phase: 'loading', loaded: false, paused: true,
      buffering: true, seeking: false, error: null, position: resumePosition,
      lastPositionKnown: resumePosition
    }
    this.emitSession()
    this.armLoadTimeout()
    void this.openMpvIfNeeded()
  }

  private ensureMpvElement(): AuroraMpvElement {
    if (this.mpvElement) return this.mpvElement
    const element = document.createElement('mpv-video') as AuroraMpvElement
    element.className = 'mpv-video-surface'
    element.style.cssText = 'display:block;width:100%;height:100%;min-width:0;min-height:0;background:#000'
    const api = (window as Window & { _electronMpvVideo?: { supportsSharedTexture: boolean } })._electronMpvVideo
    element.setAttribute('render-mode', api?.supportsSharedTexture ? 'shared-texture' : 'webgl')
    element.setAttribute('volume', String(this.volume))
    element.addEventListener('mpv-state', this.onMpvState as EventListener)
    element.addEventListener('mpv-event', this.onMpvEvent as EventListener)
    element.addEventListener('mpv-error', this.onMpvError as EventListener)
    this.mpvElement = element
    return element
  }

  private async openMpvIfNeededInternal(epoch: number): Promise<void> {
    const plan = this.plan
    if (!plan || !this.usesMpv || this.session.phase === 'error') return

    // Removing a custom element starts an asynchronous native teardown. A new
    // element created before it finishes can race the old IPC session and leave
    // the next video attached to the stale player.
    try {
      await this.waitForMpvDestroy()
      // failPlayback bumps loadEpoch, so the epoch check also covers phase 'error'.
      if (epoch !== this.loadEpoch || this.plan !== plan) return
      const container = this.mpvAudio ? this.hiddenHost : this.container
      if (!container?.isConnected) {
        // Attach may still be settling; reopen as soon as the stage is bound.
        this.needsMpvOpen = true
        return
      }
      this.needsMpvOpen = false
      const player = this.ensureMpvElement()
      if (player.parentElement !== container) container.appendChild(player)
      if (this.loadedMpvSource === plan.url) return
      await player.open(plan.url)
      if (epoch !== this.loadEpoch || player !== this.mpvElement) return
      this.loadedMpvSource = plan.url
      await this.applyMpvControls()
    } catch (error) {
      const message = errorMessage(error)
      if (epoch !== this.loadEpoch) return
      if (isMpvAbortError(message)) {
        // Route remount / StrictMode tore the element down mid-open.
        // Stay in loading and reopen on a later tick; leave needsMpvOpen
        // false so the task finally does not immediately re-enter open.
        console.warn('[PlayerEngine] mpv open aborted during teardown, will retry', { url: plan.url, message })
        this.loadedMpvSource = ''
        const retryEpoch = this.loadEpoch
        window.setTimeout(() => {
          if (this.loadEpoch !== retryEpoch || this.session.phase === 'error') return
          this.needsMpvOpen = true
          const container = this.mpvAudio ? this.hiddenHost : this.container
          if (container?.isConnected) void this.openMpvIfNeeded()
        }, 50)
        return
      }
      console.error('[PlayerEngine] mpv open failed', { url: plan.url, error })
      this.failPlayback(message)
    }
  }

  private onMpvState = (event: CustomEvent<MpvVideoState>): void => {
    if (event.currentTarget !== this.mpvElement || !this.usesMpv) return
    const state = event.detail
    if (state.playerId !== this.mpvElement?.playerId) return
    if (Number.isFinite(state.duration) && state.duration > 0) this.session.duration = this.knownDuration || state.duration
    if (this.ended) return
    this.updateMpvPosition(state.time)
    // Only the pause property event acknowledges a play/pause command.
    if (state.fps > 0) this.ev.onFps?.(state.fps)
    this.updateBufferedSeconds()
    this.emitSessionThrottled()
  }

  private updateMpvPosition(rawTime: number): void {
    if (!this.seekingGesture && !this.seekCommandPending && performance.now() >= this.seekAcceptAfter && Number.isFinite(rawTime) && rawTime >= 0) {
      let acceptTime = this.seekTarget === null
      if (this.seekTarget !== null) {
        // IPC can still deliver one or more time-pos values from before the
        // seek. Keep the optimistic slider position until mpv's clock reaches
        // the requested timeline instead of briefly snapping back.
        const tolerance = Math.max(0.5, Math.min(1.5, this.speed * 0.5))
        if (Math.abs(rawTime - this.seekTarget) <= tolerance || (this.seekConfirmUntil > 0 && performance.now() >= this.seekConfirmUntil)) {
          this.seekTarget = null
          this.session.seeking = false
          this.seekAcceptAfter = 0
          this.seekConfirmUntil = 0
          acceptTime = true
        }
      }
      if (acceptTime) {
        const floorActive = this.seekDisplayFloor !== null && performance.now() < this.seekDisplayFloorUntil
        const displayedTime = floorActive && rawTime < this.seekDisplayFloor!
          ? this.seekDisplayFloor!
          : rawTime
        if (!floorActive || rawTime >= this.seekDisplayFloor!) {
          this.seekDisplayFloor = null
          this.seekDisplayFloorUntil = 0
        }
        this.session.position = displayedTime
        this.session.lastPositionKnown = displayedTime
      }
    }
  }

  private onMpvEvent = (event: CustomEvent<MpvEvent>): void => {
    if (event.currentTarget !== this.mpvElement || !this.usesMpv) return
    const detail = event.detail
    if (detail.playerId !== this.mpvElement?.playerId) return
    if (detail.error) { this.failPlayback(detail.error); return }
    // Do not clear mpvLoadTask on start-file/end-file: finishMpvLoad may be
    // mid-apply (tracks/resume seek/play) and isCurrent() would abort without
    // markLoaded, leaving the session stuck in loading until the 30s timeout.
    // stopBackends/load/failure paths already clear the task for real teardown.
    if (detail.type === 'file-loaded') { void this.finishMpvLoad(); return }
    if (detail.type !== 'property-change') return
    if (this.ended) return
    switch (detail.name) {
      case 'demuxer-cache-time': this.cacheEndTime = finiteOrZero(detail.data); this.updateBufferedSeconds(); break
      case 'demuxer-cache-duration': this.cacheDuration = finiteOrZero(detail.data); this.updateBufferedSeconds(); break
      case 'paused-for-cache': this.setBuffering(Boolean(detail.data)); break
      case 'pause':
        this.applyMpvPaused(Boolean(detail.data))
        break
      case 'eof-reached': if (detail.data) this.handleEnded(); break
      case 'speed': if (typeof detail.data === 'number' && Number.isFinite(detail.data) && detail.data > 0) this.speed = detail.data; break
      case 'mute': if (typeof detail.data === 'boolean') this.muted = detail.data; break
    }
    this.emitSessionThrottled()
  }

  private onMpvError = (event: CustomEvent<string>): void => {
    if (event.currentTarget !== this.mpvElement) return
    const message = event.detail || 'libmpv playback error'
    if (isMpvAbortError(message)) {
      this.loadedMpvSource = ''
      const retryEpoch = this.loadEpoch
      window.setTimeout(() => {
        if (this.loadEpoch !== retryEpoch || this.session.phase === 'error') return
        this.needsMpvOpen = true
        const container = this.mpvAudio ? this.hiddenHost : this.container
        if (container?.isConnected) void this.openMpvIfNeeded()
      }, 50)
      return
    }
    this.failPlayback(message)
  }

  private async finishMpvLoad(): Promise<void> {
    const player = this.mpvElement
    const epoch = this.loadEpoch
    if (!player || !this.usesMpv || this.session.loaded) return
    const playerId = player.playerId
    if (this.mpvLoadTask?.epoch === epoch && this.mpvLoadTask.playerId === playerId) return
    const task = { epoch, playerId }
    this.mpvLoadTask = task
    // A DOM element may reconnect with a different native player. Each awaited
    // IPC call must still belong to this file and this native session.
    const isCurrent = () => epoch === this.loadEpoch && player === this.mpvElement
      && player.playerId === playerId && this.mpvLoadTask === task
    try {
      await this.applyMpvControls()
      if (!isCurrent()) return
      await this.applySelectedTracks()
      if (!isCurrent()) return
      const duration = this.knownDuration || player.duration
      const resumePosition = duration > 0 && this.pendingResume >= duration - 0.5 ? 0 : this.pendingResume
      this.pendingResume = 0
      if (resumePosition > 0.5) {
        this.session.seeking = true
        this.seekTarget = resumePosition
        this.seekCommandPending = true
        try {
          await player.seek(resumePosition)
        } catch (seekError) {
          console.warn('[PlayerEngine] resume seek failed, starting at 0', seekError)
          this.seekTarget = null
          this.session.position = 0
          this.session.lastPositionKnown = 0
          this.session.seeking = false
        }
        if (!isCurrent()) return
        this.seekCommandPending = false
        this.seekAcceptAfter = performance.now() + 120
        this.seekConfirmUntil = performance.now() + 3000
      }
      await this.requestVideoPaused(false)
      if (!isCurrent()) return
      this.markLoaded()
    } catch (error) {
      const message = errorMessage(error)
      if (!isCurrent()) return
      if (isMpvAbortError(message)) {
        console.warn('[PlayerEngine] finishMpvLoad aborted during teardown, will retry', { message })
        this.loadedMpvSource = ''
        const retryEpoch = this.loadEpoch
        window.setTimeout(() => {
          if (this.loadEpoch !== retryEpoch || this.session.phase === 'error') return
          this.needsMpvOpen = true
          const container = this.mpvAudio ? this.hiddenHost : this.container
          if (container?.isConnected) void this.openMpvIfNeeded()
        }, 50)
        return
      }
      console.error('[PlayerEngine] finishMpvLoad failed', { error })
      this.failPlayback(message)
    }
  }

  private markLoaded(): void {
    const firstLoad = !this.session.loaded
    this.clearLoadTimeout()
    this.session.loaded = true
    this.backendBuffering = false
    this.clockStalled = false
    this.clockWatchPosition = this.session.position
    this.clockAdvancedAt = performance.now()
    this.session.buffering = false
    this.session.error = null
    this.session.phase = this.session.paused ? 'paused' : 'playing'
    if (this.knownDuration > 0) this.session.duration = this.knownDuration
    this.emitSession()
    if (firstLoad) this.ev.onLoaded?.()
  }

  private async applyMpvControls(): Promise<void> {
    const epoch = this.loadEpoch
    await this.waitForMpvDestroy()
    if (epoch !== this.loadEpoch) return
    const player = this.mpvElement
    if (!player) return
    await Promise.all([
      player.setVolume(this.volume),
      this.setMpvProperty('mute', this.muted ? 'yes' : 'no'),
      this.setMpvProperty('speed', String(this.speed))
    ])
  }

  private async waitForMpvDestroy(): Promise<void> {
    const destroyTask = this.mpvDestroyTask
    if (!destroyTask) return
    await destroyTask
    if (this.mpvDestroyTask === destroyTask) this.mpvDestroyTask = null
  }

  private async applySelectedTracks(): Promise<void> {
    await Promise.all([
      this.setMpvProperty('vid', this.mpvAudio ? 'no' : this.detectedTracks.video.length ? String(this.selectedVideoTrack + 1) : 'auto'),
      this.setMpvProperty('aid', this.detectedTracks.audio.length ? String(this.selectedAudioTrack + 1) : 'auto'),
      this.setMpvProperty('sid', this.selectedSubtitleTrack < 0 ? 'no' : String(this.selectedSubtitleTrack + 1))
    ])
  }

  private async setMpvProperty(name: MpvProperty, value: string): Promise<void> {
    const player = this.mpvElement
    const setter = player?.setProperty
    if (!player) return
    if (typeof setter !== 'function') throw new Error('The libmpv playback controls are unavailable')
    await setter.call(player, name, value)
  }

  private async loadTrackCatalog(mediaId: number): Promise<void> {
    const epoch = ++this.trackEpoch
    try {
      const value = await window.aurora.invoke(I.mediaTracks, mediaId)
      if (epoch !== this.trackEpoch || this.plan?.item?.id !== mediaId) return
      const raw = value as Partial<MediaTrackCatalog> | null
      this.detectedTracks = {
        video: Array.isArray(raw?.video) ? raw.video as TrackInfo[] : [],
        audio: Array.isArray(raw?.audio) ? raw.audio as TrackInfo[] : [],
        subtitles: Array.isArray(raw?.subtitles) ? raw.subtitles as TrackInfo[] : [],
        chapters: Array.isArray(raw?.chapters) ? raw.chapters as Chapter[] : [],
        width: Number(raw?.width) || 0, height: Number(raw?.height) || 0, fps: Number(raw?.fps) || 0,
        videoCodec: String(raw?.videoCodec ?? ''), videoProfile: String(raw?.videoProfile ?? ''),
        pixelFormat: String(raw?.pixelFormat ?? ''), colorSpace: String(raw?.colorSpace ?? ''),
        colorTransfer: String(raw?.colorTransfer ?? ''), colorPrimaries: String(raw?.colorPrimaries ?? ''),
        bitDepth: Number(raw?.bitDepth) || 0, hdrType: String(raw?.hdrType ?? '')
      }
      const defaultVideo = this.detectedTracks.video.findIndex((track) => track.default)
      const defaultAudio = this.detectedTracks.audio.findIndex((track) => track.default)
      this.selectedVideoTrack = defaultVideo >= 0 ? defaultVideo : 0
      this.selectedAudioTrack = defaultAudio >= 0 ? defaultAudio : 0
      this.ev.onTracks?.(this.detectedTracks)
      if (this.session.loaded) this.runCommand(() => this.applySelectedTracks())
    } catch {
      if (epoch === this.trackEpoch) this.ev.onTracks?.({ ...EMPTY_TRACKS })
    }
  }

  toggle(): void {
    if (!this.session.loaded) return
    if (this.ended) {
      this.seekWasPlaying = true
      this.seekingGesture = true
      this.seekTo(0)
      this.commitSeek()
      return
    }
    if (this.usesMpv) {
      const currentlyPaused = this.desiredPaused ?? this.session.paused
      this.runCommand(() => this.requestVideoPaused(!currentlyPaused))
    } else if (this.video) {
      this.runCommand(() => this.requestAudioPaused(!this.video!.paused))
    }
  }

  pause(): void {
    if (this.usesMpv) {
      this.runCommand(() => this.requestVideoPaused(true))
    }
    else this.runCommand(() => this.requestAudioPaused(true))
  }

  private runCommand(command: () => void | Promise<void>): void {
    const epoch = this.loadEpoch
    const onError = (error: unknown) => {
      if (epoch === this.loadEpoch && !this.disposed && !this.session.idle && this.session.phase !== 'error') {
        this.failPlayback(errorMessage(error))
      }
    }
    try { void Promise.resolve(command()).catch(onError) } catch (error) { onError(error) }
  }

  private async requestAudioPaused(paused: boolean): Promise<void> {
    const audio = this.video
    if (!audio) return
    const requestEpoch = ++this.playbackRequestEpoch
    this.desiredPaused = paused
    this.playbackConfirmUntil = performance.now() + 1500
    this.session.paused = paused
    this.session.phase = paused ? 'paused' : this.session.buffering ? 'buffering' : 'playing'
    this.updateWaitingTimeout()
    this.emitSession()
    try {
      if (paused) {
        audio.pause()
        if (requestEpoch === this.playbackRequestEpoch && audio === this.video) this.persistPlaybackProgress()
      }
      else await audio.play()
    } catch (error) {
      if (requestEpoch !== this.playbackRequestEpoch || audio !== this.video) return
      if (error instanceof DOMException && error.name === 'NotSupportedError') {
        this.fallbackToMpvAudio()
        return
      }
      this.desiredPaused = null
      this.playbackConfirmUntil = 0
      throw error
    }
  }

  private applyAudioPaused(paused: boolean): void {
    if (
      this.desiredPaused !== null &&
      paused !== this.desiredPaused &&
      performance.now() < this.playbackConfirmUntil
    ) return
    if (this.desiredPaused === paused || performance.now() >= this.playbackConfirmUntil) {
      this.desiredPaused = null
      this.playbackConfirmUntil = 0
    }
    this.session.paused = paused
    this.session.phase = paused ? 'paused' : this.session.buffering ? 'buffering' : 'playing'
    this.updateWaitingTimeout()
    if (paused) this.persistPlaybackProgress()
  }

  private async requestVideoPaused(paused: boolean): Promise<void> {
    const player = this.mpvElement
    if (!player) return
    const requestEpoch = ++this.playbackRequestEpoch
    this.desiredPaused = paused
    this.playbackConfirmUntil = performance.now() + 1500
    this.session.paused = paused
    this.session.phase = paused ? 'paused' : this.session.buffering ? 'buffering' : 'playing'
    this.updateWaitingTimeout()
    this.emitSession()
    try {
      if (paused) {
        await player.pause()
        if (requestEpoch === this.playbackRequestEpoch && player === this.mpvElement) this.persistPlaybackProgress()
      }
      else await player.play()
    } catch (error) {
      if (requestEpoch !== this.playbackRequestEpoch || player !== this.mpvElement) return
      this.desiredPaused = null
      this.playbackConfirmUntil = 0
      throw error
    }
  }

  private applyMpvPaused(paused: boolean): void {
    if (
      this.desiredPaused !== null &&
      paused !== this.desiredPaused &&
      performance.now() < this.playbackConfirmUntil
    ) return
    if (this.desiredPaused === paused || performance.now() >= this.playbackConfirmUntil) {
      this.desiredPaused = null
      this.playbackConfirmUntil = 0
    }
    this.session.paused = paused
    this.session.phase = paused ? 'paused' : this.session.buffering ? 'buffering' : 'playing'
    this.updateWaitingTimeout()
    if (paused) this.persistPlaybackProgress()
  }

seekTo(value: number): void {
    if (!this.session.loaded || !Number.isFinite(value)) return
    const duration = this.knownDuration || this.session.duration
    if (!(duration > 0)) return
    const target = Math.max(0, Math.min(value, duration))
    this.ended = false
    this.session.position = target
    this.session.lastPositionKnown = target
    this.session.seeking = true
    this.seekTarget = target
    this.seekDisplayFloor = target
    this.seekDisplayFloorUntil = performance.now() + (this.networkMedia ? 8000 : 5000)
    this.emitSession()
    if (this.seekingGesture) return
    if (this.usesMpv) void this.issueMpvSeek(target, false)
    else this.runCommand(() => this.seekAudio(target, false))
  }

  beginSeek(): void {
    if (!this.session.loaded || this.seekingGesture || !(this.session.duration > 0)) return
    this.seekWasPlaying = !this.session.paused
    this.seekingGesture = true
    this.seekTarget = this.session.position
    if (this.seekWasPlaying) this.pause()
  }

  commitSeek(): void {
    if (!this.session.loaded || this.seekTarget === null) return
    const target = this.seekTarget
    const resume = this.seekWasPlaying
    this.seekWasPlaying = false
    if (this.usesMpv) {
      void this.issueMpvSeek(target, resume)
    } else {
      this.seekingGesture = false
      this.runCommand(() => this.seekAudio(target, resume))
    }
  }

  private async seekAudio(target: number, resume: boolean): Promise<void> {
    const audio = this.video
    if (!audio) return
    audio.currentTime = target
    // Seeking to the current position may not dispatch a seeked event.
    if (!audio.seeking) {
      this.seekTarget = null
      this.session.seeking = false
      this.updateAudioPosition(audio)
      this.emitSession()
    }
    if (resume) await this.requestAudioPaused(false)
  }

  private async issueMpvSeek(target: number, resume: boolean): Promise<void> {
    const player = this.mpvElement
    if (!player) {
      this.seekingGesture = false
      this.seekCommandPending = false
      return
    }
    const requestEpoch = ++this.seekRequestEpoch
    this.seekCommandPending = true
    try {
await player.seek(target)
      if (requestEpoch !== this.seekRequestEpoch || player !== this.mpvElement) return
      this.seekCommandPending = false
      this.seekingGesture = false
      // Let already queued time-pos notifications drain before accepting the
      // first clock value for the new timeline.
      this.seekAcceptAfter = performance.now() + 120
      this.seekConfirmUntil = performance.now() + 3000
      this.seekDisplayFloorUntil = performance.now() + (this.networkMedia ? 8000 : 5000)
      if (resume) await this.requestVideoPaused(false)
    } catch (error) {
      if (requestEpoch !== this.seekRequestEpoch) return
      this.seekCommandPending = false
      this.seekingGesture = false
      this.seekAcceptAfter = 0
      this.failPlayback(errorMessage(error))
    }
  }

  setKnownDuration(duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) return
    this.knownDuration = duration
    if (Math.abs(this.session.duration - duration) >= 0.1) { this.session.duration = duration; this.emitSession() }
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return
    this.volume = normalizeVolume(value)
    if (this.volume > 0 && this.muted) this.muted = false
    if (this.usesMpv) {
      this.runCommand(() => this.mpvElement?.setVolume(this.volume))
      this.runCommand(() => this.setMpvProperty('mute', this.muted ? 'yes' : 'no'))
    } else if (this.video) {
      this.video.volume = this.volume / 100
      this.video.muted = this.muted
    }
    this.emitSession()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.usesMpv) this.runCommand(() => this.setMpvProperty('mute', muted ? 'yes' : 'no'))
    else if (this.video) this.video.muted = muted
    this.emitSession()
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return
    this.speed = normalizeSpeed(speed)
    if (this.usesMpv) this.runCommand(() => this.setMpvProperty('speed', String(this.speed)))
    else if (this.video) this.video.playbackRate = this.speed
    this.emitSession()
  }

  setRepeatMode(mode: 'none' | 'all' | 'one'): void {
    this.session.repeatMode = mode
    // The queue owns repetition so an EOF cannot race a second backend loop.
    this.emitSession()
  }

  setShuffle(shuffle: boolean): void { this.session.shuffle = shuffle; this.emitSession() }

  selectVideoTrack(index: number): void {
    if (!Number.isFinite(index) || !this.detectedTracks.video.length) return
    this.selectedVideoTrack = clampTrackIndex(index, this.detectedTracks.video.length)
    this.runCommand(() => this.setMpvProperty('vid', String(this.selectedVideoTrack + 1)))
  }

  selectAudioTrack(index: number): void {
    if (!Number.isFinite(index) || !this.detectedTracks.audio.length) return
    this.selectedAudioTrack = clampTrackIndex(index, this.detectedTracks.audio.length)
    this.runCommand(() => this.setMpvProperty('aid', String(this.selectedAudioTrack + 1)))
  }

  selectSubtitleTrack(index: number): void {
    if (!Number.isFinite(index) || (index >= 0 && !this.detectedTracks.subtitles.length)) return
    this.selectedSubtitleTrack = index < 0 ? -1 : clampTrackIndex(index, this.detectedTracks.subtitles.length)
    this.runCommand(() => this.setMpvProperty('sid', this.selectedSubtitleTrack < 0 ? 'no' : String(this.selectedSubtitleTrack + 1)))
  }

  position(): number {
    if (this.seekingGesture || this.session.seeking) return this.session.position
    if (this.session.kind === 'audio' && this.video && Number.isFinite(this.video.currentTime)) return this.video.currentTime
    return this.session.position
  }

private ensureAudioGraph(): void {
    const audio = this.video
    if (!audio) return
    if (this.sourceNode) {
      if (this.ctx?.state === 'suspended') this.runCommand(() => this.ctx!.resume())
      return
    }
    try {
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AudioContextClass()
      this.runCommand(() => this.ctx!.resume().catch(() => void 0))
      if (this.ctx.state === 'suspended') this.runCommand(() => this.ctx!.resume())
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.minDecibels = -90
      this.analyser.maxDecibels = -18
      this.analyser.smoothingTimeConstant = 0.34
      this.analyser.connect(this.ctx.destination)
      this.sourceNode = this.ctx.createMediaElementSource(audio)
      this.sourceNode.connect(this.analyser)
    } catch (error) {
      // Once a media element has a source node, closing its context silences
      // that element. Preserve an audible path if only the analyser failed.
      if (this.sourceNode && this.ctx) {
        try {
          this.sourceNode.disconnect()
          this.analyser?.disconnect()
          this.analyser = null
          this.sourceNode.connect(this.ctx.destination)
        } catch { this.failPlayback(errorMessage(error)) }
      } else this.destroyAudioGraph()
    }
  }

  private destroyAudioGraph(): void {
    try { this.sourceNode?.disconnect(); this.analyser?.disconnect() } catch { void 0 }
    const context = this.ctx
    this.sourceNode = null
    this.analyser = null
    this.ctx = null
    this.spectrum.fill(0)
    this.emitSpectrum(new Float32Array(this.spectrum))
    if (context && context.state !== 'closed') void context.close().catch(() => void 0)
  }

  private loop = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    this.frameCount += 1
    if (now - this.lastFrameAt >= 1000) {
      const fps = this.lastFrameAt ? (this.frameCount * 1000) / (now - this.lastFrameAt) : 0
      this.lastFrameAt = now
      this.frameCount = 0
      if (this.session.kind === 'audio') this.ev.onFps?.(fps)
    }
    if (this.analyser && now - this.lastSpectrumAt >= 32) {
      this.lastSpectrumAt = now
      const raw = this.frequencyData
      this.analyser.getByteFrequencyData(raw)
      for (let i = 0; i < this.spectrum.length; i++) {
        const start = Math.floor((i / this.spectrum.length) * raw.length)
        const end = Math.max(start + 1, Math.floor(((i + 1) / this.spectrum.length) * raw.length))
        let sumSquares = 0
        for (let bin = start; bin < end; bin++) sumSquares += raw[bin] * raw[bin]
        const rms = Math.sqrt(sumSquares / Math.max(1, end - start)) / 255
        const gated = Math.max(0, (rms - 0.018) / 0.982)
        this.spectrum[i] = Math.min(1, Math.pow(gated, 0.72))
      }
      this.emitSpectrum(new Float32Array(this.spectrum))
    }
    if (this.session.kind === 'audio' && this.video && !this.video.paused) {
      this.updateAudioPosition(this.video)
      if (now - this.lastSessionEmitAt >= 250) { this.lastSessionEmitAt = now; this.emitSession() }
    }
    if (this.usesMpv && this.mpvElement && this.seekTarget !== null) {
      this.updateMpvPosition(this.mpvElement.currentTime)
      this.emitSessionThrottled()
    }
    if (this.networkMedia && now - this.lastNetworkUpdateAt >= 1000) {
      this.lastNetworkUpdateAt = now
      this.updateBufferedSeconds()
      this.requestNetworkStats()
      this.emitSession()
    }
    this.updateVideoClockStall(now)
    if (!this.session.paused && now - this.lastSyncAt >= SESSION_SYNC_INTERVAL) {
      this.lastSyncAt = now
      this.syncToMain()
    }
  }

  private updateAudioPosition(audio: HTMLAudioElement): void {
    if (!this.seekingGesture && !this.session.seeking && !this.ended && Number.isFinite(audio.currentTime)) {
      this.session.position = audio.currentTime
      this.session.lastPositionKnown = audio.currentTime
    }
    if (this.knownDuration > 0) this.session.duration = this.knownDuration
    else if (Number.isFinite(audio.duration) && audio.duration > 0) this.session.duration = audio.duration
    if (this.networkMedia) {
      let ahead = 0
      for (let i = 0; i < audio.buffered.length; i++) {
        if (audio.currentTime >= audio.buffered.start(i) - 0.25 && audio.currentTime <= audio.buffered.end(i) + 0.25) {
          ahead = Math.max(0, audio.buffered.end(i) - audio.currentTime)
          break
        }
      }
      this.session.bufferedSeconds = ahead
    }
  }

  private updateBufferedSeconds(): void {
    if (!this.networkMedia) { this.session.bufferedSeconds = 0; return }
    if (this.session.kind === 'audio' && this.video) { this.updateAudioPosition(this.video); return }
    const aheadFromEnd = this.cacheEndTime > 0 ? Math.max(0, this.cacheEndTime - this.session.position) : 0
    this.session.bufferedSeconds = aheadFromEnd || Math.max(0, this.cacheDuration)
  }

  private requestNetworkStats(): void {
    if (!this.networkMedia || this.networkStatsPending) return
    const epoch = this.networkStatsEpoch
    this.networkStatsPending = true
    void window.aurora.invoke(I.networkStats).then((value) => {
      if (epoch !== this.networkStatsEpoch || !this.networkMedia) return
      const bytes = Number(value)
      const sampledAt = performance.now()
      let bytesPerSecond = 0
      if (Number.isFinite(bytes) && bytes >= this.networkSampleBytes && this.networkSampleAt > 0) {
        const seconds = (sampledAt - this.networkSampleAt) / 1000
        if (seconds > 0) bytesPerSecond = (bytes - this.networkSampleBytes) / seconds
      }
      if (Number.isFinite(bytes) && bytes >= 0) { this.networkSampleBytes = bytes; this.networkSampleAt = sampledAt }
      this.session.networkSpeed = Math.max(0, bytesPerSecond)
      this.emitSession()
    }).catch(() => {
      if (epoch === this.networkStatsEpoch) this.session.networkSpeed = 0
    }).finally(() => {
      if (epoch === this.networkStatsEpoch) this.networkStatsPending = false
    })
  }

  private setBuffering(buffering: boolean): void {
    this.backendBuffering = buffering
    this.applyBufferingState()
  }

private updateVideoClockStall(now: number): void {
    const shouldWatch = this.usesMpv
      && this.session.loaded
      && !this.session.paused
      && !this.session.seeking
      && this.session.phase !== 'error'
      && (this.session.duration <= 0 || this.session.duration - this.session.position > 0.75)
    if (!shouldWatch) {
      this.clockAdvancedAt = now
      this.clockWatchPosition = this.session.position
      if (this.clockStalled) { this.clockStalled = false; this.applyBufferingState() }
      return
    }
    if (Math.abs(this.session.position - this.clockWatchPosition) >= 0.04) {
      this.clockWatchPosition = this.session.position
      this.clockAdvancedAt = now
      if (this.clockStalled) { this.clockStalled = false; this.applyBufferingState() }
      return
    }
    const stallThreshold = this.networkMedia ? 3000 : 1200
    if (!this.clockStalled && now - this.clockAdvancedAt >= stallThreshold) {
      this.clockStalled = true
      this.applyBufferingState()
    }
  }

  private applyBufferingState(): void {
    const buffering = this.backendBuffering || this.clockStalled
    if (this.session.phase === 'error' || this.session.idle || this.ended) return
    if (this.session.buffering === buffering) { this.updateWaitingTimeout(); return }
    this.session.buffering = buffering
    this.session.phase = !this.session.loaded ? 'loading' : buffering && !this.session.paused ? 'buffering' : this.session.paused ? 'paused' : 'playing'
    this.updateWaitingTimeout()
    this.emitSession()
    this.ev.onBuffering?.(buffering)
  }

  private handleEnded(): void {
    if (this.session.idle || this.session.phase === 'error' || !this.session.loaded || this.ended || this.seekingGesture) return
    this.ended = true
    this.clearLoadTimeout()
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
    this.seekRequestEpoch += 1
    this.seekTarget = null
    this.seekCommandPending = false
    this.seekAcceptAfter = 0
    this.seekConfirmUntil = 0
    this.seekDisplayFloor = null
    this.seekWasPlaying = false
    this.backendBuffering = false
    this.clockStalled = false
    this.session.buffering = false
    this.session.seeking = false
    this.session.position = this.session.duration || this.session.position
    this.session.lastPositionKnown = this.session.position
    this.session.paused = true
    this.session.phase = 'paused'
    this.emitSession()
    this.persistPlaybackProgress()
    this.ev.onBuffering?.(false)
    this.ev.onEnded?.()
  }

  private failPlayback(message: string): void {
    if (this.session.idle || this.session.phase === 'error') return
    const playbackError = message || 'Playback error'
    console.error('[PlayerEngine] playback failed', { message: playbackError, mediaId: this.session.mediaId, kind: this.session.kind })
    this.clearLoadTimeout()
    // A failed open/decode can already own a native mpv session, GPU resources
    // and network cache. Invalidate every in-flight continuation before
    // releasing the backends so none of them can resurrect the failed player.
    this.loadEpoch += 1
    this.trackEpoch += 1
    this.seekRequestEpoch += 1
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
    this.loadedMpvSource = ''
    this.needsMpvOpen = false
    this.pendingResume = 0
    this.seekTarget = null
    this.seekWasPlaying = false
    this.seekingGesture = false
    this.seekCommandPending = false
    this.seekAcceptAfter = 0
    this.seekConfirmUntil = 0
    this.seekDisplayFloor = null
    this.seekDisplayFloorUntil = 0
    this.networkMedia = false
    this.backendBuffering = false
    this.clockStalled = false
    this.clockWatchPosition = 0
    this.clockAdvancedAt = 0
    this.resetNetworkStats()
    this.stopBackends('failure')
    this.detectedTracks = { ...EMPTY_TRACKS }
    this.session.phase = 'error'
    this.session.error = playbackError
    this.session.loaded = false
    this.session.paused = true
    this.session.buffering = false
    this.session.bufferedSeconds = 0
    this.session.networkSpeed = 0
    this.session.seeking = false
    this.ev.onTracks?.({ ...EMPTY_TRACKS })
    this.emitSession()
    this.ev.onBuffering?.(false)
    this.ev.onPlaybackError?.(this.session.error)
  }

  private armLoadTimeout(): void {
    if (this.loadTimeout) return
    this.loadTimeout = window.setTimeout(() => {
      this.loadTimeout = 0
      if (!this.session.idle && this.session.phase !== 'error' && (!this.session.loaded || (this.session.buffering && !this.session.paused))) {
        this.failPlayback('Media loading timed out')
      }
    }, MEDIA_LOAD_TIMEOUT)
  }

  private updateWaitingTimeout(): void {
    if (!this.session.idle && !this.ended && this.session.phase !== 'error' && (!this.session.loaded || (this.session.buffering && !this.session.paused))) this.armLoadTimeout()
    else this.clearLoadTimeout()
  }

  private clearLoadTimeout(): void { window.clearTimeout(this.loadTimeout); this.loadTimeout = 0 }

  private emitSessionThrottled(): void {
    const now = performance.now()
    if (now - this.lastSessionEmitAt < 100) return
    this.lastSessionEmitAt = now
    this.emitSession()
  }

  private emitSession(): void {
    this.ev.onSession?.({ ...this.session, volume: this.volume, muted: this.muted, speed: this.speed })
  }

  private syncToMain(): void {
    if (this.session.seeking || this.seekingGesture) return
    try {
      window.aurora.persistSession({ ...this.session, volume: this.volume, muted: this.muted, speed: this.speed })
    } catch (error) {
      console.warn('[PlayerEngine] Failed to sync playback progress', error)
    }
  }

  persistPlaybackProgress(): void {
    if (this.session.idle || this.session.mediaId == null || this.session.seeking || this.seekingGesture) return
    if (this.session.kind === 'audio' && this.video) this.updateAudioPosition(this.video)
    try {
      window.aurora.persistSession({ ...this.session, volume: this.volume, muted: this.muted, speed: this.speed })
    } catch (error) { console.warn('[PlayerEngine] Failed to persist playback progress', error) }
  }

  private resetNetworkStats(): void {
    this.networkStatsEpoch += 1
    this.networkStatsPending = false
    this.networkSampleAt = 0
    this.networkSampleBytes = 0
    this.lastNetworkUpdateAt = 0
    this.cacheEndTime = 0
    this.cacheDuration = 0
  }

  private stopBackends(reason: 'replace' | 'failure' | 'stop'): void {
    this.mpvLoadTask = null
    // Abandon any in-flight open so its finally cannot reopen after teardown.
    this.mpvOpenTask = null
    this.mpvOpenEpoch = -1
    this.audioEvents?.abort()
    this.audioEvents = null
    this.destroyAudioGraph()
    if (this.video) {
      this.video.pause()
      this.video.removeAttribute('src')
      this.video.load()
      this.video.remove()
      this.video = null
    }
    if (this.mpvElement) {
      const player = this.mpvElement
      this.mpvElement = null
      player.removeEventListener('mpv-state', this.onMpvState as EventListener)
      player.removeEventListener('mpv-event', this.onMpvEvent as EventListener)
      player.removeEventListener('mpv-error', this.onMpvError as EventListener)
      const previousDestroyTask = this.mpvDestroyTask
      const currentDestroyTask = (previousDestroyTask ?? Promise.resolve())
        .catch(() => void 0)
        .then(() => player.destroy())
        .catch((error) => {
          console.error('[PlayerEngine] Failed to destroy mpv backend', { reason, error })
        })
      this.mpvDestroyTask = currentDestroyTask
      void currentDestroyTask.then(() => {
        if (this.mpvDestroyTask === currentDestroyTask) this.mpvDestroyTask = null
      })
      player.remove()
    }
  }

  stop(): void {
    this.persistPlaybackProgress()
    this.loadEpoch += 1
    this.trackEpoch += 1
    this.clearLoadTimeout()
    this.stopBackends('stop')
    this.container = null
    this.plan = null
    this.knownDuration = 0
    this.pendingResume = 0
    this.loadedMpvSource = ''
    this.needsMpvOpen = false
    this.seekingGesture = false
    this.seekTarget = null
    this.seekWasPlaying = false
    this.seekRequestEpoch += 1
    this.seekCommandPending = false
    this.seekAcceptAfter = 0
    this.seekConfirmUntil = 0
    this.seekDisplayFloor = null
    this.seekDisplayFloorUntil = 0
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
    this.ended = false
    this.networkMedia = false
    this.backendBuffering = false
    this.clockStalled = false
    this.clockWatchPosition = 0
    this.clockAdvancedAt = 0
    this.resetNetworkStats()
    this.detectedTracks = { ...EMPTY_TRACKS }
    this.session = {
      ...this.session, phase: 'idle', idle: true, loaded: false, mediaId: null,
      position: 0, duration: 0, paused: true, buffering: false,
      bufferedSeconds: 0, networkSpeed: 0, seeking: false, error: null, lastPositionKnown: 0
    }
    this.emitSession()
  }
}

function clampTrackIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(length - 1, Math.floor(index)))
}

function finiteOrZero(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function normalizeVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 80
}

function normalizeSpeed(value: number): number {
  return Number.isFinite(value) ? Math.max(0.25, Math.min(4, value)) : 1
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMpvAbortError(message: string): boolean {
  return /destroyed during open|Player is disconnected|is disconnected/i.test(message)
}
