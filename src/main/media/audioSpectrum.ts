import { ipcMain } from 'electron'
import { execFile, type ChildProcess } from 'child_process'
import { resolveMediaCommand } from './commands'
import { I } from '../../shared/channels'
import { SPECTRUM_CHUNK_SECONDS, SPECTRUM_SAMPLE_RATE, type AudioSpectrumChunk } from '../../shared/audioSpectrum'
import type { MediaItem } from '../../shared/types'
import type { LibraryRepository } from '../library/repository'

/** Decode bounded, silent PCM windows for formats played outside Web Audio. */
export class AudioSpectrumService {
  private jobs = new Map<number, ChildProcess>()
  private disposed = false

  constructor(private repo: LibraryRepository, private urlFor: (item: MediaItem) => string) {}

  init(): void {
    ipcMain.handle(I.mediaAudioSpectrumCancel, (event) => this.cancel(event.sender.id))
    ipcMain.handle(I.mediaAudioSpectrum, (event, mediaId: number, start: number) => {
      if (this.disposed || !Number.isSafeInteger(mediaId) || !Number.isFinite(start) || start < 0) return null
      const item = this.repo.findById(mediaId)
      if (!item?.isAudio || !item.sourceAvailable) return null
      const offset = Math.floor(start / SPECTRUM_CHUNK_SECONDS) * SPECTRUM_CHUNK_SECONDS
      if (item.duration > 0 && offset >= item.duration) return null
      const owner = event.sender.id
      this.cancel(owner)
      const input = item.protocol === 'local' ? item.url : this.urlFor(item)
      let command: string
      try { command = resolveMediaCommand('ffmpeg') } catch { return null }
      return new Promise<AudioSpectrumChunk | null>((resolve) => {
        const onDestroyed = () => this.cancel(owner)
        const child = execFile(command, [
          '-hide_banner', '-loglevel', 'error', '-nostdin',
          '-ss', String(offset), '-i', input, '-map', '0:a:0',
          '-t', String(SPECTRUM_CHUNK_SECONDS), '-vn', '-sn', '-dn',
          '-ac', '1', '-ar', String(SPECTRUM_SAMPLE_RATE), '-f', 'f32le', 'pipe:1'
        ], { windowsHide: true, encoding: 'buffer', timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
          event.sender.removeListener('destroyed', onDestroyed)
          if (this.jobs.get(owner) !== child) { resolve(null); return }
          this.jobs.delete(owner)
          if (error || this.disposed || !stdout.length) { resolve(null); return }
          const samples = new Float32Array(Math.floor(stdout.length / 4))
          for (let i = 0; i < samples.length; i++) samples[i] = stdout.readFloatLE(i * 4)
          resolve({ start: offset, sampleRate: SPECTRUM_SAMPLE_RATE, samples })
        })
        this.jobs.set(owner, child)
        event.sender.once('destroyed', onDestroyed)
      })
    })
  }

  private cancel(owner: number): void {
    const child = this.jobs.get(owner)
    this.jobs.delete(owner)
    child?.kill()
  }

  dispose(): void {
    this.disposed = true
    for (const owner of this.jobs.keys()) this.cancel(owner)
  }
}
