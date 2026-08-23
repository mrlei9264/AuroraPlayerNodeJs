import React, { useMemo, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { MediaTile, MediaRow, EmptyState, PageHeader, SearchBox, FilterChips } from '../shared/shared'
import { Icon } from '../core/icons'
import type { MediaItem } from '../../shared/types'

export type BrowseKind = 'video' | 'audio' | 'image'

export function BrowsePage({ kind }: { kind: BrowseKind }) {
  const { t, library, play, session } = useRuntime()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sort, setSort] = useState<'recent' | 'title' | 'artist' | 'duration'>('recent')
  const [filter, setFilter] = useState<'all' | 'favorites' | 'available' | 'missing'>('all')

  const items = useMemo(() => {
    let list = library.filter((i) => (kind === 'video' ? !i.isAudio && !i.isImage : kind === 'audio' ? i.isAudio : i.isImage))
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((i) => (i.title || '').toLowerCase().includes(q) || i.fileName.toLowerCase().includes(q) || i.artist.toLowerCase().includes(q))
    }
    if (filter === 'favorites') list = list.filter((i) => i.favorite)
    if (filter === 'available') list = list.filter((i) => i.sourceAvailable)
    if (filter === 'missing') list = list.filter((i) => !i.sourceAvailable)
    const sorted = [...list]
    if (sort === 'recent') sorted.sort((a, b) => b.addedAt - a.addedAt)
    else if (sort === 'title') sorted.sort((a, b) => (a.title || a.fileName).localeCompare(b.title || b.fileName))
    else if (sort === 'artist') sorted.sort((a, b) => a.artist.localeCompare(b.artist) || (a.title || a.fileName).localeCompare(b.title || b.fileName))
    else if (sort === 'duration') sorted.sort((a, b) => b.duration - a.duration)
    return sorted
  }, [library, kind, query, sort, filter])

  const title = kind === 'video' ? t('videos') : kind === 'audio' ? t('music') : t('images')
  const icon = kind === 'video' ? 'video' as const : kind === 'audio' ? 'music' as const : 'image' as const
  const allIds = items.map((i) => i.id)

  return (
    <div className="col grow">
      <PageHeader title={title} subtitle={`${items.length} ${t('selected')}`}>
        <SearchBox value={query} onChange={setQuery} placeholder={t('searchPlaceholder')} />
        <button
          className={`btn-icon ${view === 'grid' ? 'active' : ''}`}
          title={t('grid')}
          onClick={() => setView('grid')}
        >
          <Icon name="grid" size={17} />
        </button>
        <button
          className={`btn-icon ${view === 'list' ? 'active' : ''}`}
          title={t('list')}
          onClick={() => setView('list')}
        >
          <Icon name="list" size={17} />
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void play(allIds, 0)}
          disabled={!items.length}
        >
          <Icon name="play" size={15} />
          {t('playAll')}
        </button>
      </PageHeader>

      <div className="browse-toolbar">
        <FilterChips
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { label: t('all'), value: 'all' },
            { label: t('favorites'), value: 'favorites' },
            { label: t('local'), value: 'available' },
            { label: t('missing'), value: 'missing' }
          ]}
        />
        <div className="spacer" />
        <select
          className="input"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="recent">{t('sortRecentlyAdded')}</option>
          <option value="title">{t('sortTitle')}</option>
          <option value="artist">{t('sortArtist')}</option>
          <option value="duration">{t('sortDuration')}</option>
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={icon}
          title={query ? t('noResults') : t('emptyLibraryTitle')}
          description={query ? '' : t('emptyLibraryDesc')}
        />
      ) : view === 'grid' ? (
        <div className={`grid ${kind === 'audio' ? 'cover' : ''}`}>
          {items.map((item) => (
            <MediaTile key={item.id} item={item} onPlay={() => void play([item.id], 0)} />
          ))}
        </div>
      ) : (
        <div className="media-list">
          {items.map((item, idx) => (
            <MediaRow
              key={item.id}
              item={item}
              index={idx}
              active={session.mediaId === item.id}
              onPlay={() => void play([item.id], 0)}
            />
          ))}
        </div>
      )}
    </div>
  )
}