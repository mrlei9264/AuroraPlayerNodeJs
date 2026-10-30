const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0))
const frequencyStops = [[0, 20], [4, 60], [12, 160], [24, 400], [45, 1000], [81, 2600], [120, 5000], [180, 8000], [255, 12000]]

// The bundled scene expects its own fixed sub-bass/bass/mid/treble layout.
// Adapt our shared logarithmic Hz scale to that layout without losing bass.
export function toVisualizerSpectrum(samples) {
  const source = Array.from(samples || [], clamp)
  return Array.from({ length: 512 }, (_, index) => {
    if (index > 255 || !source.length) return 0
    let stop = 1
    while (stop < frequencyStops.length - 1 && index > frequencyStops[stop][0]) stop++
    const [from, low] = frequencyStops[stop - 1]
    const [to, high] = frequencyStops[stop]
    const hz = low + (high - low) * (index - from) / (to - from)
    const band = Math.max(0, Math.min(source.length - 1, Math.log(hz / 20) / Math.log(12000 / 20) * (source.length - 1)))
    const first = Math.floor(band)
    return source[first] + (source[Math.min(first + 1, source.length - 1)] - source[first]) * (band - first)
  })
}

export function registerBeatBridge(audio) {
  let envelope = 0
  let lastUpdate = 0
  let lastBeat = -Infinity
  audio.pulseTrigger.enabled = false
  window.__auroraBeatEnvelope = 0
  window.__auroraApplyVisualizerBeat = (beat, pulse) => {
    const now = performance.now()
    envelope = clamp(pulse)
    lastUpdate = now
    const strength = clamp(beat)
    if (strength && now - lastBeat >= 120 && audio.onFreqTrigger) {
      lastBeat = now
      // Reuse the scene's outward ripple, bounded well below its maximum.
      audio.onFreqTrigger(0.035 + strength * 0.075, 'Kick', 'Pulse')
    }
  }
  const readAudio = audio.getAudioData.bind(audio)
  audio.getAudioData = (delta) => {
    const spectrum = readAudio(delta)
    const pulse = envelope * Math.exp(-Math.max(0, performance.now() - lastUpdate - 30) / 160)
    window.__auroraBeatEnvelope = pulse
    // Do not modify the scene's persistent smoothedData: pulse is transient.
    return {
      ...spectrum,
      subBass: Math.min(1, spectrum.subBass + pulse * 0.22),
      bass: Math.min(1, spectrum.bass + pulse * 0.18),
      energy: Math.min(1, spectrum.energy + pulse * 0.06),
      sharpness: Math.min(1, spectrum.sharpness + pulse * 0.25)
    }
  }
}
