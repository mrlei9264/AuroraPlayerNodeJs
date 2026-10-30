import { ipcMain, BrowserWindow, dialog } from 'electron'
import { I, E } from '../shared/channels'
import type { SessionState, PlayRequest, PlayPlan, MediaItem, MediaTrackCatalog } from '../shared/types'
import { LibraryRepository } from './library/repository'
import { LibraryController } from './library/controller'
import { PlaylistController } from './playback/queue'
import { PlaybackLaunchPlanner, type PlannerDeps } from './playback/planner'
import { RemoteSourceManager } from './remote/manager'
import { MediaProbeService } from './media/probe'
import { openPreviewInput } from './media/previewInput'
import { SettingsStore } from './system/settings'
import { Logger } from './system/diagnostics'
import { listAppIcons } from './util'

export interface PlaybackBus {
  plan: PlayPlan
  request: PlayRequest
}

let backgroundsDir = ''

export function setBackgroundsDir(dir: string): void {
  backgroundsDir = dir
}

export class PlaybackIpc {
  /** The plan most recently accepted by the renderer-facing playback API. */
  private activeMediaId: number | null = null
  private playRequestEpoch = 0
  private lastSessionMediaId: number | null = null
  private wasPlaying = false
  private closeFlushSequence = 0
  private pendingCloseFlush: { id: number; senderId: number; promise: Promise<void>; finish: () => void } | null = null

  constructor(
    private deps: {
      repo: LibraryRepository
      library: LibraryController
      playlists: PlaylistController
      planner: PlaybackLaunchPlanner
      remote: RemoteSourceManager
      probe: MediaProbeService
      settings: SettingsStore
      logger: Logger
      broadcast: (channel: string, payload: unknown) => void
      onPlay: (plan: PlayPlan, request: PlayRequest) => void
      urlFor: (item: MediaItem) => string
    }
  ) {}

  init(): void {
    const { repo, remote, settings } = this.deps

    ipcMain.handle(I.appIconsList, () => listAppIcons())

    ipcMain.handle(I.playPlan, async (_e, rawRequest: unknown): Promise<PlayPlan> => {
      const requestEpoch = ++this.playRequestEpoch
      const request = normalizePlayRequest(rawRequest)
      if (!request) return invalidPlan()
      try {
        const targetId = request.mediaIds[request.index]
        if (targetId != null) await this.deps.library.checkItemAvailability(targetId)
        const plan = this.deps.planner.plan(request)
        if (plan.ok && requestEpoch === this.playRequestEpoch) this.acceptPlan(plan, request)
        return plan
      } catch (error) {
        this.deps.logger.error('playback', `Could not prepare playback: ${errorMessage(error)}`)
        return invalidPlan()
      }
    })

    ipcMain.on(I.sessionSync, (_e, state: unknown) => {
      this.syncSession(state)
    })
    ipcMain.handle(I.sessionFlush, (event, requestId: number, state: unknown) => {
      const pending = this.pendingCloseFlush
      if (!pending || pending.id !== requestId || pending.senderId !== event.sender.id) return
      try {
        if (state != null) {
          this.syncSession(state)
          const snapshot = normalizeSessionState(state)
          if (snapshot?.loaded && snapshot.mediaId != null) this.deps.repo.touchPlayed(snapshot.mediaId)
        }
      } finally {
        pending.finish()
      }
    })

    ipcMain.handle(I.mediaAudioFeatures, (_e, mediaId: number) => this.deps.probe.getAudioFeatures(mediaId))
    ipcMain.handle(I.mediaPlaybackDuration, (_e, mediaId: number) => this.deps.probe.getPlaybackDuration(mediaId))
    ipcMain.handle(I.mediaTracks, async (_e, mediaId: number, detailsOnly?: boolean) => {
      const item = this.deps.repo.findById(mediaId)
      if (detailsOnly !== true || !item || item.protocol === 'local') return this.deps.probe.getTracks(mediaId)
      // The information page must not silently read an entire remote file for tags.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 45000)
      let input: Awaited<ReturnType<typeof openPreviewInput>> | null = null
      try {
        input = await openPreviewInput(this.deps.remote, item, controller.signal)
        return await this.deps.probe.getTracks(mediaId, input.url)
      } catch {
        return { video: [], audio: [], subtitles: [], chapters: [], width: 0, height: 0, fps: 0 } satisfies MediaTrackCatalog
      } finally {
        clearTimeout(timer)
        input?.close()
      }
    })
    ipcMain.handle(I.mediaChapters, (_e, mediaId: number) => this.deps.probe.getChapters(mediaId))

    ipcMain.handle(I.dialogsOpenMedia, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const { pickMediaFiles } = await import('./system/settings')
      const paths = await pickMediaFiles(win!)
      return paths ?? []
    })

    ipcMain.handle(I.dialogsOpenFolder, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const { pickFolder } = await import('./system/settings')
      const dir = await pickFolder(win!)
      return dir ?? null
    })

    ipcMain.handle(I.backgroundsPick, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const { pickBackgroundImage } = await import('./system/settings')
      if (!backgroundsDir) return null
      return pickBackgroundImage(win!, backgroundsDir)
    })

    ipcMain.handle(I.dialogsRelocate, async (e, mediaId: number) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const { dialog } = await import('electron')
      const res = await dialog.showOpenDialog(win!, {
        title: 'Relocate Missing Media',
        properties: ['openFile'],
        filters: [{ name: 'Media', extensions: ['*'] }]
      })
      if (res.canceled || !res.filePaths[0]) return false
      return this.deps.library.relocate(mediaId, res.filePaths[0])
    })

    ipcMain.handle(I.appOpenPath, (_e, p: string) => {
      const { shell } = require('electron') as typeof import('electron')
      if (!p) return
      const item = this.deps.repo.findByUrl(p)
      if (item?.protocol === 'local') {
        void shell.showItemInFolder(item.url)
        return
      }
      void shell.openPath(p)
    })
  }

  async flushPlaybackBeforeClose(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    if (this.pendingCloseFlush) return this.pendingCloseFlush.promise
    const id = ++this.closeFlushSequence
    let complete!: () => void
    const promise = new Promise<void>((resolve) => { complete = resolve })
    // An unresponsive renderer must not prevent the application from quitting.
    const timeout = setTimeout(() => {
      this.deps.logger.error('playback', 'Timed out waiting for shutdown playback progress; keeping the last saved record')
      complete()
    }, 1500)
    const pending = { id, senderId: window.webContents.id, promise, finish: () => { clearTimeout(timeout); complete() } }
    this.pendingCloseFlush = pending
    try {
      window.webContents.send(E.sessionFlushRequested, id)
      await promise
    } catch (error) {
      this.deps.logger.error('playback', `Could not request shutdown playback progress: ${errorMessage(error)}`)
    } finally {
      pending.finish()
      if (this.pendingCloseFlush === pending) this.pendingCloseFlush = null
    }
  }

  private acceptPlan(plan: PlayPlan, request: PlayRequest): void {
    this.activeMediaId = plan.item?.id ?? null
    this.deps.onPlay(plan, request)
    if (!plan.item) return
    // Commit the accepted playback action before any probe can publish another
    // library snapshot, so it cannot overwrite the renderer's new history.
    this.deps.repo.touchPlayed(plan.item.id)
    if (this.deps.settings.get('resumePlayback')) {
      this.deps.repo.updatePlaybackProgress(plan.item.id, plan.resumePosition, plan.item.duration)
    }
    this.deps.broadcast(E.libraryChanged, this.deps.library.snapshot())
    this.deps.probe.request(plan.item.id)
  }

  private syncSession(rawState: unknown): void {
    const state = normalizeSessionState(rawState)
    if (!state) {
      this.deps.logger.error('playback', 'Ignored an invalid playback session update')
      return
    }
    this.deps.logger.debug('session', `state=${state.phase} media=${state.mediaId} pos=${state.position.toFixed(1)}${state.phase === 'error' && state.error ? ` error=${state.error}` : ''}`)
    if (this.deps.settings.get('resumePlayback') && state.mediaId != null && state.duration > 0) {
      this.deps.repo.updatePlaybackProgress(state.mediaId, state.position, state.duration)
    }
    // Renderer invokes are asynchronous. Keep a late update for the old item
    // in its own history, but never let it overwrite the current session sent
    // to the UI or platform integrations.
    if (state.mediaId !== null && this.activeMediaId !== null && state.mediaId !== this.activeMediaId) return
    const playing = state.loaded && !state.paused && state.phase !== 'error' && !state.idle
    if (playing && state.mediaId != null && (this.lastSessionMediaId !== state.mediaId || !this.wasPlaying)) {
      this.deps.repo.touchPlayed(state.mediaId)
    }
    this.lastSessionMediaId = state.mediaId
    this.wasPlaying = playing
    if (state.idle) this.activeMediaId = null
    else if (state.mediaId !== null) this.activeMediaId = state.mediaId
  }
}

export function makePlannerDeps(deps: {
  repo: LibraryRepository
  remote: RemoteSourceManager
  settings: SettingsStore
  urlFor: (item: MediaItem) => string
  fileExists: (p: string) => boolean
}): PlannerDeps {
  return {
    itemById: (id) => deps.repo.findById(id),
    fileExists: deps.fileExists,
    sourceAvailable: (sourceId) => deps.remote.sourceAvailable(sourceId),
    resumePlayback: () => deps.settings.get('resumePlayback'),
    urlFor: deps.urlFor
  }
}

export function validateUrlInput(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function invalidPlan(): PlayPlan {
  return { ok: false, result: 'invalidRequest', item: null, url: '', kind: 'video', resumePosition: 0 }
}

function normalizePlayRequest(value: unknown): PlayRequest | null {
  if (!isRecord(value) || !Array.isArray(value.mediaIds) || typeof value.index !== 'number' || !Number.isSafeInteger(value.index)) return null
  const mediaIds = value.mediaIds
  if (!mediaIds.length || value.index < 0 || value.index >= mediaIds.length || !mediaIds.every((id) => validMediaId(id) !== null)) return null
  if (value.action !== 'play' && value.action !== 'playNext' && value.action !== 'playPrevious' && value.action !== 'resume' && value.action !== 'restart') return null
  return { mediaIds: [...mediaIds] as number[], index: value.index, action: value.action }
}

function normalizeSessionState(value: unknown): SessionState | null {
  if (!isRecord(value) || !isSessionPhase(value.phase) || (value.kind !== 'audio' && value.kind !== 'video')) return null
  const mediaId = value.mediaId === null ? null : validMediaId(value.mediaId)
  if (mediaId === null && value.mediaId !== null) return null
  const duration = nonNegativeNumber(value.duration)
  const rawPosition = nonNegativeNumber(value.position)
  if (duration === null || rawPosition === null) return null
  const position = duration > 0 ? Math.min(rawPosition, duration) : rawPosition
  const phase = value.phase
  const repeatMode = validRepeatMode(value.repeatMode) ?? 'none'
  const lastPosition = nonNegativeNumber(value.lastPositionKnown)
  const base: SessionState = {
    phase,
    kind: value.kind,
    mediaId,
    position,
    duration,
    paused: booleanValue(value.paused, phase !== 'playing' && phase !== 'buffering'),
    loaded: booleanValue(value.loaded, phase !== 'idle' && phase !== 'loading' && phase !== 'error'),
    buffering: booleanValue(value.buffering, phase === 'buffering' || phase === 'loading'),
    bufferedSeconds: nonNegativeNumber(value.bufferedSeconds) ?? 0,
    networkSpeed: nonNegativeNumber(value.networkSpeed) ?? 0,
    seeking: booleanValue(value.seeking, false),
    idle: phase === 'idle',
    error: typeof value.error === 'string' && value.error.trim() ? value.error.slice(0, 1000) : null,
    volume: clampNumber(value.volume, 80, 0, 100),
    muted: booleanValue(value.muted, false),
    speed: clampNumber(value.speed, 1, 0.25, 4),
    repeatMode,
    shuffle: booleanValue(value.shuffle, false),
    lastPositionKnown: duration > 0 ? Math.min(lastPosition ?? position, duration) : lastPosition ?? position
  }
  if (phase === 'idle') {
    return { ...base, mediaId: null, position: 0, duration: 0, paused: true, loaded: false, buffering: false, seeking: false, error: null, lastPositionKnown: 0 }
  }
  if (phase === 'error') return { ...base, paused: true, loaded: false, buffering: false, seeking: false, error: base.error ?? 'Playback error' }
  if (phase === 'paused') return { ...base, paused: true, buffering: false }
  if (phase === 'playing') return { ...base, paused: false, buffering: false }
  return base
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isSessionPhase(value: unknown): value is SessionState['phase'] {
  return value === 'idle' || value === 'loading' || value === 'playing' || value === 'paused' || value === 'buffering' || value === 'error'
}

function validMediaId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function validRepeatMode(value: unknown): SessionState['repeatMode'] | null {
  return value === 'none' || value === 'all' || value === 'one' ? value : null
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = nonNegativeNumber(value)
  return number === null ? fallback : Math.max(min, Math.min(max, number))
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
