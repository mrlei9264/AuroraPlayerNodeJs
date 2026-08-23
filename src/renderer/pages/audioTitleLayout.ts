export const AUDIO_TITLE_ACTIVE_SCALE = 1
export const AUDIO_TITLE_INACTIVE_SCALE = 0.56
export const AUDIO_TITLE_FOCUS_RATIO = 0.32
export const AUDIO_TITLE_GLYPH_GAP = 2

export interface AudioTitleGlyphSpan {
  glyphIndex: number
  start: number
  end: number
}

export interface AudioTitleGlyphPosition {
  x: number
  width: number
  scale: number
}

export interface AudioTitleLayout {
  glyphs: AudioTitleGlyphPosition[]
  contentWidth: number
  targetOffset: number
}

export function buildAudioTitleGlyphSpans(outlineLengths: number[]): AudioTitleGlyphSpan[] {
  const spans: AudioTitleGlyphSpan[] = []
  let preceding = 0
  outlineLengths.forEach((rawLength, glyphIndex) => {
    const length = Math.max(0, Number.isFinite(rawLength) ? rawLength : 0)
    if (length <= 0) return
    spans.push({ glyphIndex, start: preceding, end: preceding + length })
    preceding += length
  })
  return spans
}

export function activeAudioTitleGlyphIndex(spans: AudioTitleGlyphSpan[], drawnLength: number): number {
  if (!spans.length) return -1
  if (!Number.isFinite(drawnLength) || drawnLength <= 0) return spans[0].glyphIndex
  for (const span of spans) {
    if (drawnLength < span.end) return span.glyphIndex
  }
  return spans[spans.length - 1].glyphIndex
}

export function audioTitleScaleTargets(glyphCount: number, activeGlyphIndex: number): number[] {
  return Array.from({ length: Math.max(0, glyphCount) }, (_, glyphIndex) => (
    glyphIndex === activeGlyphIndex ? AUDIO_TITLE_ACTIVE_SCALE : AUDIO_TITLE_INACTIVE_SCALE
  ))
}

export function layoutAudioTitleGlyphs(
  widths: number[],
  scales: number[],
  viewportWidth: number,
  activeGlyphIndex: number,
  edgePadding = 0,
  focusRatio = AUDIO_TITLE_FOCUS_RATIO,
  glyphGap = AUDIO_TITLE_GLYPH_GAP
): AudioTitleLayout {
  const safeViewportWidth = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : 1)
  const safePadding = Math.max(0, Math.min(safeViewportWidth / 2, Number.isFinite(edgePadding) ? edgePadding : 0))
  const glyphs: AudioTitleGlyphPosition[] = []
  let cursor = 0

  widths.forEach((rawWidth, glyphIndex) => {
    const width = Math.max(0, Number.isFinite(rawWidth) ? rawWidth : 0)
    const scale = Math.max(0, Number.isFinite(scales[glyphIndex]) ? scales[glyphIndex] : AUDIO_TITLE_INACTIVE_SCALE)
    const scaledWidth = width * scale
    glyphs.push({ x: cursor, width: scaledWidth, scale })
    cursor += scaledWidth
    if (glyphIndex < widths.length - 1) cursor += glyphGap
  })

  const contentWidth = Math.max(0, cursor)
  const availableWidth = Math.max(0, safeViewportWidth - safePadding * 2)
  if (contentWidth <= availableWidth) {
    return { glyphs, contentWidth, targetOffset: safePadding }
  }

  const active = glyphs[Math.min(Math.max(0, activeGlyphIndex), Math.max(0, glyphs.length - 1))]
  const activeCenter = active ? active.x + active.width / 2 : 0
  const focusX = safeViewportWidth * Math.min(1, Math.max(0, focusRatio))
  const minimumOffset = safeViewportWidth - safePadding - contentWidth
  const maximumOffset = safePadding
  const targetOffset = Math.min(maximumOffset, Math.max(minimumOffset, focusX - activeCenter))
  return { glyphs, contentWidth, targetOffset }
}

