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

type ThemeBase = Pick<Theme['colors'], 'bg0' | 'bg1' | 'bg2' | 'bg3' | 'surface' | 'surface2' | 'border' | 'borderStrong' | 'fg0' | 'fg1' | 'fg2' | 'fg3' | 'overlay' | 'shadow'>

const darkBases: Record<ColorThemeId, ThemeBase> = {
  aurora: {
    bg0: '#070812', bg1: '#0d1020', bg2: '#12162b', bg3: '#1a2040', surface: '#13172b', surface2: '#1b2140',
    border: 'rgba(139,130,255,0.12)', borderStrong: 'rgba(139,130,255,0.24)', fg0: '#f3f2ff', fg1: '#cbc9e6', fg2: '#9290ad', fg3: '#605e7a',
    overlay: 'rgba(4,5,14,0.74)', shadow: 'rgba(0,0,0,0.58)'
  },
  'neon-cyan': {
    bg0: '#03100f', bg1: '#061817', bg2: '#0a2220', bg3: '#10302d', surface: '#0a211f', surface2: '#10302c',
    border: 'rgba(0,212,255,0.12)', borderStrong: 'rgba(0,255,163,0.24)', fg0: '#edfffb', fg1: '#c0ded7', fg2: '#81a69e', fg3: '#52736c',
    overlay: 'rgba(1,10,10,0.76)', shadow: 'rgba(0,0,0,0.56)'
  },
  'neon-gold': {
    bg0: '#050301', bg1: '#0c0803', bg2: '#151005', bg3: '#211707', surface: '#120c04', surface2: '#211706',
    border: 'rgba(255,184,0,0.13)', borderStrong: 'rgba(255,184,0,0.27)', fg0: '#fff6df', fg1: '#e5cfaa', fg2: '#a68d63', fg3: '#725c3b',
    overlay: 'rgba(6,3,0,0.76)', shadow: 'rgba(0,0,0,0.62)'
  },
  'archive-violet': {
    bg0: '#0b0714', bg1: '#140c22', bg2: '#1d1232', bg3: '#291942', surface: '#1a102c', surface2: '#291940',
    border: 'rgba(167,139,250,0.13)', borderStrong: 'rgba(167,139,250,0.26)', fg0: '#f8f2ff', fg1: '#d7c7e8', fg2: '#9d8aaf', fg3: '#6b587e',
    overlay: 'rgba(9,4,16,0.76)', shadow: 'rgba(0,0,0,0.58)'
  },
  emerald: {
    bg0: '#03100a', bg1: '#061910', bg2: '#0a2518', bg3: '#103322', surface: '#092218', surface2: '#103322',
    border: 'rgba(16,185,129,0.13)', borderStrong: 'rgba(52,211,153,0.25)', fg0: '#effff7', fg1: '#c3dfd1', fg2: '#86a995', fg3: '#567661',
    overlay: 'rgba(1,10,6,0.76)', shadow: 'rgba(0,0,0,0.56)'
  },
  rose: {
    bg0: '#120509', bg1: '#1b0910', bg2: '#28101a', bg3: '#391624', surface: '#250f19', surface2: '#391622',
    border: 'rgba(244,63,94,0.13)', borderStrong: 'rgba(251,113,133,0.26)', fg0: '#fff1f4', fg1: '#e6c2ca', fg2: '#ac838d', fg3: '#79545e',
    overlay: 'rgba(13,3,7,0.77)', shadow: 'rgba(0,0,0,0.58)'
  }
}

const dark = darkBases.aurora

export function buildTheme(accentIndex: number): Theme {
  const resolvedIndex = normalizeColorThemeIndex(accentIndex)
  const definition = colorThemeAt(resolvedIndex)
  const base = darkBases[definition.id] ?? dark
  return {
    id: definition.id,
    accentIndex: resolvedIndex,
    isDark: true,
    variant: 'classic',
    colors: {
      ...base,
      accentStart: definition.start,
      accentEnd: definition.end,
      accent: definition.start,
      accentSoft: `${definition.start}26`,
      danger: '#ef4444',
      success: '#22c55e',
      warning: '#f59e0b',
      info: '#38bdf8',
      projection: '#8be9fd',
      neonCyan: '#00e5ff',
      neonGold: '#ffd166',
      archiveViolet: '#b794f6'
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
  set('--accent-gradient-soft', `linear-gradient(135deg, ${c.accentStart}33, ${c.accentEnd}33)`)
  root.style.colorScheme = theme.isDark ? 'dark' : 'light'
}
