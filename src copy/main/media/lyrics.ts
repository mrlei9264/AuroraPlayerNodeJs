import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'
import { I } from '../../shared/channels'
import type { LyricsData, LyricsLine } from '../../shared/types'
import { probeEmbeddedLyrics } from './tags'
import { requestBuffer } from '../system/networkProxy'

const TS_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

export function parseLrc(text: string): LyricsData {
  const lines: LyricsLine[] = []
  let title: string | undefined
  let artist: string | undefined
  let album: string | undefined
  let offsetMs = 0

  const raw = text.replace(/\r/g, '').split('\n')
  for (const line of raw) {
    const meta = line.match(/^\[(\w+):(.*)\]$/)
    if (meta) {
      const key = meta[1].toLowerCase()
      const val = meta[2].trim()
      if (key === 'ti' || key === 'title') title = val
      else if (key === 'ar' || key === 'artist') artist = val
      else if (key === 'al' || key === 'album') album = val
      else if (key === 'offset') offsetMs = parseInt(val, 10) || 0
      continue
    }
    TS_RE.lastIndex = 0
    const matches: { time: number }[] = []
    let m: RegExpExecArray | null
    while ((m = TS_RE.exec(line)) !== null) {
      const min = parseInt(m[1], 10)
      const sec = parseInt(m[2], 10)
      const fracStr = m[3]
      let frac = 0
      if (fracStr) {
        frac = parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10)
      }
      matches.push({ time: min * 60 + sec + frac / 1000 })
    }
    if (matches.length) {
      const text = line.replace(TS_RE, '').trim()
      for (const mm of matches) lines.push({ time: mm.time, text })
    } else if (!lines.length && line.trim()) {
      lines.push({ time: -1, text: line.trim() })
    }
  }
  lines.sort((a, b) => {
    if (a.time < 0 && b.time < 0) return 0
    if (a.time < 0) return 1
    if (b.time < 0) return -1
    return a.time - b.time
  })
  return { lines, title, artist, album, offsetMs, source: lines.length ? 'external' : 'none' }
}

export class LyricsService {
  constructor(
    private notify: (title: string, message: string) => void,
    private readRemote: (sourceId: number, remotePath: string) => Promise<Buffer | null>
  ) {}

  init(): void {
    ipcMain.handle(
      I.lyricsLoad,
      async (_e, mediaId: number, url: string, remote: boolean, sourceId?: number | null, remotePath?: string | null) => {
        try {
          if (remote) {
            if (sourceId != null && remotePath) return await this.loadRemoteStream(sourceId, remotePath)
            return await this.loadRemote(url)
          }
          return await this.loadLocal(mediaId, url)
        } catch {
          return { lines: [], offsetMs: 0, source: 'none' as const }
        }
      }
    )
  }

  private async loadLocal(mediaId: number, url: string): Promise<LyricsData> {
    const dir = path.dirname(url)
    const base = path.basename(url).replace(/\.[^.]+$/, '')
    const candidates = [path.join(dir, base + '.lrc'), path.join(dir, base + '.LRC')]
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          const text = fs.readFileSync(c, 'utf8')
          return { ...parseLrc(text), source: 'external' }
        } catch {
          void 0
        }
      }
    }
    const embedded = probeEmbeddedLyrics(url)
    if (embedded) {
      return { ...parseLrc(embedded), source: 'embedded' }
    }
    void mediaId
    return { lines: [], offsetMs: 0, source: 'none' }
  }

  private async loadRemoteStream(sourceId: number, remotePath: string): Promise<LyricsData> {
    try {
      const buf = await this.readRemote(sourceId, remotePath)
      if (buf && buf.length > 0) {
        const text = buf.toString('utf8')
        if (text.includes('[')) {
          return { ...parseLrc(text), source: 'external' }
        }
      }
    } catch {
      void 0
    }
    return { lines: [], offsetMs: 0, source: 'none' }
  }

  private async loadRemote(url: string): Promise<LyricsData> {
    try {
      const res = await requestBuffer(url, { timeoutMs: 5000, maxBytes: 2 * 1024 * 1024 })
      if (res.ok) {
        const text = res.data.toString('utf8')
        if (text.includes('[')) {
          return { ...parseLrc(text), source: 'external' }
        }
      }
    } catch {
      void 0
    }
    return { lines: [], offsetMs: 0, source: 'none' }
  }
}
