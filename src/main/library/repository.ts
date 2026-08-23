import fs from 'fs'
import path from 'path'
import type { Db } from './db'
import { rowToMedia } from './db'
import { cleanMediaText, type MediaItem } from '../../shared/types'

export interface MediaRowInput {
  url: string
  fileName: string
  isAudio: boolean
  isImage: boolean
  sourceId: number | null
  remotePath: string | null
  protocol: string
  sourceName: string
  sourceAvailable: boolean
  title?: string
  artist?: string
  album?: string
  duration?: number
  fileSize?: number
  coverPath?: string | null
}

export class LibraryRepository {
  constructor(private db: Db) {}

  insert(item: MediaRowInput): MediaItem {
    const now = Date.now()
    const res = this.db
      .prepare(
        `INSERT INTO media (url, file_name, is_audio, is_image, source_id, remote_path, protocol, source_name,
         source_available, title, artist, album, added_at, duration, file_size, cover_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.url,
        item.fileName,
        item.isAudio ? 1 : 0,
        item.isImage ? 1 : 0,
        item.sourceId,
        item.remotePath,
        item.protocol,
        item.sourceName,
        item.sourceAvailable ? 1 : 0,
        cleanMediaText(item.title),
        cleanMediaText(item.artist),
        cleanMediaText(item.album),
        now,
        item.duration ?? 0,
        item.fileSize ?? 0,
        item.coverPath ?? null
      )
    const id = Number(res.lastInsertRowid)
    return this.findById(id)!
  }

  upsertByUrl(item: MediaRowInput): MediaItem {
    const existing = this.findByUrl(item.url)
    if (existing) {
      this.updateFields(existing.id, {
        sourceAvailable: item.sourceAvailable,
        sourceId: item.sourceId,
        remotePath: item.remotePath,
        protocol: item.protocol,
        sourceName: item.sourceName,
        fileSize: item.fileSize
      })
      return this.findById(existing.id)!
    }
    return this.insert(item)
  }

  findById(id: number): MediaItem | null {
    const row = this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return rowToMedia(row)
  }

  findByUrl(url: string): MediaItem | null {
    const row = this.db.prepare('SELECT * FROM media WHERE url = ?').get(url) as Record<string, unknown> | undefined
    return rowToMedia(row)
  }

  loadAll(): MediaItem[] {
    const rows = this.db.prepare('SELECT * FROM media ORDER BY added_at DESC, id DESC').all() as Record<string, unknown>[]
    return rows.map((r) => rowToMedia(r)!).filter(Boolean)
  }

  updateFields(
    id: number,
    fields: Partial<
      Pick<
        MediaItem,
        | 'title'
        | 'artist'
        | 'album'
        | 'favorite'
        | 'duration'
        | 'fileSize'
        | 'coverPath'
        | 'metaProbed'
        | 'sourceAvailable'
        | 'sourceId'
        | 'remotePath'
        | 'protocol'
        | 'sourceName'
        | 'scrapedMetadata'
        | 'scrapedAt'
      >
    >
  ): void {
    const sets: string[] = []
    const vals: (string | number | null)[] = []
    const map: Record<string, string> = {
      title: 'title',
      artist: 'artist',
      album: 'album',
      favorite: 'favorite',
      duration: 'duration',
      fileSize: 'file_size',
      coverPath: 'cover_path',
      metaProbed: 'meta_probed',
      sourceAvailable: 'source_available',
      sourceId: 'source_id',
      remotePath: 'remote_path',
      protocol: 'protocol',
      sourceName: 'source_name',
      scrapedMetadata: 'scraped_metadata',
      scrapedAt: 'scraped_at'
    }
    for (const [k, col] of Object.entries(map)) {
      if (k in fields && fields[k as keyof typeof fields] !== undefined) {
        let v = fields[k as keyof typeof fields] as string | number | boolean | object | null
        if (k === 'title' || k === 'artist' || k === 'album') v = cleanMediaText(v)
        if (k === 'scrapedMetadata') v = v == null ? null : JSON.stringify(v)
        sets.push(`${col} = ?`)
        vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v as string | number | null)
      }
    }
    if (!sets.length) return
    vals.push(id)
    this.db.prepare(`UPDATE media SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  updatePlaybackState(mediaId: number, position: number, duration: number): void {
    this.db
      .prepare('UPDATE media SET last_position = ?, duration = ?, last_played_at = ? WHERE id = ?')
      .run(position, duration, Date.now(), mediaId)
  }

  updateUrl(id: number, newUrl: string): void {
    this.db.prepare('UPDATE media SET url = ?, file_name = ?, source_available = 1 WHERE id = ?').run(newUrl, path.basename(newUrl), id)
  }

  touchPlayed(mediaId: number): void {
    this.db.prepare('UPDATE media SET last_played_at = ? WHERE id = ?').run(Date.now(), mediaId)
  }

  remove(ids: number[]): void {
    for (const id of ids) {
      this.db.prepare('DELETE FROM queue WHERE media_id = ?').run(id)
      this.db.prepare('DELETE FROM playlist_entries WHERE media_id = ?').run(id)
      this.db.prepare('DELETE FROM media WHERE id = ?').run(id)
    }
    const queueIds = this.loadQueueIds()
    this.saveQueueIds(queueIds)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }
    return row.n
  }

  migrateCoverPaths(coverDirectory: string): number {
    const rows = this.db.prepare('SELECT id, cover_path FROM media WHERE cover_path IS NOT NULL').all() as { id: number; cover_path: string }[]
    let migrated = 0
    for (const row of rows) {
      if (fs.existsSync(row.cover_path)) continue
      const candidate = path.join(coverDirectory, path.basename(row.cover_path))
      if (!fs.existsSync(candidate)) continue
      this.db.prepare('UPDATE media SET cover_path = ? WHERE id = ?').run(candidate, row.id)
      migrated++
    }
    return migrated
  }

  loadQueueIds(): number[] {
    const rows = this.db.prepare('SELECT media_id FROM queue ORDER BY position').all() as { media_id: number }[]
    return rows.map((r) => r.media_id)
  }

  saveQueueIds(ids: number[]): void {
    this.db.prepare('DELETE FROM queue').run()
    const stmt = this.db.prepare('INSERT INTO queue (position, media_id) VALUES (?, ?)')
    ids.forEach((id, i) => stmt.run(i, id))
  }

  loadPlaylists(): { id: number; name: string; createdAt: number; mediaIds: number[] }[] {
    const rows = this.db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all() as { id: number; name: string; created_at: number }[]
    return rows.map((r) => {
      const entries = this.db.prepare('SELECT media_id FROM playlist_entries WHERE playlist_id = ? ORDER BY position').all(r.id) as { media_id: number }[]
      return { id: r.id, name: r.name, createdAt: r.created_at, mediaIds: entries.map((e) => e.media_id) }
    })
  }

  createPlaylist(name: string): number {
    const res = this.db.prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)').run(name, Date.now())
    return Number(res.lastInsertRowid)
  }

  renamePlaylist(id: number, name: string): void {
    this.db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, id)
  }

  removePlaylist(id: number): void {
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM playlist_entries WHERE playlist_id = ?').run(id)
  }

  addPlaylistEntry(playlistId: number, mediaId: number, position: number): void {
    this.db.prepare('INSERT OR IGNORE INTO playlist_entries (playlist_id, media_id, position) VALUES (?, ?, ?)').run(playlistId, mediaId, position)
  }

  removePlaylistEntry(playlistId: number, mediaId: number): void {
    const row = this.db.prepare('SELECT position FROM playlist_entries WHERE playlist_id = ? AND media_id = ?').get(playlistId, mediaId) as { position: number } | undefined
    if (!row) return
    this.db.prepare('DELETE FROM playlist_entries WHERE playlist_id = ? AND position = ?').run(playlistId, row.position)
    this.db.prepare('UPDATE playlist_entries SET position = position - 1 WHERE playlist_id = ? AND position > ?').run(playlistId, row.position)
  }

  movePlaylistEntry(playlistId: number, fromIndex: number, toIndex: number): void {
    const rows = this.db.prepare('SELECT media_id FROM playlist_entries WHERE playlist_id = ? ORDER BY position').all(playlistId) as { media_id: number }[]
    if (toIndex < 0 || toIndex >= rows.length) return
    const [moved] = rows.splice(fromIndex, 1)
    rows.splice(toIndex, 0, moved)
    this.db.prepare('DELETE FROM playlist_entries WHERE playlist_id = ?').run(playlistId)
    const stmt = this.db.prepare('INSERT INTO playlist_entries (playlist_id, media_id, position) VALUES (?, ?, ?)')
    rows.forEach((r, i) => stmt.run(playlistId, r.media_id, i))
  }

  referencesForMediaId(mediaId: number): { playlistId: number; playlistName: string }[] {
    return this.db
      .prepare(
        'SELECT p.id AS playlistId, p.name AS playlistName FROM playlist_entries pe JOIN playlists p ON p.id = pe.playlist_id WHERE pe.media_id = ?'
      )
      .all(mediaId) as { playlistId: number; playlistName: string }[]
  }

  loadManagedFolders(): { path: string; lastScanned: number }[] {
    return this.db.prepare('SELECT * FROM managed_folders ORDER BY path').all() as { path: string; lastScanned: number }[]
  }

  addManagedFolder(p: string): void {
    this.db.prepare('INSERT OR IGNORE INTO managed_folders (path, last_scanned) VALUES (?, 0)').run(p)
  }

  removeManagedFolder(p: string): void {
    this.db.prepare('DELETE FROM managed_folders WHERE path = ?').run(p)
  }

  markFolderScanned(p: string, at?: number): void {
    this.db.prepare('UPDATE managed_folders SET last_scanned = ? WHERE path = ?').run(at ?? Date.now(), p)
  }

  async migrateLegacyLibrary(legacyFile: string): Promise<number> {
    if (!fs.existsSync(legacyFile)) return 0
    try {
      const data = JSON.parse(fs.readFileSync(legacyFile, 'utf8')) as { items?: { url?: string; fileName?: string }[] }
      const items = Array.isArray(data) ? data : data.items
      if (!Array.isArray(items)) return 0
      let added = 0
      for (const it of items) {
        if (!it.url || !fs.existsSync(it.url)) continue
        const fileName = it.fileName ?? path.basename(it.url)
        this.insert({
          url: it.url,
          fileName,
          isAudio: false,
          isImage: false,
          sourceId: null,
          remotePath: null,
          protocol: 'local',
          sourceName: '',
          sourceAvailable: true
        })
        added++
      }
      if (added > 0) fs.renameSync(legacyFile, legacyFile + '.migrated')
      return added
    } catch {
      return 0
    }
  }
}
