export type ColorThemeId = 'aurora' | 'neon-cyan' | 'neon-gold' | 'archive-violet' | 'emerald' | 'rose'

export interface ColorThemeDefinition {
  id: ColorThemeId
  name: string
  start: string
  end: string
  windowBackground: string
  isLight: boolean
}

export const COLOR_THEMES: readonly ColorThemeDefinition[] = [
  { id: 'aurora', name: 'Aurora', start: '#6a5cff', end: '#00d4ff', windowBackground: '#070812', isLight: false },
  { id: 'neon-cyan', name: 'Neon Cyan', start: '#00d4ff', end: '#00ffa3', windowBackground: '#03100f', isLight: false },
  { id: 'neon-gold', name: 'Neon Gold', start: '#ffb800', end: '#ff7a00', windowBackground: '#050301', isLight: false },
  { id: 'archive-violet', name: 'Archive Violet', start: '#a78bfa', end: '#6a5cff', windowBackground: '#0b0714', isLight: false },
  { id: 'emerald', name: 'Emerald', start: '#10b981', end: '#34d399', windowBackground: '#03100a', isLight: false },
  { id: 'rose', name: 'Rose', start: '#f43f5e', end: '#fb7185', windowBackground: '#120509', isLight: false }
]

export function normalizeColorThemeIndex(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  const rounded = Math.trunc(parsed)
  return ((rounded % COLOR_THEMES.length) + COLOR_THEMES.length) % COLOR_THEMES.length
}

export function colorThemeAt(value: unknown): ColorThemeDefinition {
  return COLOR_THEMES[normalizeColorThemeIndex(value)] ?? COLOR_THEMES[0]
}
