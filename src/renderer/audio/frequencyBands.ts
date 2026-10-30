export const SPECTRUM_BANDS = 128
const MIN_HZ = 20
const MAX_HZ = 12_000
const BAND_RATIO = (MAX_HZ / MIN_HZ) ** (1 / (SPECTRUM_BANDS - 1))

export const frequencyForBand = (index: number): number => MIN_HZ * BAND_RATIO ** index

/** One Hz-based logarithmic scale for Web Audio and native PCM analysis. */
export function mapFrequencyBands(decibels: ArrayLike<number>, binHz: number, output: Float32Array): void {
  for (let band = 0; band < output.length; band++) {
    const frequency = frequencyForBand(band)
    const low = Math.max(1, Math.ceil(frequency / Math.sqrt(BAND_RATIO) / binHz))
    const high = Math.min(decibels.length - 1, Math.floor(frequency * Math.sqrt(BAND_RATIO) / binHz))
    let db = -160
    if (high >= low) {
      let power = 0
      for (let bin = low; bin <= high; bin++) power += 10 ** (Math.max(-160, decibels[bin]) / 10)
      db = 10 * Math.log10(Math.max(1e-16, power / (high - low + 1)))
    } else {
      const index = Math.max(0, Math.min(decibels.length - 1, frequency / binHz))
      const first = Math.floor(index)
      const fraction = index - first
      const a = Math.max(-160, decibels[first])
      const b = Math.max(-160, decibels[Math.min(first + 1, decibels.length - 1)])
      db = a + (b - a) * fraction
    }
    const normalized = Math.max(0, Math.min(1, (db + 90) / 72))
    output[band] = Math.max(0, (normalized - 0.018) / 0.982) ** 0.72
  }
}
