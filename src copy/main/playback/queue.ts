import { ipcMain } from 'electron'
import { I, E } from '../../shared/channels'
import type { QueueEntry, Playlist, MediaItem } from '../../shared/types'
import { LibraryRepository } from '../library/repository'
import { Logger } from '../system/diagnostics'

function toEntry(item: MediaItem | null | undefined): QueueEntry | null {
  if (!item) return null
  return {
    position: 0,
    mediaId: item.id,
    title: item.title || item.fileName,
    artist: item.artist,
    duration: item.duration,
    isAudio: item.isAudio,
    isImage: item.isImage
  }
}

export class QueueController {
  private ids: number[] = []

  constructor(
    private repo: LibraryRepository,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void
  ) {}

  init(): void {
    this.ids = this.repo.loadQueueIds()
    ipcMain.handle(I.queueGet, () => this.snapshot())
    ipcMain.handle(I.queueEnqueue, (_e, mediaIds: number[]) => {
      this.enqueue(mediaIds)
      return this.snapshot()
    })
    ipcMain.handle(I.queueInsert, (_e, mediaId: number, at: number) => {
      this.insert(mediaId, at)
      return this.snapshot()
    })
    ipcMain.handle(I.queueTake, (_e, index: number) => this.take(index))
    ipcMain.handle(I.queueRemove, (_e, index: number) => {
      this.ids.splice(index, 1)
      this.persist()
      return this.snapshot()
    })
    ipcMain.handle(I.queueRemoveMedia, (_e, mediaId: number) => {
      this.ids = this.ids.filter((id) => id !== mediaId)
      this.persist()
      return this.snapshot()
    })
    ipcMain.handle(I.queueMove, (_e, from: number, to: number) => {
      this.move(from, to)
      return this.snapshot()
    })
    ipcMain.handle(I.queueClear, () => {
      this.ids = []
      this.persist()
      return this.snapshot()
    })
  }

  get mediaIds(): number[] {
    return [...this.ids]
  }

  snapshot(): QueueEntry[] {
    return this.ids
      .map((id) => {
        const item = this.repo.findById(id)
        return toEntry(item)
      })
      .filter((e): e is QueueEntry => !!e)
      .map((e, i) => ({ ...e, position: i }))
  }

  enqueue(mediaIds: number[]): void {
    let added = 0
    for (const id of mediaIds) {
      if (!this.ids.includes(id)) {
        this.ids.push(id)
        added++
      }
    }
    if (added) {
      this.persist()
      this.logger.info('queue', `enqueued ${added} items`)
    }
  }

  enqueueRange(items: MediaItem[], from: number, to: number): void {
    const range = items.slice(from, to + 1).map((i) => i.id)
    this.enqueue(range)
  }

  insert(mediaId: number, at: number): void {
    this.ids = this.ids.filter((id) => id !== mediaId)
    const pos = Math.max(0, Math.min(this.ids.length, at))
    this.ids.splice(pos, 0, mediaId)
    this.persist()
  }

  take(index: number): number | null {
    if (index < 0 || index >= this.ids.length) return null
    const [id] = this.ids.splice(index, 1)
    this.persist()
    return id
  }

  move(from: number, to: number): void {
    if (from < 0 || from >= this.ids.length || to < 0 || to >= this.ids.length || from === to) return
    const [id] = this.ids.splice(from, 1)
    this.ids.splice(to, 0, id)
    this.persist()
  }

  removeMediaId(mediaId: number): void {
    this.ids = this.ids.filter((id) => id !== mediaId)
    this.persist()
  }

  positionsOfMediaId(mediaId: number): number[] {
    return this.ids.map((id, i) => (id === mediaId ? i : -1)).filter((i) => i >= 0)
  }

  restoreMediaIdPositions(mediaId: number, positions: number[]): void {
    const inQueue = this.ids.filter((id) => id !== mediaId)
    for (const pos of positions.sort((a, b) => a - b)) {
      inQueue.splice(Math.min(pos, inQueue.length), 0, mediaId)
    }
    this.ids = inQueue
    this.persist()
  }

  indexOf(mediaId: number): number {
    return this.ids.indexOf(mediaId)
  }

  private persist(): void {
    this.repo.saveQueueIds(this.ids)
    this.broadcast(E.queueChanged, this.snapshot())
  }
}

export class PlaylistController {
  constructor(
    private repo: LibraryRepository,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void
  ) {}

  init(): void {
    ipcMain.handle(I.playlistsGet, () => this.snapshot())
    ipcMain.handle(I.playlistCreate, (_e, name: string) => {
      const id = this.repo.createPlaylist(name || 'New Playlist')
      this.emit()
      return id
    })
    ipcMain.handle(I.playlistRename, (_e, id: number, name: string) => {
      this.repo.renamePlaylist(id, name)
      this.emit()
    })
    ipcMain.handle(I.playlistRemove, (_e, id: number) => {
      this.repo.removePlaylist(id)
      this.emit()
    })
    ipcMain.handle(I.playlistAddMedia, (_e, playlistId: number, mediaIds: number[]) => {
      const rows = this.repo.loadPlaylists().find((p) => p.id === playlistId)
      const next = rows?.mediaIds.length ?? 0
      let added = 0
      mediaIds.forEach((mid, i) => {
        if (!rows?.mediaIds.includes(mid)) {
          this.repo.addPlaylistEntry(playlistId, mid, next + added + i)
          added++
        }
      })
      this.emit()
      return added
    })
    ipcMain.handle(I.playlistRemoveEntry, (_e, playlistId: number, mediaId: number) => {
      this.repo.removePlaylistEntry(playlistId, mediaId)
      this.emit()
    })
    ipcMain.handle(I.playlistMoveEntry, (_e, playlistId: number, from: number, to: number) => {
      this.repo.movePlaylistEntry(playlistId, from, to)
      this.emit()
    })
  }

  snapshot(): Playlist[] {
    return this.repo
      .loadPlaylists()
      .map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        entries: p.mediaIds
          .map((id) => toEntry(this.repo.findById(id)))
          .filter((e): e is QueueEntry => !!e)
          .map((e, i) => ({ ...e, position: i }))
      }))
  }

  referencesForMediaId(mediaId: number): { playlistId: number; playlistName: string }[] {
    return this.repo.referencesForMediaId(mediaId)
  }

  removeMediaIdFromAll(mediaId: number): void {
    for (const p of this.repo.loadPlaylists()) {
      if (p.mediaIds.includes(mediaId)) {
        this.repo.removePlaylistEntry(p.id, mediaId)
      }
    }
    this.emit()
  }

  private emit(): void {
    this.broadcast(E.playlistsChanged, this.snapshot())
  }
}
