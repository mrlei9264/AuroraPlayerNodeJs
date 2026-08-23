import React from 'react'
import { Icon } from '../core/icons'

const AUDIO_WAVE_BARS = [34, 58, 42, 76, 52, 88, 64, 44, 70, 50, 62, 38]

export function AudioArtwork({ artwork, variant = 'card', className = '' }: {
  artwork?: string | null
  variant?: 'card' | 'hero'
  className?: string
}) {
  return (
    <span className={`library-audio-artwork ${variant === 'hero' ? 'hero' : ''} ${className}`.trim()} aria-hidden="true">
      {artwork && <img className="library-audio-artwork-backdrop" src={artwork} alt="" />}
      <span className="library-audio-mark"><Icon name="music" size={variant === 'hero' ? 44 : 30} /></span>
      <span className="library-audio-wave">
        {AUDIO_WAVE_BARS.map((height, index) => <i key={`${height}-${index}`} style={{ height: `${height}%` }} />)}
      </span>
    </span>
  )
}
