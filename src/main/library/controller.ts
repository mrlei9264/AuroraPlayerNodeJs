import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'
import { E, I } from '../../shared/channels'
import { classifyFile, isMediaExt } from '../../shared/types'
import type { MediaItem } from '../../shared/types'
import { LibraryRepository } from './repository'
import { Logger } from '../system/diagnostics'

export class LibraryController {
  private undoStack: { ids: number[]; items: MediaItem[]; expiresAt: number }[] = []
  private localSizesRefreshed = false

  constructor(
    private repo: LibraryRepository,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void,
    private beforeRemove: (items: MediaItem[]) => void = () => undefined,
    private afterRestore: (items: MediaItem[]) => void = () => undefined,
    private afterRelocate: (item: MediaItem) => void = () => undefined
  ) {}

  init(): void {
    ipcMain.handle(I.libraryAddPaths, (_e, paths: string[]) => this.addPaths(paths))
    ipcMain.handle(I.libraryGet, () => this.snapshot())
    ipcMain.handle(I.libraryAddUrl, (_e, url: string) => this.addUrl(url))
    ipcMain.handle(
      I.libraryAddRemote,
      (_e, entries: { sourceId: number; sourceName: string; protocol: string; path: string; name: string; size: number }[]) =>
        this.addRemoteItems(entries)
    )
    ipcMain.handle(I.libraryRemove, (_e, ids: number[]) => this.remove(ids))
    ipcMain.handle(I.libraryUndoRemove, () => this.undo())
    ipcMain.handle(I.libraryFavorite, (_e, id: number, fav: boolean) => this.setFavorite(id, fav))
    ipcMain.handle(I.libraryRelocate, (_e, id: number, newUrl: string) => this.relocate(id, newUrl))
    ipcMain.handle(I.libraryAutoMatch, () => this.autoMatchMissing())
    ipcMain.handle(I.libraryUpdateMeta, (_e, id: number, fields: Partial<Pick<MediaItem, 'title' | 'artist' | 'album'>>) => {
      this.repo.updateFields(id, fields)
      this.changed()
    })
  }

  addPaths(paths: string[]): number {
    let added = 0
    for (const p of paths) {
      try {
        const st = fs.statSync(p)
        if (st.isDirectory()) added += this.scanDirectory(p)
        else if (st.isFile() && isMediaExt(path.extname(p))) added += this.addFile(p) ? 1 : 0
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

  addFile(p: string): MediaItem | null {
    const kind = classifyFile(path.basename(p))
    if (!kind) return null
    const fileSize = this.localFileSize(p)
    const existing = this.repo.findByUrl(p)
    if (existing) {
      if (fileSize !== existing.fileSize) this.repo.updateFields(existing.id, { fileSize })
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

  scanDirectory(dir: string): number {
    let added = 0
    const stack = [dir]
    const visited = new Set<string>()
    while (stack.length) {
      const cur = stack.pop()!
      if (visited.has(cur) || stack.length > 4000) continue
      visited.add(cur)
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        const full = path.join(cur, ent.name)
        if (ent.isDirectory()) {
          if (!ent.name.startsWith('.') && ent.name !== 'node_modules') stack.push(full)
        } else if (ent.isFile() && isMediaExt(ent.name)) {
          const kind = classifyFile(ent.name)
          if (!kind) continue
          if (!this.repo.findByUrl(full)) {
            const fileSize = this.localFileSize(full)
            this.repo.insert({
              url: full,
              fileName: ent.name,
              isAudio: kind === 'audio',
              isImage: false,
              sourceId: null,
              remotePath: null,
              protocol: 'local',
              sourceName: '',
              sourceAvailable: true,
              fileSize
            })
            added++
          }
        }
      }
    }
    return added
  }

  setFavorite(id: number, fav: boolean): void {
    this.repo.updateFields(id, { favorite: fav })
    this.changed()
  }

  remove(ids: number[]): void {
    const items = ids.map((id) => this.repo.findById(id)).filter((x): x is MediaItem => !!x)
    if (!items.length) return
    this.beforeRemove(items)
    this.undoStack.push({ ids, items: items.map((item) => ({ ...item, coverPath: null, metaProbed: false })), expiresAt: Date.now() + 15_000 })
    while (this.undoStack.length > 5) this.undoStack.shift()
    this.repo.remove(ids)
    this.changed()
  }

  undo(): boolean {
    const top = this.undoStack.pop()
    if (!top || top.expiresAt < Date.now()) return false
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

  refreshAvailability(): void {
    const all = this.repo.loadAll()
    let changed = false
    for (const item of all) {
      if (item.protocol !== 'local') continue
      const exists = fs.existsSync(item.url)
      if (exists !== item.sourceAvailable) {
        this.repo.updateFields(item.id, { sourceAvailable: exists })
        changed = true
      }
    }
    if (changed) this.changed()
  }

  private changed(): void {
    this.broadcast(E.libraryChanged, this.snapshot())
    this.logger.info('library', `library changed, count=${this.repo.count()}`)
  }

  snapshot(): MediaItem[] {
    if (!this.localSizesRefreshed) {
      this.localSizesRefreshed = true
      for (const item of this.repo.loadAll()) {
        if (item.protocol !== 'local' || !item.sourceAvailable) continue
        const fileSize = this.localFileSize(item.url)
        if (fileSize !== item.fileSize) this.repo.updateFields(item.id, { fileSize })
      }
    }
    return this.repo.loadAll().filter((item) => !item.isImage)
  }

  private localFileSize(filePath: string): number {
    try {
      return fs.statSync(filePath).size
    } catch {
      return 0
    }
  }

  itemsByIds(ids: number[]): MediaItem[] {
    return ids.map((id) => this.repo.findById(id)).filter((x): x is MediaItem => !!x && !x.isImage)
  }
}
