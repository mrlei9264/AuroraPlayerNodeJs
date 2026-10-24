import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'
import { E, I } from '../../shared/channels'
import { classifyFile, isMediaExt } from '../../shared/types'
import type { MediaItem } from '../../shared/types'
import { LibraryRepository, type MediaRowInput } from './repository'
import { Logger } from '../system/diagnostics'

export class LibraryController {
  private undoStack: { ids: number[]; items: MediaItem[]; expiresAt: number }[] = []
  private undoCleanupTimer: ReturnType<typeof setTimeout> | null = null
  private availabilityTask: Promise<void> | null = null
  private availabilityIncludesRemote = false

  constructor(
    private repo: LibraryRepository,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void,
    private afterRemove: (items: MediaItem[]) => void = () => undefined,
    private afterRestore: (items: MediaItem[]) => void = () => undefined,
    private afterRelocate: (item: MediaItem) => void = () => undefined,
    private checkAvailable: (item: MediaItem) => Promise<boolean> = async (item) => fs.existsSync(item.url)
  ) {}

  init(): void {
    ipcMain.handle(I.libraryAddPaths, (_e, paths: string[]) => this.addPaths(paths))
    ipcMain.handle(I.libraryGet, () => this.snapshot())
    ipcMain.handle(I.libraryRefreshAvailability, (_event, includeRemote?: boolean) => this.refreshAvailability(includeRemote !== false))
    ipcMain.handle(I.libraryAddUrl, (_e, url: string) => this.addUrl(url))
    ipcMain.handle(
      I.libraryAddRemote,
      (_e, entries: { sourceId: number; sourceName: string; protocol: string; path: string; name: string; size: number }[]) =>
        this.addRemoteItems(entries)
    )
    ipcMain.handle(I.libraryRemove, (_e, ids: number[]) => this.remove(ids))
    ipcMain.handle(I.libraryUndoRemove, () => this.undo())
    ipcMain.handle(I.libraryFavorite, (_e, id: number, fav: boolean) => this.setFavorite(id, fav))
    ipcMain.handle(I.libraryFavoriteMany, (_e, ids: number[], favorite: boolean) => this.setFavorites(ids, favorite))
    ipcMain.handle(I.libraryRelocate, (_e, id: number, newUrl: string) => this.relocate(id, newUrl))
    ipcMain.handle(I.libraryAutoMatch, () => this.autoMatchMissing())
    ipcMain.handle(I.libraryUpdateMeta, (_e, id: number, fields: Partial<Pick<MediaItem, 'title' | 'artist' | 'album'>>) => {
      this.repo.updateFields(id, fields)
      this.changed()
    })
  }

  async addPaths(paths: string[]): Promise<number> {
    let added = 0
    const knownUrls = this.repo.loadUrlSet()
    for (const p of paths) {
      try {
        const st = await fs.promises.stat(p)
        if (st.isDirectory()) added += await this.scanDirectory(p, knownUrls)
        else if (st.isFile() && isMediaExt(path.extname(p))) {
          const existed = knownUrls.has(p)
          if (this.addFile(p, st.size) && !existed) added++
          knownUrls.add(p)
        }
      } catch (err) {
        this.logger.warn('library', `add path failed: ${p}`, err as Error)
      }
    }
    if (added > 0) this.changed()
    return added
  }

  addUrl(url: string): MediaItem | null {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    const protocol = parsed.protocol.replace(':', '')
    if (!['http', 'https'].includes(protocol)) return null
    let fileName = path.basename(parsed.pathname) || 'network-media'
    try { fileName = decodeURIComponent(fileName) } catch { void 0 }
    const kind = classifyFile(fileName)
    if (!kind) return null
    const item = this.repo.upsertByUrl({
      url,
      fileName,
      isAudio: kind === 'audio',
      isImage: false,
      sourceId: null,
      remotePath: null,
      protocol,
      sourceName: '',
      sourceAvailable: true
    })
    this.changed()
    return item
  }

  addRemoteItems(entries: { sourceId: number; sourceName: string; protocol: string; path: string; name: string; size: number }[]): number {
    let added = 0
    for (const entry of entries) {
      const kind = classifyFile(entry.name)
      if (!kind) continue
      const key = `remote:${entry.sourceId}:${entry.path}`
      const existing = this.repo.findByUrl(key)
      if (existing) continue
      this.repo.insert({
        url: key,
        fileName: entry.name,
        isAudio: kind === 'audio',
        isImage: false,
        sourceId: entry.sourceId,
        remotePath: entry.path,
        protocol: entry.protocol,
        sourceName: entry.sourceName,
        sourceAvailable: true,
        fileSize: entry.size
      })
      added++
    }
    if (added > 0) this.changed()
    return added
  }

  addFile(p: string, knownFileSize?: number): MediaItem | null {
    const kind = classifyFile(path.basename(p))
    if (!kind) return null
    const fileSize = knownFileSize ?? this.localFileSize(p)
    const existing = this.repo.findByUrl(p)
    if (existing) {
      if (fileSize !== existing.fileSize || !existing.sourceAvailable) this.repo.updateFields(existing.id, { fileSize, sourceAvailable: fileSize > 0 })
      return this.repo.findById(existing.id)
    }
    const item = this.repo.insert({
      url: p,
      fileName: path.basename(p),
      isAudio: kind === 'audio',
      isImage: false,
      sourceId: null,
      remotePath: null,
      protocol: 'local',
      sourceName: '',
      sourceAvailable: fs.existsSync(p),
      fileSize
    })
    return item
  }

  async scanDirectory(dir: string, knownUrls = this.repo.loadUrlSet()): Promise<number> {
    let added = 0
    const stack = [dir]
    const visited = new Set<string>()
    while (stack.length) {
      const cur = stack.pop()!
      if (visited.has(cur) || visited.size > 60_000) continue
      visited.add(cur)
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(cur, { withFileTypes: true })
      } catch {
        continue
      }
      const mediaFiles: Array<{ full: string; name: string }> = []
      for (const ent of entries) {
        const full = path.join(cur, ent.name)
        if (ent.isDirectory()) {
          if (!ent.name.startsWith('.') && ent.name !== 'node_modules') stack.push(full)
        } else if (ent.isFile() && isMediaExt(ent.name) && !knownUrls.has(full)) {
          mediaFiles.push({ full, name: ent.name })
          knownUrls.add(full)
        }
      }
      for (let offset = 0; offset < mediaFiles.length; offset += 32) {
        const batch = await Promise.all(mediaFiles.slice(offset, offset + 32).map(async ({ full, name }): Promise<MediaRowInput | null> => {
          const kind = classifyFile(name)
          if (!kind) return null
          try {
            const stats = await fs.promises.stat(full)
            if (!stats.isFile()) return null
            return {
              url: full,
              fileName: name,
              isAudio: kind === 'audio',
              isImage: false,
              sourceId: null,
              remotePath: null,
              protocol: 'local',
              sourceName: '',
              sourceAvailable: true,
              fileSize: stats.size
            }
          } catch {
            return null
          }
        }))
        added += this.repo.insertMany(batch.filter((item): item is MediaRowInput => item !== null))
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    return added
  }

  setFavorite(id: number, fav: boolean): void {
    if (this.repo.setFavorites([id], fav) > 0) this.changed()
  }

  setFavorites(ids: number[], favorite: boolean): void {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length && this.repo.setFavorites(uniqueIds, favorite) > 0) this.changed()
  }

  remove(ids: number[]): void {
    this.pruneUndoStack()
    const items = ids.map((id) => this.repo.findById(id)).filter((x): x is MediaItem => !!x)
    if (!items.length) return
    this.undoStack.push({ ids, items: items.map((item) => ({ ...item, coverPath: null, metaProbed: false })), expiresAt: Date.now() + 15_000 })
    while (this.undoStack.length > 5) this.undoStack.shift()
    this.scheduleUndoCleanup()
    this.repo.remove(ids)
    this.afterRemove(items)
    this.changed()
  }

  undo(): boolean {
    this.pruneUndoStack()
    const top = this.undoStack.pop()
    this.scheduleUndoCleanup()
    if (!top) return false
    const restored: MediaItem[] = []
    for (const item of top.items) {
      restored.push(this.repo.upsertByUrl({
        url: item.url,
        fileName: item.fileName,
        isAudio: item.isAudio,
        isImage: item.isImage,
        sourceId: item.sourceId,
        remotePath: item.remotePath,
        protocol: item.protocol,
        sourceName: item.sourceName,
        sourceAvailable: item.sourceAvailable,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration: item.duration,
        fileSize: item.fileSize,
        coverPath: item.coverPath
      }))
    }
    this.afterRestore(restored)
    this.changed()
    return true
  }

  relocate(id: number, newUrl: string): boolean {
    const item = this.repo.findById(id)
    if (!item || !fs.existsSync(newUrl)) return false
    const conflict = this.repo.findByUrl(newUrl)
    if (conflict && conflict.id !== id) return false
    this.repo.updateUrl(id, newUrl)
    this.repo.updateFields(id, { title: '', artist: '', album: '', metaProbed: false, sourceAvailable: true })
    const relocated = this.repo.findById(id)
    if (relocated) this.afterRelocate(relocated)
    this.changed()
    return true
  }

  autoMatchMissing(): number {
    const all = this.repo.loadAll()
    let matched = 0
    for (const item of all) {
      if (item.protocol !== 'local' || item.sourceAvailable) continue
      const dir = path.dirname(item.url)
      const candidate = path.join(dir, item.fileName)
      if (fs.existsSync(candidate)) {
        this.repo.updateFields(item.id, { sourceAvailable: true, metaProbed: false })
        matched++
      }
    }
    if (matched > 0) this.changed()
    return matched
  }

  async checkItemAvailability(id: number): Promise<boolean> {
    const item = this.repo.findById(id)
    if (!item) return false
    const available = await this.checkAvailable(item)
    const current = this.repo.findById(id)
    if (!current || current.url !== item.url) return false
    if (current.sourceAvailable !== available) {
      this.repo.updateFields(id, { sourceAvailable: available })
      this.changed()
    }
    return available
  }

  refreshAvailability(includeRemote = true): Promise<void> {
    if (this.availabilityTask) {
      if (includeRemote && !this.availabilityIncludesRemote) {
        return this.availabilityTask.then(() => this.refreshAvailability(true))
      }
      return this.availabilityTask
    }
    this.availabilityIncludesRemote = includeRemote
    this.availabilityTask = this.refreshAvailabilityBatch(includeRemote).finally(() => { this.availabilityTask = null })
    return this.availabilityTask
  }

  private async refreshAvailabilityBatch(includeRemote: boolean): Promise<void> {
    const items = this.repo.loadAll().filter((item) => includeRemote || item.protocol === 'local')
    let index = 0
    const updates: Array<{ id: number; url: string; available: boolean }> = []
    // Explicit refreshes may touch many files. Limit I/O concurrency, then commit
    // all changed flags in one SQLite transaction and publish one snapshot.
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index++]
        const available = await this.checkAvailable(item)
        if (item.sourceAvailable !== available) updates.push({ id: item.id, url: item.url, available })
      }
    }))
    if (this.repo.updateAvailability(updates) > 0) this.changed()
  }

  private changed(): void {
    this.broadcast(E.libraryChanged, this.snapshot())
    this.logger.info('library', `library changed, count=${this.repo.count()}`)
  }

  snapshot(): MediaItem[] {
    return this.repo.loadAll().filter((item) => !item.isImage)
  }

  private pruneUndoStack(): void {
    const now = Date.now()
    this.undoStack = this.undoStack.filter((entry) => entry.expiresAt > now)
  }

  private scheduleUndoCleanup(): void {
    if (this.undoCleanupTimer) clearTimeout(this.undoCleanupTimer)
    this.undoCleanupTimer = null
    if (!this.undoStack.length) return
    const nextExpiry = Math.min(...this.undoStack.map((entry) => entry.expiresAt))
    this.undoCleanupTimer = setTimeout(() => {
      this.undoCleanupTimer = null
      this.pruneUndoStack()
      this.scheduleUndoCleanup()
    }, Math.max(0, nextExpiry - Date.now()))
  }

  private localFileSize(filePath: string): number {
    try {
      return fs.statSync(filePath).size
    } catch {
      return 0
    }
  }

  itemsByIds(ids: number[]): MediaItem[] {
    const items = new Map(this.repo.findByIds(ids).map((item) => [item.id, item]))
    return ids.map((id) => items.get(id)).filter((x): x is MediaItem => !!x && !x.isImage)
  }
}
