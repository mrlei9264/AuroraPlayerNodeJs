import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { I, E } from '../../shared/channels'
import { cleanMediaText, type Chapter, type MediaAudioFeatures, type MediaItem, type MediaTrackCatalog, type ProbeProgress, type TrackInfo } from '../../shared/types'
import { LibraryRepository } from '../library/repository'
import { Logger } from '../system/diagnostics'
import { probeTags } from './tags'
import ffmpegStaticPath from 'ffmpeg-static'
import { path as ffprobeStaticPath } from 'ffprobe-static'

const execFileAsync = promisify(execFile)
const ffmpegCommand = bundledCommand(ffmpegStaticPath, 'ffmpeg')
const ffprobeCommand = bundledCommand(ffprobeStaticPath, 'ffprobe')
const PROBE_CACHE_LIMIT = 256

function readLru<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

function writeLru<K, V>(cache: Map<K, V>, key: K, value: V): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > PROBE_CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

function bundledCommand(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback
  const unpackedCandidate = app.isPackaged
    ? candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : candidate
  return fs.existsSync(unpackedCandidate) ? unpackedCandidate : fallback
}

export interface CoverRecord {
  coverPath: string | null
  mime: string
}

interface EmbeddedMediaMetadata {
  title?: string
  artist?: string
  album?: string
  duration?: number
  cover?: Buffer
  coverMime?: string
}

type FfprobeAudioStream = {
  codec_name?: string
  codec_long_name?: string
  profile?: string
  channels?: number
  channel_layout?: string
  sample_rate?: string | number
  bits_per_sample?: number
  bits_per_raw_sample?: string | number
  bit_rate?: string | number
  tags?: Record<string, string>
  side_data_list?: Array<Record<string, unknown>>
}

type FfprobeDurationResult = {
  format?: { duration?: string | number }
  streams?: Array<{ duration?: string | number }>
}

type FfprobeTrackStream = {
  codec_type?: string
  codec_name?: string
  codec_long_name?: string
  disposition?: { default?: number }
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  profile?: string
  pix_fmt?: string
  color_space?: string
  color_transfer?: string
  color_primaries?: string
  bits_per_raw_sample?: string | number
  bits_per_sample?: string | number
  sample_rate?: string | number
  bit_rate?: string | number
  channel_layout?: string
  side_data_list?: Array<Record<string, unknown>>
  channels?: number
  tags?: Record<string, string>
}

type FfprobeChapter = {
  start_time?: string | number
  end_time?: string | number
  tags?: Record<string, string>
}

export function durationFromProbe(result: FfprobeDurationResult): number {
  const values = [result.format?.duration, ...(result.streams ?? []).map((stream) => stream.duration)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
  return values.length ? Math.max(...values) : 0
}

export function audioFeaturesFromStreams(streams: FfprobeAudioStream[]): MediaAudioFeatures {
  const primary = streams[0]
  if (!primary) return { atmos: false, codec: '', profile: '', channels: 0, channelLayout: '', sampleRate: 0, bitDepth: 0, bitrate: 0 }
  const atmos = streams.some((stream) => {
    const evidence = [
      stream.codec_name,
      stream.codec_long_name,
      stream.profile,
      stream.channel_layout,
      ...Object.values(stream.tags ?? {}),
      JSON.stringify(stream.side_data_list ?? [])
    ].filter(Boolean).join(' ').toLowerCase()
    return /\batmos\b|\bjoc\b|joint object coding|object.?based audio/.test(evidence)
  })
  return {
    atmos,
    codec: primary.codec_name ?? '',
    profile: primary.profile ?? '',
    channels: primary.channels ?? 0,
    channelLayout: primary.channel_layout ?? '',
    sampleRate: finitePositive(primary.sample_rate),
    bitDepth: finitePositive(primary.bits_per_raw_sample) || finitePositive(primary.bits_per_sample),
    bitrate: finitePositive(primary.bit_rate)
  }
}

function finitePositive(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function parseFrameRate(value?: string): number {
  if (!value) return 0
  const [numerator, denominator] = value.split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
}

function bitDepthFromPixelFormat(pixelFormat?: string): number {
  return Number(String(pixelFormat ?? '').match(/(?:p|yuv)\D*(10|12|16)(?:le|be)?$/i)?.[1]) || 0
}

function hdrTypeFromVideoStream(stream: FfprobeTrackStream): string {
  const evidence = [
    stream.profile,
    stream.color_transfer,
    stream.color_primaries,
    JSON.stringify(stream.side_data_list ?? [])
  ].filter(Boolean).join(' ').toLowerCase()
  if (/dolby.?vision|dovi/.test(evidence)) return 'Dolby Vision'
  if (/hdr10\+|smpte.?2094|dynamic hdr plus/.test(evidence)) return 'HDR10+'
  if (/smpte2084|smpte.?st.?2084|pq/.test(evidence)) return 'HDR10'
  if (/arib.?std.?b67|hlg/.test(evidence)) return 'HLG'
  return ''
}

function audioStreamHasAtmos(stream: FfprobeTrackStream): boolean {
  const evidence = [
    stream.codec_name,
    stream.codec_long_name,
    stream.profile,
    stream.channel_layout,
    ...Object.values(stream.tags ?? {}),
    JSON.stringify(stream.side_data_list ?? [])
  ].filter(Boolean).join(' ').toLowerCase()
  return /\batmos\b|\bjoc\b|joint object coding|object.?based audio/.test(evidence)
}

export class MediaProbeService {
  private pending: Map<number, { mediaId: number; url: string; remote: boolean }> = new Map()
  private running: number | null = null
  private canceled = false
  private progress: ProbeProgress = { mode: 'single', running: false, current: null, completed: 0, total: 0, percent: 0, canceled: false }
  private audioFeatureCache = new Map<number, MediaAudioFeatures>()
  private durationCache = new Map<number, number>()
  private trackCache = new Map<number, MediaTrackCatalog>()
  private coverDir: string

  constructor(
    private repo: LibraryRepository,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void,
    coverDirectory: string,
    private readRemoteTags: (item: MediaItem) => Promise<{ title?: string; artist?: string; album?: string; duration?: number; cover?: Buffer; coverMime?: string }>,
    private mediaUrlFor: (item: MediaItem) => string
  ) {
    this.coverDir = coverDirectory
    fs.mkdirSync(this.coverDir, { recursive: true })
  }

  init(): void {
    ipcMain.handle(I.probeGet, () => this.progress)
    ipcMain.handle(I.probeRequest, (_e, mediaIds: number | number[]) => {
      const ids = Array.isArray(mediaIds) ? mediaIds : [mediaIds]
      for (const id of ids) this.request(id)
    })
    ipcMain.handle(I.probeResult, (_e, mediaId: number, duration: number, coverDataUrl: string | null) => {
      this.consumeProbeResult(mediaId, duration, coverDataUrl)
    })
    ipcMain.handle(I.probeCancel, () => {
      this.canceled = true
    })
  }

  getCoverPath(mediaId: number): CoverRecord | null {
    const item = this.repo.findById(mediaId)
    if (!item) return null
    if (item.coverPath && fs.existsSync(item.coverPath)) return { coverPath: item.coverPath, mime: mimeFromPath(item.coverPath) }
    return null
  }

  async getChapters(mediaId: number): Promise<Chapter[]> {
    return (await this.getTracks(mediaId)).chapters
  }

  async getAudioFeatures(mediaId: number): Promise<MediaAudioFeatures> {
    const cached = readLru(this.audioFeatureCache, mediaId)
    if (cached) return cached
    const item = this.repo.findById(mediaId)
    const empty: MediaAudioFeatures = { atmos: false, codec: '', profile: '', channels: 0, channelLayout: '', sampleRate: 0, bitDepth: 0, bitrate: 0 }
    if (!item || item.isImage) return empty
    const input = item.protocol === 'local' ? item.url : this.mediaUrlFor(item)
    try {
      const { stdout } = await execFileAsync(ffprobeCommand, [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_streams',
        '-of', 'json',
        input
      ], { windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
      const parsed = JSON.parse(stdout) as { streams?: FfprobeAudioStream[] }
      const features = audioFeaturesFromStreams(parsed.streams ?? [])
      const current = this.repo.findById(mediaId)
      if (current?.url === item.url) writeLru(this.audioFeatureCache, mediaId, features)
      return features
    } catch (error) {
      this.logger.warn('probe', `audio feature probe failed media=${mediaId}`, error)
      return empty
    }
  }

  async getPlaybackDuration(mediaId: number): Promise<number> {
    const cached = readLru(this.durationCache, mediaId)
    if (cached) return cached
    const item = this.repo.findById(mediaId)
    if (!item || item.isImage) return 0
    const input = item.protocol === 'local' ? item.url : this.mediaUrlFor(item)
    try {
      const { stdout } = await execFileAsync(ffprobeCommand, [
        '-v', 'error',
        '-show_entries', 'format=duration:stream=duration',
        '-of', 'json',
        input
      ], { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 })
      const duration = durationFromProbe(JSON.parse(stdout) as FfprobeDurationResult)
      if (duration > 0) {
        const current = this.repo.findById(mediaId)
        if (current?.url === item.url) writeLru(this.durationCache, mediaId, duration)
        if (Math.abs(duration - item.duration) > 0.5) {
          this.repo.updateFields(mediaId, { duration })
          this.emitLibrary()
        }
        return duration
      }
    } catch {
      void 0
    }
    return item.duration > 0 && Number.isFinite(item.duration) ? item.duration : 0
  }

  async getTracks(mediaId: number): Promise<MediaTrackCatalog> {
    const empty: MediaTrackCatalog = { video: [], audio: [], subtitles: [], chapters: [], width: 0, height: 0, fps: 0 }
    const cached = readLru(this.trackCache, mediaId)
    if (cached) return cached
    const item = this.repo.findById(mediaId)
    if (!item || item.isImage) return empty
    const input = item.protocol === 'local' ? item.url : this.mediaUrlFor(item)
    try {
      const { stdout } = await execFileAsync(ffprobeCommand, [
        '-v', 'error',
        '-show_streams',
        '-show_chapters',
        '-of', 'json',
        input
      ], { windowsHide: true, timeout: 45_000, maxBuffer: 8 * 1024 * 1024 })
      const parsed = JSON.parse(stdout) as { streams?: FfprobeTrackStream[]; chapters?: FfprobeChapter[] }
      const video: TrackInfo[] = []
      const audio: TrackInfo[] = []
      const subtitles: TrackInfo[] = []
      let width = 0
      let height = 0
      let fps = 0
      let primaryVideo: FfprobeTrackStream | undefined
      for (const stream of parsed.streams ?? []) {
        const kind = stream.codec_type
        const ordinal = kind === 'video' ? video.length : kind === 'audio' ? audio.length : kind === 'subtitle' ? subtitles.length : -1
        if (ordinal < 0) continue
        const tags = stream.tags ?? {}
        const title = cleanMediaText(tags.title) || cleanMediaText(tags.handler_name)
        const language = cleanMediaText(tags.language)
        const info: TrackInfo = {
          id: ordinal,
          title: title || `${kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Subtitle'} ${ordinal + 1}`,
          language,
          codec: cleanMediaText(stream.codec_name),
          default: Number(stream.disposition?.default) === 1
        }
        if (kind === 'video') {
          if (!primaryVideo) primaryVideo = stream
          info.width = Number(stream.width) || undefined
          info.height = Number(stream.height) || undefined
          info.profile = cleanMediaText(stream.profile)
          info.fps = parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate)
          info.pixelFormat = cleanMediaText(stream.pix_fmt)
          info.colorTransfer = cleanMediaText(stream.color_transfer)
          info.colorPrimaries = cleanMediaText(stream.color_primaries)
          info.bitDepth = finitePositive(stream.bits_per_raw_sample) || bitDepthFromPixelFormat(stream.pix_fmt)
          info.hdrType = hdrTypeFromVideoStream(stream)
          video.push(info)
          if (!width && Number.isFinite(stream.width)) width = Number(stream.width)
          if (!height && Number.isFinite(stream.height)) height = Number(stream.height)
          if (!fps) fps = parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate)
        } else if (kind === 'audio') {
          info.profile = cleanMediaText(stream.profile)
          info.channels = finitePositive(stream.channels)
          info.channelLayout = cleanMediaText(stream.channel_layout)
          info.sampleRate = finitePositive(stream.sample_rate)
          info.bitDepth = finitePositive(stream.bits_per_raw_sample) || finitePositive(stream.bits_per_sample)
          info.bitrate = finitePositive(stream.bit_rate)
          info.atmos = audioStreamHasAtmos(stream)
          audio.push(info)
        } else {
          subtitles.push(info)
        }
      }
      const chapters = chaptersFromProbe(parsed.chapters ?? [])
      const colorTransfer = cleanMediaText(primaryVideo?.color_transfer)
      const hdrType = primaryVideo ? hdrTypeFromVideoStream(primaryVideo) : ''
      const pixelFormat = cleanMediaText(primaryVideo?.pix_fmt)
      const pixelBitDepth = bitDepthFromPixelFormat(pixelFormat)
      const result: MediaTrackCatalog = {
        video, audio, subtitles, chapters, width, height, fps,
        videoCodec: cleanMediaText(primaryVideo?.codec_name),
        videoProfile: cleanMediaText(primaryVideo?.profile),
        pixelFormat,
        colorSpace: cleanMediaText(primaryVideo?.color_space),
        colorTransfer,
        colorPrimaries: cleanMediaText(primaryVideo?.color_primaries),
        bitDepth: finitePositive(primaryVideo?.bits_per_raw_sample) || pixelBitDepth,
        hdrType
      }
      const current = this.repo.findById(mediaId)
      if (current?.url === item.url) writeLru(this.trackCache, mediaId, result)
      return result
    } catch (error) {
      this.logger.warn('probe', `track probe failed media=${mediaId}`, error)
      return empty
    }
  }

  request(mediaId: number): boolean {
    const item = this.repo.findById(mediaId)
    if (!item || item.isImage) return false
    // Automatic probing is a one-shot operation. A failed cover must not turn
    // libraryChanged into an endless retry loop; requestAll(true) is the
    // explicit retry path exposed by Settings.
    if (item.metaProbed) return false
    if (this.pending.has(mediaId) || this.running === mediaId) return false
    this.pending.set(mediaId, { mediaId, url: item.url, remote: item.protocol !== 'local' })
    this.drain()
    return true
  }

  regenerateCover(mediaId: number): boolean {
    const item = this.repo.findById(mediaId)
    if (!item || item.isImage) return false
    this.forgetMedia(mediaId)
    this.removeTemporaryCover(item.coverPath)
    this.repo.updateFields(mediaId, { metaProbed: false, coverPath: null })
    return this.request(mediaId)
  }

  removeTemporaryCover(coverPath: string | null): void {
    if (!coverPath) return
    const resolved = path.resolve(coverPath)
    if (path.dirname(resolved) !== path.resolve(this.coverDir)) return
    try {
      fs.rmSync(resolved, { force: true })
    } catch {
      void 0
    }
  }

  cancel(): void {
    this.canceled = true
    this.pending.clear()
    this.setProgress({ ...this.progress, running: this.running !== null, canceled: true })
  }

  forgetMedia(mediaId: number): void {
    this.pending.delete(mediaId)
    this.audioFeatureCache.delete(mediaId)
    this.durationCache.delete(mediaId)
    this.trackCache.delete(mediaId)
  }

  private async drain(): Promise<void> {
    if (this.running !== null) return
    const next = this.pending.values().next()
    if (next.done) {
      this.setProgress({ ...this.progress, running: false })
      return
    }
    const job = next.value
    this.pending.delete(job.mediaId)
    this.running = job.mediaId
    this.canceled = false
    this.setProgress({
      mode: 'single',
      running: true,
      current: job.url,
      completed: 0,
      total: 1,
      percent: 0,
      canceled: false
    })
    try {
      const item = this.repo.findById(job.mediaId)
      if (item && !this.canceled) {
        if (item.protocol === 'local' && !fs.existsSync(item.url)) {
          this.repo.updateFields(item.id, { sourceAvailable: false, metaProbed: true })
          this.emitLibrary()
        } else if (item.protocol !== 'local') {
          const remote = await this.readRemoteTags(item)
          await this.finishProbe(item, remote)
          this.emitLibrary()
        } else {
          const tags = probeTags(job.url)
          await this.finishProbe(item, tags)
          this.emitLibrary()
        }
      }
    } catch (err) {
      this.logger.warn('probe', `probe failed for ${job.url}`, err as Error)
    }
    this.running = null
    void this.drain()
  }

  private async finishProbe(item: MediaItem, metadata: EmbeddedMediaMetadata): Promise<void> {
    const isVideo = !item.isAudio && !item.isImage
    let coverPath: string | null = null
    if (metadata.cover) coverPath = this.saveCover(item.id, metadata.cover, metadata.coverMime ?? 'image/jpeg')
    if (!coverPath && isVideo) coverPath = await this.captureVideoFrame(item)

    this.repo.updateFields(item.id, {
      title: metadata.title ?? item.title,
      artist: metadata.artist ?? item.artist,
      album: metadata.album ?? item.album,
      duration: metadata.duration ?? item.duration,
      coverPath: coverPath ?? item.coverPath,
      // Record the attempt even if both capture methods fail. Otherwise every
      // library refresh immediately starts the same expensive work again.
      metaProbed: true
    })
  }

  private async captureVideoFrame(item: MediaItem): Promise<string | null> {
    const output = path.join(this.coverDir, `${item.id}.jpg`)
    const targetSeconds = item.duration > 0 ? Math.min(10, Math.max(0.2, item.duration * 0.1)) : 2
    const input = item.protocol === 'local' ? item.url : this.mediaUrlFor(item)
    try {
      await execFileAsync(ffmpegCommand, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', targetSeconds.toFixed(2), '-i', input,
        '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', output
      ], { windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024 })
      if (fs.existsSync(output) && fs.statSync(output).size > 0) return output
    } catch {
      // Frame capture failures are expected for unavailable files, unsupported
      // codecs, and systems without FFmpeg. Continue silently with the renderer
      // fallback instead of flooding the terminal.
    }
    try {
      if (fs.existsSync(output) && fs.statSync(output).size === 0) fs.unlinkSync(output)
    } catch {
      void 0
    }
    this.broadcast(E.probeFrameRequested, { mediaId: item.id, url: this.mediaUrlFor(item) })
    return null
  }

  private consumeProbeResult(mediaId: number, duration: number, coverDataUrl: string | null): void {
    const item = this.repo.findById(mediaId)
    if (!item) return
    const updates: Partial<Pick<MediaItem, 'duration' | 'metaProbed' | 'coverPath'>> = {}
    if (duration > 0 && !item.duration) updates.duration = duration
    if (coverDataUrl) {
      const [meta, b64] = coverDataUrl.split(',')
      if (b64) {
        const mime = (meta.match(/data:(.*?);/) ?? [])[1] ?? 'image/jpeg'
        const saved = this.saveCover(mediaId, Buffer.from(b64, 'base64'), mime)
        if (saved) updates.coverPath = saved
      }
    }
    updates.metaProbed = true
    this.repo.updateFields(mediaId, updates)
    this.emitLibrary()
    this.setProgress({ ...this.progress, running: false, percent: 100 })
  }

  private saveCover(mediaId: number, data: Buffer, mime: string): string | null {
    try {
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('bmp') ? 'bmp' : 'jpg'
      const file = path.join(this.coverDir, `${mediaId}.${ext}`)
      for (const candidateExt of ['jpg', 'png', 'webp', 'bmp']) {
        if (candidateExt !== ext) fs.rmSync(path.join(this.coverDir, `${mediaId}.${candidateExt}`), { force: true })
      }
      fs.writeFileSync(file, data)
      return file
    } catch (err) {
      this.logger.warn('probe', 'cover save failed', err as Error)
      return null
    }
  }

  private setProgress(p: ProbeProgress): void {
    this.progress = p
    this.broadcast(E.probeProgress, p)
  }

  private emitLibrary(): void {
    this.broadcast(E.libraryChanged, this.repo.loadAll())
  }
}

function chaptersFromProbe(raw: FfprobeChapter[]): Chapter[] {
  return raw
    .map((chapter, index): Chapter | null => {
      const time = Number(chapter.start_time)
      const end = Number(chapter.end_time)
      if (!Number.isFinite(time) || time < 0) return null
      const title = cleanMediaText(chapter.tags?.title) || `Chapter ${index + 1}`
      return { title, time, duration: Number.isFinite(end) && end > time ? end - time : 0 }
    })
    .filter((chapter): chapter is Chapter => chapter !== null)
    .sort((a, b) => a.time - b.time)
}

export function fingerprintFor(pathOrUrl: string, size: number): string {
  return crypto.createHash('sha1').update(`${pathOrUrl}|${size}`).digest('hex').slice(0, 16)
}

function mimeFromPath(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/jpeg'
}
