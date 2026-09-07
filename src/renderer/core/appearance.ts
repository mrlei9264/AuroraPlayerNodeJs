import type { AppSettingsData } from '../../main/system/settings-types'

type TypographySettings = Pick<AppSettingsData, 'fontFamily' | 'fontSize'>

export function fontFamilyStack(fontFamily: string): string {
  const selectedFont = fontFamily.trim().replace(/^['"]|['"]$/g, '')
  const escapedFont = selectedFont.replace(/["\\]/g, '\\$&')
  return escapedFont
    ? `"${escapedFont}", 'Noto Sans SC Variable', 'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif`
    : "'Space Grotesk Variable', 'Noto Sans SC Variable', 'Microsoft YaHei UI', 'Segoe UI', system-ui, sans-serif"
}

export function applyTypographySettings(settings: TypographySettings): void {
  const root = document.documentElement

  root.style.setProperty('--font-family', fontFamilyStack(settings.fontFamily))
  const fontSize = settings.fontSize || 14
  // Render the configured size directly; subtracting 2px made the default
  // body text 11px and secondary labels even smaller. Scale text without
  // zooming the page so fixed controls keep their layout coordinates.
  const fontScale = fontSize / 14
  const controlScale = 1 + (fontSize - 14) * 0.025
  root.style.setProperty('--font-scale', String(fontScale))
  root.style.setProperty('--network-font-scale', String(fontScale))
  // Toasts share the configured body size.
  root.style.setProperty('--notification-font-size', `${fontSize}px`)
  root.style.setProperty('--toast-action-font-size', `${Math.max(12, fontSize - 1)}px`)
  // Keep the HUD compact while tracking the configured font size.
  root.style.setProperty('--hud-font-size', `${Math.max(10, fontSize - 2)}px`)
  root.style.setProperty('--control-scale', String(controlScale))
  root.style.removeProperty('--interface-scale')
  root.style.removeProperty('zoom')
  root.style.fontSize = '14px'
}
