export const SPECTRUM_CHUNK_SECONDS = 8
export const SPECTRUM_SAMPLE_RATE = 24_000

export interface AudioSpectrumChunk {
  start: number
  sampleRate: number
  samples: Float32Array
}
