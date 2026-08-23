const BASS_CORE_END = 3
const BASS_TRANSITION_END = 12
const BASS_CORE_GAIN = 0.68
const BASS_CORE_TRANSIENT_BOOST = 1.2
const BASS_TRANSITION_TRANSIENT_BOOST = 0.62
const UPPER_TRANSIENT_BOOST = 0.16

export function shapeAudioVisualizerSpectrum(spectrum: ArrayLike<number>, playing: boolean, previousSpectrum?: ArrayLike<number>): number[] {
  return Array.from(spectrum, (sample, index) => {
    if (!playing) return 0
    const normalized = Math.max(0, Math.min(1, Number.isFinite(sample) ? sample : 0))
    const shaped = normalized * bassGainForBin(index)
    if (!previousSpectrum || index >= previousSpectrum.length) return shaped
    const previous = Math.max(0, Math.min(1, Number.isFinite(previousSpectrum[index]) ? previousSpectrum[index] : 0))
    const attack = Math.max(0, normalized - previous)
    return Math.min(1, shaped + attack * transientBoostForBin(index))
  })
}

export function bassGainForBin(index: number): number {
  if (index <= BASS_CORE_END) return BASS_CORE_GAIN
  if (index >= BASS_TRANSITION_END) return 1
  const transition = (index - BASS_CORE_END) / (BASS_TRANSITION_END - BASS_CORE_END)
  return BASS_CORE_GAIN + (1 - BASS_CORE_GAIN) * smoothstep(transition)
}

function smoothstep(value: number): number {
  const normalized = Math.max(0, Math.min(1, value))
  return normalized * normalized * (3 - 2 * normalized)
}

function transientBoostForBin(index: number): number {
  if (index <= BASS_CORE_END) return BASS_CORE_TRANSIENT_BOOST
  if (index < BASS_TRANSITION_END) return BASS_TRANSITION_TRANSIENT_BOOST
  return UPPER_TRANSIENT_BOOST
}
