import React from 'react'
import { Icon } from '../core/icons'
import { ThumbnailImage } from '../shared/thumbnail'

const AUDIO_WAVE_BAR_COUNT = 14

// No decoded peaks are available, so derive a stable silhouette from the media id.
function waveBars(seed: number) {
  let state = (Math.trunc(seed) || 1) >>> 0
  return Array.from({ length: AUDIO_WAVE_BAR_COUNT }, (_, index) => {
    state = (state * 1664525 + 1013904223) >>> 0
    return { height: 18 + (state % 78), width: index % 4 === 0 ? 4 : 3 }
  })
}

export function AudioArtwork({ artwork, seed = 1, variant = 'card', className = '', thumbnail = false }: {
  artwork?: string | null
  seed?: number
  variant?: 'card' | 'hero'
  className?: string
  thumbnail?: boolean
}) {
  const bars = waveBars(seed)
  const ArtworkImage = thumbnail ? ThumbnailImage : 'img'
  return (
    <span className={`library-audio-artwork ${variant === 'hero' ? 'hero' : ''} ${artwork ? 'has-artwork' : ''} ${className}`.trim()} aria-hidden="true">
      {artwork && <ArtworkImage className="library-audio-artwork-backdrop" src={artwork} alt="" loading={variant === 'hero' ? 'eager' : 'lazy'} decoding="async" fetchPriority={variant === 'hero' ? 'high' : 'low'} />}
      <span className="library-audio-mark"><Icon name="music" size={variant === 'hero' ? 44 : 30} /></span>
      <span className="library-audio-wave">
        {bars.map((bar, index) => <i key={index} style={variant === 'hero' ? { height: `${bar.height}%` } : { height: `${bar.height}%`, width: `${bar.width}px` }} />)}
      </span>
    </span>
  )
}
