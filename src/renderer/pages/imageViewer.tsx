import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { Icon } from '../core/icons'
import { coverUrl } from '../core/player'
import { formatTime } from '../../shared/types'

export function ImageViewerPage() {
  const { t, imageSession, navigate, stopPlayback, setFullscreen, win, library } = useRuntime()
  const [index, setIndex] = useState(imageSession?.index ?? 0)
  const [showUi, setShowUi] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState(false)
  const hideTimer = useRef(0)

  const items = imageSession?.items ?? []
  const current = items[index] ?? null
  const imgUrl = current ? coverUrl(current.url) : ''

  useEffect(() => {
    setIndex(imageSession?.index ?? 0)
    setZoom(1)
    setError(false)
  }, [imageSession])

  const poke = useCallback(() => {
    setShowUi(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowUi(false), 2800)
  }, [])

  useEffect(() => {
    poke()
    return () => window.clearTimeout(hideTimer.current)
  }, [poke, index])

  const go = (delta: number) => {
    if (!items.length) return
    setIndex((prev) => {
      const next = prev + delta
      return next < 0 ? 0 : next >= items.length ? items.length - 1 : next
    })
    setZoom(1)
    poke()
  }

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'Escape') stopPlayback()
      else if (e.key === 'f' || e.key === 'F') void setFullscreen(!win.fullscreen)
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.25))
      else if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.25))
      else if (e.key === '0') setZoom(1)
      else if (e.key === ' ') {
        e.preventDefault()
        poke()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [win.fullscreen, stopPlayback, setFullscreen, index, items.length]
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  useEffect(() => {
    if (current && !current.sourceAvailable) setError(true)
    else setError(false)
  }, [current])

  if (!current) {
    return (
      <div className="image-viewer center">
        <div className="col gap-12 text-white">
          <Icon name="image" size={40} className="muted" />
          <span className="medium">{t('noResults')}</span>
          <button className="btn btn-primary" onClick={() => navigate({ section: 'images' })}>{t('images')}</button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`image-viewer ${showUi ? 'show-ui' : ''}`}
      onMouseMove={poke}
      onDoubleClick={() => void setFullscreen(!win.fullscreen)}
    >
      {error ? (
        <div className="center">
          <div className="col gap-12 text-white">
            <Icon name="alert" size={34} />
            <span className="medium">{t('fileNotFound')}</span>
          </div>
        </div>
      ) : (
        <img
          key={imgUrl}
          src={imgUrl}
          alt=""
          draggable={false}
          style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? 'zoom-out' : 'zoom-in' }}
          onClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
          onError={() => setError(true)}
        />
      )}

      <div className="iv-top">
        <button className="btn-icon" onClick={() => navigate({ section: 'images' })}>
          <Icon name="chevronLeft" size={18} />
        </button>
        <div className="iv-title">{current.title || current.fileName}</div>
        <div className="spacer" />
        <button className="btn-icon" title={t('fullscreen')} onClick={() => void setFullscreen(!win.fullscreen)}>
          <Icon name={win.fullscreen ? 'fullscreenExit' : 'fullscreen'} size={17} />
        </button>
        <button className="btn-icon" title={t('stop')} onClick={stopPlayback}>
          <Icon name="stop" size={16} />
        </button>
      </div>

      {index > 0 && (
        <button className="iv-nav prev" onClick={() => go(-1)}>
          <Icon name="chevronLeft" size={22} />
        </button>
      )}
      {index < items.length - 1 && (
        <button className="iv-nav next" onClick={() => go(1)}>
          <Icon name="chevronRight" size={22} />
        </button>
      )}

      <div className="iv-bottom">
        <button className="btn-icon" disabled={index <= 0} onClick={() => go(-1)}>
          <Icon name="prev" size={16} />
        </button>
        <span className="iv-count">{index + 1} / {items.length}</span>
        <button className="btn-icon" disabled={index >= items.length - 1} onClick={() => go(1)}>
          <Icon name="next" size={16} />
        </button>
        <div className="divider" style={{ height: 20, margin: '0 4px' }} />
        <button className="btn-icon" title="−" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
          <Icon name="minus" size={15} />
        </button>
        <span className="dim small" style={{ width: 48, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn-icon" title="+" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>
          <Icon name="plus" size={15} />
        </button>
      </div>
    </div>
  )
}