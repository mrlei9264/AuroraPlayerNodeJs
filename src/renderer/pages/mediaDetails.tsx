import React, { useEffect, useState } from 'react'
import { formatTime, type MediaTrackCatalog } from '../../shared/types'
import { I } from '../../shared/channels'
import { Icon } from '../core/icons'
import { coverUrl } from '../core/player'
import { p, useRuntime } from '../core/runtime'
import { AudioArtwork } from './mediaArtwork'

const COPY = {
  en: {
    back: 'Back to library', play: 'Play', technical: 'Technical details', tracks: 'Tracks', file: 'File information',
    audio: 'Audio', video: 'Video',
    duration: 'Duration', resolution: 'Resolution', frameRate: 'Frame rate', videoCodec: 'Video codec', hdr: 'HDR',
    audioTracks: 'Audio', subtitleTracks: 'Subtitles', chapters: 'Chapters', none: 'None',
    fileName: 'File name', location: 'Location', fileSize: 'File size', protocol: 'Protocol', unavailable: 'Source unavailable'
  },
  zh: {
    back: '返回媒体库', play: '播放', technical: '技术规格', tracks: '轨道信息', file: '文件信息',
    audio: '音频', video: '视频',
    duration: '时长', resolution: '分辨率', frameRate: '帧率', videoCodec: '视频编码', hdr: 'HDR',
    audioTracks: '音频', subtitleTracks: '字幕', chapters: '章节', none: '无',
    fileName: '文件名', location: '位置', fileSize: '文件大小', protocol: '协议', unavailable: '媒体来源不可用'
  }
} as const

export function MediaDetailsPage({ mediaId }: { mediaId: number }) {
  const { settings, library, navigate, play, openPath } = useRuntime()
  const copy = COPY[settings.language]
  const item = library.find((candidate) => candidate.id === mediaId)
  const [tracks, setTracks] = useState<MediaTrackCatalog | null>(null)

  useEffect(() => {
    let active = true
    setTracks(null)
    void p<MediaTrackCatalog>(I.mediaTracks, mediaId)
      .then((result) => { if (active) setTracks(result) })
      .catch(() => { if (active) setTracks(null) })
    return () => { active = false }
  }, [mediaId])

  const title = item?.title || item?.fileName || ''
  const artwork = item?.coverPath ? coverUrl(item.coverPath) : ''

  if (!item) {
    return <main className="media-details-page"><button className="media-details-back" onClick={() => navigate({ section: 'library' })}><Icon name="chevronLeft" />{copy.back}</button></main>
  }

  const resolution = tracks?.width && tracks.height ? `${tracks.width} × ${tracks.height}` : '—'
  const audioTracks = tracks?.audio ?? []
  const subtitleTracks = tracks?.subtitles ?? []

  return (
    <main className="media-details-page">
      <div className="media-details-backdrop" style={artwork ? { backgroundImage: `url("${artwork}")` } : undefined} />
      <header className="media-details-toolbar">
        <button className="media-details-back" onClick={() => navigate({ section: 'library' })}><Icon name="chevronLeft" size={18} />{copy.back}</button>
      </header>

      <section className="media-details-hero">
        <div className={`media-details-art ${item.isAudio ? 'audio' : ''}`}>
          {item.isAudio ? <AudioArtwork artwork={artwork || null} /> : artwork ? <img src={artwork} alt="" /> : <div className="media-details-art-fallback"><Icon name="video" size={46} /></div>}
        </div>
        <div className="media-details-heading">
          <div className="media-details-kicker"><span>{item.protocol}</span></div>
          <h1>{title}</h1>
          {item.artist && <p className="media-details-byline">{item.artist}{item.album ? ` · ${item.album}` : ''}</p>}
          <div className="media-details-badges">
            <span><Icon name={item.isAudio ? 'music' : 'video'} size={14} />{item.isAudio ? copy.audio : copy.video}</span>
          </div>
          <div className="media-details-actions">
            <button className="media-details-play" disabled={!item.sourceAvailable} onClick={() => void play([item.id], 0)}><Icon name="play" size={17} />{copy.play}</button>
          </div>
          {!item.sourceAvailable && <div className="media-details-unavailable"><Icon name="alert" size={16} />{copy.unavailable}</div>}
        </div>
      </section>

      <section className="media-details-content">
        <article className="media-details-panel wide">
          <h2>{copy.technical}</h2>
          <div className="media-details-specs">
            <DetailSpec icon="clock" label={copy.duration} value={formatTime(item.duration)} />
            {!item.isAudio && <DetailSpec icon="image" label={copy.resolution} value={resolution} />}
            {!item.isAudio && <DetailSpec icon="speed" label={copy.frameRate} value={tracks?.fps ? `${tracks.fps.toFixed(2)} fps` : '—'} />}
            {!item.isAudio && <DetailSpec icon="video" label={copy.videoCodec} value={[tracks?.videoCodec, tracks?.videoProfile].filter(Boolean).join(' · ') || '—'} />}
            {!item.isAudio && <DetailSpec icon="sun" label={copy.hdr} value={tracks?.hdrType || copy.none} />}
            <DetailSpec icon="music" label={copy.audioTracks} value={String(audioTracks.length)} />
            <DetailSpec icon="subtitle" label={copy.subtitleTracks} value={String(subtitleTracks.length)} />
            <DetailSpec icon="list" label={copy.chapters} value={String(tracks?.chapters.length ?? 0)} />
          </div>
        </article>

        <article className="media-details-panel wide">
          <h2>{copy.tracks}</h2>
          <div className="media-details-track-groups">
            <TrackGroup icon="music" title={copy.audioTracks} tracks={audioTracks.map((track) => `${track.title}${track.language ? ` · ${track.language}` : ''}${track.codec ? ` · ${track.codec.toUpperCase()}` : ''}`)} empty={copy.none} />
            <TrackGroup icon="subtitle" title={copy.subtitleTracks} tracks={subtitleTracks.map((track) => `${track.title}${track.language ? ` · ${track.language}` : ''}${track.codec ? ` · ${track.codec.toUpperCase()}` : ''}`)} empty={copy.none} />
          </div>
        </article>

        <article className="media-details-panel wide">
          <h2>{copy.file}</h2>
          <dl className="media-details-file-grid">
            <div><dt>{copy.fileName}</dt><dd>{item.fileName}</dd></div>
            <div><dt>{copy.fileSize}</dt><dd>{formatBytes(item.fileSize || 0)}</dd></div>
            <div><dt>{copy.protocol}</dt><dd>{item.protocol.toUpperCase()}</dd></div>
            <div className="path"><dt>{copy.location}</dt><dd><button disabled={item.protocol !== 'local'} onClick={() => void openPath(item.url)}>{item.url}</button></dd></div>
          </dl>
        </article>
      </section>
    </main>
  )
}

function DetailSpec({ icon, label, value }: { icon: Parameters<typeof Icon>[0]['name']; label: string; value: string }) {
  return <div className="media-details-spec"><Icon name={icon} size={18} /><span><small>{label}</small><strong>{value}</strong></span></div>
}

function TrackGroup({ icon, title, tracks, empty }: { icon: Parameters<typeof Icon>[0]['name']; title: string; tracks: string[]; empty: string }) {
  return <div className="media-details-track-group"><h3><Icon name={icon} size={17} />{title}</h3><div>{tracks.length ? tracks.map((track, index) => <span key={`${track}-${index}`}>{track}</span>) : <em>{empty}</em>}</div></div>
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 2 : 0)} ${units[unit]}`
}
