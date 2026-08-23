import React, { useMemo, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { EmptyState, PageHeader, QueueRow } from '../shared/shared'
import { Icon } from '../core/icons'

export function PlaylistsPage() {
  const { t, playlists, createPlaylist, renamePlaylist, deletePlaylist, confirm, prompt, navigate, nav, session } = useRuntime()
  const selectedId = nav.playlistId ?? null
  const playlist = playlists.find((p) => p.id === selectedId) ?? null

  const create = async () => {
    const name = await prompt(t('newPlaylist'), '')
    if (name) await createPlaylist(name)
  }

  const rename = async () => {
    if (!playlist) return
    const name = await prompt(t('rename'), playlist.name)
    if (name && name !== playlist.name) await renamePlaylist(playlist.id, name)
  }

  const remove = async () => {
    if (!playlist) return
    const ok = await confirm(t('deleteConfirm'), playlist.name, { danger: true, confirmLabel: t('delete') })
    if (ok) {
      await deletePlaylist(playlist.id)
      navigate({ section: 'playlists' })
    }
  }

  return (
    <div className="col grow">
      <PageHeader title={playlist ? playlist.name : t('playlists')} subtitle={playlist ? `${playlist.entries.length} ${t('selected')}` : undefined}>
        {playlist ? (
          <>
            <button className="btn" onClick={() => void rename()}>
              <Icon name="edit" size={15} />
              {t('rename')}
            </button>
            <button className="btn btn-danger" onClick={() => void remove()}>
              <Icon name="trash" size={15} />
              {t('delete')}
            </button>
            <button className="btn-icon" onClick={() => navigate({ section: 'playlists' })}>
              <Icon name="close" size={15} />
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => void create()}
          >
            <Icon name="plus" size={15} />
            {t('newPlaylist')}
          </button>
        )}
      </PageHeader>

      {!playlist ? (
        playlists.length === 0 ? (
          <EmptyState icon="playlist" title={t('noPlaylists')} action={{ label: t('newPlaylist'), onClick: () => void create() }} />
        ) : (
          <div className="grid">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                className="playlist-card"
                onClick={() => navigate({ section: 'playlists', playlistId: pl.id })}
                onContextMenu={(e) => e.preventDefault()}
              >
                <div className="pl-cover">
                  <Icon name="playlist" size={24} />
                </div>
                <div className="pl-info">
                  <div className="pl-name">{pl.name}</div>
                  <div className="pl-count">{pl.entries.length} {t('selected')}</div>
                </div>
                <Icon name="chevronRight" size={16} className="hover-reveal" />
              </div>
            ))}
          </div>
        )
      ) : (
        <PlaylistDetail playlistId={playlist.id} />
      )}
    </div>
  )
}

function PlaylistDetail({ playlistId }: { playlistId: number }) {
  const { t, playlists, play, session, removePlaylistEntry, movePlaylistEntry, enqueue } = useRuntime()
  const playlist = playlists.find((p) => p.id === playlistId)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  if (!playlist) return null
  const entries = playlist.entries

  const drop = (toIndex: number) => {
    if (dragIndex != null && dragIndex !== toIndex) {
      void movePlaylistEntry(playlist.id, dragIndex, toIndex)
    }
    setDragIndex(null)
  }

  return (
    <div className="col gap-12">
      <div className="row gap-8">
        <button className="btn btn-primary" disabled={!entries.length} onClick={() => void play(entries.map((e) => e.mediaId), 0)}>
          <Icon name="play" size={14} />
          {t('playAll')}
        </button>
        <button className="btn" disabled={!entries.length} onClick={() => void enqueue(entries.map((e) => e.mediaId))}>
          <Icon name="plus" size={14} />
          {t('addToQueue')}
        </button>
      </div>
      {entries.length === 0 ? (
        <EmptyState icon="playlist" title={t('noQueue')} />
      ) : (
        <div className="media-list">
          {entries.map((entry, idx) => (
            <div
              key={`${entry.mediaId}-${idx}`}
              draggable
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => { e.preventDefault() }}
              onDrop={() => drop(idx)}
            >
              <QueueRow
                item={{
                  id: entry.mediaId,
                  url: '',
                  fileName: entry.title,
                  isAudio: entry.isAudio,
                  isImage: entry.isImage,
                  sourceId: null,
                  remotePath: null,
                  protocol: 'local',
                  sourceName: '',
                  sourceAvailable: true,
                  title: entry.title,
                  artist: entry.artist,
                  album: '',
                  favorite: false,
                  addedAt: 0,
                  lastPlayedAt: 0,
                  lastPosition: 0,
                  duration: entry.duration,
                  coverPath: null,
                  metaProbed: false
                }}
                index={idx}
                active={session.mediaId === entry.mediaId}
                onPlay={() => void play(entries.map((e) => e.mediaId), idx)}
                onRemove={() => void removePlaylistEntry(playlist.id, entry.mediaId)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}