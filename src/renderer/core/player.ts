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
  onSpectrum?: (samples: Float32Array) => void
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
 * Audio uses one HTMLAudioElement so Web Audio can feed the visualizer. Video
 * uses one libmpv instance for demuxing, decoding, audio, subtitles, caching,
 * seeking and the playback clock. A video must never create a companion audio
 * element or a second FFmpeg frame stream.
 */
export class PlayerEngine {
  /** Audio-only element. Video pixels and sound are owned by mpvElement. */
  video: HTMLAudioElement | null = null
  ev: EngineEvents = {}

  private mpvElement: AuroraMpvElement | null = null
  private container: HTMLElement | null = null
  private readonly hiddenHost: HTMLDivElement
  private plan: PlayPlan | null = null
  private disposed = false
  private loadEpoch = 0
  private trackEpoch = 0
  private loadTimeout = 0
  private knownDuration = 0
  private pendingResume = 0
  private loadedMpvSource = ''
  private seekTarget: number | null = null
  private seekWasPlaying = false
  private seekingGesture = false
  private seekRequestEpoch = 0
  private seekCommandPending = false
  private seekAcceptAfter = 0
  private seekDisplayFloor: number | null = null
  private seekDisplayFloorUntil = 0
  private playbackRequestEpoch = 0
  private desiredPaused: boolean | null = null
  private playbackConfirmUntil = 0
  private selectedVideoTrack = 0
  private selectedAudioTrack = 0
  private selectedSubtitleTrack = -1
  private detectedTracks: MediaTrackCatalog = { ...EMPTY_TRACKS }

  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null
  private spectrum = new Float32Array(128)
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
    document.body.appendChild(this.hiddenHost)
    this.raf = requestAnimationFrame(this.loop)
  }

  attach(container: HTMLElement, muted: boolean, volume: number, speed: number): void {
    this.container = container
    this.muted = muted
    this.volume = Math.max(0, Math.min(100, Math.round(volume)))
    this.speed = speed
    if (this.session.kind !== 'video' || !this.plan) return
    const player = this.ensureMpvElement()
    if (player.parentElement !== container) container.appendChild(player)
    void this.applyMpvControls()
    void this.openMpvIfNeeded()
  }

  detach(): void {
    // Reparenting a custom element disconnects it and destroys its native mpv
    // session. The player route calls stop() before the stage is unmounted.
    this.container = null
  }

  load(plan: PlayPlan, volume: number, muted: boolean, speed: number): void {
    const epoch = ++this.loadEpoch
    this.stopBackends()
    this.plan = plan
    this.volume = Math.max(0, Math.min(100, Math.round(volume)))
    this.muted = muted
    this.speed = speed
    this.knownDuration = Number.isFinite(plan.item?.duration) && (plan.item?.duration ?? 0) > 0 ? plan.item!.duration : 0
    this.pendingResume = Math.max(0, plan.resumePosition ?? 0)
    this.loadedMpvSource = ''
    this.seekTarget = null
    this.seekWasPlaying = false
    this.seekingGesture = false
    this.seekRequestEpoch += 1
    this.seekCommandPending = false
    this.seekAcceptAfter = 0
    this.seekDisplayFloor = null
    this.seekDisplayFloorUntil = 0
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
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
    this.armLoadTimeout()

    if (plan.kind === 'audio') {
      this.loadAudio(plan, epoch)
    } else if (plan.kind === 'video') {
      if (plan.item?.id != null) void this.loadTrackCatalog(plan.item.id)
      if (this.container) {
        const player = this.ensureMpvElement()
        if (player.parentElement !== this.container) this.container.appendChild(player)
        void this.openMpvIfNeeded()
      }
    }
  }

  private loadAudio(plan: PlayPlan, epoch: number): void {
    const audio = document.createElement('audio')
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'
    audio.volume = this.volume / 100
    audio.muted = this.muted
    audio.playbackRate = this.speed
    audio.loop = this.session.repeatMode === 'one'
    audio.addEventListener('loadedmetadata', () => {
      if (epoch !== this.loadEpoch || this.video !== audio) return
      const nativeDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
      this.session.duration = this.knownDuration || nativeDuration || this.session.duration
      if (this.pendingResume > 0.5 && this.pendingResume < this.session.duration - 0.5) audio.currentTime = this.pendingResume
      this.markLoaded()
    })
    audio.addEventListener('playing', () => {
      if (epoch !== this.loadEpoch) return
      this.session.phase = 'playing'
      this.session.paused = false
      this.setBuffering(false)
      this.ensureAudioGraph()
      this.emitSession()
    })
    audio.addEventListener('pause', () => {
      if (epoch !== this.loadEpoch || this.session.idle || this.session.phase === 'error') return
      this.updateAudioPosition(audio)
      this.session.phase = 'paused'
      this.session.paused = true
      this.emitSession()
      this.persistPlaybackProgress()
    })
    audio.addEventListener('waiting', () => this.setBuffering(true))
    audio.addEventListener('canplay', () => this.setBuffering(false))
    audio.addEventListener('seeking', () => { this.session.seeking = true; this.emitSession() })
    audio.addEventListener('seeked', () => {
      this.session.seeking = false
      this.updateAudioPosition(audio)
      this.emitSession()
    })
    audio.addEventListener('ended', () => this.handleEnded())
    audio.addEventListener('error', () => {
      const code = audio.error?.code
      this.failPlayback(code === 2 ? 'Network error while loading media' : code === 3 ? 'Could not decode this media' : code === 4 ? 'This media is not supported' : 'Playback error')
    })
    this.hiddenHost.appendChild(audio)
    this.video = audio
    audio.src = plan.url
    void audio.play().catch(() => void 0)
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

  private async openMpvIfNeeded(): Promise<void> {
    const player = this.mpvElement
    const plan = this.plan
    const epoch = this.loadEpoch
    if (!player || !plan || plan.kind !== 'video' || this.loadedMpvSource === plan.url) return
    this.loadedMpvSource = plan.url
    try {
      await player.open(plan.url)
      if (epoch !== this.loadEpoch || player !== this.mpvElement) return
      await this.applyMpvControls()
    } catch (error) {
      if (epoch === this.loadEpoch) this.failPlayback(error instanceof Error ? error.message : String(error))
    }
  }

  private onMpvState = (event: CustomEvent<MpvVideoState>): void => {
    if (event.currentTarget !== this.mpvElement || this.session.kind !== 'video') return
    const state = event.detail
    if (!this.seekingGesture && !this.seekCommandPending && performance.now() >= this.seekAcceptAfter && Number.isFinite(state.time) && state.time >= 0) {
      const rawTime = state.time
      let acceptTime = this.seekTarget === null
      if (this.seekTarget !== null) {
        // IPC can still deliver one or more time-pos values from before the
        // seek. Keep the optimistic slider position until mpv's clock reaches
        // the requested timeline instead of briefly snapping back.
        const tolerance = Math.max(0.75, Math.min(3, this.speed * 0.75))
        if (Math.abs(rawTime - this.seekTarget) <= tolerance) {
          this.seekTarget = null
          this.session.seeking = false
          this.seekAcceptAfter = 0
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
    if (Number.isFinite(state.duration) && state.duration > 0) this.session.duration = this.knownDuration || state.duration
    // Playing/Paused is intentionally not read from this aggregate snapshot.
    // The same pause property is dispatched separately just before mpv-state;
    // consuming both sources allows an older snapshot to overwrite a newer
    // play/pause command. onMpvEvent is the single source of truth.
    if (state.status === 'Ended') this.handleEnded()
    if (state.fps > 0) this.ev.onFps?.(state.fps)
    this.updateBufferedSeconds()
    this.emitSessionThrottled()
  }

  private onMpvEvent = (event: CustomEvent<MpvEvent>): void => {
    if (event.currentTarget !== this.mpvElement || this.session.kind !== 'video') return
    const detail = event.detail
    if (detail.error) { this.failPlayback(detail.error); return }
    if (detail.type === 'file-loaded') { void this.finishMpvLoad(); return }
    if (detail.type !== 'property-change') return
    switch (detail.name) {
      case 'demuxer-cache-time': this.cacheEndTime = finiteOrZero(detail.data); this.updateBufferedSeconds(); break
      case 'demuxer-cache-duration': this.cacheDuration = finiteOrZero(detail.data); this.updateBufferedSeconds(); break
      case 'paused-for-cache': this.setBuffering(Boolean(detail.data)); break
      case 'pause':
        this.applyMpvPaused(Boolean(detail.data))
        break
      case 'eof-reached': if (detail.data) this.handleEnded(); break
      case 'speed': if (typeof detail.data === 'number') this.speed = detail.data; break
      case 'mute': if (typeof detail.data === 'boolean') this.muted = detail.data; break
    }
    this.emitSessionThrottled()
  }

  private onMpvError = (event: CustomEvent<string>): void => {
    if (event.currentTarget === this.mpvElement) this.failPlayback(event.detail || 'libmpv playback error')
  }

  private async finishMpvLoad(): Promise<void> {
    const player = this.mpvElement
    const epoch = this.loadEpoch
    if (!player || this.session.kind !== 'video') return
    try {
      await this.applyMpvControls()
      await this.applySelectedTracks()
      if (this.pendingResume > 0.5) {
        this.session.seeking = true
        this.seekTarget = this.pendingResume
        await player.seek(this.pendingResume)
      }
      await this.requestVideoPaused(false)
      if (epoch !== this.loadEpoch) return
      this.markLoaded()
    } catch (error) {
      if (epoch === this.loadEpoch) this.failPlayback(error instanceof Error ? error.message : String(error))
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
    if (this.knownDuration > 0) this.session.duration = this.knownDuration
    this.emitSession()
    if (firstLoad) this.ev.onLoaded?.()
  }

  private async applyMpvControls(): Promise<void> {
    const player = this.mpvElement
    if (!player) return
    await Promise.all([
      player.setVolume(this.volume),
      this.setMpvProperty('mute', this.muted ? 'yes' : 'no'),
      this.setMpvProperty('speed', String(this.speed))
    ])
  }

  private async applySelectedTracks(): Promise<void> {
    await Promise.all([
      this.setMpvProperty('vid', this.detectedTracks.video.length ? String(this.selectedVideoTrack + 1) : 'auto'),
      this.setMpvProperty('aid', this.detectedTracks.audio.length ? String(this.selectedAudioTrack + 1) : 'auto'),
      this.setMpvProperty('sid', this.selectedSubtitleTrack < 0 ? 'no' : String(this.selectedSubtitleTrack + 1))
    ])
  }

  private async setMpvProperty(name: MpvProperty, value: string): Promise<void> {
    const player = this.mpvElement
    const setter = player?.setProperty
    if (!player || typeof setter !== 'function') return
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
      if (this.session.loaded) await this.applySelectedTracks()
    } catch {
      if (epoch === this.trackEpoch) this.ev.onTracks?.({ ...EMPTY_TRACKS })
    }
  }

  toggle(): void {
    if (!this.session.loaded) return
    if (this.session.kind === 'video') {
      const currentlyPaused = this.desiredPaused ?? this.session.paused
      void this.requestVideoPaused(!currentlyPaused).catch((error) => this.failPlayback(error instanceof Error ? error.message : String(error)))
    } else if (this.video) {
      if (this.video.paused) void this.video.play().catch(() => void 0)
      else this.video.pause()
    }
  }

  pause(): void {
    if (this.session.kind === 'video') {
      void this.requestVideoPaused(true).catch((error) => this.failPlayback(error instanceof Error ? error.message : String(error)))
    }
    else this.video?.pause()
  }

  private async requestVideoPaused(paused: boolean): Promise<void> {
    const player = this.mpvElement
    if (!player) return
    const requestEpoch = ++this.playbackRequestEpoch
    this.desiredPaused = paused
    this.playbackConfirmUntil = performance.now() + 1500
    this.session.paused = paused
    this.session.phase = paused ? 'paused' : this.session.buffering ? 'buffering' : 'playing'
    this.emitSession()
    try {
      if (paused) {
        await player.pause()
        this.persistPlaybackProgress()
      }
      else await player.play()
    } catch (error) {
      if (requestEpoch === this.playbackRequestEpoch) {
        this.desiredPaused = null
        this.playbackConfirmUntil = 0
      }
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
    if (paused) this.persistPlaybackProgress()
  }

  seekTo(value: number): void {
    const duration = this.knownDuration || this.session.duration
    if (!(duration > 0)) return
    const target = Math.max(0, Math.min(value, duration))
    this.session.position = target
    this.session.lastPositionKnown = target
    this.session.seeking = true
    this.seekTarget = target
    this.seekDisplayFloor = target
    this.seekDisplayFloorUntil = performance.now() + 3000
    this.emitSession()
    if (this.seekingGesture) return
    if (this.session.kind === 'video') void this.issueMpvSeek(target, false)
    else if (this.video) this.video.currentTime = target
  }

  beginSeek(): void {
    if (!this.session.loaded) return
    this.seekWasPlaying = !this.session.paused
    this.seekingGesture = true
    this.seekTarget = this.session.position
    if (this.seekWasPlaying) this.pause()
  }

  commitSeek(): void {
    if (this.seekTarget === null) return
    const target = this.seekTarget
    const resume = this.seekWasPlaying
    this.seekWasPlaying = false
    if (this.session.kind === 'video') {
      void this.issueMpvSeek(target, resume)
    } else if (this.video) {
      this.seekingGesture = false
      this.video.currentTime = target
      if (resume) void this.video.play().catch(() => void 0)
    }
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
      if (resume) await this.requestVideoPaused(false)
    } catch (error) {
      if (requestEpoch !== this.seekRequestEpoch) return
      this.seekCommandPending = false
      this.seekingGesture = false
      this.seekAcceptAfter = 0
      this.failPlayback(error instanceof Error ? error.message : String(error))
    }
  }

  setKnownDuration(duration: number): void {
    if (!Number.isFinite(duration) || duration <= 0) return
    this.knownDuration = duration
    if (Math.abs(this.session.duration - duration) >= 0.1) { this.session.duration = duration; this.emitSession() }
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(value)))
    if (this.volume > 0 && this.muted) this.muted = false
    if (this.session.kind === 'video') {
      void this.mpvElement?.setVolume(this.volume)
      void this.setMpvProperty('mute', this.muted ? 'yes' : 'no')
    } else if (this.video) {
      this.video.volume = this.volume / 100
      this.video.muted = this.muted
    }
    this.emitSession()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.session.kind === 'video') void this.setMpvProperty('mute', muted ? 'yes' : 'no')
    else if (this.video) this.video.muted = muted
    this.emitSession()
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(4, speed))
    if (this.session.kind === 'video') void this.setMpvProperty('speed', String(this.speed))
    else if (this.video) this.video.playbackRate = this.speed
    this.emitSession()
  }

  setRepeatMode(mode: 'none' | 'all' | 'one'): void {
    this.session.repeatMode = mode
    if (this.mpvElement) this.mpvElement.loop = mode === 'one'
    if (this.video) this.video.loop = mode === 'one'
    this.emitSession()
  }

  setShuffle(shuffle: boolean): void { this.session.shuffle = shuffle; this.emitSession() }

  selectVideoTrack(index: number): void {
    this.selectedVideoTrack = clampTrackIndex(index, this.detectedTracks.video.length)
    void this.setMpvProperty('vid', String(this.selectedVideoTrack + 1))
  }

  selectAudioTrack(index: number): void {
    this.selectedAudioTrack = clampTrackIndex(index, this.detectedTracks.audio.length)
    void this.setMpvProperty('aid', String(this.selectedAudioTrack + 1))
  }

  selectSubtitleTrack(index: number): void {
    this.selectedSubtitleTrack = index < 0 ? -1 : clampTrackIndex(index, this.detectedTracks.subtitles.length)
    void this.setMpvProperty('sid', this.selectedSubtitleTrack < 0 ? 'no' : String(this.selectedSubtitleTrack + 1))
  }

  position(): number {
    if (this.session.kind === 'audio' && this.video && Number.isFinite(this.video.currentTime)) return this.video.currentTime
    return this.session.position
  }

  private ensureAudioGraph(): void {
    const audio = this.video
    if (!audio || this.sourceNode) return
    try {
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AudioContextClass()
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => void 0)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.minDecibels = -90
      this.analyser.maxDecibels = -18
      this.analyser.smoothingTimeConstant = 0.34
      this.sourceNode = this.ctx.createMediaElementSource(audio)
      this.sourceNode.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
    } catch { this.destroyAudioGraph() }
  }

  private destroyAudioGraph(): void {
    try { this.sourceNode?.disconnect(); this.analyser?.disconnect() } catch { void 0 }
    const context = this.ctx
    this.sourceNode = null
    this.analyser = null
    this.ctx = null
    this.spectrum.fill(0)
    this.ev.onSpectrum?.(new Float32Array(this.spectrum))
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
      const raw = new Uint8Array(this.analyser.frequencyBinCount)
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
      this.ev.onSpectrum?.(new Float32Array(this.spectrum))
    }
    if (this.session.kind === 'audio' && this.video && !this.video.paused) {
      this.updateAudioPosition(this.video)
      if (now - this.lastSessionEmitAt >= 250) { this.lastSessionEmitAt = now; this.emitSession() }
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
    this.session.position = audio.currentTime
    this.session.lastPositionKnown = audio.currentTime
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
    const shouldWatch = this.session.kind === 'video'
      && this.session.loaded
      && !this.session.paused
      && !this.session.seeking
      && this.session.phase !== 'error'
      && this.session.duration - this.session.position > 0.75
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
    if (!this.clockStalled && now - this.clockAdvancedAt >= 1200) {
      this.clockStalled = true
      this.applyBufferingState()
    }
  }

  private applyBufferingState(): void {
    const buffering = this.backendBuffering || this.clockStalled
    if (this.session.phase === 'error' || this.session.buffering === buffering) return
    this.session.buffering = buffering
    this.session.phase = buffering && !this.session.paused ? 'buffering' : this.session.paused ? 'paused' : 'playing'
    if (buffering) this.armLoadTimeout()
    else this.clearLoadTimeout()
    this.emitSession()
    this.ev.onBuffering?.(buffering)
  }

  private handleEnded(): void {
    if (this.session.idle) return
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
    this.session.position = this.session.duration
    this.session.paused = true
    this.session.phase = 'paused'
    this.emitSession()
    this.ev.onEnded?.()
  }

  private failPlayback(message: string): void {
    this.clearLoadTimeout()
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
    this.session.phase = 'error'
    this.session.error = message || 'Playback error'
    this.session.loaded = false
    this.session.paused = true
    this.session.buffering = false
    this.session.seeking = false
    this.emitSession()
    this.ev.onBuffering?.(false)
    this.ev.onPlaybackError?.(this.session.error)
  }

  private armLoadTimeout(): void {
    if (this.loadTimeout) return
    this.loadTimeout = window.setTimeout(() => {
      this.loadTimeout = 0
      if (!this.session.idle && !this.session.loaded && this.session.phase !== 'error') this.failPlayback('Media loading timed out')
    }, MEDIA_LOAD_TIMEOUT)
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
    void window.aurora.invoke(I.sessionSync, { ...this.session, volume: this.volume, muted: this.muted, speed: this.speed })
  }

  persistPlaybackProgress(): void {
    if (this.session.idle || this.session.mediaId == null) return
    if (this.session.kind === 'audio' && this.video) this.updateAudioPosition(this.video)
    window.aurora.persistSession({ ...this.session, volume: this.volume, muted: this.muted, speed: this.speed })
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

  private stopBackends(): void {
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
      void player.destroy().catch(() => void 0)
      player.remove()
    }
  }

  stop(): void {
    this.persistPlaybackProgress()
    this.loadEpoch += 1
    this.trackEpoch += 1
    this.clearLoadTimeout()
    this.stopBackends()
    this.container = null
    this.plan = null
    this.knownDuration = 0
    this.pendingResume = 0
    this.loadedMpvSource = ''
    this.seekingGesture = false
    this.seekTarget = null
    this.seekWasPlaying = false
    this.seekRequestEpoch += 1
    this.seekCommandPending = false
    this.seekAcceptAfter = 0
    this.seekDisplayFloor = null
    this.seekDisplayFloorUntil = 0
    this.playbackRequestEpoch += 1
    this.desiredPaused = null
    this.playbackConfirmUntil = 0
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
      bufferedSeconds: 0, networkSpeed: 0, seeking: false, error: null
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
