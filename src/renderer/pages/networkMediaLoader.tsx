import React from 'react'
import bundledAppIconUrl from '../assets/icon/app_icon.png'

export function NetworkMediaLoader({ label, bytesPerSecond, showSpeed = true, iconUrl }: {
  label: string
  bytesPerSecond: number
  showSpeed?: boolean
  iconUrl?: string | null
}) {
  return (
    <div className="network-media-loading" role="status" aria-live="polite" aria-label={label}>
      <div className="network-media-loading-graphic" aria-hidden="true">
        <span className="network-media-loading-icon-shell">
          <img src={iconUrl || bundledAppIconUrl} alt="" />
          <span className="network-media-loading-sheen" />
        </span>
        <span className="network-media-loading-wave">
          {Array.from({ length: 7 }, (_, index) => <i key={index} style={{ '--wave-index': index } as React.CSSProperties} />)}
        </span>
      </div>
      <div className="network-media-loading-label">{label}</div>
      {showSpeed && <output className="network-media-loading-speed">{formatNetworkSpeed(bytesPerSecond)}</output>}
    </div>
  )
}

export function formatNetworkSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0.00 B/s'
  const megabytes = bytesPerSecond / (1024 * 1024)
  if (megabytes >= 1) return `${megabytes.toFixed(2)} MB/s`
  const kilobytes = bytesPerSecond / 1024
  if (kilobytes >= 1) return `${kilobytes.toFixed(2)} KB/s`
  return `${Math.max(1, Math.round(bytesPerSecond))} B/s`
}
