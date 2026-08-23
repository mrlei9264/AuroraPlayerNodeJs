import type { AppSettingsData } from '../../main/system/settings-types'

type TypographySettings = Pick<AppSettingsData, 'fontFamily' | 'fontSize'>

export function applyTypographySettings(settings: TypographySettings): void {
  const selectedFont = settings.fontFamily.trim().replace(/^['"]|['"]$/g, '')
  const escapedFont = selectedFont.replace(/["\\]/g, '\\$&')
  const root = document.documentElement

  root.style.setProperty(
    '--font-family',
    escapedFont
      ? `"${escapedFont}", 'Microsoft YaHei UI', system-ui, sans-serif`
      : "'Segoe UI', 'Microsoft YaHei UI', system-ui, sans-serif"
  )
  const fontSize = settings.fontSize || 14
  const visualFontSize = Math.max(10, fontSize - 2)
  // Keep the existing visual scale for the rest of the interface.
  // Scaling individual font declarations avoids changing fixed geometry.
  // Global CSS zoom changes the page coordinate system and can shift fixed
  // navigation or responsive boundaries when moving between pages.
  const fontScale = visualFontSize / 14
  const controlScale = 1 + (fontSize - 14) * 0.025
  root.style.setProperty('--font-scale', String(fontScale))
  // Network pages use a denser information layout, but their text should map
  // directly to the configured size instead of inheriting the global -2px trim.
  root.style.setProperty('--network-font-scale', String(fontSize / 14))
  // Toasts need to remain immediately readable. Unlike the surrounding UI,
  // use the configured size directly instead of the reduced visual scale.
  root.style.setProperty('--notification-font-size', `${fontSize}px`)
  root.style.setProperty('--toast-action-font-size', `${Math.max(12, fontSize - 1)}px`)
  // Keep the HUD compact while tracking the configured font size.
  root.style.setProperty('--hud-font-size', `${Math.max(10, fontSize - 2)}px`)
  root.style.setProperty('--control-scale', String(controlScale))
  root.style.removeProperty('--interface-scale')
  root.style.removeProperty('zoom')
  root.style.fontSize = '14px'
}
