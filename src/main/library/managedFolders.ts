import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'
import { I, E } from '../../shared/channels'
import { isMediaExt } from '../../shared/types'
import type { MediaItem } from '../../shared/types'
import { LibraryRepository } from './repository'
import { Logger } from '../system/diagnostics'
import { pickFolder } from '../system/settings'

export interface FolderState {
  path: string
  lastScanned: number
  scanning: boolean
  found: number
}

export class ManagedFolderController {
  private scanning = new Set<string>()

  constructor(
    private repo: LibraryRepository,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void
  ) {}

  init(): void {
    ipcMain.handle(I.foldersList, () => this.list())
    ipcMain.handle(I.folderAdd, async (e) => {
      const win = require('electron').BrowserWindow.fromWebContents(e.sender)
      const dir = await pickFolder(win)
      if (!dir) return false
      this.repo.addManagedFolder(dir)
      this.emitChanged()
      void this.scanFolder(dir)
      return true
    })
    ipcMain.handle(I.folderRemove, (_e, folderPath: string) => {
      this.repo.removeManagedFolder(folderPath)
      this.emitChanged()
    })
    ipcMain.handle(I.folderScan, (_e, folderPath: string) => this.scanFolder(folderPath))
    ipcMain.handle(I.folderScanAll, () => {
      for (const f of this.repo.loadManagedFolders()) void this.scanFolder(f.path)
    })
  }

  list(): FolderState[] {
    return this.repo
      .loadManagedFolders()
      .map((f) => ({ path: f.path, lastScanned: f.lastScanned, scanning: this.scanning.has(f.path), found: 0 }))
  }

  private emitChanged(): void {
    this.broadcast(E.foldersChanged, this.list())
  }

  private scanFolder(folderPath: string): Promise<void> {
    if (this.scanning.has(folderPath)) return Promise.resolve()
    this.scanning.add(folderPath)
    this.emitChanged()
    return new Promise((resolve) => {
      setImmediate(() => {
        let found = 0
        const added = this.walk(folderPath, (fileName, full) => {
          found++
          if (this.repo.findByUrl(full)) return
          const kind = this.isAudioOrImage(fileName)
          this.repo.insert({
            url: full,
            fileName,
            isAudio: kind === 'audio',
            isImage: kind === 'image',
            sourceId: null,
            remotePath: null,
            protocol: 'local',
            sourceName: '',
            sourceAvailable: true
          })
        })
        this.repo.markFolderScanned(folderPath)
        this.scanning.delete(folderPath)
        this.broadcast(E.folderScanProgress, { folder: folderPath, phase: 'done', found })
        this.logger.info('managed-folder', `scan ${folderPath}: found=${found} added=${added}`)
        this.broadcast(E.libraryChanged, this.snapshot())
        this.emitChanged()
        resolve()
      })
    })
  }

  private walk(root: string, onFile: (fileName: string, full: string) => void): number {
    let added = 0
    const stack = [root]
    let guard = 0
    while (stack.length && guard < 60000) {
      guard++
      const cur = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        const full = path.join(cur, ent.name)
        if (ent.isDirectory()) {
          if (!ent.name.startsWith('.') && !ent.name.startsWith('$')) stack.push(full)
        } else if (ent.isFile() && isMediaExt(ent.name)) {
          onFile(ent.name, full)
          added++
        }
      }
    }
    return added
  }

  private isAudioOrImage(fileName: string): 'audio' | 'image' | 'video' {
    const ext = path.extname(fileName).slice(1).toLowerCase()
    const audio = ['mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'wma', 'ape', 'mka']
    const image = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico']
    if (audio.includes(ext)) return 'audio'
    if (image.includes(ext)) return 'image'
    return 'video'
  }

  private snapshot(): MediaItem[] {
    return this.repo.loadAll()
  }
}
