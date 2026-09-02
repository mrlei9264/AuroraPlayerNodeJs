export interface MediaItem {
  id: number
  url: string
  fileName: string
  isAudio: boolean
  isImage: boolean
  sourceId: number | null
  remotePath: string | null
  protocol: string
  sourceName: string
  sourceAvailable: boolean
  title: string
  artist: string
  album: string
  favorite: boolean
  addedAt: number
  fileSize?: number
  lastPlayedAt: number
  lastPosition: number
  duration: number
  coverPath: string | null
  metaProbed: boolean
}

export function cleanMediaText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || /[\u0000-\u001f\u007f-\u009f\ufffd]/.test(text)) return ''
  return text
}

export interface QueueEntry {
  position: number
  mediaId: number
  title: string
  artist: string
  duration: number
  isAudio: boolean
  isImage: boolean
}

export interface Playlist {
  id: number
  name: string
  createdAt: number
  entries: QueueEntry[]
}

export interface ManagedFolder {
  path: string
  lastScanned: number
  scanning: boolean
  found: number
}

export type RemoteProtocol = 'http' | 'ftp' | 'ftps' | 'webdav' | 'smb' | 'sftp'

export interface RemoteSource {
  id: number
  name: string
  protocol: RemoteProtocol
  host: string
  port: number
  username: string
  basePath: string
  secure?: boolean
  tlsMode?: 'none' | 'explicit' | 'implicit'
  domain?: string
  authMode?: 'password' | 'privateKey'
  privateKeyPath?: string
  hasPassword: boolean
  autoReconnect?: boolean
  createdAt: number
}

export interface RemoteSourceInput {
  name: string
  protocol: RemoteProtocol
  host: string
  port: number
  username: string
  password: string
  basePath: string
  secure?: boolean
  tlsMode?: 'none' | 'explicit' | 'implicit'
  domain?: string
  authMode?: 'password' | 'privateKey'
  privateKeyPath?: string
  rememberPassword?: boolean
  autoReconnect?: boolean
}

export interface RemoteEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

export interface LyricsLine {
  time: number
  text: string
}

export interface LyricsData {
  lines: LyricsLine[]
  title?: string
  artist?: string
  album?: string
  offsetMs: number
  source: 'external' | 'embedded' | 'none'
}

export interface Chapter {
  title: string
  time: number
  duration: number
}

export interface TrackInfo {
  id: number
  title: string
  language: string
  /** ffprobe codec name; useful for deciding whether a subtitle can be rendered as text. */
  codec?: string
  /** Whether the container marks this track as the default. */
  default?: boolean
  width?: number
  height?: number
  profile?: string
  fps?: number
  pixelFormat?: string
  colorTransfer?: string
  colorPrimaries?: string
  bitDepth?: number
  hdrType?: string
  channels?: number
  channelLayout?: string
  sampleRate?: number
  bitrate?: number
  atmos?: boolean
}

export interface MediaTrackCatalog {
  video: TrackInfo[]
  audio: TrackInfo[]
  subtitles: TrackInfo[]
  chapters: Chapter[]
  width: number
  height: number
  fps: number
  videoCodec?: string
  videoProfile?: string
  pixelFormat?: string
  colorSpace?: string
  colorTransfer?: string
  colorPrimaries?: string
  bitDepth?: number
  hdrType?: string
}

export interface MediaAudioFeatures {
  atmos: boolean
  codec: string
  profile: string
  channels: number
  channelLayout: string
  sampleRate: number
  bitDepth: number
  bitrate: number
}

export interface MediaInfoData {
  duration: number
  width: number
  height: number
  bitrate: number
  fps: number
  hdr: boolean
  videoTracks: TrackInfo[]
  audioTracks: TrackInfo[]
  subtitleTracks: TrackInfo[]
  chapters: Chapter[]
}

export type SessionPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'error'
export type MediaKind = 'video' | 'audio'

export interface SessionState {
  phase: SessionPhase
  kind: MediaKind
  mediaId: number | null
  position: number
  duration: number
  paused: boolean
  loaded: boolean
  buffering: boolean
  /** Seconds of media buffered ahead of the current playback position. */
  bufferedSeconds?: number
  /** Actual bytes-per-second rate observed by the application's stream proxy. */
  networkSpeed?: number
  seeking: boolean
  idle: boolean
  error: string | null
  volume: number
  muted: boolean
  speed: number
  repeatMode: 'none' | 'all' | 'one'
  shuffle: boolean
  lastPositionKnown: number
}

export interface PlayRequest {
  mediaIds: number[]
  index: number
  action: 'play' | 'playNext' | 'playPrevious' | 'resume' | 'restart'
}

export type PlayPlanResult =
  | 'ready'
  | 'invalidRequest'
  | 'localFileMissing'
  | 'remoteSourceMissing'

export interface PlayPlan {
  ok: boolean
  result: PlayPlanResult
  item: MediaItem | null
  url: string
  kind: MediaKind
  resumePosition: number
}

export interface HudStats {
  cpu: number
  gpu: number
  memoryMb: number
  networkBps: number
  fps: number
  cpuUnavailable: boolean
  gpuUnavailable: boolean
}

export interface NotificationItem {
  id: number
  kind: 'info' | 'success' | 'error' | 'update'
  title: string
  message?: string
  action?: { label: string; handler: () => void }
}

export interface DownloadTask {
  id: number
  sourceId: number
  sourceName: string
  remotePath: string
  fileName: string
  localPath: string
  bytesTotal: number
  bytesDone: number
  speedBps: number
  status: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error'
  error: string | null
  createdAt: number
  threadCount: number
  speedLimitMbps: number
  segments: DownloadSegment[]
}

export interface DownloadSegment {
  start: number
  end: number
  done: number
}

export interface DownloadOptions {
  threadCount: number
  speedLimitMbps: number
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'uptodate' | 'error' | 'disabled'
  version?: string
  url?: string
  message?: string
}

export interface ProbeProgress {
  mode: 'single'
  running: boolean
  current: string | null
  completed: number
  total: number
  percent: number
  canceled: boolean
}

export interface FolderScanProgress {
  folder: string
  phase: 'scanning' | 'done' | 'error'
  found: number
  message?: string
}

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
}

export type Section =
  | 'home'
  | 'videos'
  | 'music'
  | 'playlists'
  | 'remote'
  | 'downloads'
  | 'settings'
  | 'library'
  | 'player'

export interface NavState {
  section: Section
  mediaId?: number
  playlistId?: number
  remoteTab?: 'sources' | 'config' | 'browser' | 'downloads'
  sourceId?: number
  remoteProtocol?: Exclude<RemoteProtocol, 'ftps'>
}

export interface NotificationRecord {
  id: string
  kind: 'info' | 'success' | 'error'
  title?: string
  message: string
  createdAt: number
}

export const MEDIA_VIDEO_EXTS = [
  'mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'asf', 'flv', 'f4v',
  'mpg', 'mpeg', 'mpe', 'm1v', 'm2v', 'vob', 'ts', 'm2ts', 'mts', '3gp',
  '3g2', 'ogv', 'ogm', 'rm', 'rmvb', 'divx', 'dv', 'mxf', 'wtv', 'nsv',
  'mj2', 'mjp2', 'm4p', 'f4p'
]
export const MEDIA_AUDIO_EXTS = [
  'mp3', 'mp2', 'mp1', 'mpa', 'flac', 'wav', 'aiff', 'aif', 'aifc', 'au',
  'snd', 'ogg', 'oga', 'ogx', 'm4a', 'm4b', 'aac', 'opus', 'wma', 'ape',
  'mka', 'amr', 'wv', 'tta', 'dts', 'ac3', 'eac3', 'dsf', 'dff', 'mpc',
  'mid', 'midi', 'ra', 'ram', 'spx', 'xm', 'mod', 's3m', 'it'
]
export const MEDIA_EXTS = [...MEDIA_VIDEO_EXTS, ...MEDIA_AUDIO_EXTS]

const extOf = (e: string): string => {
  const lower = e.toLowerCase().replace(/\\/g, '/')
  const idx = lower.lastIndexOf('.')
  return idx >= 0 ? lower.slice(idx + 1) : lower
}

export const isVideoExt = (e: string) => MEDIA_VIDEO_EXTS.includes(extOf(e))
export const isAudioExt = (e: string) => MEDIA_AUDIO_EXTS.includes(extOf(e))
export const isMediaExt = (e: string) => isVideoExt(e) || isAudioExt(e)

export function classifyFile(name: string): MediaKind | null {
  const idx = name.lastIndexOf('.')
  if (idx < 0) return null
  const ext = name.slice(idx + 1).toLowerCase()
  if (isVideoExt(ext)) return 'video'
  if (isAudioExt(ext)) return 'audio'
  return null
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export function formatBytes(n: number): string {
  if (!isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatBps(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB/s` : `${(n / 1024).toFixed(0)} KB/s`
}
