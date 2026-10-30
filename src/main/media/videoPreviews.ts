import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app, ipcMain } from 'electron'
import { I, E } from '../../shared/channels'
import type { MediaItem, VideoPreviewFrame, VideoPreviewResult } from '../../shared/types'
import type { LibraryRepository } from '../library/repository'
import type { RemoteSourceManager } from '../remote/manager'
import type { Logger } from '../system/diagnostics'
import { openPreviewInput, PreviewReadLimitError } from './previewInput'
import { MediaToolMissingError, resolveMediaCommand } from './commands'

const execute = promisify(execFile)
const COUNT = 30

type Job = { mediaId: number; requestId: string; senderId: number; controller: AbortController }

export class VideoPreviewService {
  private current: Job | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private repo: LibraryRepository,
    private remote: RemoteSourceManager,
    private logger: Logger,
    private directory: string,
    private localCopy: (item: MediaItem) => string | null,
    private broadcast: (channel: string, payload: unknown) => void
  ) {}

  init(): void {
    ipcMain.handle(I.mediaVideoPreviews, (event, mediaId: number, requestId: string, refresh = false) => {
      if (!Number.isSafeInteger(mediaId) || typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)) throw new Error('Invalid preview request')
      this.current?.controller.abort()
      const job: Job = { mediaId, requestId, senderId: event.sender.id, controller: new AbortController() }
      this.current = job
      const task = this.queue.catch(() => {}).then(() => this.generate(job, refresh === true))
      this.queue = task
      return task.finally(() => { if (this.current === job) this.current = null })
    })
    ipcMain.handle(I.mediaVideoPreviewsCancel, (event, requestId: string) => {
      if (this.current?.requestId === requestId && this.current.senderId === event.sender.id) this.current.controller.abort()
    })
    app.once('before-quit', () => this.current?.controller.abort())
  }

  private async generate(job: Job, refresh: boolean): Promise<VideoPreviewResult> {
    const { mediaId, requestId, controller } = job
    const frames: VideoPreviewFrame[] = []
    let imagePath: string | undefined
    let errorReason: VideoPreviewResult['error']
    const result = (status: VideoPreviewResult['status']): VideoPreviewResult => ({ mediaId, requestId, frames: [...frames], imagePath, total: COUNT, status, error: errorReason })
    if (controller.signal.aborted) return result('cancelled')
    const item = this.repo.findById(mediaId)
    if (!item || item.isAudio || item.isImage) return result('error')
    let remoteInput: Awaited<ReturnType<typeof openPreviewInput>> | null = null
    try {
      const localPath = item.protocol === 'local' ? item.url : this.localCopy(item)
      if (!localPath && !item.sourceAvailable) return result('error')
      const stat = localPath ? await fs.promises.stat(localPath) : null
      if (stat && !stat.isFile()) throw new Error('Video file is missing')
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify([item.url, localPath, stat?.size ?? item.fileSize, stat?.mtimeMs])).digest('hex').slice(0, 20)
      const folder = path.join(this.directory, String(mediaId), fingerprint)
      const manifest = path.join(folder, 'frames.json')
      if (!refresh) {
        try {
          const cached = JSON.parse(await fs.promises.readFile(manifest, 'utf8')) as VideoPreviewFrame[]
          if (Array.isArray(cached) && cached.length === COUNT && cached.every((frame, index) => Number.isFinite(frame.time) && frame.path === path.join(folder, `${index}.jpg`) && fs.existsSync(frame.path))) {
            frames.push(...cached)
          }
        } catch { /* Missing or incomplete cache is regenerated. */ }
        if (frames.length === COUNT) {
          const sheet = path.join(folder, 'contact-10x3.jpg')
          imagePath = fs.existsSync(sheet) && fs.statSync(sheet).size > 0 ? sheet : await this.compose(folder, controller.signal)
          return result('ready')
        }
      }
      if (controller.signal.aborted) return result('cancelled')
      let input = localPath ?? ''
      if (!localPath) {
        remoteInput = await openPreviewInput(this.remote, item, controller.signal, { maxBytes: 256 * 1024 * 1024 })
        input = remoteInput.url
      }
      let duration = item.duration
      if (!(duration > 0 && Number.isFinite(duration))) {
        const { stdout } = await execute(resolveMediaCommand('ffprobe'), [
          '-v', 'error', '-select_streams', 'V:0', '-show_entries', 'format=duration:stream=duration', '-of', 'json', input
        ], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, signal: controller.signal })
        const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ duration?: string }> }
        duration = Number(parsed.format?.duration ?? parsed.streams?.[0]?.duration)
      }
      if (!(duration > 0 && Number.isFinite(duration))) throw new Error('Unknown video duration')
      await fs.promises.mkdir(folder, { recursive: true })
      for (let index = 0; index < COUNT; index++) {
        if (controller.signal.aborted) return result('cancelled')
        const time = duration * (index + 0.5) / COUNT
        const output = path.join(folder, `${index}.jpg`)
        // Do not expose files until a complete JPEG has been written.
        const temporary = path.join(folder, `${index}-${requestId}.tmp.jpg`)
        try {
          await execute(resolveMediaCommand('ffmpeg'), [
            '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            // Contact sheets need representative seek-point frames, not costly frame-exact decoding over the network.
            ...(remoteInput ? ['-noaccurate_seek'] : []), '-ss', time.toFixed(3), '-i', input,
            '-map', '0:V:0', '-frames:v', '1', '-an', '-sn',
            '-vf', 'scale=320:-2:out_range=full,format=yuvj420p', '-color_range', 'pc', '-q:v', '4', temporary
          ], { windowsHide: true, timeout: remoteInput ? 45000 : 20000, maxBuffer: 1024 * 1024, signal: controller.signal })
          if (!fs.existsSync(temporary) || !fs.statSync(temporary).size) throw new Error('Empty preview frame')
          await fs.promises.rename(temporary, output)
        } finally {
          await fs.promises.rm(temporary, { force: true }).catch(() => {})
        }
        frames.push({ time, path: output })
        this.broadcast(E.mediaVideoPreviewsProgress, result('generating'))
      }
      await fs.promises.writeFile(manifest, JSON.stringify(frames))
      imagePath = await this.compose(folder, controller.signal)
      return result('ready')
    } catch (error) {
      if (controller.signal.aborted) return result('cancelled')
      const readFailure = remoteInput?.failure()
      const reason = error instanceof PreviewReadLimitError ? error : readFailure instanceof PreviewReadLimitError ? readFailure : null
      const processError = error as { stderr?: string; code?: string | number; killed?: boolean }
      const stderr = processError.stderr?.trim()
      const detail = reason?.message ?? readFailure?.message ?? stderr ?? (error instanceof Error ? error.message : String(error))
      this.logger.warn('previews', `preview generation stopped media=${mediaId} frames=${frames.length}/${COUNT} remoteBytes=${remoteInput?.bytesRead() ?? 0} code=${processError.code ?? '-'} killed=${processError.killed ?? false} :: ${detail}${stderr && stderr !== detail ? `\n${stderr}` : ''}`)
      // A complete download is a separate user-confirmed action, never a fallback here.
      const missingTool = error instanceof MediaToolMissingError || (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      if (missingTool) errorReason = 'tool-missing'
      else if (reason) errorReason = reason.reason
      return result(!missingTool && frames.length < COUNT && item.protocol !== 'local' && reason ? 'needs-download' : 'error')
    } finally {
      remoteInput?.close()
    }
  }

  private async compose(folder: string, signal: AbortSignal): Promise<string> {
    const output = path.join(folder, 'contact-10x3.jpg')
    const temporary = path.join(folder, `contact-${crypto.randomUUID()}.tmp.jpg`)
    try {
      await execute(resolveMediaCommand('ffmpeg'), [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-framerate', '1', '-start_number', '0', '-i', path.join(folder, '%d.jpg'),
        '-vf', 'scale=320:180:force_original_aspect_ratio=decrease:out_range=full,format=yuvj420p,pad=320:180:(ow-iw)/2:(oh-ih)/2,setsar=1,tile=10x3:nb_frames=30:padding=2:margin=2:color=black',
        '-frames:v', '1', '-color_range', 'pc', '-q:v', '3', temporary
      ], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, signal })
      if (!fs.existsSync(temporary) || !fs.statSync(temporary).size) throw new Error('Contact sheet is empty')
      await fs.promises.rename(temporary, output)
      return output
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => {})
    }
  }
}
