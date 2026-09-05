import { COLOR_THEMES, colorThemeAt, normalizeColorThemeIndex, type ColorThemeId } from '../../shared/colorThemes'

export type Accent = { name: string; start: string; end: string }

export const ACCENTS: Accent[] = COLOR_THEMES.map(({ name, start, end }) => ({ name, start, end }))

export interface Theme {
  id: ColorThemeId
  accentIndex: number
  isDark: boolean
  variant: 'classic'
  colors: {
    bg0: string
    bg1: string
    bg2: string
    bg3: string
    surface: string
    surface2: string
    border: string
    borderStrong: string
    fg0: string
    fg1: string
    fg2: string
    fg3: string
    accentStart: string
    accentEnd: string
    accent: string
    accentSoft: string
    danger: string
    success: string
    warning: string
    info: string
    overlay: string
    projection: string
    neonCyan: string
    neonGold: string
    archiveViolet: string
    shadow: string
  }
  radii: { sm: string; md: string; lg: string; xl: string; pill: string }
  motion: { fast: string; normal: string; slow: string }
  effectsEnabled: boolean
  richEffectsEnabled: boolean
}

export function buildTheme(accentIndex: number): Theme {
  const resolvedIndex = normalizeColorThemeIndex(accentIndex)
  const definition = colorThemeAt(resolvedIndex)
  const base = definition.palette
  return {
    id: definition.id,
    accentIndex: resolvedIndex,
    isDark: !definition.isLight,
    variant: 'classic',
    colors: {
      ...base,
      bg0: definition.windowBackground,
      surface: base.bg1,
      surface2: base.bg2,
      border: `${base.fg0}1a`,
      borderStrong: `${base.fg0}33`,
      overlay: `${definition.windowBackground}d1`,
      shadow: 'rgba(0,0,0,0.36)',
      accentStart: definition.start,
      accentEnd: definition.end,
      accent: definition.start,
      accentSoft: `${definition.start}1f`,
      danger: '#e49b98',
      success: '#a3c4ad',
      warning: '#d7bc8d',
      info: '#9bbfd9',
      projection: definition.end,
      neonCyan: definition.start,
      neonGold: definition.end,
      archiveViolet: definition.start
    },
    radii: { sm: '6px', md: '10px', lg: '16px', xl: '24px', pill: '999px' },
    motion: { fast: '120ms', normal: '240ms', slow: '420ms' },
    effectsEnabled: true,
    richEffectsEnabled: true
  }
}

export function injectThemeVars(theme: Theme): void {
  const root = document.documentElement
  root.dataset.colorTheme = theme.variant
  root.dataset.accentTheme = theme.id
  const c = theme.colors
  const set = (k: string, v: string) => root.style.setProperty(k, v)
  set('--bg0', c.bg0)
  set('--bg1', c.bg1)
  set('--bg2', c.bg2)
  set('--bg3', c.bg3)
  set('--surface', c.surface)
  set('--surface2', c.surface2)
  set('--border', c.border)
  set('--border-strong', c.borderStrong)
  set('--fg0', c.fg0)
  set('--fg1', c.fg1)
  set('--fg2', c.fg2)
  set('--fg3', c.fg3)
  set('--accent-start', c.accentStart)
  set('--accent-end', c.accentEnd)
  set('--accent', c.accent)
  set('--accent-soft', c.accentSoft)
  set('--danger', c.danger)
  set('--success', c.success)
  set('--warning', c.warning)
  set('--info', c.info)
  set('--projection', c.projection)
  set('--neon-cyan', c.neonCyan)
  set('--neon-gold', c.neonGold)
  set('--archive-violet', c.archiveViolet)
  set('--shadow', c.shadow)
  set('--overlay', c.overlay)
  set('--r-sm', theme.radii.sm)
  set('--r-md', theme.radii.md)
  set('--r-lg', theme.radii.lg)
  set('--r-xl', theme.radii.xl)
  set('--r-pill', theme.radii.pill)
  set('--m-fast', theme.motion.fast)
  set('--m-normal', theme.motion.normal)
  set('--m-slow', theme.motion.slow)
  const grad = `linear-gradient(135deg, ${c.accentStart}, ${c.accentEnd})`
  set('--accent-gradient', grad)
  set('--accent-gradient-soft', `linear-gradient(135deg, ${c.accentStart}1f, ${c.accentEnd}14)`)
  root.style.colorScheme = theme.isDark ? 'dark' : 'light'
}
