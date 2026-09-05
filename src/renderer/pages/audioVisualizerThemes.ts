import { colorThemeAt } from '../../shared/colorThemes'

export function audioVisualizerPaletteForColorTheme(accentIndex: unknown) {
  const theme = colorThemeAt(accentIndex)
  return {
    id: theme.id,
    background: theme.windowBackground,
    surface: theme.palette.bg1,
    accent: theme.start,
    accentEnd: theme.end,
    foreground: theme.palette.fg0
  }
}
