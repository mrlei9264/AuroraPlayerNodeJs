import React, { useCallback, useRef, useState } from 'react'
import { Icon } from '../core/icons'
import { useRuntime } from '../core/runtime'

export function ProgressSlider({ value, max, onSeek, disabled }: { value: number; max: number; onSeek: (v: number) => void; disabled?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const getPosition = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const x = (e instanceof MouseEvent ? e.clientX : e.clientX) - rect.left
    return Math.max(0, Math.min(1, x / rect.width))
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return
    setDragging(true)
    const pos = getPosition(e)
    onSeek(pos * max)

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getPosition(e)
      onSeek(pos * max)
    }
    const handleMouseUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const pct = max > 0 ? (value / max) * 100 : 0

  return (
    <div
      ref={trackRef}
      className={`progress-track ${disabled ? 'disabled' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      {!disabled && (
        <div
          className="progress-thumb"
          style={{ left: `calc(${pct}% - 7px)` }}
        />
      )}
    </div>
  )
}

export function TransportButton({ icon, onClick, title, size, active }: { icon: string; onClick: () => void; title?: string; size?: number; active?: boolean }) {
  return (
    <button
      className={`btn-icon ${active ? 'active' : ''}`}
      onClick={onClick}
      title={title}
    >
      <Icon name={icon as any} size={size ?? 18} />
    </button>
  )
}

export function VolumeControl() {
  const { t, session, setVolume, toggleMute } = useRuntime()
  return (
    <div className="row gap-8">
      <button className="btn-icon" onClick={toggleMute} title={t('mute')}>
        <Icon name={session.muted || session.volume === 0 ? 'volumeMute' : 'volume'} size={16} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={session.volume}
        className="accent-fill"
        onChange={(e) => setVolume(Number(e.target.value))}
      />
    </div>
  )
}

export function PlaybackRateMenu({ onClose }: { onClose: () => void }) {
  const { t } = useRuntime()
  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
  return (
    <div className="ctx-menu">
      {rates.map((rate) => (
        <button
          key={rate}
          className="ctx-item"
          onClick={() => { onClose() }}
        >
          {rate === 1 ? t('normalSpeed') : `${rate}x`}
        </button>
      ))}
    </div>
  )
}
