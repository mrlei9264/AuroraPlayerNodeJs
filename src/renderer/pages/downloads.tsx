import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRuntime } from '../core/runtime'
import { EmptyState } from '../shared/shared'
import { Icon } from '../core/icons'
import type { DownloadTask } from '../../shared/types'
import { formatBytes, formatBps } from '../../shared/types'

const STATUS_LABEL: Record<DownloadTask['status'], { labelKey: string; kind: 'info' | 'success' | 'danger' | 'warning' }> = {
  queued: { labelKey: 'queued', kind: 'info' },
  running: { labelKey: 'downloading', kind: 'info' },
  paused: { labelKey: 'paused', kind: 'warning' },
  completed: { labelKey: 'downloadCompleted', kind: 'success' },
  cancelled: { labelKey: 'downloadCancelled', kind: 'warning' },
  error: { labelKey: 'downloadError', kind: 'danger' }
}

export function DownloadsPage({ networkContext = false, onBack }: { networkContext?: boolean; onBack?: () => void } = {}) {
  const { t, downloads, downloadOptions, updateDownloadOptions, pauseDownload, resumeDownload, removeDownload, retryDownload, openDownloadFolder, playDownloaded } = useRuntime()
  const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'error'>('all')
  const [deleteTarget, setDeleteTarget] = useState<DownloadTask | null>(null)
  const [deleteLocalFile, setDeleteLocalFile] = useState(false)
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [speedDraft, setSpeedDraft] = useState(String(downloadOptions.speedLimitMbps))
  const threadMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSpeedDraft(String(downloadOptions.speedLimitMbps)), [downloadOptions.speedLimitMbps])
  useEffect(() => {
    if (!threadMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!threadMenuRef.current?.contains(event.target as Node)) setThreadMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [threadMenuOpen])

  const commitSpeedLimit = () => {
    const next = Math.max(0, Number(speedDraft) || 0)
    setSpeedDraft(String(next))
    void updateDownloadOptions({ speedLimitMbps: next })
  }

  const tasks = useMemo(() => {
    let list = [...downloads]
    if (filter === 'running') list = list.filter((d) => d.status === 'running' || d.status === 'queued' || d.status === 'paused')
    if (filter === 'completed') list = list.filter((d) => d.status === 'completed')
    if (filter === 'error') list = list.filter((d) => d.status === 'error' || d.status === 'cancelled')
    return list.sort((a, b) => b.createdAt - a.createdAt)
  }, [downloads, filter])

  const requestDelete = (task: DownloadTask) => {
    setDeleteLocalFile(false)
    setDeleteTarget(task)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const task = deleteTarget
    setDeleteTarget(null)
    await removeDownload(task.id, deleteLocalFile)
  }

  const content = (
    <>
      <div className={networkContext ? 'network-download-filters' : 'row gap-8'}>
        {[
          { key: 'all' as const, label: t('all') },
          { key: 'running' as const, label: t('downloading') },
          { key: 'completed' as const, label: t('downloadComplete') },
          { key: 'error' as const, label: t('downloadFailed') }
        ].map((opt) => (
          <button
            key={opt.key}
            className={networkContext ? (filter === opt.key ? 'active' : '') : `chip ${filter === opt.key ? 'active' : ''}`}
            onClick={() => setFilter(opt.key)}
          >
            {opt.label}
          </button>
        ))}
        <div className="network-download-controls">
          <div className="download-thread-select" ref={threadMenuRef} data-open={threadMenuOpen ? 'true' : 'false'}>
            <span>{t('downloadThreads')}</span>
            <button type="button" className="download-thread-trigger" aria-haspopup="listbox" aria-expanded={threadMenuOpen} onClick={() => setThreadMenuOpen((open) => !open)}>
              <strong>{downloadOptions.threadCount}</strong><Icon name={threadMenuOpen ? 'chevronUp' : 'chevronDown'} size={13} />
            </button>
            {threadMenuOpen && (
              <div className="download-thread-menu" role="listbox" aria-label={t('downloadThreads')}>
                {[1, 2, 4, 8].map((count) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={downloadOptions.threadCount === count}
                    className={downloadOptions.threadCount === count ? 'selected' : ''}
                    key={count}
                    onClick={() => { setThreadMenuOpen(false); void updateDownloadOptions({ threadCount: count }) }}
                  >
                    <span>{count}</span>{downloadOptions.threadCount === count && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="download-speed-control"><span>{t('downloadSpeedLimit')}</span><input type="number" min="0" step="0.5" value={speedDraft} onChange={(event) => setSpeedDraft(event.target.value)} onBlur={commitSpeedLimit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /><small>MB/s</small></label>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon="download" title={t('noDownloads')} />
      ) : (
        tasks.map((task) => {
          const st = STATUS_LABEL[task.status]
          const pct = task.bytesTotal > 0 ? Math.min(100, (task.bytesDone / task.bytesTotal) * 100) : 0
          return (
            <div
              key={task.id}
              className={`dl-row ${task.bytesTotal > 0 ? 'has-progress' : ''} ${task.status === 'completed' ? 'download-completed' : ''} ${networkContext ? 'network-download-row' : ''}`}
              style={{ '--download-progress': `${pct}%` } as React.CSSProperties}
              role={task.status === 'completed' ? 'button' : undefined}
              tabIndex={task.status === 'completed' ? 0 : undefined}
              onClick={(event) => {
                if (task.status === 'completed' && !(event.target as HTMLElement).closest('button')) void playDownloaded(task.id)
              }}
              onKeyDown={(event) => {
                if (task.status === 'completed' && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  void playDownloaded(task.id)
                }
              }}
            >
              <div className={`dl-icon ${st.kind}`}>
                <Icon name={st.kind === 'success' ? 'check' : task.status === 'paused' ? 'pause' : 'download'} size={18} />
              </div>
              <div className="dl-main">
                <div className="dl-title-line">
                  <div className="dl-name">{task.fileName}</div>
                  <strong className="dl-percent">{task.bytesTotal > 0 ? `${Math.round(pct)}%` : '--'}</strong>
                </div>
                <div className="dl-meta">
                  {task.sourceName} / {formatBytes(task.bytesDone)} / {formatBytes(task.bytesTotal)}
                  {task.status === 'running' && ` / ${formatBps(task.speedBps)}`}
                  {` / ${task.threadCount} ${t('threads')}`}
                  {task.speedLimitMbps > 0 && ` / ${t('limitedTo')} ${task.speedLimitMbps} MB/s`}
                  {task.error && ` / ${task.error}`}
                </div>
              </div>
              <span className={`badge ${st.kind}`}>
                {t(st.labelKey)}
              </span>
              <div className="dl-actions">
                {task.status === 'completed' && (
                  <button className="btn-icon" title={t('openFolder')} onClick={() => void openDownloadFolder(task.id)}>
                    <Icon name="folder" size={16} />
                  </button>
                )}
                {(task.status === 'error' || task.status === 'cancelled') && (
                  <button className="btn-icon" title={t('retry')} onClick={() => void retryDownload(task.id)}>
                    <Icon name="refresh" size={16} />
                  </button>
                )}
                {(task.status === 'running' || task.status === 'queued') && (
                  <button className="btn-icon" title={t('pauseDownload')} onClick={() => void pauseDownload(task.id)}>
                    <Icon name="pause" size={16} />
                  </button>
                )}
                {task.status === 'paused' && (
                  <button className="btn-icon" title={t('resumeDownload')} onClick={() => void resumeDownload(task.id)}>
                    <Icon name="play" size={16} />
                  </button>
                )}
                <button className="btn-icon dl-delete-button" title={t('deleteDownloadRecord')} onClick={() => requestDelete(task)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
          )
        })
      )}
    </>
  )

  const deleteDialog = deleteTarget && (
    <div className="dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null) }}>
      <div className="dialog download-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="download-delete-title">
        <div id="download-delete-title" className="dialog-title">{t('deleteDownloadRecord')}</div>
        <div className="dialog-message">{t('deleteDownloadRecordMessage', { name: deleteTarget.fileName })}</div>
        <label className="download-delete-local-option">
          <input type="checkbox" checked={deleteLocalFile} onChange={(event) => setDeleteLocalFile(event.target.checked)} />
          <span className="download-delete-checkbox"><Icon name="check" size={14} /></span>
          <span><strong>{t('deleteLocalFile')}</strong><small>{t('deleteLocalFileHint')}</small></span>
        </label>
        <div className="dialog-actions">
          <button className="btn" onClick={() => setDeleteTarget(null)}>{t('cancel')}</button>
          <button className="btn btn-danger" onClick={() => void confirmDelete()}>{t('delete')}</button>
        </div>
      </div>
    </div>
  )

  if (!networkContext) return <><div className="col gap-12" style={{ maxWidth: 860 }}>{content}</div>{deleteDialog}</>

  return (
    <main className="network-page network-v2 network-download-page" aria-labelledby="network-download-title">
      <header className="network-v2-header network-download-header">
        <div className="network-v2-heading">
          {onBack && <button type="button" className="network-back-button-v2" onClick={onBack}><Icon name="chevronLeft" size={17} />{t('backToConnections')}</button>}
          <h1 id="network-download-title">{t('downloads')}</h1>
          <p>{t('downloadsDescription')}</p>
        </div>
      </header>
      <section className="network-download-shell">{content}</section>
      {deleteDialog}
    </main>
  )
}
