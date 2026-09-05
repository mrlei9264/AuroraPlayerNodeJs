export type ColorThemeId = 'aurora' | 'neon-cyan' | 'neon-gold' | 'emerald' | 'rose'

export interface ColorThemeDefinition {
  /** Persisted preference key, independent of the order in the picker. */
  index: number
  id: ColorThemeId
  name: string
  nameZh: string
  start: string
  end: string
  windowBackground: string
  isLight: boolean
  palette: {
    bg1: string; bg2: string; bg3: string
    fg0: string; fg1: string; fg2: string; fg3: string
  }
}

export const COLOR_THEMES: readonly ColorThemeDefinition[] = [
  {
    index: 0, id: 'aurora', name: 'Midnight Indigo', nameZh: '暮夜靛蓝',
    start: '#a5a8e8', end: '#bec1ef', windowBackground: '#13141a', isLight: false,
    palette: { bg1: '#1b1c25', bg2: '#252632', bg3: '#303140', fg0: '#f1f0f7', fg1: '#c5c4d2', fg2: '#9999aa', fg3: '#77788b' }
  },
  {
    index: 1, id: 'neon-cyan', name: 'Glacier', nameZh: '冰川蓝',
    start: '#93bdd5', end: '#b2d1e4', windowBackground: '#11161b', isLight: false,
    palette: { bg1: '#192129', bg2: '#242f39', bg3: '#303d49', fg0: '#eef3f6', fg1: '#c1cdd5', fg2: '#96a5b1', fg3: '#748591' }
  },
  {
    index: 2, id: 'neon-gold', name: 'Champagne', nameZh: '香槟金',
    start: '#cbb18b', end: '#e0cbaa', windowBackground: '#191714', isLight: false,
    palette: { bg1: '#23201c', bg2: '#2e2a24', bg3: '#3c362e', fg0: '#f4f0e9', fg1: '#cec5b8', fg2: '#a79e91', fg3: '#857c70' }
  },
  {
    index: 4, id: 'emerald', name: 'Misty Pine', nameZh: '雾松绿',
    start: '#9cb7aa', end: '#bfd0c5', windowBackground: '#141917', isLight: false,
    palette: { bg1: '#1c2421', bg2: '#28312d', bg3: '#343f3a', fg0: '#eef3ef', fg1: '#c3cfc7', fg2: '#98aa9f', fg3: '#768b7d' }
  },
  {
    index: 5, id: 'rose', name: 'Smoked Rose', nameZh: '烟玫瑰',
    start: '#cca3af', end: '#dfbec7', windowBackground: '#1a1619', isLight: false,
    palette: { bg1: '#251f24', bg2: '#312a30', bg3: '#40363e', fg0: '#f5eff3', fg1: '#d2c3cd', fg2: '#ad9ba7', fg3: '#8b7885' }
  }
]

export function normalizeColorThemeIndex(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  const rounded = Math.trunc(parsed)
  // Archive Violet (3) is retired into Midnight Indigo (0). Keep the other
  // stored keys intact so existing green and rose selections never shift.
  return COLOR_THEMES.some((theme) => theme.index === rounded) ? rounded : 0
}

export function colorThemeAt(value: unknown): ColorThemeDefinition {
  const index = normalizeColorThemeIndex(value)
  return COLOR_THEMES.find((theme) => theme.index === index) ?? COLOR_THEMES[0]
}
