import React, { useEffect, useMemo, useState } from 'react'
import { p, useRuntime } from '../core/runtime'
import { Icon } from '../core/icons'
import { coverUrl } from '../core/player'
import { displayMediaTitle, type MediaItem, type MediaTrackCatalog } from '../../shared/types'
import { I } from '../../shared/channels'
import { getResumePosition, isPlaybackComplete } from '../../shared/playback'
import { AudioArtwork } from './mediaArtwork'

export function HomePage() {
  const { t, library, session, settings, play, addMediaDialog } = useRuntime()
  const resumeEnabled = settings?.resumePlayback ?? true

  const playable = useMemo(() => library.filter((item) => !item.isImage && item.sourceAvailable), [library])
  const playbackHistory = useMemo(
    () => playable
      .filter((item) => item.lastPlayedAt > 0 && (!resumeEnabled || !isPlaybackComplete(item)))
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt),
    [playable, resumeEnabled]
  )
  const recent = useMemo(() => [...playable].sort((a, b) => b.addedAt - a.addedAt), [playable])
  const featured = useMemo(() => {
    const current = session.mediaId == null ? null : playable.find((item) => item.id === session.mediaId)
    return current ?? playbackHistory[0] ?? recent.find((item) => !item.isAudio) ?? recent[0] ?? null
  }, [playbackHistory, playable, recent, session.mediaId])

  const railItems = playbackHistory.length ? playbackHistory.slice(0, 4) : recent.slice(0, 4)

  if (!featured) {
    return (
      <div className="home-page home-page-empty">
        <button className="cinema-empty cinema-empty-home" onClick={() => void addMediaDialog()}>
          <Icon name="plus" size={22} />
          <strong>{t('libraryEmpty')}</strong>
          <span>{t('addMediaToStart')}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="home-page">
      <HeroMediaPanel key={featured.id} item={featured} onPlay={() => void play([featured.id], 0)} />

      <section className="cinema-rail" aria-labelledby="home-history-title">
        <div className="cinema-section-head">
          <h2 id="home-history-title">{playbackHistory.length ? t(resumeEnabled ? 'continueWatching' : 'recentlyPlayed') : t('recentArchives')}</h2>
        </div>
        <div className="cinema-card-grid">
          {railItems.map((item) => (
            <CinemaCard key={item.id} item={item} featured={item.id === featured.id} onPlay={() => void play([item.id], 0)} />
          ))}
        </div>
      </section>
    </div>
  )
}

function HeroMediaPanel({ item, onPlay }: { item: MediaItem; onPlay: () => void }) {
  const { t, settings } = useRuntime()
  const title = displayMediaTitle(item.title, item.fileName)
  return (
    <section className="cinema-hero" aria-label={title}>
      <div className="cinema-copy">
        <div className="cinema-title-block">
          <h1 data-tooltip={title}>{title}</h1>
          <span className="cinema-title-rule" aria-hidden="true" />
        </div>
        <MediaMetadata item={item} />
        <div className="cinema-actions">
          <button className="cinema-resume" onClick={onPlay}>
            <Icon name="play" size={24} />
            {getResumePosition(item, settings?.resumePlayback ?? true) > 0 ? t('resume') : t('play')}
          </button>
        </div>
      </div>
      <div className="cinema-hero-art" aria-hidden="true">
        {item.isAudio
          ? <AudioArtwork artwork={item.coverPath ? coverUrl(item.coverPath) : null} seed={item.id} variant="hero" className="cinema-audio-artwork" />
          : item.coverPath
            ? <img src={coverUrl(item.coverPath)} alt="" draggable={false} />
            : <span className="cinema-hero-art-fallback"><Icon name="video" size={64} /></span>}
      </div>
    </section>
  )
}

function MediaMetadata({ item }: { item: MediaItem }) {
  const { t } = useRuntime()
  const [catalog, setCatalog] = useState<MediaTrackCatalog | null>(null)
  useEffect(() => {
    let active = true
    setCatalog(null)
    // Reuse the existing catalogue; never infer technical labels from a title.
    void p<MediaTrackCatalog>(I.mediaTracks, item.id)
      .then((result) => { if (active) setCatalog(result) })
      .catch(() => { if (active) setCatalog(null) })
    return () => { active = false }
  }, [item.id])

  const duration = formatHomeDuration(item.duration, t('shortHour'), t('shortMinute'))
  const subtitle = item.artist || item.album || item.sourceName
  const extension = /\.([a-z0-9]{1,8})$/i.exec(item.fileName)?.[1].toUpperCase()
  const resolution = catalog && !item.isAudio
    ? catalog.width >= 7680 ? '8K' : catalog.width >= 3840 ? '4K' : catalog.height >= 1080 ? '1080p' : catalog.height >= 720 ? '720p' : null
    : null
  const hdr = !item.isAudio && catalog?.hdrType && catalog.hdrType.toUpperCase() !== 'SDR' ? catalog.hdrType : null
  const atmos = catalog?.audio.some((track) => track.atmos)
  return (
    <div className="cinema-meta">
      {duration && <span className="cinema-duration">{duration}</span>}
      {subtitle && <span className="cinema-subtitle" data-tooltip={subtitle}>{subtitle}</span>}
      {(resolution || hdr || atmos || extension) && <div className="cinema-tags">
        {resolution && <span className="cinema-tag">{resolution}</span>}
        {hdr && <span className="cinema-tag">{hdr}</span>}
        {atmos && <span className="cinema-tag cinema-tag-atmos">Dolby Atmos</span>}
        {extension && <span className="cinema-tag">{extension}</span>}
      </div>}
    </div>
  )
}

function CinemaCard({ item, onPlay, featured }: { item: MediaItem; onPlay: () => void; featured: boolean }) {
  const { settings } = useRuntime()
  const resumeEnabled = settings?.resumePlayback ?? true
  const progress = resumeEnabled && item.duration > 0 ? Math.min(100, Math.max(0, item.lastPosition / item.duration * 100)) : 0
  const title = displayMediaTitle(item.title, item.fileName)
  return (
    <button className={`cinema-card ${featured ? 'is-featured' : ''}`} onClick={onPlay} data-tooltip={title} aria-label={title} aria-current={featured ? 'true' : undefined}>
      <div className="cinema-card-image">
        {item.isAudio
          ? <AudioArtwork artwork={item.coverPath ? coverUrl(item.coverPath) : null} seed={item.id} className="cinema-audio-artwork" />
          : item.coverPath
            ? <img src={coverUrl(item.coverPath)} alt="" />
            : <MediaArtworkFallback kind="video" compact />}
        <div className="cinema-card-play"><Icon name="play" size={20} /></div>
        {resumeEnabled && <div className="cinema-card-track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>}
      </div>
      <span className="cinema-card-title">{title}</span>
    </button>
  )
}

export function MediaArtworkFallback({ kind, compact = false }: { kind: 'audio' | 'video'; compact?: boolean }) {
  return <span className={`media-artwork-fallback ${compact ? 'compact' : ''}`}><Icon name={kind === 'audio' ? 'music' : 'video'} size={compact ? 31 : 58} /></span>
}

function formatHomeDuration(seconds: number, hour: string, minute: string): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds / 60)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours ? `${hours}${hour}${minutes ? ` ${minutes}${minute}` : ''}` : `${minutes}${minute}`
}
