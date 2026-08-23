import { normalizeColorThemeIndex } from '../../shared/colorThemes'

export const AUDIO_VISUALIZER_THEMES = [
  'neon-tokyo',
  'arctic-aurora',
  'copper-forge',
  'lavender-dream',
  'cyber-forest',
  'coral-mirage'
] as const

export function audioVisualizerThemeForColorTheme(accentIndex: unknown): (typeof AUDIO_VISUALIZER_THEMES)[number] {
  return AUDIO_VISUALIZER_THEMES[normalizeColorThemeIndex(accentIndex)] ?? AUDIO_VISUALIZER_THEMES[0]
}
