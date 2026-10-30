import { I } from '../../shared/channels'
import { mapFrequencyBands, SPECTRUM_BANDS } from './frequencyBands'
import { SPECTRUM_CHUNK_SECONDS, type AudioSpectrumChunk } from '../../shared/audioSpectrum'

const FFT_SIZE = 1024

/** Samples actual decoded PCM at the native player's current media time. */
export class PcmSpectrum {
  private mediaId: number | null = null
  private chunks: AudioSpectrumChunk[] = []
  private pending: { start: number; generation: number } | null = null
  private generation = 0
  private retryAfter = 0
  private real = new Float64Array(FFT_SIZE)
  private imaginary = new Float64Array(FFT_SIZE)
  private decibels = new Float32Array(FFT_SIZE / 2)
  // Match Web Audio's Blackman window and FFT magnitude normalization.
  private window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.42 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE) + 0.08 * Math.cos(4 * Math.PI * i / FFT_SIZE))
  private spectrum = new Float32Array(SPECTRUM_BANDS)

  reset(): void {
    if (this.pending) void window.aurora.invoke(I.mediaAudioSpectrumCancel).catch(() => void 0)
    this.generation++
    this.mediaId = null
    this.pending = null
    this.chunks = []
    this.retryAfter = 0
    this.spectrum.fill(0)
  }

  sample(mediaId: number, position: number, playing: boolean, gain: number): Float32Array {
    if (this.mediaId !== mediaId) { this.reset(); this.mediaId = mediaId }
    if (!playing || !(gain > 0) || !Number.isFinite(position) || position < 0) {
      this.spectrum.fill(0)
      return new Float32Array(this.spectrum)
    }
    const start = Math.floor(position / SPECTRUM_CHUNK_SECONDS) * SPECTRUM_CHUNK_SECONDS
    const chunk = this.chunks.find((entry) => entry.start === start)
    if (!chunk) {
      if (this.pending?.start !== start && performance.now() >= this.retryAfter) this.request(start)
      this.spectrum.fill(0)
      return new Float32Array(this.spectrum)
    }
    if (position - start > SPECTRUM_CHUNK_SECONDS - 2 && !this.pending &&
      !this.chunks.some((entry) => entry.start === start + SPECTRUM_CHUNK_SECONDS) && performance.now() >= this.retryAfter) {
      this.request(start + SPECTRUM_CHUNK_SECONDS)
    }
    const center = Math.floor((position - chunk.start) * chunk.sampleRate)
    // Trailing samples at a chunk boundary are zero-padded, never borrowed
    // from a different file or an earlier seek.
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = center - FFT_SIZE / 2 + i
      const value = chunk.samples[index] ?? 0
      this.real[i] = (Number.isFinite(value) ? value : 0) * this.window[i]
      this.imaginary[i] = 0
    }
    this.fft()
    for (let bin = 0; bin < this.decibels.length; bin++) {
      const amplitude = Math.hypot(this.real[bin], this.imaginary[bin]) / FFT_SIZE * gain
      this.decibels[bin] = 20 * Math.log10(Math.max(1e-8, amplitude))
    }
    mapFrequencyBands(this.decibels, chunk.sampleRate / FFT_SIZE, this.spectrum)
    return new Float32Array(this.spectrum)
  }

  private request(start: number): void {
    if (this.pending) void window.aurora.invoke(I.mediaAudioSpectrumCancel).catch(() => void 0)
    const mediaId = this.mediaId
    const task = { start, generation: ++this.generation }
    this.pending = task
    void window.aurora.invoke(I.mediaAudioSpectrum, mediaId, start).then((value) => {
      if (this.pending !== task || this.generation !== task.generation || this.mediaId !== mediaId) return
      const chunk = value as AudioSpectrumChunk | null
      if (!chunk || chunk.start !== start || !(chunk.samples instanceof Float32Array) || !(chunk.sampleRate > 0)) {
        this.retryAfter = performance.now() + 2000
        return
      }
      this.chunks = [...this.chunks.filter((entry) => entry.start !== start), chunk].slice(-2)
    }).catch(() => {
      if (this.pending === task) this.retryAfter = performance.now() + 2000
    }).finally(() => {
      if (this.pending === task) this.pending = null
    })
  }

  private fft(): void {
    const real = this.real
    const imaginary = this.imaginary
    for (let i = 1, j = 0; i < FFT_SIZE; i++) {
      let bit = FFT_SIZE >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) [real[i], real[j]] = [real[j], real[i]]
    }
    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      const angle = -2 * Math.PI / size
      for (let offset = 0; offset < FFT_SIZE; offset += size) {
        for (let i = 0; i < size / 2; i++) {
          const cosine = Math.cos(angle * i)
          const sine = Math.sin(angle * i)
          const even = offset + i
          const odd = even + size / 2
          const r = real[odd] * cosine - imaginary[odd] * sine
          const im = real[odd] * sine + imaginary[odd] * cosine
          real[odd] = real[even] - r
          imaginary[odd] = imaginary[even] - im
          real[even] += r
          imaginary[even] += im
        }
      }
    }
  }
}
