import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { cleanMediaText } from '../../shared/types'
import { repairLegacyTextEncoding } from '../util'

export function openDatabase(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  migrate(db)
  return db
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL DEFAULT '',
      is_audio INTEGER NOT NULL DEFAULT 0,
      is_image INTEGER NOT NULL DEFAULT 0,
      source_id INTEGER,
      remote_path TEXT,
      protocol TEXT NOT NULL DEFAULT 'local',
      source_name TEXT NOT NULL DEFAULT '',
      source_available INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      favorite INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      last_played_at INTEGER NOT NULL DEFAULT 0,
      last_position REAL NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0,
      cover_path TEXT,
      meta_probed INTEGER NOT NULL DEFAULT 0,
      scraped_metadata TEXT,
      scraped_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_media_is_audio ON media(is_audio);
    CREATE INDEX IF NOT EXISTS idx_media_favorite ON media(favorite);
    CREATE INDEX IF NOT EXISTS idx_media_source ON media(source_id);
    CREATE TABLE IF NOT EXISTS queue (
      position INTEGER PRIMARY KEY,
      media_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS playlist_entries (
      playlist_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_pl_entries_media ON playlist_entries(media_id);
    CREATE TABLE IF NOT EXISTS managed_folders (
      path TEXT PRIMARY KEY,
      last_scanned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      source_name TEXT NOT NULL DEFAULT '',
      remote_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      bytes_total INTEGER NOT NULL DEFAULT 0,
      bytes_done INTEGER NOT NULL DEFAULT 0,
      speed_bps INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'paused',
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      thread_count INTEGER NOT NULL DEFAULT 4,
      speed_limit_mbps REAL NOT NULL DEFAULT 0,
      segments_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at DESC);
    CREATE TABLE IF NOT EXISTS download_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      thread_count INTEGER NOT NULL DEFAULT 4,
      speed_limit_mbps REAL NOT NULL DEFAULT 0
    );
  `)
  const mediaColumns = db.prepare('PRAGMA table_info(media)').all() as { name: string }[]
  if (!mediaColumns.some((column) => column.name === 'file_size')) {
    db.exec('ALTER TABLE media ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0')
  }
  if (!mediaColumns.some((column) => column.name === 'scraped_metadata')) db.exec('ALTER TABLE media ADD COLUMN scraped_metadata TEXT')
  if (!mediaColumns.some((column) => column.name === 'scraped_at')) db.exec('ALTER TABLE media ADD COLUMN scraped_at INTEGER NOT NULL DEFAULT 0')
  const downloadColumns = db.prepare('PRAGMA table_info(downloads)').all() as { name: string }[]
  if (!downloadColumns.some((column) => column.name === 'thread_count')) db.exec('ALTER TABLE downloads ADD COLUMN thread_count INTEGER NOT NULL DEFAULT 4')
  if (!downloadColumns.some((column) => column.name === 'speed_limit_mbps')) db.exec('ALTER TABLE downloads ADD COLUMN speed_limit_mbps REAL NOT NULL DEFAULT 0')
  if (!downloadColumns.some((column) => column.name === 'segments_json')) db.exec("ALTER TABLE downloads ADD COLUMN segments_json TEXT NOT NULL DEFAULT '[]'")
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const version = row.user_version
  if (version < 5) {
    db.exec('PRAGMA user_version = 5')
  }
}

export type Db = DatabaseSync

export function rowToMedia(row: Record<string, unknown> | undefined): import('../../shared/types').MediaItem | null {
  if (!row) return null
  const protocol = String(row.protocol ?? 'local')
  let fileName = String(row.file_name ?? '')
  if ((protocol === 'http' || protocol === 'https') && /%[\da-f]{2}/i.test(fileName)) {
    try { fileName = decodeURIComponent(fileName) } catch { void 0 }
  }
  fileName = repairLegacyTextEncoding(fileName)
  return {
    id: row.id as number,
    url: String(row.url),
    fileName,
    isAudio: !!row.is_audio,
    isImage: !!row.is_image,
    sourceId: row.source_id as number | null,
    remotePath: row.remote_path ? String(row.remote_path) : null,
    protocol,
    sourceName: String(row.source_name ?? ''),
    sourceAvailable: !!row.source_available,
    title: cleanMediaText(repairLegacyTextEncoding(String(row.title ?? ''))),
    artist: cleanMediaText(repairLegacyTextEncoding(String(row.artist ?? ''))),
    album: cleanMediaText(repairLegacyTextEncoding(String(row.album ?? ''))),
    favorite: !!row.favorite,
    addedAt: (row.added_at as number) ?? 0,
    fileSize: Number(row.file_size ?? 0),
    lastPlayedAt: (row.last_played_at as number) ?? 0,
    lastPosition: Number(row.last_position ?? 0),
    duration: Number(row.duration ?? 0),
    coverPath: row.cover_path ? String(row.cover_path) : null,
    metaProbed: !!row.meta_probed,
    scrapedMetadata: parseScrapedMetadata(row.scraped_metadata),
    scrapedAt: Number(row.scraped_at ?? 0)
  }
}

function parseScrapedMetadata(value: unknown): import('../../shared/types').ScrapedMediaMetadata | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value) as import('../../shared/types').ScrapedMediaMetadata
    return parsed && typeof parsed.source === 'string' ? parsed : null
  } catch {
    return null
  }
}
