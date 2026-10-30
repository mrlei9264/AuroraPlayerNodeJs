import { frequencyForBand, SPECTRUM_BANDS } from './frequencyBands'

export interface VisualizerAudioFrame {
  samples: number[]
  beat: number
  pulse: number
}

/** Detect onsets before display smoothing; sustained bass is not a new beat. */
export class AudioVisualizerDynamics {
  private previous = new Float32Array(SPECTRUM_BANDS)
  private envelope = new Float32Array(SPECTRUM_BANDS)
  private history: Array<{ at: number; flux: number }> = []
  private lastAt = 0
  private startedAt = 0
  private lastBeatAt = -Infinity
  private slowBass = 0
  private pulse = 0

  reset(): void {
    this.previous.fill(0)
    this.envelope.fill(0)
    this.history = []
    this.lastAt = this.startedAt = 0
    this.lastBeatAt = -Infinity
    this.slowBass = this.pulse = 0
  }

  process(spectrum: ArrayLike<number>, playing: boolean, now = performance.now()): VisualizerAudioFrame {
    const samples = Array.from({ length: SPECTRUM_BANDS }, (_, index) => Math.max(0, Math.min(1, Number(spectrum[index]) || 0)))
    if (!playing) {
      this.reset()
      return { samples: samples.map(() => 0), beat: 0, pulse: 0 }
    }
    const dt = this.lastAt ? Math.min(0.1, Math.max(0.001, (now - this.lastAt) / 1000)) : 0.02
    if (!this.startedAt) this.startedAt = now
    this.lastAt = now
    if (!samples.some((value) => value > 0.005)) {
      // Preserve timing through gaps between isolated drum hits. Resetting
      // the warm-up on each silent frame would suppress every following hit.
      this.previous.fill(0)
      this.envelope.fill(0)
      this.history = this.history.filter((entry) => now - entry.at < 850)
      this.history.push({ at: now, flux: 0 })
      this.slowBass *= Math.exp(-dt / 0.45)
      this.pulse = 0
      return { samples: samples.map(() => 0), beat: 0, pulse: 0 }
    }
    let bass = 0, bassFlux = 0, midFlux = 0, bassBins = 0, midBins = 0
    samples.forEach((sample, index) => {
      const hz = frequencyForBand(index)
      const rise = Math.max(0, sample - this.previous[index])
      if (hz >= 40 && hz <= 180) { bass += sample * sample; bassFlux += rise; bassBins++ }
      if (hz > 180 && hz <= 3000) { midFlux += rise; midBins++ }
    })
    bass /= Math.max(1, bassBins)
    const lowRise = bassFlux / Math.max(1, bassBins)
    const midRise = midFlux / Math.max(1, midBins)
    const flux = lowRise * 0.8 + midRise * 0.2
    this.history = this.history.filter((entry) => now - entry.at < 850)
    const mean = this.history.reduce((sum, entry) => sum + entry.flux, 0) / Math.max(1, this.history.length)
    const variance = this.history.reduce((sum, entry) => sum + (entry.flux - mean) ** 2, 0) / Math.max(1, this.history.length)
    const threshold = Math.max(0.012, mean + Math.sqrt(variance) * 1.35)
    const contrast = Math.max(0, (bass - this.slowBass) / Math.max(0.04, this.slowBass))
    const onset = now - this.startedAt > 180 && now - this.lastBeatAt >= 150 && flux > threshold &&
      ((bass > 0.012 && contrast > 0.05 && lowRise > 0.01) || midRise > Math.max(0.07, mean * 1.8))
    const beat = onset ? Math.max(0.25, Math.min(1, (flux - threshold) / (threshold + 0.025) * 0.6 + contrast * 0.25)) : 0
    if (beat) { this.lastBeatAt = now; this.pulse = beat }
    else this.pulse *= Math.exp(-dt / 0.16)
    this.slowBass += (bass - this.slowBass) * (1 - Math.exp(-dt / 0.45))
    this.history.push({ at: now, flux })
    samples.forEach((sample, index) => {
      const hz = frequencyForBand(index)
      const gain = hz <= 180 ? 1.1 : 1
      const transient = Math.max(0, sample - this.previous[index]) * (hz <= 180 ? 0.8 : 0.25)
      const target = Math.min(1, sample * gain + transient)
      const tau = target > this.envelope[index] ? 0.012 : hz <= 180 ? 0.12 : 0.09
      this.envelope[index] += (target - this.envelope[index]) * (1 - Math.exp(-dt / tau))
      this.previous[index] = sample
      samples[index] = this.envelope[index]
    })
    return { samples, beat, pulse: this.pulse }
  }
}
