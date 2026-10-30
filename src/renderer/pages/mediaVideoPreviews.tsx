import React, { useEffect, useRef, useState } from 'react'
import { I, E } from '../../shared/channels'
import type { DownloadTask, MediaItem, VideoPreviewResult } from '../../shared/types'
import { Icon } from '../core/icons'
import { coverUrl } from '../core/player'
import { p, useRuntime } from '../core/runtime'

const COPY = {
  zh: {
    title: '视频缩略图', description: '3 行 × 10 列 · 30 帧拼接图', enlarge: '放大查看拼接图', close: '关闭',
    retry: '重新生成', cancelled: '生成已停止，请重新尝试。', missingTool: '缺少 FFmpeg / FFprobe，请修复媒体工具依赖后重新生成。',
    failed: '暂时无法生成预览，请检查文件是否可读取后重试。',
    downloadNeeded: '按需读取失败。点击重新生成可确认下载完整视频，再生成缩略图。',
    readLimit: '生成拼接图所需数据超出按需读取限额。点击重新生成可确认下载完整视频后继续。',
    confirmTitle: '下载完整视频？', confirmMessage: '此操作会下载完整视频并保存到下载目录，完成后自动生成预览。是否继续？',
    confirm: '确认下载', downloadFailed: '下载未完成，请重试或前往下载页面查看。',
    noSource: '请先将视频下载并添加到本地媒体库，再打开媒体信息。'
  },
  en: {
    title: 'Video contact sheet', description: '3 rows × 10 columns · 30 frames in one image', enlarge: 'Enlarge contact sheet', close: 'Close',
    retry: 'Regenerate', cancelled: 'Generation stopped. Please retry.', missingTool: 'FFmpeg / FFprobe is missing. Restore the media tools and regenerate.',
    failed: 'Previews could not be generated. Check that the file is accessible and retry.',
    downloadNeeded: 'Partial reads failed. Regenerate will ask to download the full video before continuing.',
    readLimit: 'The contact sheet exceeded the partial-read limit. Regenerate will ask to download the full video before continuing.',
    confirmTitle: 'Download the full video?', confirmMessage: 'This downloads the entire video to your downloads directory, then generates previews. Continue?',
    confirm: 'Download', downloadFailed: 'The download did not complete. Retry or check the Downloads page.',
    noSource: 'Download the video and add it to the local library, then open its media information.'
  }
} as const

export function MediaVideoPreviews({ item }: { item: MediaItem }) {
  const { settings, downloads, confirm } = useRuntime()
  const copy = COPY[settings.language]
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<VideoPreviewResult | null>(null)
  const [downloadId, setDownloadId] = useState<number | null>(null)
  const [requestingDownload, setRequestingDownload] = useState(false)
  const [downloadError, setDownloadError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  useEffect(() => {
    const requestId = crypto.randomUUID()
    let active = true
    setResult(null)
    setDownloadError(false)
    const accept = (next: VideoPreviewResult) => {
      if (active && next.mediaId === item.id && next.requestId === requestId) setResult(next)
    }
    const unsubscribe = window.aurora.on<VideoPreviewResult>(E.mediaVideoPreviewsProgress, accept)
    void p<VideoPreviewResult>(I.mediaVideoPreviews, item.id, requestId, attempt > 0).then(accept).catch(() => accept({
      mediaId: item.id, requestId, frames: [], total: 30, status: 'error'
    }))
    return () => {
      active = false
      unsubscribe()
      void p(I.mediaVideoPreviewsCancel, requestId).catch(() => {})
    }
  }, [item.id, item.url, attempt])

  useEffect(() => {
    if (downloadId === null) return
    const task = downloads.find((candidate) => candidate.id === downloadId)
    if (task?.status === 'completed') {
      setDownloadId(null)
      setAttempt((value) => value + 1)
    } else if (task && ['cancelled', 'error'].includes(task.status)) {
      setDownloadId(null)
      setDownloadError(true)
    }
  }, [downloadId, downloads])

  const download = async () => {
    if (!item.sourceId || !item.remotePath || requestingDownload || downloadId !== null) return
    setRequestingDownload(true)
    try {
      if (!await confirm(copy.confirmTitle, `${copy.confirmMessage}\n\n${item.fileName}`, { confirmLabel: copy.confirm })) return
      if (!alive.current) return
      setDownloadError(false)
      const task = await p<DownloadTask | null>(I.downloadStart, item.sourceId, item.remotePath, `video-previews/${item.id}/${item.fileName}`)
      if (!alive.current) return
      if (!task) throw new Error('Download could not be started')
      setDownloadId(task.id)
    } catch {
      if (alive.current) setDownloadError(true)
    } finally {
      if (alive.current) setRequestingDownload(false)
    }
  }
  const image = result?.imagePath ? `${coverUrl(result.imagePath)}&preview=${result.requestId}` : ''
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !expanded || !image) return
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [expanded, image])
  const generating = !result || result.status === 'generating'
  const downloading = downloadId !== null
  const downloadBusy = downloading || requestingDownload
  const failed = result?.status === 'error'
  const needsDownload = result?.status === 'needs-download'
  const downloadMessage = item.sourceId && item.remotePath
    ? result?.error === 'read-limit' ? copy.readLimit : copy.downloadNeeded
    : copy.noSource
  const errorMessage = downloadError ? copy.downloadFailed : needsDownload ? downloadMessage
    : failed ? result?.error === 'tool-missing' ? copy.missingTool : copy.failed : copy.cancelled

  return <section className="media-details-preview-panel" aria-label={copy.title} aria-busy={generating || downloadBusy}>
    <div className="media-details-preview-controls">
      <button type="button" disabled={generating || downloadBusy} aria-busy={generating || downloadBusy}
        className={generating || downloadBusy ? 'is-generating' : undefined}
        onClick={() => { if (needsDownload && item.sourceId && item.remotePath) void download(); else setAttempt((value) => value + 1) }}>
        <Icon name="refresh" size={15} />{copy.retry}
      </button>
    </div>
    {!downloadBusy && (needsDownload || failed || result?.status === 'cancelled' || downloadError) && <div className="media-details-preview-message" role="status">
      <p>{errorMessage}</p>
    </div>}
    {image
      ? <button type="button" className="media-details-preview-sheet" aria-label={copy.enlarge} data-tooltip={copy.enlarge} onClick={() => setExpanded(true)}>
          <img src={image} alt={copy.description} decoding="async" />
        </button>
      : null}
    {image && <dialog ref={dialogRef} className="media-details-sheet-dialog" aria-label={copy.title}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setExpanded(false) } }}
      onCancel={(event) => { event.preventDefault(); setExpanded(false) }}
      onClose={() => setExpanded(false)} onClick={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}>
      <header><span>{copy.title}</span><button type="button" aria-label={copy.close} onClick={() => setExpanded(false)} autoFocus><Icon name="close" size={18} /></button></header>
      <div className="media-details-sheet-full"><img src={image} alt={copy.description} /></div>
    </dialog>}
  </section>
}
