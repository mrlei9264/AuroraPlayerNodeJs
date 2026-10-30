import React, { useEffect, useState } from 'react'
import { displayMediaTitle, formatTime, type MediaTrackCatalog } from '../../shared/types'
import { I } from '../../shared/channels'
import { Icon } from '../core/icons'
import { coverUrl } from '../core/player'
import { p, useRuntime } from '../core/runtime'
import { AudioArtwork } from './mediaArtwork'
import { MediaVideoPreviews } from './mediaVideoPreviews'

const COPY = {
  en: {
    back: 'Back to library', play: 'Play', technical: 'Technical details', tracks: 'Tracks', file: 'File information',
    audio: 'Audio', video: 'Video',
    music: 'Music information', songTitle: 'Title', artist: 'Artist', album: 'Album', albumArtist: 'Album artist',
    composer: 'Composer', genre: 'Genre', date: 'Release date / year', track: 'Track number', disc: 'Disc number',
    publisher: 'Label / publisher', copyright: 'Copyright', comment: 'Comment', notProvided: 'Not provided', readingTags: 'Reading audio tags…',
    audioCodec: 'Audio codec', sampleRate: 'Sample rate', bitDepth: 'Bit depth', bitrate: 'Bitrate', channels: 'Channels',
    duration: 'Duration', resolution: 'Resolution', frameRate: 'Frame rate', videoCodec: 'Video codec', hdr: 'HDR',
    audioTracks: 'Audio', subtitleTracks: 'Subtitles', chapters: 'Chapters', none: 'None',
    fileName: 'File name', location: 'Location', fileSize: 'File size', protocol: 'Protocol', unavailable: 'Source unavailable'
  },
  zh: {
    back: '返回媒体库', play: '播放', technical: '技术规格', tracks: '轨道信息', file: '文件信息',
    audio: '音频', video: '视频',
    music: '音乐信息', songTitle: '标题', artist: '歌手', album: '专辑', albumArtist: '专辑歌手',
    composer: '作曲者', genre: '流派', date: '发行日期 / 年份', track: '曲目号', disc: '碟号',
    publisher: '唱片公司 / 发行方', copyright: '版权', comment: '备注', notProvided: '未提供', readingTags: '正在读取音频标签…',
    audioCodec: '音频编码', sampleRate: '采样率', bitDepth: '位深', bitrate: '码率', channels: '声道',
    duration: '时长', resolution: '分辨率', frameRate: '帧率', videoCodec: '视频编码', hdr: 'HDR',
    audioTracks: '音频', subtitleTracks: '字幕', chapters: '章节', none: '无',
    fileName: '文件名', location: '位置', fileSize: '文件大小', protocol: '协议', unavailable: '媒体来源不可用'
  }
} as const

export function MediaDetailsPage({ mediaId }: { mediaId: number }) {
  const { settings, library, navigate, play, openPath } = useRuntime()
  const copy = COPY[settings.language]
  const item = library.find((candidate) => candidate.id === mediaId)
  const [trackState, setTrackState] = useState<{ mediaId: number; catalog: MediaTrackCatalog } | null>(null)
  const [loadingTracks, setLoadingTracks] = useState(true)
  const tracks = trackState?.mediaId === mediaId ? trackState.catalog : null

  useEffect(() => {
    let active = true
    setTrackState(null)
    setLoadingTracks(true)
    void p<MediaTrackCatalog>(I.mediaTracks, mediaId, true)
      .then((result) => { if (active) setTrackState({ mediaId, catalog: result }) })
      .catch(() => { if (active) setTrackState(null) })
      .finally(() => { if (active) setLoadingTracks(false) })
    return () => { active = false }
  }, [mediaId])

  const music = item?.isAudio ? tracks?.music : undefined
  const title = item ? displayMediaTitle(music?.title || item.title, item.fileName) : ''
  const artist = music?.artist || item?.artist || ''
  const album = music?.album || item?.album || ''
  const artwork = item?.coverPath ? coverUrl(item.coverPath) : ''
  const backButton = <button type="button" className="page-back-button" aria-label={copy.back} data-tooltip={copy.back} onClick={() => navigate({ section: 'library' })}><Icon name="chevronLeft" size={19} /></button>

  if (!item) {
    return <main className="media-details-page"><header className="media-details-toolbar">{backButton}</header></main>
  }

  const resolution = tracks?.width && tracks.height ? `${tracks.width} × ${tracks.height}` : '—'
  const audioTracks = tracks?.audio ?? []
  const subtitleTracks = tracks?.subtitles ?? []
  const primaryAudio = audioTracks.find((track) => track.default) ?? audioTracks[0]
  const audioBitrate = primaryAudio?.bitrate || tracks?.bitrate
  const duration = tracks?.duration || item.duration
  const musicFields = [
    { label: copy.songTitle, value: title },
    { label: copy.artist, value: artist },
    { label: copy.album, value: album },
    { label: copy.albumArtist, value: music?.albumArtist ?? '' },
    ...([
      ['composer', copy.composer], ['genre', copy.genre], ['date', copy.date], ['track', copy.track], ['disc', copy.disc],
      ['publisher', copy.publisher], ['copyright', copy.copyright], ['comment', copy.comment]
    ] as const).filter(([key]) => music?.[key]).map(([key, label]) => ({ label, value: music?.[key] ?? '' }))
  ]

  return (
    <main className="media-details-page">
      <div className="media-details-backdrop" style={artwork ? { backgroundImage: `url("${artwork}")` } : undefined} />
      <header className="media-details-toolbar">
        {backButton}
      </header>

      <section className={`media-details-hero ${!item.isAudio && !item.isImage ? 'has-preview' : ''}`}>
        <div className={`media-details-art ${item.isAudio ? 'audio' : ''}`}>
          {item.isAudio ? <AudioArtwork artwork={artwork || null} seed={item.id} /> : artwork ? <img src={artwork} alt="" /> : <div className="media-details-art-fallback"><Icon name="video" size={46} /></div>}
        </div>
        <div className="media-details-heading">
          <div className="media-details-kicker"><span>{item.protocol}</span></div>
          <h1>{title}</h1>
          {(artist || album) && <p className="media-details-byline">{[artist, album].filter(Boolean).join(' · ')}</p>}
          <div className="media-details-badges">
            <span><Icon name={item.isAudio ? 'music' : 'video'} size={14} />{item.isAudio ? copy.audio : copy.video}</span>
          </div>
          <div className="media-details-actions">
            <button className="media-details-play" disabled={!item.sourceAvailable} onClick={() => void play([item.id], 0)}><Icon name="play" size={17} />{copy.play}</button>
          </div>
          {!item.sourceAvailable && <div className="media-details-unavailable"><Icon name="alert" size={16} />{copy.unavailable}</div>}
        </div>
        {!item.isAudio && !item.isImage && <MediaVideoPreviews key={item.id} item={item} />}
      </section>

      <section className="media-details-content">
        {item.isAudio && <article className="media-details-panel wide">
          <h2>{copy.music}</h2>
          {loadingTracks && <p className="media-details-metadata-status" role="status">{copy.readingTags}</p>}
          <dl className="media-details-music-grid">
            {musicFields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value || copy.notProvided}</dd></div>)}
          </dl>
        </article>}
        <article className="media-details-panel wide">
          <h2>{copy.technical}</h2>
          <div className="media-details-specs">
            <DetailSpec icon="clock" label={copy.duration} value={formatTime(duration)} />
            {item.isAudio && <>
              <DetailSpec icon="music" label={copy.audioCodec} value={[primaryAudio?.codec?.toUpperCase(), primaryAudio?.profile].filter(Boolean).join(' · ') || '—'} />
              <DetailSpec icon="speed" label={copy.sampleRate} value={primaryAudio?.sampleRate ? `${primaryAudio.sampleRate / 1000} kHz` : '—'} />
              <DetailSpec icon="sliders" label={copy.bitDepth} value={primaryAudio?.bitDepth ? `${primaryAudio.bitDepth} bit` : '—'} />
              <DetailSpec icon="network" label={copy.bitrate} value={audioBitrate ? `${Math.round(audioBitrate / 1000)} kbps` : '—'} />
              <DetailSpec icon="volume" label={copy.channels} value={primaryAudio?.channels ? `${primaryAudio.channels}${primaryAudio.channelLayout ? ` · ${primaryAudio.channelLayout}` : ''}` : '—'} />
            </>}
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
