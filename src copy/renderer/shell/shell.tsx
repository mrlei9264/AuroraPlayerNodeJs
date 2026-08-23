import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { Icon, type IconName } from '../core/icons'
import { I } from '../../shared/channels'
import type { MediaItem, NavState, Section } from '../../shared/types'
import { coverUrl } from '../core/player'
import { formatTime } from '../../shared/types'
import { ProgressSlider } from '../controls/controls'
import type { AppSettingsData } from '../../main/system/settings-types'
import bundledAppIconUrl from '../assets/icon/app_icon.png'

export function WindowChrome() {
  const { t, win, windowMinimize, windowMaximizeToggle, windowClose, navigate, settings, appIconUrl } = useRuntime()
  const [hover, setHover] = useState(false)

  return (
    <div
      className="titlebar"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="tb-brand">
        <img className="logo" src={appIconUrl ?? bundledAppIconUrl} alt="Aurora Player" />
        {settings && settings.language === 'zh' ? 'Aurora Player' : 'Aurora Player'}
      </div>
      <div className="tb-title">
        {hover ? t('appName') : ' '}
      </div>
      <div className="tb-controls">
        <button className="tb-btn" title={t('minimize')} onClick={windowMinimize}>
          <Icon name="minimize" size={15} />
        </button>
        <button className="tb-btn" title={win.maximized ? t('restore') : t('maximize')} onClick={() => void windowMaximizeToggle()}>
          <Icon name={win.maximized ? 'restore' : 'maximize'} size={14} />
        </button>
        <button className="tb-btn close" title={t('close')} onClick={windowClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}

const NAV_SECTIONS: { section: Section; icon: IconName; key: string }[] = [
  { section: 'home', icon: 'home', key: 'home' },
  { section: 'library', icon: 'library', key: 'library' },
  { section: 'remote', icon: 'cast', key: 'remote' },
  { section: 'settings', icon: 'settings', key: 'settings' },
]

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t, nav, navigate, settings, appIconUrl } = useRuntime()
  const settingsMode = nav.section === 'settings'
  const cinemaMode = nav.section === 'home' || nav.section === 'library' || nav.section === 'remote' || settingsMode
  const navigationLabel = t('navigation')
  const expandLabel = t('expandSidebar')
  const collapseLabel = t('collapseSidebar')
  const sections = NAV_SECTIONS

  const activateFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, action: () => void) => {
    if ((event.key === 'Enter' || event.key === ' ' || event.code === 'Space') && !event.repeat) {
      event.preventDefault()
      action()
    }
  }

  if (cinemaMode) {
    return (
      <aside className={`sidebar ${settings?.reducedMotion ? 'reduce-motion' : ''}`} aria-label={navigationLabel}>
        <nav className="nav-list" aria-label={navigationLabel}>
          <div className="nav-mark">
            <img className="app-mark" src={appIconUrl ?? bundledAppIconUrl} alt="Aurora Player" />
          </div>
          <div className="nav-items">
            {sections.map((item) => {
              const active = nav.section === item.section
              const label = item.section === 'library' ? t('libraryTitle') : item.section === 'remote' ? t('networkMedia') : t(item.key)
              return (
                <button
                  type="button"
                  key={item.section}
                  data-section={item.section}
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={() => navigate({ section: item.section })}
                  onKeyDown={(event) => activateFromKeyboard(event, () => navigate({ section: item.section }))}
                  title={label}
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="nav-icon"><Icon name={item.icon} size={28} strokeWidth={1.8} /></span>
                  {active && <span className="nav-label">{label}</span>}
                </button>
              )
            })}
          </div>
        </nav>
        <HomePlaybackStatus />
      </aside>
    )
  }

  return (
    <aside
      className={`sidebar ${collapsed ? 'collapsed' : ''} ${settings?.reducedMotion ? 'reduce-motion' : ''}`}
      aria-label={navigationLabel}
    >
      <nav className="nav-list" aria-label={navigationLabel}>
        <div className="nav-section">{t('home')}</div>
        <div className="nav-items">
          {sections.map((item) => {
            const active = nav.section === item.section
            const label = t(item.key)
            return (
              <button
                type="button"
                key={item.section}
                data-section={item.section}
                className={`nav-item ${active ? 'active' : ''} ${collapsed ? 'collapsed' : ''}`}
                onClick={() => navigate({ section: item.section })}
                onKeyDown={(event) => activateFromKeyboard(event, () => navigate({ section: item.section }))}
                title={collapsed ? label : undefined}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
              >
                <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                <span className="nav-label">{label}</span>
              </button>
            )
          })}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <button
          type="button"
          className={`nav-item ${collapsed ? 'collapsed' : ''}`}
          onClick={onToggle}
          onKeyDown={(event) => activateFromKeyboard(event, onToggle)}
          title={collapsed ? expandLabel : collapseLabel}
          aria-label={collapsed ? expandLabel : collapseLabel}
          aria-expanded={!collapsed}
        >
          <span className="nav-icon"><Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} /></span>
          <span className="nav-label">{collapsed ? expandLabel : collapseLabel}</span>
        </button>
      </div>
      <HomePlaybackStatus />
    </aside>
  )
}

function HomePlaybackStatus() {
  const { t, session, library, play, togglePlayPause, navigate, settings } = useRuntime()
  const previewItem = [...library]
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || b.addedAt - a.addedAt)
    .find((entry) => !entry.isImage && entry.sourceAvailable)
  const idle = session.idle || session.mediaId == null
  const stateLabel = idle ? t('play') : session.paused ? t('paused') : t('playing')
  const primaryAction = settings?.navigationPlayPrimaryAction ?? 'open-player'

  const toggle = () => {
    if (idle) {
      if (previewItem) void play([previewItem.id], 0)
      return
    }
    togglePlayPause()
  }

  const openPlayer = () => {
    if (idle) {
      if (previewItem) void play([previewItem.id], 0)
      return
    }
    navigate({ section: 'player' })
  }

  const runAction = (action: AppSettingsData['navigationPlayPrimaryAction']) => {
    if (action === 'open-player') openPlayer()
    else toggle()
  }

  const secondaryAction = primaryAction === 'open-player' ? 'toggle-playback' : 'open-player'
  const primaryLabel = primaryAction === 'open-player'
    ? (idle ? t('play') : stateLabel)
    : (idle || session.paused ? t('play') : t('pause'))
  const primaryIcon: IconName = primaryAction === 'open-player' && !idle
    ? (session.kind === 'audio' ? 'music' : 'video')
    : (idle || session.paused ? 'play' : 'pause')
  const primaryTitle = primaryAction === 'open-player' ? t('openPlayer') : (idle || session.paused ? t('play') : t('pause'))
  const secondaryTitle = secondaryAction === 'open-player' ? t('openPlayer') : (idle || session.paused ? t('play') : t('pause'))

  return (
    <div
      className="home-playback-status"
      data-playback-state={idle ? 'idle' : session.paused ? 'paused' : 'playing'}
      data-primary-action={primaryAction}
    >
      <button
        type="button"
        className="home-playback-toggle"
        onClick={() => runAction(primaryAction)}
        onContextMenu={(event) => {
          event.preventDefault()
          runAction(secondaryAction)
        }}
        disabled={idle && !previewItem}
        title={`${primaryTitle}; ${t('rightClick')}: ${secondaryTitle}`}
        aria-label={`${stateLabel}. ${primaryTitle}. ${t('rightClick')}: ${secondaryTitle}`}
      >
        <span className="home-playback-icon">
          <Icon name={primaryIcon} size={19} style={{ marginLeft: primaryIcon === 'play' ? 2 : 0 }} />
        </span>
        <span className="home-playback-label">{primaryLabel}</span>
      </button>
    </div>
  )
}

export function ToastHost({ showNotificationCenter = true }: { showNotificationCenter?: boolean }) {
  const { t, settings, toasts, notificationHistory, pauseToast, resumeToast, clearNotifications, removeNotification } = useRuntime()
  const [historyOpen, setHistoryOpen] = useState(false)
  const centerRef = useRef<HTMLDivElement>(null)
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(settings?.language === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    [settings?.language]
  )

  useEffect(() => {
    if (!historyOpen) return
    const closeFromOutside = (event: PointerEvent) => {
      if (!centerRef.current?.contains(event.target as Node)) setHistoryOpen(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [historyOpen])

  useEffect(() => {
    if (!showNotificationCenter) setHistoryOpen(false)
  }, [showNotificationCenter])

  return (
    <>
      {showNotificationCenter && <div className="notification-center" ref={centerRef}>
        <button
          type="button"
          className={`notification-center-toggle ${historyOpen ? 'active' : ''}`}
          onClick={() => setHistoryOpen((open) => !open)}
          title={t('notifications')}
          aria-label={t('notifications')}
          aria-expanded={historyOpen}
        >
          <Icon name="bell" size={21} />
          {notificationHistory.length > 0 && <span>{notificationHistory.length > 99 ? '99+' : notificationHistory.length}</span>}
        </button>
        {historyOpen && (
          <section className="notification-center-panel" aria-label={t('notifications')}>
            <header>
              <h2>{t('notifications')}</h2>
              {notificationHistory.length > 0 && <button type="button" onClick={() => void clearNotifications()}>{t('clearNotifications')}</button>}
            </header>
            <div className="notification-history-list">
              {notificationHistory.length > 0 ? notificationHistory.map((record) => (
                <article key={record.id} className={`notification-history-item ${record.kind}`}>
                  <span className="notification-history-icon"><Icon name={record.kind === 'error' ? 'alert' : record.kind === 'success' ? 'check' : 'info'} size={15} /></span>
                  <span className="notification-history-copy">
                    <strong>{record.title ?? t(record.kind === 'success' ? 'notificationSuccessTitle' : record.kind === 'error' ? 'notificationErrorTitle' : 'notificationInfoTitle')}</strong>
                    <span>{record.message}</span>
                    <time dateTime={new Date(record.createdAt).toISOString()}>{dateFormatter.format(record.createdAt)}</time>
                  </span>
                  <button type="button" className="notification-history-delete" title={t('deleteNotification')} aria-label={t('deleteNotification')} onClick={() => void removeNotification(record.id)}><Icon name="trash" size={14} /></button>
                </article>
              )) : <div className="notification-history-empty">{t('noNotifications')}</div>}
            </div>
          </section>
        )}
      </div>}
      <div className="toast-host" aria-live="polite" aria-atomic="false">
        {toasts.map((toastItem) => (
          <div
            key={toastItem.id}
            className={`toast ${toastItem.kind}`}
            role={toastItem.kind === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => pauseToast(toastItem.id)}
            onMouseLeave={() => resumeToast(toastItem.id)}
          >
            <span className="toast-icon">
              <Icon name={toastItem.kind === 'error' ? 'alert' : toastItem.kind === 'success' ? 'check' : 'info'} size={16} />
            </span>
            <span className="toast-copy"><strong>{toastItem.title}</strong><span className="toast-message">{toastItem.message}</span></span>
            {toastItem.action && (
              <button type="button" className="toast-action" onClick={() => toastItem.action!.onClick()}>
                {toastItem.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

export function DialogHost() {
  const { dialog, closeDialog } = useRuntime()
  if (!dialog) return null
  return <DialogContent dialog={dialog} onClose={closeDialog} />
}

function DialogContent({ dialog, onClose }: { dialog: NonNullable<ReturnType<typeof useRuntime>['dialog']>; onClose: (v: boolean | string | null) => void }) {
  const { t } = useRuntime()
  const [value, setValue] = useState(dialog.defaultValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  if (dialog.type === 'prompt') {
    return (
      <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(null) }}>
        <div className="dialog">
          <div className="dialog-title">{dialog.title}</div>
          {dialog.message && <div className="dialog-message">{dialog.message}</div>}
          <input ref={inputRef} className="input" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onClose(value); if (e.key === 'Escape') onClose(null) }} />
          <div className="dialog-actions">
            <button className="btn" onClick={() => onClose(null)}>{dialog.cancelLabel ?? t('cancel')}</button>
            <button className="btn btn-primary" onClick={() => onClose(value)}>{dialog.confirmLabel ?? t('create')}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false) }}>
      <div className="dialog">
        <div className="dialog-title">{dialog.title}</div>
        {dialog.message && <div className="dialog-message">{dialog.message}</div>}
        <div className="dialog-actions">
          <button className="btn" onClick={() => onClose(false)}>{dialog.cancelLabel ?? t('cancel')}</button>
          <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onClose(true)}>
            {dialog.confirmLabel ?? t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CtxMenuHost() {
  const { ctxMenu, closeCtxMenu } = useRuntime()
  useEffect(() => {
    if (!ctxMenu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCtxMenu() }
    const onClick = (e: Event) => {
      const el = e.target as HTMLElement
      if (el.closest('.ctx-menu')) return
      closeCtxMenu()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick, true)
    window.addEventListener('blur', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('blur', onClick)
    }
  }, [ctxMenu, closeCtxMenu])

  if (!ctxMenu) return null
  const estimatedHeight = ctxMenu.items.reduce((height, item) => height + (item.divider ? 11 : 40), 10)
  const x = Math.max(8, Math.min(ctxMenu.x, window.innerWidth - 220))
  const y = Math.max(8, Math.min(ctxMenu.y, window.innerHeight - estimatedHeight - 8))
  return (
    <div className="ctx-menu" role="menu" style={{ left: x, top: y }}>
      {ctxMenu.items.map((item, i) => {
        if (item.divider) return <div key={i} className="ctx-sep" />
        return (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
            disabled={item.disabled}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              closeCtxMenu()
              item.onSelect?.()
            }}
          >
            {item.icon && (
              <span className="ctx-icon">
                <Icon name={item.icon as IconName} size={15} />
              </span>
            )}
            <span>{item.label}</span>
            {item.checked && (
              <span className="ctx-check">
                <Icon name="check" size={14} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function HudHost() {
  const { hud, settings } = useRuntime()
  const enabled = Boolean(settings?.performanceHudEnabled)
  const [rendererRefreshRate, setRendererRefreshRate] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let frame = 0
    let frameCount = 0
    let sampledAt = performance.now()
    const sample = (now: number) => {
      frameCount += 1
      const elapsed = now - sampledAt
      if (elapsed >= 750) {
        setRendererRefreshRate(frameCount * 1000 / elapsed)
        frameCount = 0
        sampledAt = now
      }
      frame = requestAnimationFrame(sample)
    }
    const resetSample = () => {
      frameCount = 0
      sampledAt = performance.now()
    }
    frame = requestAnimationFrame(sample)
    document.addEventListener('visibilitychange', resetSample)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', resetSample)
    }
  }, [enabled])

  if (!enabled) return null
  const rows: [string, string][] = []
  rows.push(['CPU', hud && !hud.cpuUnavailable ? `${hud.cpu.toFixed(1)}%` : '--'])
  rows.push(['GPU', hud && !hud.gpuUnavailable ? `${hud.gpu.toFixed(1)}%` : '--'])
  rows.push(['RAM', hud ? `${hud.memoryMb.toFixed(0)} MB` : '--'])
  rows.push(['REFRESH', rendererRefreshRate > 0 ? `${rendererRefreshRate.toFixed(0)} Hz` : '--'])
  return (
    <div className="hud" role="group" aria-label="Application performance">
      <div className="hud-panel">
        {rows.map(([k, v]) => (
          <div className="hud-row" key={k}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MiniPlayer({ surface = false }: { surface?: boolean } = {}) {
  const { session, library, nav, t, navigate, engine, playNext, playPrevious, togglePlayPause, setVolume, toggleMute, stopPlayback, setFullscreen, win } = useRuntime()
  if (session.idle || session.mediaId == null) return null
  const item = library.find((i) => i.id === session.mediaId)
  const title = item?.title || item?.fileName || t('appName')
  const artist = item?.artist || item?.album || ''
  const position = session.position
  const duration = session.duration
  const toggle = togglePlayPause

  if (surface || nav.section === 'home') {
    return (
      <div className={`cinema-mini-player mini-player ${surface ? 'player-surface-controls' : ''}`}>
        <div className="mp-cover" onClick={() => navigate({ section: 'player' })}>
          {item?.coverPath ? <img src={coverUrl(item.coverPath)} alt="" /> : <Icon name={item?.isAudio ? 'music' : 'video'} size={21} />}
        </div>
        <div className="mp-info">
          <div className="mp-title" onClick={() => navigate({ section: 'player' })}>{title}</div>
          <div className="mp-sub">{artist || t('unknown')}</div>
        </div>
        <div className="mp-controls">
          <button className="btn-icon" onClick={() => void playPrevious()} title={t('previous')}><Icon name="prev" size={17} /></button>
          <button className="btn-icon" onClick={toggle} title={session.paused ? t('play') : t('pause')}>
            <Icon name={session.paused ? 'play' : 'pause'} size={22} />
          </button>
          <button className="btn-icon" onClick={() => void playNext()} title={t('next')}><Icon name="next" size={17} /></button>
        </div>
        <div className="mp-slider">
          <span className="mp-time">{formatTime(position)}</span>
          <ProgressSlider value={position} max={duration} onSeek={(v) => engine.seekTo(v)} disabled={false} />
          <span className="mp-time">{formatTime(duration)}</span>
        </div>
        <div className="mp-extra">
          <button className="btn-icon" onClick={toggleMute} title={t('mute')}>
            <Icon name={session.muted || session.volume === 0 ? 'volumeMute' : 'volume'} size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={session.volume}
            style={{ '--volume-progress': `${session.volume}%` } as React.CSSProperties}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <button className="btn-icon" onClick={() => navigate({ section: 'playlists' })} title={t('playlists')}>
            <Icon name="playlist" size={18} />
          </button>
          <button className="btn-icon" onClick={() => navigate({ section: 'player' })} title={t('subtitleTracks')}>
            <Icon name="subtitle" size={17} />
          </button>
          <button className="btn-icon" onClick={() => void setFullscreen(!win.fullscreen)} title={t('fullscreen')}>
            <Icon name="fullscreen" size={17} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mini-player">
      <div className="mp-cover" onClick={() => navigate({ section: 'player' })}>
        {item?.coverPath ? <img src={coverUrl(item.coverPath)} alt="" /> : <Icon name={item?.isAudio ? 'music' : 'video'} size={21} />}
      </div>
      <div className="mp-info">
        <div className="mp-title" onClick={() => navigate({ section: 'player' })}>{title}</div>
        <div className="mp-sub">{artist || t('unknown')}</div>
      </div>
      <div className="mp-controls">
        <button className="btn-icon" onClick={() => void playPrevious()} title={t('previous')}><Icon name="prev" size={17} /></button>
        <button className="btn-icon" onClick={toggle} title={session.paused ? t('play') : t('pause')}>
          <Icon name={session.paused ? 'play' : 'pause'} size={19} />
        </button>
        <button className="btn-icon" onClick={() => void playNext()} title={t('next')}><Icon name="next" size={17} /></button>
      </div>
      <div className="mp-slider">
        <span className="mp-time">{formatTime(position)}</span>
        <ProgressSlider value={position} max={duration} onSeek={(v) => engine.seekTo(v)} disabled={false} />
        <span className="mp-time">{formatTime(duration)}</span>
      </div>
      <div className="mp-extra">
        <button className="btn-icon" onClick={toggleMute} title={t('mute')}>
          <Icon name={session.muted || session.volume === 0 ? 'volumeMute' : 'volume'} size={16} />
        </button>
        <input type="range" min={0} max={100} value={session.volume} onChange={(e) => setVolume(Number(e.target.value))} />
        <button className="btn-icon" onClick={() => void setFullscreen(!win.fullscreen)} title={t('fullscreen')}>
          <Icon name="fullscreen" size={16} />
        </button>
        <button className="btn-icon" onClick={stopPlayback} title={t('stop')}>
          <Icon name="stop" size={16} />
        </button>
      </div>
    </div>
  )
}

export function GlobalShortcuts() {
  const { togglePlayPause, playNext, playPrevious, setVolume, session, engine, setFullscreen, win, nav, imageSession } = useRuntime()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Video and image players have richer, page-specific keyboard handling.
      // Avoid processing the same repeated keydown in both shortcut layers.
      if (nav.section === 'player' && (session.kind === 'video' || imageSession != null)) return
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlayPause()
      } else if (e.key === 'ArrowRight' && session.mediaId != null) {
        engine.seekTo(session.position + 5)
      } else if (e.key === 'ArrowLeft' && session.mediaId != null) {
        engine.seekTo(session.position - 5)
      } else if (e.key === 'ArrowUp' && session.mediaId != null) {
        setVolume(session.volume + 5)
      } else if (e.key === 'ArrowDown' && session.mediaId != null) {
        setVolume(session.volume - 5)
      } else if (e.key === 'f' || e.key === 'F') {
        void setFullscreen(!win.fullscreen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlayPause, playNext, playPrevious, setVolume, session, engine, setFullscreen, win, nav.section, imageSession])
  return null
}

export function DragDropImporter() {
  const { t, toast } = useRuntime()
  const [over, setOver] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth.current++
      setOver(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setOver(false)
    }
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0
      setOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      const paths = files.map((f) => window.aurora.pathForFile(f))
      void window.aurora.invoke(I.libraryAddPaths, paths).then((added) => {
        toast('success', t('filesImportedNotification', { count: added as number }))
      })
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [t, toast])

  if (!over) return null
  return (
    <div className="drop-overlay">
      <div className="drop-box">
        <div className="drop-icon">
          <Icon name="download" size={30} />
        </div>
        <div className="drop-text">{t('dropHint')}</div>
      </div>
    </div>
  )
}
