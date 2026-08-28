import React, { useMemo, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { Icon } from '../core/icons'
import { coverUrl } from '../core/player'
import type { MediaItem } from '../../shared/types'
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

  const featuredTitle = featured.title || featured.fileName
  const featuredSubtitle = featured.artist || featured.album || featured.sourceName || ''
  const featuredDuration = formatHomeDuration(featured.duration, t('shortHour'), t('shortMinute'))

  return (
    <div className="home-page">
      <section key={featured.id} className={`cinema-hero ${featured.isAudio ? 'audio-artwork' : featured.coverPath ? '' : 'no-artwork'}`} aria-label={featuredTitle}>
        {featured.isAudio
          ? <AudioArtwork artwork={featured.coverPath ? coverUrl(featured.coverPath) : null} variant="hero" className="cinema-audio-artwork" />
          : featured.coverPath
            ? <img className="cinema-hero-image" src={coverUrl(featured.coverPath)} alt="" />
            : <MediaArtworkFallback kind="video" />}
        <div className="cinema-ambient-light" aria-hidden="true" />
        <div className="cinema-hero-shade" />
        <div className="cinema-film-reveal" aria-hidden="true" />
        <div className="cinema-copy">
          <div className="cinema-title-block">
            <h1>{featuredTitle}</h1>
            <span className="cinema-title-rule" aria-hidden="true" />
          </div>
          {(featuredSubtitle || featuredDuration) && (
            <div className="cinema-meta">
              {featuredSubtitle && <span>{featuredSubtitle}</span>}
              {featuredSubtitle && featuredDuration && <i />}
              {featuredDuration && <span>{featuredDuration}</span>}
            </div>
          )}
          <div className="cinema-actions">
            <button className="cinema-resume" onClick={() => void play([featured.id], 0)}>
              <Icon name="play" size={19} />
              {featured.lastPosition > 5 ? t('resume') : t('play')}
            </button>
          </div>
        </div>
      </section>

      <section className="cinema-rail" aria-labelledby="continue-watching-title">
        <div className="cinema-section-head">
          <h2 id="continue-watching-title">{query ? t('search') : continueWatching.length ? t('continueWatching') : t('recentArchives')}</h2>
        </div>
        {railItems.length ? (
          <div className="cinema-card-grid">
            {railItems.map((item) => (
              <CinemaCard key={item.id} item={item} onPlay={() => void play([item.id], 0)} />
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

function CinemaCard({ item, onPlay }: { item: MediaItem; onPlay: () => void }) {
  const progress = item.duration > 0 ? Math.min(100, Math.max(0, item.lastPosition / item.duration * 100)) : 0
  return (
    <button className="cinema-card" onClick={onPlay} title={item.title || item.fileName}>
      <div className={`cinema-card-image ${item.isAudio ? 'audio-art' : ''}`}>
        {item.isAudio
          ? <AudioArtwork artwork={item.coverPath ? coverUrl(item.coverPath) : null} className="cinema-audio-artwork" />
          : item.coverPath
            ? <img src={coverUrl(item.coverPath)} alt="" />
            : <MediaArtworkFallback kind="video" compact />}
        <div className="cinema-card-play"><Icon name="play" size={20} /></div>
        {progress > 0 && <div className="cinema-card-track"><i style={{ width: `${progress}%` }} /></div>}
      </div>
      <span className="cinema-card-title">{item.title || item.fileName}</span>
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
