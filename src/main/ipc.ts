import { ipcMain, BrowserWindow, dialog } from 'electron'
import { I, E } from '../shared/channels'
import type { SessionState, PlayRequest, PlayPlan, MediaItem } from '../shared/types'
import { LibraryRepository } from './library/repository'
import { LibraryController } from './library/controller'
import { QueueController, PlaylistController } from './playback/queue'
import { PlaybackLaunchPlanner, PlaybackQueueCoordinator, type PlannerDeps } from './playback/planner'
import { PlaybackSessionController } from './playback/session'
import { RemoteSourceManager } from './remote/manager'
import { MediaProbeService } from './media/probe'
import { SettingsStore } from './system/settings'
import { Logger } from './system/diagnostics'
import { classifyFile } from '../shared/types'
import { listAppIcons } from './util'

export interface PlaybackBus {
  plan: PlayPlan
  request: PlayRequest
}

export class PlaybackIpc {
  private session = new PlaybackSessionController()

  constructor(
    private deps: {
      repo: LibraryRepository
      library: LibraryController
      queue: QueueController
      playlists: PlaylistController
      planner: PlaybackLaunchPlanner
      coordinator: PlaybackQueueCoordinator
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
    const { repo, queue, remote, settings } = this.deps

    ipcMain.handle(I.appIconsList, () => listAppIcons())

    ipcMain.handle(I.playPlan, async (_e, request: PlayRequest): Promise<PlayPlan> => {
      const plan = this.deps.planner.plan(request)
      if (plan.ok) {
        this.deps.onPlay(plan, request)
        if (plan.item) {
          repo.touchPlayed(plan.item.id)
          this.deps.broadcast(E.libraryChanged, repo.loadAll())
        }
      }
      return plan
    })

    ipcMain.handle(I.queueNav, (_e, action: 'previous' | 'next' | 'naturalEnd', mediaId: number, repeat: SessionState['repeatMode']): PlayPlan | null => {
      const ids = queue.mediaIds
      const idx = queue.indexOf(mediaId)
      if (idx < 0) return null
      const target = action === 'previous' ? this.deps.coordinator.previous(idx, ids.length, repeat) : this.deps.coordinator.next(idx, ids.length, repeat)
      if (target === null) return null
      const request: PlayRequest = { mediaIds: ids, index: target, action: action === 'naturalEnd' ? 'play' : 'play' }
      const plan = this.deps.planner.plan(request)
      if (plan.ok) {
        this.deps.onPlay(plan, request)
        if (plan.item) {
          repo.touchPlayed(plan.item.id)
          this.deps.broadcast(E.libraryChanged, repo.loadAll())
        }
      }
      return plan
    })

    ipcMain.handle(I.sessionSync, (_e, state: SessionState) => {
      this.syncSession(state)
    })

    ipcMain.handle(I.mediaAudioFeatures, (_e, mediaId: number) => this.deps.probe.getAudioFeatures(mediaId))
    ipcMain.handle(I.mediaPlaybackDuration, (_e, mediaId: number) => this.deps.probe.getPlaybackDuration(mediaId))
    ipcMain.handle(I.mediaTracks, (_e, mediaId: number) => this.deps.probe.getTracks(mediaId))
    ipcMain.handle(I.mediaChapters, (_e, mediaId: number) => this.deps.probe.getChapters(mediaId))

    ipcMain.on(I.sessionSync, (event, state: SessionState) => {
      this.syncSession(state)
      event.returnValue = true
    })

    ipcMain.handle(I.dialogsOpenMedia, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const { pickMediaFiles } = await import('./system/settings')
      const paths = await pickMediaFiles(win!)
      if (!paths) return []
      const added = this.deps.library.addPaths(paths)
      void added
      return paths
    })

    ipcMain.handle(I.dialogsOpenFolder, async (e) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const { pickFolder } = await import('./system/settings')
      const dir = await pickFolder(win!)
      if (!dir) return null
      const added = this.deps.library.addPaths([dir])
      void added
      return dir
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

  private syncSession(state: SessionState): void {
    this.deps.logger.debug('session', `state=${state.phase} media=${state.mediaId} pos=${state.position.toFixed(1)}`)
    if (this.deps.settings.get('rememberPlaybackPosition') && state.mediaId != null && state.duration > 0) {
      this.deps.repo.updatePlaybackState(state.mediaId, state.position, state.duration)
    }
    switch (state.phase) {
      case 'playing':
        this.session.dispatch({ type: 'playing' })
        break
      case 'paused':
        this.session.dispatch({ type: 'paused' })
        break
      case 'buffering':
        this.session.dispatch({ type: 'buffering' })
        break
      case 'error':
        this.session.dispatch({ type: 'error', message: state.error ?? 'unknown error' })
        break
      default:
        this.session.dispatch({ type: 'idle' })
        break
    }
    this.deps.broadcast(E.sessionState, this.session.snapshot())
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
    itemsByIds: (ids) => deps.repo.loadAll().filter((i) => ids.includes(i.id)),
    fileExists: deps.fileExists,
    sourceAvailable: (sourceId) => deps.remote.sourceAvailable(sourceId),
    resumePlayback: () => deps.settings.get('resumePlayback'),
    rememberPlaybackPosition: () => deps.settings.get('rememberPlaybackPosition'),
    urlFor: deps.urlFor
  }
}

export function kindOfItem(item: MediaItem): 'video' | 'audio' | 'image' {
  const kind = classifyFile(item.fileName)
  if (kind === 'image') return 'image'
  if (item.isAudio || kind === 'audio') return 'audio'
  return 'video'
}

export function validateUrlInput(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
