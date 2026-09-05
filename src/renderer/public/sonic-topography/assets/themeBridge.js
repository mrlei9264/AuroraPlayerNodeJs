// The bundled visualizer owns its Three.js Color class and preset registry.
// Register the app palette here so shader colors share the UI's source of truth.
export function registerThemeBridge(Color, themes) {
  window.__auroraApplyVisualizerPalette = (palette) => {
    if (!palette || typeof palette.id !== 'string') return null
    const fields = ['background', 'surface', 'accent', 'accentEnd', 'foreground']
    if (!fields.every((field) => /^#[0-9a-f]{6}$/i.test(palette[field]))) return null
    const id = `aurora-${palette.id}`
    const background = new Color(palette.background)
    const surface = new Color(palette.surface)
    const accent = new Color(palette.accent)
    const accentEnd = new Color(palette.accentEnd)
    themes[id] = {
      id, name: id,
      uBaseColor1: background,
      uBaseColor2: surface,
      uCoolCore: accent,
      uCoolEdge: accent.clone().lerp(surface, .48),
      uWarmCore: accentEnd,
      uWarmEdge: accentEnd.clone().lerp(surface, .4),
      uRippleColor: accentEnd.clone().lerp(accent, .35),
      uPeakColor: new Color(palette.foreground).lerp(accentEnd, .45),
      uGlowIntensity: .78
    }
    return id
  }
}
