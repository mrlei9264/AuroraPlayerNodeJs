import React from 'react'
import { Icon } from '../core/icons'

const AUDIO_WAVE_BARS = [34, 58, 42, 76, 52, 88, 64, 44, 70, 50, 62, 38]

export function AudioArtwork({ artwork, variant = 'card', className = '', identity = '' }: {
  artwork?: string | null
  variant?: 'card' | 'hero' | 'library'
  identity?: string
  className?: string
}) {
  if (variant === 'library') {
    let hash = 0
    for (const character of identity) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0
    const tones = ['var(--accent)', 'var(--accent-end)', 'var(--fg2)', 'color-mix(in srgb, var(--accent) 60%, var(--fg2))', 'color-mix(in srgb, var(--accent-end) 50%, var(--fg1))']
    return (
      <span className="library-audio-cover" aria-hidden="true" style={{ '--cover-tone': tones[hash % tones.length], '--record-angle': `${hash % 140 + 15}deg` } as React.CSSProperties}>
        <Icon name="music" size={21} />
        <span className="library-audio-record"><span /></span>
      </span>
    )
  }
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
