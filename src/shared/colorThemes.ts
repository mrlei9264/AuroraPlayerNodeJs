export type ColorThemeId = 'liquid-glass'

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
    bg0: string; bg1: string; bg2: string; bg3: string
    fg0: string; fg1: string; fg2: string; fg3: string
  }
}

export const COLOR_THEMES: readonly ColorThemeDefinition[] = [
  {
    index: 1,
    id: 'liquid-glass',
    name: 'Liquid Glass',
    nameZh: '液态玻璃',
    isLight: false,
    windowBackground: '#040A12',
    start: '#2691E3',
    end: '#6DD5FF',
    palette: {
      bg0: '#040A12',
      bg1: '#071526',
      bg2: '#0B2038',
      bg3: '#113154',
      fg0: '#F2F8FC',
      fg1: '#C1D6EA',
      fg2: '#7B9CBA',
      fg3: '#4A6E8F',
    },
  },
]

export function normalizeColorThemeIndex(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return COLOR_THEMES[0].index
  const rounded = Math.trunc(parsed)
  return COLOR_THEMES.some((theme) => theme.index === rounded) ? rounded : COLOR_THEMES[0].index
}

export function colorThemeAt(value: unknown): ColorThemeDefinition {
  const index = normalizeColorThemeIndex(value)
  return COLOR_THEMES.find((theme) => theme.index === index) ?? COLOR_THEMES[0]
}
