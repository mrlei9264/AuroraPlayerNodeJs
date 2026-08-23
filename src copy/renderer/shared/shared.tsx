import React, { useState } from 'react'
import { Icon, type IconName } from '../core/icons'
import { useRuntime } from '../core/runtime'
import type { MediaItem } from '../../shared/types'
import { coverUrl } from '../core/player'
import { formatTime } from '../../shared/types'

export function MediaTile({ item, onPlay, onContextMenu, selected, onSelect }: { item: MediaItem; onPlay: () => void; onContextMenu?: (e: React.MouseEvent) => void; selected?: boolean; onSelect?: () => void }) {
  return (
    <div
      className={`tile ${selected ? 'selected' : ''}`}
      onClick={onPlay}
      onContextMenu={onContextMenu}
    >
      <div className="tile-media">
        <img src={item.coverPath ? coverUrl(item.coverPath) : ''} alt="" />
        <div className="tile-play">
          <div className="play-bubble">
            <Icon name="play" size={20} />
          </div>
        </div>
        {item.duration > 0 && (
          <div className="tile-duration">
            {formatTime(item.duration)}
          </div>
        )}
        {onSelect && (
          <div className="tile-actions">
            <button className="btn-icon" onClick={(e) => { e.stopPropagation(); onSelect() }}>
              <Icon name={selected ? 'check' : 'plus'} size={15} />
            </button>
          </div>
        )}
      </div>
      <div className="tile-body">
        <div className="tile-title">{item.title || item.fileName}</div>
        <div className="tile-sub">{item.artist || item.album || ''}</div>
      </div>
    </div>
  )
}

export function MediaRow({ item, index, onPlay, onContextMenu, active }: { item: MediaItem; index?: number; onPlay: () => void; onContextMenu?: (e: React.MouseEvent) => void; active?: boolean }) {
  return (
    <div
      className={`media-row ${active ? 'active' : ''}`}
      onClick={onPlay}
      onContextMenu={onContextMenu}
    >
      {index != null && <div className="row-index">{index + 1}</div>}
      <div className="row-thumb">
        <img src={item.coverPath ? coverUrl(item.coverPath) : ''} alt="" />
      </div>
      <div className="row-title">{item.title || item.fileName}</div>
      <div className="row-sub">{item.artist || item.album || ''}</div>
      <div className="row-meta">{formatTime(item.duration)}</div>
    </div>
  )
}

export function EmptyState({ icon, title, description, action }: { icon: IconName; title: string; description?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={34} />
      </div>
      <div className="empty-title">{title}</div>
      {description && <div className="empty-desc">{description}</div>}
      {action && (
        <button className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-title">{title}</div>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search-box">
      <div className="search-icon">
        <Icon name="search" size={16} />
      </div>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

export function FilterChips({ options, value, onChange }: { options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="row wrap gap-8">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`chip ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function QueueRow({ item, index, onPlay, onRemove, active }: { item: MediaItem; index: number; onPlay: () => void; onRemove?: () => void; active?: boolean }) {
  return (
    <div className={`track-queue-row ${active ? 'active' : ''}`} onClick={onPlay}>
      <div className="tq-index">{index + 1}</div>
      <div className="tq-main">
        <div className="tq-title">{item.title || item.fileName}</div>
        <div className="tq-sub">{item.artist || ''}</div>
      </div>
      <div className="tq-dur">{formatTime(item.duration)}</div>
      {onRemove && (
        <button className="btn-icon hover-reveal" onClick={(e) => { e.stopPropagation(); onRemove() }}>
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}