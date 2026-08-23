import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { ipcMain, shell } from 'electron'
import { I, E } from '../../shared/channels'
import type { DownloadOptions, DownloadSegment, DownloadTask } from '../../shared/types'
import { nextId, safeBaseName } from '../util'
import { RemoteSourceManager } from './manager'
import { Logger } from '../system/diagnostics'
import type { Db } from '../library/db'

type ActivePart = { stream: Readable; writer: fs.WriteStream; segment: DownloadSegment; initialDone: number }
class RangeUnsupportedError extends Error {}
const MIN_SEGMENT_BYTES = 8 * 1024 * 1024

export class DownloadManager {
  private tasks: DownloadTask[] = []
  private running = new Set<number>()
  private active = new Map<number, Set<ActivePart>>()
  private progressTicks = new Map<number, { at: number; bytes: number }>()
  private throttleSlots = new Map<number, number>()
  private options: DownloadOptions = { threadCount: 4, speedLimitMbps: 0 }

  constructor(
    private manager: RemoteSourceManager,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void,
    private downloadDir: string,
    private db: Db
  ) {}

  init(): void {
    this.options = this.loadOptions()
    this.tasks = this.loadTasks()
    this.persistTasks()
    ipcMain.handle(I.downloadsList, () => this.tasks)
    ipcMain.handle(I.downloadOptionsGet, () => this.options)
    ipcMain.handle(I.downloadOptionsSet, (_e, input: Partial<DownloadOptions>) => this.setOptions(input))
    ipcMain.handle(I.downloadStart, async (_e, sourceId: number, remotePath: string, relativePath?: string) => this.start(sourceId, remotePath, relativePath))
    ipcMain.handle(I.downloadCancel, async (_e, id: number) => this.cancel(id))
    ipcMain.handle(I.downloadPause, async (_e, id: number) => this.pause(id))
    ipcMain.handle(I.downloadResume, (_e, id: number) => this.resume(id))
    ipcMain.handle(I.downloadRemove, async (_e, id: number, deleteLocalFile: boolean) => this.remove(id, deleteLocalFile))
    ipcMain.handle(I.downloadRetry, (_e, id: number) => this.retry(id))
    ipcMain.handle(I.downloadOpenFolder, (_e, id: number) => {
      const task = this.tasks.find((item) => item.id === id)
      if (task && fs.existsSync(path.dirname(task.localPath))) void shell.openPath(path.dirname(task.localPath))
    })
  }

  private loadOptions(): DownloadOptions {
    const row = this.db.prepare('SELECT thread_count, speed_limit_mbps FROM download_settings WHERE id = 1').get() as Record<string, unknown> | undefined
    return { threadCount: clampThreads(Number(row?.thread_count ?? 4)), speedLimitMbps: clampSpeed(Number(row?.speed_limit_mbps ?? 0)) }
  }

  private async setOptions(input: Partial<DownloadOptions>): Promise<DownloadOptions> {
    const previousThreads = this.options.threadCount
    this.options = {
      threadCount: clampThreads(Number(input.threadCount ?? this.options.threadCount)),
      speedLimitMbps: clampSpeed(Number(input.speedLimitMbps ?? this.options.speedLimitMbps))
    }
    this.db.prepare(`INSERT INTO download_settings (id, thread_count, speed_limit_mbps) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET thread_count = excluded.thread_count, speed_limit_mbps = excluded.speed_limit_mbps`)
      .run(this.options.threadCount, this.options.speedLimitMbps)
    this.throttleSlots.clear()

    const threadCountChanged = previousThreads !== this.options.threadCount
    const restartIds: number[] = []
    for (const task of this.tasks) {
      if (task.status === 'completed' || task.status === 'cancelled') continue
      task.speedLimitMbps = this.options.speedLimitMbps
      if (!threadCountChanged || task.threadCount === this.options.threadCount) continue
      task.threadCount = this.options.threadCount
      task.speedBps = 0
      if (this.running.has(task.id)) {
        task.status = 'paused'
        restartIds.push(task.id)
      } else if (task.bytesTotal > 0 && segmentsCoverTotal(task.segments, task.bytesTotal)) {
        task.segments = rebalanceSegments(task.segments, task.bytesTotal, task.threadCount)
        task.bytesDone = sumSegmentBytes(task.segments)
      }
    }
    this.emit()
    await Promise.all(restartIds.map((id) => this.stopActive(id)))
    await Promise.all(restartIds.map((id) => this.waitForTaskStopped(id)))
    for (const id of restartIds) {
      const task = this.tasks.find((item) => item.id === id)
      if (!task || task.status !== 'paused') continue
      if (task.bytesTotal > 0 && segmentsCoverTotal(task.segments, task.bytesTotal)) {
        task.segments = rebalanceSegments(task.segments, task.bytesTotal, task.threadCount)
        task.bytesDone = sumSegmentBytes(task.segments)
      }
      task.status = 'queued'
      void this.runTask(task)
    }
    if (restartIds.length > 0) this.emit()
    return this.options
  }

  private emit(): void {
    this.persistTasks()
    this.broadcast(E.downloadsChanged, this.tasks.map((task) => ({ ...task, segments: task.segments.map((segment) => ({ ...segment })) })))
  }

  private async waitForTaskStopped(id: number): Promise<void> {
    const deadline = Date.now() + 2000
    while (this.running.has(id) && Date.now() < deadline) await wait(20)
  }

  private loadTasks(): DownloadTask[] {
    const rows = this.db.prepare('SELECT * FROM downloads ORDER BY created_at DESC, id DESC').all() as Record<string, unknown>[]
    return rows.map((row) => {
      const localPath = String(row.local_path ?? '')
      const status = String(row.status) as DownloadTask['status']
      let restoredStatus = status === 'running' || status === 'queued' ? 'paused' : status
      let error = row.error == null ? null : String(row.error)
      if (restoredStatus === 'completed' && !fs.existsSync(localPath)) {
        restoredStatus = 'error'
        error = 'Downloaded file is missing'
      }
      const segments = parseSegments(row.segments_json)
      const persistedBytes = Number(row.bytes_done ?? 0)
      const legacyPartPath = localPath + '.part'
      const legacyBytes = segments.length === 0 && fs.existsSync(legacyPartPath) ? fs.statSync(legacyPartPath).size : persistedBytes
      return {
        id: Number(row.id), sourceId: Number(row.source_id), sourceName: String(row.source_name ?? ''),
        remotePath: String(row.remote_path ?? ''), fileName: String(row.file_name ?? ''), localPath,
        bytesTotal: Number(row.bytes_total ?? 0), bytesDone: segments.length > 0 ? sumSegmentBytes(segments) : legacyBytes,
        speedBps: 0, status: restoredStatus, error, createdAt: Number(row.created_at ?? 0),
        threadCount: clampThreads(Number(row.thread_count ?? 4)), speedLimitMbps: clampSpeed(Number(row.speed_limit_mbps ?? 0)), segments
      }
    })
  }

  private persistTasks(): void {
    const statement = this.db.prepare(`
      INSERT INTO downloads (id, source_id, source_name, remote_path, file_name, local_path, bytes_total, bytes_done, speed_bps, status, error, created_at, thread_count, speed_limit_mbps, segments_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id, source_name = excluded.source_name, remote_path = excluded.remote_path,
        file_name = excluded.file_name, local_path = excluded.local_path, bytes_total = excluded.bytes_total,
        bytes_done = excluded.bytes_done, speed_bps = excluded.speed_bps, status = excluded.status,
        error = excluded.error, created_at = excluded.created_at, thread_count = excluded.thread_count,
        speed_limit_mbps = excluded.speed_limit_mbps, segments_json = excluded.segments_json`)
    for (const task of this.tasks) {
      statement.run(task.id, task.sourceId, task.sourceName, task.remotePath, task.fileName, task.localPath,
        task.bytesTotal, task.bytesDone, task.speedBps, task.status, task.error, task.createdAt,
        task.threadCount, task.speedLimitMbps, JSON.stringify(task.segments))
    }
  }

  async start(sourceId: number, remotePath: string, relativePath?: string): Promise<DownloadTask | null> {
    const source = this.manager.getSource(sourceId)
    if (!source) return null
    const fileName = safeBaseName(remotePath)
    const localPath = path.join(this.downloadDir, sanitizeRelativePath(relativePath || fileName))
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    const task: DownloadTask = {
      id: nextId(), sourceId, sourceName: source.name, remotePath, fileName, localPath,
      bytesTotal: 0, bytesDone: 0, speedBps: 0, status: 'queued', error: null, createdAt: Date.now(),
      threadCount: this.options.threadCount, speedLimitMbps: this.options.speedLimitMbps, segments: []
    }
    this.tasks.unshift(task)
    this.emit()
    void this.runTask(task)
    return task
  }

  private async runTask(task: DownloadTask): Promise<void> {
    if (this.running.has(task.id)) return
    this.running.add(task.id)
    task.status = 'running'
    task.error = null
    task.speedBps = 0
    this.progressTicks.set(task.id, { at: Date.now(), bytes: task.bytesDone })
    this.emit()
    const tmpPath = task.localPath + '.part'
    try {
      const stat = await this.manager.stat(task.sourceId, task.remotePath)
      if (task.status !== 'running') return
      task.bytesTotal = stat?.size ?? 0
      if (task.bytesTotal <= 0) throw new Error('Remote file size is unavailable')
      const desiredThreads = Math.min(task.threadCount, Math.max(1, Math.ceil(task.bytesTotal / MIN_SEGMENT_BYTES)))
      if (!segmentsCoverTotal(task.segments, task.bytesTotal)) task.segments = createSegments(task.bytesTotal, desiredThreads, task.bytesDone)
      else task.segments = rebalanceSegments(task.segments, task.bytesTotal, desiredThreads)
      task.bytesDone = sumSegmentBytes(task.segments)
      await preparePartialFile(tmpPath, task.bytesTotal)
      const pending = task.segments.filter((segment) => segment.done < segmentLength(segment))
      let pendingIndex = 0
      const worker = async () => {
        while (task.status === 'running') {
          const segment = pending[pendingIndex++]
          if (!segment) return
          await this.downloadSegment(task, segment, tmpPath)
        }
      }
      const workerCount = Math.min(desiredThreads, pending.length)
      const results = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()))
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
      if (this.taskWasStopped(task)) return
      if (!task.segments.every((segment) => segment.done >= segmentLength(segment))) throw new Error('Download ended before all segments completed')
      if (fs.existsSync(task.localPath)) await fs.promises.rm(task.localPath, { force: true })
      await fs.promises.rename(tmpPath, task.localPath)
      task.status = 'completed'
      task.speedBps = 0
      task.bytesDone = task.bytesTotal
    } catch (error) {
      await this.stopActive(task.id)
      if (error instanceof RangeUnsupportedError && task.threadCount > 1 && !this.taskWasStopped(task)) {
        task.threadCount = 1
        task.segments = createSegments(task.bytesTotal, 1, 0)
        task.bytesDone = 0
        task.status = 'queued'
      } else if (!this.taskWasStopped(task)) {
        task.status = 'error'
        task.error = error instanceof Error ? error.message : String(error)
        this.logger.warn('download', `download failed for ${task.remotePath}`, error as Error)
      }
    } finally {
      task.bytesDone = sumSegmentBytes(task.segments)
      this.active.delete(task.id)
      this.progressTicks.delete(task.id)
      this.throttleSlots.delete(task.id)
      this.running.delete(task.id)
      this.emit()
      if (task.status === 'queued' && this.tasks.includes(task)) void this.runTask(task)
    }
  }

  private async downloadSegment(task: DownloadTask, segment: DownloadSegment, tmpPath: string): Promise<void> {
    const initialDone = segment.done
    const start = segment.start + initialDone
    const expected = segment.end - start + 1
    const result = await this.manager.openDownloadStream(task.sourceId, task.remotePath, start, segment.end)
    if (!result) throw new Error('Cannot open remote stream')
    const source = this.manager.getSource(task.sourceId)
    if (source?.protocol === 'http' && result.contentLength != null && result.contentLength > expected) {
      ;(result.stream as Readable).destroy()
      throw new RangeUnsupportedError('Server does not support byte ranges')
    }
    if (task.status !== 'running') {
      ;(result.stream as Readable).destroy()
      return
    }
    const stream = result.stream as Readable
    const writer = fs.createWriteStream(tmpPath, { flags: 'r+', start })
    const active: ActivePart = { stream, writer, segment, initialDone }
    const set = this.active.get(task.id) ?? new Set<ActivePart>()
    set.add(active)
    this.active.set(task.id, set)
    let received = 0
    try {
      for await (const value of stream) {
        if (task.status !== 'running') break
        const sourceChunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
        const remaining = expected - received
        if (remaining <= 0) break
        const chunk = sourceChunk.length > remaining ? sourceChunk.subarray(0, remaining) : sourceChunk
        received += chunk.length
        await this.throttle(task, chunk.length)
        if (task.status !== 'running') break
        if (!writer.write(chunk)) await waitForDrain(writer)
        segment.done = initialDone + writer.bytesWritten
        this.updateProgress(task)
        if (received >= expected) break
      }
      await endWriter(writer)
      segment.done = initialDone + writer.bytesWritten
      if (task.status === 'running' && segment.done < segmentLength(segment)) throw new Error('Remote stream ended early')
    } catch (error) {
      segment.done = initialDone + writer.bytesWritten
      if (!this.taskWasStopped(task)) throw error
    } finally {
      writer.destroy()
      stream.destroy()
      set.delete(active)
      this.updateProgress(task, true)
    }
  }

  /** Reserve bandwidth on one task-wide timeline so all segments share one real limit. */
  private async throttle(task: DownloadTask, bytes: number): Promise<void> {
    if (task.speedLimitMbps <= 0 || bytes <= 0) return
    const bytesPerSecond = task.speedLimitMbps * 1024 * 1024
    const now = Date.now()
    const slotStart = Math.max(now, this.throttleSlots.get(task.id) ?? now)
    const slotEnd = slotStart + (bytes / bytesPerSecond) * 1000
    this.throttleSlots.set(task.id, slotEnd)
    let remaining = slotEnd - now
    while (remaining > 1 && task.status === 'running') {
      await wait(Math.min(remaining, 200))
      remaining = slotEnd - Date.now()
    }
  }

  private updateProgress(task: DownloadTask, force = false): void {
    task.bytesDone = sumSegmentBytes(task.segments)
    const tick = this.progressTicks.get(task.id) ?? { at: Date.now(), bytes: task.bytesDone }
    const now = Date.now()
    if (force || now - tick.at >= 600) {
      task.speedBps = Math.max(0, Math.round((task.bytesDone - tick.bytes) * 1000 / Math.max(1, now - tick.at)))
      this.progressTicks.set(task.id, { at: now, bytes: task.bytesDone })
      this.emit()
    }
  }

  private async stopActive(id: number): Promise<void> {
    const active = [...(this.active.get(id) ?? [])]
    for (const part of active) { part.stream.destroy(); part.writer.destroy() }
    await Promise.all(active.map((part) => part.writer.closed ? Promise.resolve() : new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 300)
      part.writer.once('close', () => { clearTimeout(timeout); resolve() })
    })))
  }

  private taskWasStopped(task: DownloadTask): boolean {
    return task.status === 'paused' || task.status === 'cancelled'
  }

  async pause(id: number): Promise<void> {
    const task = this.tasks.find((item) => item.id === id)
    if (!task || (task.status !== 'running' && task.status !== 'queued')) return
    task.status = 'paused'; task.speedBps = 0; this.emit(); await this.stopActive(id)
  }

  resume(id: number): void {
    const task = this.tasks.find((item) => item.id === id)
    if (!task || task.status !== 'paused') return
    task.status = 'queued'; this.emit(); void this.runTask(task)
  }

  async remove(id: number, deleteLocalFile: boolean): Promise<void> {
    const index = this.tasks.findIndex((item) => item.id === id)
    if (index < 0) return
    const task = this.tasks[index]
    task.status = 'cancelled'; task.speedBps = 0
    await this.stopActive(id)
    this.tasks.splice(index, 1)
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
    if (deleteLocalFile) {
      for (const target of [task.localPath, task.localPath + '.part']) {
        try { await fs.promises.rm(target, { force: true }) } catch (error) { this.logger.warn('download', `cannot delete ${target}`, error as Error) }
      }
    }
    this.emit()
  }

  async cancel(id: number): Promise<void> {
    const task = this.tasks.find((item) => item.id === id)
    if (!task) return
    task.status = 'cancelled'; task.speedBps = 0; this.emit(); await this.stopActive(id)
  }

  retry(id: number): void {
    const task = this.tasks.find((item) => item.id === id)
    if (!task || (task.status !== 'cancelled' && task.status !== 'error')) return
    task.status = 'queued'; task.error = null; this.emit(); void this.runTask(task)
  }
}

function clampThreads(value: number): number { return [1, 2, 4, 8].includes(Math.round(value)) ? Math.round(value) : 4 }
function clampSpeed(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(10240, Math.round(value * 10) / 10)) : 0 }
function sanitizeRelativePath(value: string): string {
  const parts = value.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').map(safeBaseName)
  return parts.length > 0 ? path.join(...parts) : 'download'
}
function parseSegments(value: unknown): DownloadSegment[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is DownloadSegment => !!item && typeof item === 'object'
      && Number.isFinite((item as DownloadSegment).start) && Number.isFinite((item as DownloadSegment).end) && Number.isFinite((item as DownloadSegment).done))
      .map((segment) => ({ start: segment.start, end: segment.end, done: Math.max(0, segment.done) }))
  } catch { return [] }
}
function createSegments(total: number, threads: number, existingBytes: number): DownloadSegment[] {
  const count = Math.max(1, Math.min(threads, total)); const chunk = Math.ceil(total / count); const result: DownloadSegment[] = []
  for (let index = 0; index < count; index++) {
    const start = index * chunk; const end = Math.min(total - 1, start + chunk - 1)
    if (start > end) break
    result.push({ start, end, done: Math.max(0, Math.min(end - start + 1, existingBytes - start)) })
  }
  return result
}
function segmentsCoverTotal(segments: DownloadSegment[], total: number): boolean {
  if (segments.length === 0 || total <= 0) return false
  const ordered = [...segments].sort((left, right) => left.start - right.start)
  return ordered[0].start === 0
    && ordered[ordered.length - 1].end === total - 1
    && ordered.every((segment, index) => segment.end >= segment.start
      && segment.done >= 0
      && segment.done <= segmentLength(segment)
      && (index === 0 || ordered[index - 1].end + 1 === segment.start))
}

/** Re-split only the missing byte ranges; completed ranges keep their offsets in the part file. */
function rebalanceSegments(segments: DownloadSegment[], total: number, threads: number): DownloadSegment[] {
  const downloaded = segments
    .filter((segment) => segment.done > 0)
    .map((segment) => ({ start: segment.start, end: Math.min(segment.end, segment.start + segment.done - 1) }))
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ start: number; end: number }>>((merged, interval) => {
      const previous = merged[merged.length - 1]
      if (previous && interval.start <= previous.end + 1) previous.end = Math.max(previous.end, interval.end)
      else merged.push({ ...interval })
      return merged
    }, [])

  const downloadedBytes = downloaded.reduce((sum, interval) => sum + interval.end - interval.start + 1, 0)
  const targetPendingSize = Math.max(1, Math.ceil(Math.max(0, total - downloadedBytes) / Math.max(1, threads)))
  const result: DownloadSegment[] = []
  let cursor = 0
  let intervalIndex = 0
  while (cursor < total) {
    const interval = downloaded[intervalIndex]
    if (interval && cursor === interval.start) {
      const length = interval.end - interval.start + 1
      result.push({ start: interval.start, end: interval.end, done: length })
      cursor = interval.end + 1
      intervalIndex++
      continue
    }
    const gapEnd = Math.min(total - 1, interval ? interval.start - 1 : total - 1)
    while (cursor <= gapEnd) {
      const end = Math.min(gapEnd, cursor + targetPendingSize - 1)
      result.push({ start: cursor, end, done: 0 })
      cursor = end + 1
    }
  }
  return result
}
function segmentLength(segment: DownloadSegment): number { return segment.end - segment.start + 1 }
function sumSegmentBytes(segments: DownloadSegment[]): number { return segments.reduce((sum, segment) => sum + Math.min(segment.done, segmentLength(segment)), 0) }
async function preparePartialFile(filePath: string, size: number): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const handle = await fs.promises.open(filePath, fs.existsSync(filePath) ? 'r+' : 'w+')
  try { await handle.truncate(size) } finally { await handle.close() }
}
function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }
function waitForDrain(writer: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { writer.off('drain', onDrain); writer.off('error', onError) }
    const onDrain = () => { cleanup(); resolve() }
    const onError = (error: Error) => { cleanup(); reject(error) }
    writer.once('drain', onDrain)
    writer.once('error', onError)
  })
}
function endWriter(writer: fs.WriteStream): Promise<void> {
  if (writer.destroyed) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => writer.off('error', onError)
    const onError = (error: Error) => { cleanup(); reject(error) }
    writer.once('error', onError)
    writer.end(() => { cleanup(); resolve() })
  })
}
