import React, { useEffect, useMemo, useState } from 'react'
import { p, useRuntime } from '../core/runtime'
import { Icon } from '../core/icons'
import { coverUrl } from '../core/player'
import { displayMediaTitle, type MediaItem, type MediaTrackCatalog } from '../../shared/types'
import { I } from '../../shared/channels'
import { AudioArtwork } from './mediaArtwork'

export function HomePage() {
  const { t, library, session, play, addMediaDialog } = useRuntime()
  const [query, setQuery] = useState('')

  const playable = useMemo(() => library.filter((item) => !item.isImage && item.sourceAvailable), [library])
  const continueWatching = useMemo(
    () => playable
      .filter((item) => item.lastPlayedAt > 0 && item.lastPosition > 5 && item.lastPosition < (item.duration || 0) - 3)
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt),
    [playable]
  )
  const recent = useMemo(() => [...playable].sort((a, b) => b.addedAt - a.addedAt), [playable])
  const featured = useMemo(() => {
    const current = session.mediaId == null ? null : playable.find((item) => item.id === session.mediaId)
    return current ?? continueWatching[0] ?? recent.find((item) => !item.isAudio) ?? recent[0] ?? null
  }, [continueWatching, playable, recent, session.mediaId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []
    return playable
      .filter((item) => [item.title, item.fileName, item.artist, item.album].some((value) => value.toLocaleLowerCase().includes(needle)))
      .slice(0, 4)
  }, [playable, query])
  const railItems = query ? filtered : continueWatching.length ? continueWatching.slice(0, 4) : recent.slice(0, 4)

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

      <section className="cinema-rail" aria-labelledby="continue-watching-title">
        <div className="cinema-section-head">
          <h2 id="continue-watching-title">{query ? t('search') : continueWatching.length ? t('continueWatching') : t('recentArchives')}</h2>
        </div>
        {railItems.length ? (
          <div className="cinema-card-grid">
            {railItems.map((item) => (
              <CinemaCard key={item.id} item={item} featured={item.id === featured.id} onPlay={() => void play([item.id], 0)} />
            ))}
          </div>
        ) : (
          <button className="cinema-empty" onClick={() => void addMediaDialog()}>
            <Icon name="plus" size={20} />
            <span>{query ? t('noMatchingMedia') : t('addMedia')}</span>
          </button>
        )}
      </section>
    </div>
  )
}

function HeroMediaPanel({ item, onPlay }: { item: MediaItem; onPlay: () => void }) {
  const { t } = useRuntime()
  const title = displayMediaTitle(item.title, item.fileName)
  return (
    <section className="cinema-hero" aria-label={title}>
      <div className="cinema-copy">
        <div className="cinema-title-block">
          <h1 title={title}>{title}</h1>
          <span className="cinema-title-rule" aria-hidden="true" />
        </div>
        <MediaMetadata item={item} />
        <div className="cinema-actions">
          <button className="cinema-resume" onClick={onPlay}>
            <Icon name="play" size={24} />
            {item.lastPosition > 5 ? t('resume') : t('play')}
          </button>
        </div>
      </div>
      <div className="cinema-hero-art" aria-hidden="true">
        {item.isAudio
          ? <AudioArtwork artwork={item.coverPath ? coverUrl(item.coverPath) : null} variant="hero" className="cinema-audio-artwork" />
          : item.coverPath
            ? <img src={coverUrl(item.coverPath)} alt="" draggable={false} />
            : <span className="cinema-hero-art-fallback"><Icon name="video" size={64} /></span>}
      </div>
      <div className="cinema-motto" aria-hidden="true">
        <span>GOOD</span><span>MOVIES</span><span>BETTER</span><span>MOMENTS</span>
        <i />
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
      {subtitle && <span className="cinema-subtitle" title={subtitle}>{subtitle}</span>}
      {(resolution || hdr || atmos || extension) && <div className="cinema-tags">
        {resolution && <span className="cinema-tag">{resolution}</span>}
        {hdr && <span className="cinema-tag">{hdr}</span>}
        {atmos && <span className="cinema-tag cinema-tag-atmos">Dolby Atmos</span>}
        {extension && <span className="cinema-tag">{extension}</span>}
      </div>}
    </div>
  )
}

export function CinemaTopbar({ query, onQueryChange, results }: { query: string; onQueryChange: (value: string) => void; results: MediaItem[] }) {
  const { t, play } = useRuntime()
  return (
    <div className="cinema-topbar">
      <label className="cinema-search">
        <Icon name="search" size={21} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) void play([results[0].id], 0) }} placeholder={t('search')} aria-label={t('search')} />
      </label>
    </div>
  )
}

function CinemaCard({ item, onPlay, featured }: { item: MediaItem; onPlay: () => void; featured: boolean }) {
  const progress = item.duration > 0 ? Math.min(100, Math.max(0, item.lastPosition / item.duration * 100)) : 0
  const title = displayMediaTitle(item.title, item.fileName)
  return (
    <button className={`cinema-card ${featured ? 'is-featured' : ''}`} onClick={onPlay} title={title} aria-current={featured ? 'true' : undefined}>
      <div className={`cinema-card-image ${item.isAudio ? 'audio-art' : ''}`}>
        {item.isAudio
          ? <AudioArtwork artwork={item.coverPath ? coverUrl(item.coverPath) : null} className="cinema-audio-artwork" />
          : item.coverPath
            ? <img src={coverUrl(item.coverPath)} alt="" />
            : <MediaArtworkFallback kind="video" compact />}
        <div className="cinema-card-play"><Icon name="play" size={20} /></div>
        <div className="cinema-card-track" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
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
