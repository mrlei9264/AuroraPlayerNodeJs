import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { I, E } from '../../shared/channels'
import type {
  MediaItem,
  QueueEntry,
  Playlist,
  RemoteSource,
  RemoteSourceInput,
  RemoteEntry,
  ManagedFolder,
  DownloadTask,
  DownloadOptions,
  ProbeProgress,
  SessionState,
  NavState,
  HudStats,
  WindowState,
  PlayPlan,
  PlayRequest,
  LyricsData,
  MediaTrackCatalog,
  TrackInfo,
  UpdateStatus,
  NotificationRecord
} from '../../shared/types'
import type { AppSettingsData } from '../../main/system/settings-types'
import { initMediaBase, PlayerEngine } from './player'
import { makeT, playbackErrorKey, type TKey } from './i18n'
import { buildTheme, injectThemeVars } from './theme'
import { stopThemeTransition, transitionTheme } from './themeTransition'

export const p = <T,>(channel: string, ...args: unknown[]): Promise<T> =>
  window.aurora.invoke(channel as never, ...args) as Promise<T>

export interface CtxMenuItem {
  id?: string
  label?: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  checked?: boolean
  onSelect?: () => void
}

export interface ToastItem {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  message: string
  action?: { label: string; onClick: () => void }
}

export interface DialogRequest {
  id: number
  type: 'confirm' | 'prompt' | 'input' | 'info'
  title: string
  message?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  resolve: (v: boolean | string | null) => void
}

export interface CtxMenuState {
  x: number
  y: number
  items: CtxMenuItem[]
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  mediaEngine: string
  homeDir: string
  userData: string
  dataRoot: string
  dataDirectories: Record<'config' | 'database' | 'security' | 'logs' | 'temp' | 'downloads' | 'backgrounds' | 'diagnostics' | 'runtime', string>
  refreshRate: number
}

interface RuntimeState {
  booted: boolean
  settings: AppSettingsData
  appIconUrl: string | null
  appInfo: AppInfo | null
  library: MediaItem[]
  queue: QueueEntry[]
  playlists: Playlist[]
  sources: RemoteSource[]
  folders: ManagedFolder[]
  downloads: DownloadTask[]
  downloadOptions: DownloadOptions
  probe: ProbeProgress
  nav: NavState
  session: SessionState
  tracks: MediaTrackCatalog
  lyrics: LyricsData | null
  win: WindowState
  hud: HudStats | null
  updateStatus: UpdateStatus
  toasts: ToastItem[]
  notificationHistory: NotificationRecord[]
  dialog: DialogRequest | null
  ctxMenu: CtxMenuState | null
  lang: ReturnType<typeof makeT>
  theme: ReturnType<typeof buildTheme>
}

interface RuntimeApi {
  nav: NavState
  navigate: (n: NavState) => void
  engine: PlayerEngine
  t: (key: TKey | string, vars?: Record<string, string | number>) => string
  patchSettings: (partial: Partial<AppSettingsData>) => Promise<AppSettingsData>
  toast: (kind: ToastItem['kind'], message: string, action?: ToastItem['action']) => void
  pauseToast: (id: number) => void
  resumeToast: (id: number) => void
  clearNotifications: () => Promise<void>
  removeNotification: (id: string) => Promise<void>
  confirm: (title: string, message?: string, opts?: { confirmLabel?: string; danger?: boolean }) => Promise<boolean>
  prompt: (title: string, defaultValue?: string, message?: string, confirmLabel?: string) => Promise<string | null>
  openCtxMenu: (x: number, y: number, items: CtxMenuItem[]) => void
  closeCtxMenu: () => void
  closeDialog: (v: boolean | string | null) => void
  play: (mediaIds: number[], index: number) => Promise<void>
  playQueueEntry: (position: number) => Promise<void>
  retryPlayback: () => Promise<void>
  playNext: () => Promise<void>
  playPrevious: () => Promise<void>
  togglePlayPause: () => void
  seek: (t: number) => void
  beginSeek: () => void
  commitSeek: () => void
  leavePlayer: () => void
  stopPlayback: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setSpeed: (s: number) => void
  setRepeat: (m: 'none' | 'all' | 'one') => void
  setShuffle: (s: boolean) => void
  selectVideoTrack: (i: number) => void
  selectAudioTrack: (i: number) => void
  selectSubtitleTrack: (i: number) => void
  enqueue: (ids: number[]) => Promise<void>
  takeFromQueue: (index: number) => Promise<void>
  removeFromQueue: (index: number) => Promise<void>
  moveQueue: (from: number, to: number) => Promise<void>
  clearQueue: () => Promise<void>
  addMediaDialog: () => Promise<void>
  addFolderDialog: () => Promise<void>
  addUrl: (url: string) => Promise<boolean>
  addRemoteMedia: (sourceId: number, entries: { path: string; name: string; size: number }[], notify?: boolean) => Promise<void>
  removeMedia: (ids: number[]) => Promise<void>
  toggleFavorite: (id: number) => void
  setFavorites: (ids: number[], favorite: boolean) => Promise<void>
  relocate: (id: number) => Promise<boolean>
  autoMatch: () => Promise<void>
  updateMeta: (id: number, fields: Partial<Pick<MediaItem, 'title' | 'artist' | 'album'>>) => void
  createPlaylist: (name: string) => Promise<void>
  renamePlaylist: (id: number, name: string) => Promise<void>
  deletePlaylist: (id: number) => Promise<void>
  addToPlaylist: (playlistId: number, ids: number[]) => Promise<void>
  removePlaylistEntry: (playlistId: number, mediaId: number) => Promise<void>
  movePlaylistEntry: (playlistId: number, from: number, to: number) => Promise<void>
  saveSource: (input: RemoteSourceInput, id?: number) => Promise<boolean>
  deleteSource: (id: number) => Promise<void>
  testSource: (input: RemoteSourceInput, id?: number) => Promise<{ ok: boolean; error?: string; errorKind?: string; secure?: boolean }>
  browseSource: (sourceId: number, path: string) => Promise<RemoteEntry[] | null>
  startDownload: (sourceId: number, remotePath: string, relativePath?: string, notify?: boolean) => Promise<void>
  updateDownloadOptions: (options: Partial<DownloadOptions>) => Promise<void>
  cancelDownload: (id: number) => Promise<void>
  pauseDownload: (id: number) => Promise<void>
  resumeDownload: (id: number) => Promise<void>
  removeDownload: (id: number, deleteLocalFile: boolean) => Promise<void>
  retryDownload: (id: number) => Promise<void>
  openDownloadFolder: (id: number) => Promise<void>
  playDownloaded: (id: number) => Promise<void>
  addFolder: (path: string) => Promise<void>
  removeFolder: (path: string) => Promise<void>
  scanFolder: (path: string) => Promise<void>
  scanAll: () => Promise<void>
  requestProbe: (ids: number[]) => Promise<void>
  cancelProbe: () => Promise<void>
  windowMinimize: () => void
  windowMaximizeToggle: () => Promise<boolean>
  windowClose: () => void
  setFullscreen: (full: boolean) => Promise<void>
  quitApp: () => Promise<void>
  checkUpdate: () => Promise<UpdateStatus>
  openUpdatePage: () => Promise<void>
  exportBundle: () => Promise<void>
  openPath: (path: string) => Promise<void>
  loadLyrics: (mediaId: number, url: string, remote: boolean, sourceId?: number | null, remotePath?: string | null) => Promise<LyricsData | null>
}

const RuntimeContext = createContext<RuntimeState & RuntimeApi>(null as never)
export const useRuntime = (): RuntimeState & RuntimeApi => useContext(RuntimeContext)

type LibraryRuntimeValue = Pick<RuntimeState, 'settings' | 'library'> &
  Pick<RuntimeApi,
    | 't'
    | 'play'
    | 'addMediaDialog'
    | 'addFolderDialog'
    | 'enqueue'
    | 'toggleFavorite'
    | 'setFavorites'
    | 'removeMedia'
    | 'confirm'
    | 'prompt'
    | 'openPath'
    | 'openCtxMenu'
    | 'navigate'
    | 'toast'
  > & { currentMediaId: number | null }

const LibraryRuntimeContext = createContext<LibraryRuntimeValue>(null as never)
export const useLibraryRuntime = (): LibraryRuntimeValue => useContext(LibraryRuntimeContext)

let toastSeq = 1
let dialogSeq = 1

interface ToastTimer {
  timeoutId: number | null
  remaining: number
  startedAt: number
}

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettingsData | null>(null)
  const settingsRef = useRef(settings)
  useLayoutEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => stopThemeTransition, [])
  const [appIconUrl, setAppIconUrl] = useState<string | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [library, setLibrary] = useState<MediaItem[]>([])
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [sources, setSources] = useState<RemoteSource[]>([])
  const [folders, setFolders] = useState<ManagedFolder[]>([])
  const [downloads, setDownloads] = useState<DownloadTask[]>([])
  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions>({ threadCount: 4, speedLimitMbps: 0 })
  const [probe, setProbe] = useState<ProbeProgress>({ mode: 'single', running: false, current: null, completed: 0, total: 0, percent: 0, canceled: false })
  const [nav, setNav] = useState<NavState>({ section: 'home' })
  const playerReturnNavRef = useRef<NavState>({ section: 'home' })
  const [session, setSession] = useState<SessionState>({
    phase: 'idle',
    kind: 'video',
    mediaId: null,
    position: 0,
    duration: 0,
    paused: true,
    loaded: false,
    buffering: false,
    seeking: false,
    idle: true,
    error: null,
    volume: 80,
    muted: false,
    speed: 1,
    repeatMode: 'none',
    shuffle: false,
    lastPositionKnown: 0
  })
  const [tracks, setTracks] = useState<RuntimeState['tracks']>({ video: [], audio: [], subtitles: [], chapters: [], width: 0, height: 0, fps: 0 })
  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  const [win, setWin] = useState<WindowState>({ maximized: false, fullscreen: false })
  const [hud, setHud] = useState<HudStats | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'disabled' })
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [notificationHistory, setNotificationHistory] = useState<NotificationRecord[]>([])
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  const toastTimersRef = useRef<Map<number, ToastTimer>>(new Map())
  const libraryProgressRef = useRef({ mediaId: null as number | null, playing: false })
  const playRequestEpochRef = useRef(0)
  const sessionRef = useRef(session)
  const libraryRef = useRef(library)
  const queueRef = useRef(queue)
  const lastPlayListRef = useRef<number[]>([])
  const volumeRef = useRef(session.volume)
  const volumePersistTimerRef = useRef(0)
  sessionRef.current = session
  libraryRef.current = library
  queueRef.current = queue

  const engineRef = useRef<PlayerEngine | null>(null)
  if (!engineRef.current) {
    engineRef.current = new PlayerEngine({})
  }
  const captureLifetime = useRef<AbortController | null>(null)
  const engine = engineRef.current
  useEffect(() => {
    engine.mount()
    const controller = new AbortController()
    captureLifetime.current = controller
    return () => {
      controller.abort()
      engine.dispose()
    }
  }, [engine])

  const t = useMemo(() => (settings ? makeT(settings.language) : makeT('en')), [settings?.language])
  const theme = useMemo(
    () => buildTheme(settings?.accentIndex ?? 0, 'classic'),
    [settings?.accentIndex]
  )

  useLayoutEffect(() => {
    injectThemeVars(theme)
  }, [theme])

  useEffect(() => {
    if (!settings) return
    let active = true
    void p<Array<{ value: string; dataUrl: string }>>(I.appIconsList).then((icons) => {
      if (!active) return
      const selected = icons.find((icon) => icon.value === settings.appIcon) ?? icons[0]
      setAppIconUrl(selected?.dataUrl ?? null)
    }).catch(() => {
      if (active) setAppIconUrl(null)
    })
    return () => { active = false }
  }, [settings?.appIcon])

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id)
    if (timer?.timeoutId != null) window.clearTimeout(timer.timeoutId)
    toastTimersRef.current.delete(id)
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const scheduleToast = useCallback((id: number, delay: number) => {
    const timeoutId = window.setTimeout(() => dismissToast(id), delay)
    toastTimersRef.current.set(id, { timeoutId, remaining: delay, startedAt: window.performance.now() })
  }, [dismissToast])

  const pauseToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id)
    if (!timer || timer.timeoutId == null) return
    window.clearTimeout(timer.timeoutId)
    timer.remaining = Math.max(0, timer.remaining - (window.performance.now() - timer.startedAt))
    timer.timeoutId = null
  }, [])

  const resumeToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id)
    if (!timer || timer.timeoutId != null) return
    if (timer.remaining <= 0) dismissToast(id)
    else scheduleToast(id, timer.remaining)
  }, [dismissToast, scheduleToast])

  const toast = useCallback((kind: ToastItem['kind'], message: string, action?: ToastItem['action']) => {
    const id = toastSeq++
    const duration = action ? 8000 : 4200
    const title = t(kind === 'success' ? 'notificationSuccessTitle' : kind === 'error' ? 'notificationErrorTitle' : 'notificationInfoTitle')
    const record: NotificationRecord = { id: `${Date.now()}-${id}`, kind, title, message, createdAt: Date.now() }
    setToasts((prev) => [...prev.slice(-4), { id, kind, title, message, action }])
    setNotificationHistory((prev) => [record, ...prev].slice(0, 500))
    void p<NotificationRecord>(I.notificationsAppend, record).catch(() => void 0)
    scheduleToast(id, duration)
  }, [scheduleToast, t])

  const clearNotifications = useCallback(async () => {
    await p(I.notificationsClear)
    setNotificationHistory([])
  }, [])

  const removeNotification = useCallback(async (id: string) => {
    await p(I.notificationsRemove, id)
    setNotificationHistory((current) => current.filter((record) => record.id !== id))
  }, [])

  useEffect(() => () => {
    toastTimersRef.current.forEach((timer) => {
      if (timer.timeoutId != null) window.clearTimeout(timer.timeoutId)
    })
    toastTimersRef.current.clear()
  }, [])

  const confirm = useCallback(
    (title: string, message?: string, opts?: { confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        const id = dialogSeq++
        setDialog({ id, type: 'confirm', title, message, confirmLabel: opts?.confirmLabel, danger: opts?.danger, resolve: (v) => resolve(v === true) })
      }),
    []
  )

  const prompt = useCallback(
    (title: string, defaultValue?: string, message?: string, confirmLabel?: string) =>
      new Promise<string | null>((resolve) => {
        const id = dialogSeq++
        setDialog({ id, type: 'prompt', title, message, defaultValue, confirmLabel, resolve: (v) => resolve(typeof v === 'string' ? v : null) })
      }),
    []
  )

  const openCtxMenu = useCallback((x: number, y: number, items: CtxMenuItem[]) => {
    setCtxMenu({ x, y, items })
  }, [])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const closeDialog = useCallback((v: boolean | string | null) => {
    setDialog((cur) => {
      if (cur) cur.resolve(v)
      return null
    })
  }, [])

  const navigate = useCallback((n: NavState) => {
    setNav((previous) => {
      if (n.section === 'player' && previous.section !== 'player') {
        playerReturnNavRef.current = previous
      }
      return n
    })
  }, [])

  const patchSettings = useCallback(async (partial: Partial<AppSettingsData>) => {
    const current = settingsRef.current
    const changesTheme = current != null && partial.accentIndex !== undefined && partial.accentIndex !== current.accentIndex
    const update = () => setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
    if (changesTheme) await transitionTheme(update, partial.reducedMotion ?? current?.reducedMotion ?? false)
    else update()
    const updated = await p<AppSettingsData>(I.settingsPatch, partial)
    setSettings(updated)
    return updated
  }, [])

const playRequest = useCallback(
    async (request: PlayRequest, navigateToPlayer = true): Promise<PlayPlan> => {
      const requestEpoch = ++playRequestEpochRef.current
      let plan: PlayPlan
      try {
        plan = await p<PlayPlan>(I.playPlan, request)
      } catch (error) {
        if (requestEpoch === playRequestEpochRef.current) toast('error', t(playbackErrorKey(error instanceof Error ? error.message : String(error))))
        return { ok: false, result: 'invalidRequest', item: null, url: '', kind: 'video', resumePosition: 0 }
      }
      // A slower availability check must not reopen media after a later play
      // request has already won.
      if (requestEpoch !== playRequestEpochRef.current) return plan
      if (!plan.ok) {
        if (plan.result === 'localFileMissing') {
          toast('error', t('playbackMissing'))
        } else if (plan.result === 'remoteSourceMissing') {
          toast('error', t('playbackSourceMissing'))
        } else {
          toast('error', t('playbackInvalid'))
        }
        return plan
      }
      if (request.mediaIds.length > 1) lastPlayListRef.current = request.mediaIds
      if (plan.item) {
        const item = plan.item
        const startedAt = Date.now()
        setLibrary((items) => items.map((entry) => entry.id === item.id
          ? { ...entry, lastPlayedAt: startedAt, lastPosition: settingsRef.current?.resumePlayback !== false ? plan.resumePosition : 0, duration: item.duration || entry.duration }
          : entry))
      }
      engine.load(plan, sessionRef.current.volume, sessionRef.current.muted, sessionRef.current.speed)
      if (navigateToPlayer) navigate({ section: 'player' })
      return plan
    },
    [engine, navigate, t, toast]
  )

  const play = useCallback(
    async (mediaIds: number[], index: number) => {
      await playRequest({ mediaIds, index, action: 'play' })
    },
    [playRequest]
  )

  const playQueueEntry = useCallback(
    async (position: number) => {
      const ids = queue.map((q) => q.mediaId)
      if (position < 0 || position >= ids.length) return
      await playRequest({ mediaIds: ids, index: position, action: 'play' })
    },
    [queue, playRequest]
  )

  const retryPlayback = useCallback(
    async () => {
      const mediaId = session.mediaId
      if (mediaId == null) return
      await playRequest({ mediaIds: [mediaId], index: 0, action: 'restart' }, false)
    },
    [playRequest, session.mediaId]
  )

  const navQueue = useCallback(
    async (action: 'previous' | 'next' | 'naturalEnd') => {
      const current = sessionRef.current.mediaId
      if (current == null) return
      const libraryMap = new Map(libraryRef.current.map((item) => [item.id, item]))
      const usable = (id: number) => {
        const item = libraryMap.get(id)
        return item != null && !item.isImage && item.sourceAvailable
      }
      const queueIds = queueRef.current.map((entry) => entry.mediaId).filter(usable)
      let ids = queueIds.includes(current) ? queueIds : lastPlayListRef.current.filter(usable)
      if (!ids.includes(current)) {
        if (action === 'naturalEnd') return
        const audio = sessionRef.current.kind === 'audio'
        ids = libraryRef.current
          .filter((item) => !item.isImage && item.sourceAvailable && item.isAudio === audio)
          .map((item) => item.id)
      }
      const currentIndex = ids.indexOf(current)
      if (currentIndex < 0 || ids.length === 0) return

      const { repeatMode, shuffle } = sessionRef.current
      let targetIndex: number | null = null
      if (repeatMode === 'one' && action === 'naturalEnd') {
        targetIndex = currentIndex
      } else if (shuffle && action !== 'previous') {
        const candidates = ids.map((_, index) => index).filter((index) => index !== currentIndex)
        targetIndex = candidates.length
          ? candidates[Math.floor(Math.random() * candidates.length)]
          : repeatMode === 'all' ? currentIndex : null
      } else if (action === 'previous') {
        targetIndex = currentIndex > 0 ? currentIndex - 1 : repeatMode === 'all' ? ids.length - 1 : null
      } else {
        const nextIndex = currentIndex + 1
        targetIndex = nextIndex < ids.length ? nextIndex : repeatMode === 'all' ? 0 : null
      }
      if (targetIndex == null) return
      await playRequest({
        mediaIds: ids,
        index: targetIndex,
        action: targetIndex === currentIndex
          ? 'restart'
          : action === 'previous' ? 'playPrevious' : 'playNext'
      }, false)
    },
    [playRequest]
  )

  const playNext = useCallback(() => navQueue('next'), [navQueue])
  const playPrevious = useCallback(() => navQueue('previous'), [navQueue])

  const togglePlayPause = useCallback(() => {
    if (!session.loaded || session.mediaId == null) {
      const last = library.find((i) => i.lastPlayedAt > 0)
      if (last) void play([last.id], 0)
      return
    }
    engine.toggle()
  }, [session.loaded, session.mediaId, library, engine, play])

  const seek = useCallback(
    (t: number) => {
      engine.seekTo(t)
    },
    [engine]
  )

  const beginSeek = useCallback(() => engine.beginSeek(), [engine])
  const commitSeek = useCallback(() => engine.commitSeek(), [engine])

  const stopPlayback = useCallback(() => {
    engine.stop()
    // Returning from a player should also restore the normal window frame.
    // Fullscreen is a window state, so unmounting the player alone cannot clear it.
    void p(I.winSetFullscreen, false)
    setLyrics(null)
    setNav((prev) => (prev.section === 'player' ? playerReturnNavRef.current : prev))
  }, [engine])

  const leavePlayer = useCallback(() => {
    if (session.kind !== 'audio' || session.idle || session.mediaId == null) {
      stopPlayback()
      return
    }
    void p(I.winSetFullscreen, false)
    setNav((prev) => (prev.section === 'player' ? playerReturnNavRef.current : prev))
  }, [session.kind, session.idle, session.mediaId, stopPlayback])

  const setVolume = useCallback(
    (v: number) => {
      const volume = Math.max(0, Math.min(100, Math.round(v)))
      engine.setVolume(volume)
      volumeRef.current = volume
      window.clearTimeout(volumePersistTimerRef.current)
      volumePersistTimerRef.current = window.setTimeout(() => {
        volumePersistTimerRef.current = 0
        void p<AppSettingsData>(I.settingsPatch, { playbackVolume: volumeRef.current }).catch(() => void 0)
      }, 250)
    },
    [engine]
  )

  useEffect(() => () => {
    if (!volumePersistTimerRef.current) return
    window.clearTimeout(volumePersistTimerRef.current)
    void p(I.settingsPatch, { playbackVolume: volumeRef.current }).catch(() => void 0)
  }, [])

  const toggleMute = useCallback(() => {
    engine.setMuted(!session.muted)
  }, [engine, session.muted])

  const setSpeed = useCallback(
    (s: number) => {
      engine.setSpeed(s)
    },
    [engine]
  )

  const setRepeat = useCallback(
    (m: 'none' | 'all' | 'one') => {
      engine.setRepeatMode(m)
    },
    [engine]
  )

  const setShuffle = useCallback(
    (s: boolean) => {
      engine.setShuffle(s)
    },
    [engine]
  )

  const selectAudioTrack = useCallback(
    (i: number) => engine.selectAudioTrack(i),
    [engine]
  )
  const selectVideoTrack = useCallback(
    (i: number) => engine.selectVideoTrack(i),
    [engine]
  )
  const selectSubtitleTrack = useCallback(
    (i: number) => engine.selectSubtitleTrack(i),
    [engine]
  )

  const enqueue = useCallback(
    async (ids: number[]) => {
      if (!ids.length) return
      const snap = await p<QueueEntry[]>(I.queueEnqueue, ids)
      setQueue(snap)
      toast('info', t('queueAddedNotification', { count: ids.length }))
    },
    [t, toast]
  )

  const takeFromQueue = useCallback(
    async (index: number) => {
      const snap = await p<QueueEntry[]>(I.queueTake, index)
      setQueue(snap)
    },
    []
  )

  const removeFromQueue = useCallback(
    async (index: number) => {
      const snap = await p<QueueEntry[]>(I.queueRemove, index)
      setQueue(snap)
    },
    []
  )

  const moveQueue = useCallback(
    async (from: number, to: number) => {
      const snap = await p<QueueEntry[]>(I.queueMove, from, to)
      setQueue(snap)
    },
    []
  )

  const clearQueue = useCallback(async () => {
    const snap = await p<QueueEntry[]>(I.queueClear)
    setQueue(snap)
  }, [])

  const addMediaDialog = useCallback(async () => {
    const paths = await p<string[]>(I.dialogsOpenMedia)
    if (paths.length) {
      const added = await p<number>(I.libraryAddPaths, paths)
      toast('success', t('filesImportedNotification', { count: added }))
    }
  }, [t, toast])

  const addFolderDialog = useCallback(async () => {
    const dir = await p<string | null>(I.dialogsOpenFolder)
    if (dir) {
      const added = await p<number>(I.libraryAddPaths, [dir])
      toast('success', t('filesImportedNotification', { count: added }))
    }
  }, [t, toast])

  const addUrl = useCallback(
    async (url: string) => {
      const item = await p<MediaItem | null>(I.libraryAddUrl, url)
      if (item) {
        toast('success', t('networkAddressAddedNotification'))
        return true
      }
      toast('error', t('playbackInvalid'))
      return false
    },
    [t, toast]
  )

  const addRemoteMedia = useCallback(
    async (sourceId: number, entries: { path: string; name: string; size: number }[], notify = true) => {
      const source = sources.find((s) => s.id === sourceId)
      if (!source || !entries.length) return
      await p<number>(
        I.libraryAddRemote,
        entries.map((e) => ({ sourceId, sourceName: source.name, protocol: source.protocol, path: e.path, name: e.name, size: e.size }))
      )
      if (notify) toast('success', t('remoteMediaAddedNotification', { count: entries.length, source: source.name }))
    },
    [sources, t, toast]
  )

  const removeMedia = useCallback(
    async (ids: number[]) => {
      await p(I.libraryRemove, ids)
      toast('success', t('mediaRemovedNotification', { count: ids.length }), { label: t('undo'), onClick: () => void p(I.libraryUndoRemove) })
    },
    [t, toast]
  )

  const setFavorites = useCallback(async (ids: number[], favorite: boolean) => {
    if (!ids.length) return
    await p(I.libraryFavoriteMany, ids, favorite)
  }, [])

  const toggleFavorite = useCallback(
    async (id: number) => {
      const item = library.find((i) => i.id === id)
      if (!item) return
      await setFavorites([id], !item.favorite)
    },
    [library, setFavorites]
  )

  const relocate = useCallback(
    async (id: number) => {
      const ok = await p<boolean>(I.dialogsRelocate, id)
      if (ok) {
        toast('success', t('mediaRelocatedNotification'))
      }
      return ok
    },
    [t, toast]
  )

  const autoMatch = useCallback(async () => {
    const matched = await p<number>(I.libraryAutoMatch)
    toast(matched > 0 ? 'success' : 'info', t(matched > 0 ? 'autoMatchCompletedNotification' : 'autoMatchEmptyNotification', { count: matched }))
  }, [t, toast])

  const updateMeta = useCallback((id: number, fields: Partial<Pick<MediaItem, 'title' | 'artist' | 'album'>>) => {
    void p(I.libraryUpdateMeta, id, fields)
    setLibrary((prev) => prev.map((i) => (i.id === id ? { ...i, ...fields } : i)))
  }, [])

  const createPlaylist = useCallback(async (name: string) => {
    await p(I.playlistCreate, name)
    await refreshPlaylists()
  }, [])

  const renamePlaylist = useCallback(async (id: number, name: string) => {
    await p(I.playlistRename, id, name)
    await refreshPlaylists()
  }, [])

  const deletePlaylist = useCallback(async (id: number) => {
    await p(I.playlistRemove, id)
    await refreshPlaylists()
  }, [])

  const addToPlaylist = useCallback(async (playlistId: number, ids: number[]) => {
    await p(I.playlistAddMedia, playlistId, ids)
    await refreshPlaylists()
  }, [])

  const removePlaylistEntry = useCallback(async (playlistId: number, mediaId: number) => {
    await p(I.playlistRemoveEntry, playlistId, mediaId)
    await refreshPlaylists()
  }, [])

  const movePlaylistEntry = useCallback(async (playlistId: number, from: number, to: number) => {
    await p(I.playlistMoveEntry, playlistId, from, to)
    await refreshPlaylists()
  }, [])

  const saveSource = useCallback(
    async (input: RemoteSourceInput, id?: number) => {
      const ok = await p<boolean>(I.sourceSave, input, id ?? null)
      if (ok) {
        toast('success', t('sourceSavedNotification', { name: input.name }))
        await refreshSources()
      } else {
        toast('error', t('connectionFailed'))
      }
      return ok
    },
    [t, toast]
  )

  const deleteSource = useCallback(async (id: number) => {
    await p(I.sourceRemove, id)
    await refreshSources()
  }, [])

  const testSource = useCallback(async (input: RemoteSourceInput, id?: number) => {
    return await p<{ ok: boolean; error?: string; errorKind?: string; secure?: boolean }>(I.sourceTest, input, id ?? null)
  }, [])

  const browseSource = useCallback(
    async (sourceId: number, path: string) => {
      const res = await p<{ entries: RemoteEntry[]; error?: string }>(I.sourceBrowse, sourceId, path)
      if (res?.error) {
        toast('error', res.error)
        return null
      }
      return res?.entries ?? null
    },
    [toast]
  )

  const startDownload = useCallback(
    async (sourceId: number, remotePath: string, relativePath?: string, notify = true) => {
      const ok = await p<boolean>(I.downloadStart, sourceId, remotePath, relativePath)
      if (ok && notify) toast('info', t('downloadQueuedNotification', { name: remotePath.split('/').filter(Boolean).pop() ?? remotePath }))
      await refreshDownloads()
    },
    [t, toast]
  )

  const updateDownloadOptions = useCallback(async (options: Partial<DownloadOptions>) => {
    setDownloadOptions(await p<DownloadOptions>(I.downloadOptionsSet, options))
  }, [])

  const cancelDownload = useCallback(async (id: number) => {
    await p(I.downloadCancel, id)
    await refreshDownloads()
  }, [])

  const pauseDownload = useCallback(async (id: number) => {
    await p(I.downloadPause, id)
    await refreshDownloads()
  }, [])

  const resumeDownload = useCallback(async (id: number) => {
    await p(I.downloadResume, id)
    await refreshDownloads()
  }, [])

  const removeDownload = useCallback(async (id: number, deleteLocalFile: boolean) => {
    await p(I.downloadRemove, id, deleteLocalFile)
    await refreshDownloads()
  }, [])

  const retryDownload = useCallback(async (id: number) => {
    await p(I.downloadRetry, id)
    await refreshDownloads()
  }, [])

  const openDownloadFolder = useCallback(async (id: number) => {
    await p(I.downloadOpenFolder, id)
  }, [])

  const playDownloaded = useCallback(async (id: number) => {
    const task = downloads.find((item) => item.id === id)
    if (!task || task.status !== 'completed') return
    await p(I.libraryAddPaths, [task.localPath])
    const items = await p<MediaItem[]>(I.libraryGet)
    setLibrary(items)
    const item = items.find((candidate) => candidate.url === task.localPath)
    if (item) await play([item.id], 0)
    else toast('error', t('playbackMissing'))
  }, [downloads, play, t, toast])

  const addFolder = useCallback(async (path: string) => {
    await p(I.folderAdd, path)
    await refreshFolders()
  }, [])

  const removeFolder = useCallback(async (path: string) => {
    await p(I.folderRemove, path)
    await refreshFolders()
  }, [])

  const scanFolder = useCallback(async (path: string) => {
    await p(I.folderScan, path)
  }, [])

  const scanAll = useCallback(async () => {
    await p(I.folderScanAll)
  }, [])

  const requestProbe = useCallback(async (ids: number[]) => {
    if (!ids.length) return
    await p(I.probeRequest, ids)
  }, [])

  const cancelProbe = useCallback(async () => {
    await p(I.probeCancel)
  }, [])

  const windowMinimize = useCallback(() => window.aurora.windowMinimize(), [])
  const windowMaximizeToggle = useCallback(() => window.aurora.windowMaximizeToggle(), [])
  const windowClose = useCallback(() => {
    engine.persistPlaybackProgress()
    window.aurora.windowClose()
  }, [engine])

  const setFullscreen = useCallback(async (full: boolean) => {
    await p(I.winSetFullscreen, full)
  }, [])

  const quitApp = useCallback(async () => {
    engine.persistPlaybackProgress()
    await p(I.appQuit)
  }, [engine])

  const checkUpdate = useCallback(async () => {
    return await p<UpdateStatus>(I.appCheckUpdate)
  }, [])

  const openUpdatePage = useCallback(async () => {
    await p(I.appOpenUpdatePage)
  }, [])

  const exportBundle = useCallback(async () => {
    await p(I.appExportBundle)
  }, [])

  const openPath = useCallback(async (path: string) => {
    await p(I.appOpenPath, path)
  }, [])

  const loadLyrics = useCallback(async (mediaId: number, url: string, remote: boolean, sourceId?: number | null, remotePath?: string | null) => {
    const data = await p<LyricsData | null>(I.lyricsLoad, mediaId, url, remote, sourceId ?? null, remotePath ?? null)
    setLyrics(data && data.source !== 'none' ? data : null)
    return data
  }, [])

  // ---- boot ----
  useEffect(() => {
    let mounted = true
    const boot = async () => {
      const s = await p<AppSettingsData>(I.settingsGet)
      if (!mounted) return
      await initMediaBase()
      if (!mounted) return
      engine.setVolume(s.playbackVolume)
      setSettings(s)
      const [lib, q, pl, src, fld, dls, dlOptions, prb, info, wst, notifications] = await Promise.all([
        p<MediaItem[]>(I.libraryGet),
        p<QueueEntry[]>(I.queueGet),
        p<Playlist[]>(I.playlistsGet),
        p<RemoteSource[]>(I.sourcesList),
        p<ManagedFolder[]>(I.foldersList),
        p<DownloadTask[]>(I.downloadsList),
        p<DownloadOptions>(I.downloadOptionsGet),
        p<ProbeProgress>(I.probeGet),
        p<AppInfo>(I.appGetInfo),
        p<WindowState>(I.winState),
        p<NotificationRecord[]>(I.notificationsList)
      ])
      if (!mounted) return
      setLibrary(lib)
      setQueue(q)
      setPlaylists(pl)
      setSources(src)
      setFolders(fld)
      setDownloads(dls)
      setDownloadOptions(dlOptions)
      setProbe(prb)
      setAppInfo(info)
      setWin(wst)
      setNotificationHistory((current) => {
        const records = new Map(notifications.map((record) => [record.id, record]))
        current.forEach((record) => records.set(record.id, record))
        return [...records.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500)
      })
    }
    void boot()
    return () => {
      mounted = false
    }
  }, [])

// ---- engine wiring ----
  useEffect(() => {
    const persist = () => engine.persistPlaybackProgress()
    const unsubscribe = window.aurora.on(E.sessionFlushRequested, (requestId: number) => {
      const state = engine.persistPlaybackProgress()
      if (state?.loaded && state.mediaId != null) {
        setLibrary((items) => items.map((item) => item.id === state.mediaId
          ? { ...item, lastPlayedAt: Date.now(), lastPosition: settingsRef.current?.resumePlayback !== false ? state.position : 0, duration: state.duration || item.duration }
          : item))
      }
      // The main process waits for this acknowledgement before destroying mpv
      // or closing the database, including tray Quit and system window close.
      void p(I.sessionFlush, requestId, state).catch((error) => console.warn('[Runtime] Failed to flush playback on close', error))
    })
    window.addEventListener('pagehide', persist)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', persist)
    }
  }, [engine])

  // Core callbacks that must always be active (session, tracks, errors, ended)
  useEffect(() => {
    const e = engineRef.current!
    e.ev = {
      ...e.ev,
      onSession: (s) => {
        setSession(s)
        if (s.mediaId != null) {
          const now = Date.now()
          const progress = libraryProgressRef.current
          const mediaChanged = progress.mediaId !== s.mediaId
          const playing = s.loaded && !s.paused && s.phase !== 'error'
          const justStarted = playing && (mediaChanged || !progress.playing)
          progress.mediaId = s.mediaId
          progress.playing = playing
          if (justStarted) {
            e.persistPlaybackProgress()
            setLibrary((prev) => {
              const index = prev.findIndex((item) => item.id === s.mediaId)
              if (index < 0) return prev
              const next = [...prev]
              next[index] = {
                ...prev[index],
                lastPlayedAt: now,
                lastPosition: settingsRef.current?.resumePlayback !== false ? s.position : 0,
                duration: s.duration || prev[index].duration
              }
              return next
            })
          }
        } else {
          libraryProgressRef.current.mediaId = null
          libraryProgressRef.current.playing = false
        }
      },
      onTracks: setTracks,
      onFps: () => void 0,
      onEnded: () => {
        const current = sessionRef.current
        if (current.repeatMode === 'one' || settingsRef.current?.autoplayNextMedia !== false) void navQueue('naturalEnd')
      },
      onPlaybackError: (msg) => {
        console.error('[Runtime] playback error', msg)
        toast('error', t(playbackErrorKey(msg)))
      },
      onLoaded: () => void 0,
      onBuffering: () => void 0
    }
    return () => {
      e.ev = { ...e.ev, onSession: undefined, onTracks: undefined, onFps: undefined, onEnded: undefined, onPlaybackError: undefined, onLoaded: undefined, onBuffering: undefined }
    }
  }, [navQueue, t, toast])

  // ---- subscriptions ----
  useEffect(() => {
    const unsubs: (() => void)[] = []
    unsubs.push(window.aurora.on(E.settingsChanged, (s: AppSettingsData) => setSettings(s)))
    unsubs.push(window.aurora.on(E.libraryChanged, (items: MediaItem[]) => setLibrary(items)))
    unsubs.push(window.aurora.on(E.queueChanged, (q: QueueEntry[]) => setQueue(q)))
    unsubs.push(window.aurora.on(E.playlistsChanged, (pl: Playlist[]) => setPlaylists(pl)))
    unsubs.push(window.aurora.on(E.sourcesChanged, (src: RemoteSource[]) => setSources(src)))
    unsubs.push(window.aurora.on(E.foldersChanged, (fld: ManagedFolder[]) => setFolders(fld)))
    unsubs.push(window.aurora.on(E.folderScanProgress, (prg: { folder: string; phase: string; found: number }) => {
      if (prg.phase === 'done') toast('success', t('libraryScanCompletedNotification'))
    }))
    unsubs.push(window.aurora.on(E.probeProgress, (prg: ProbeProgress) => setProbe(prg)))
    unsubs.push(window.aurora.on(E.probeFrameRequested, (payload: { mediaId: number; url: string }) => {
      void captureVideoCover(payload.url, captureLifetime.current?.signal)
        .then((coverDataUrl) => p(I.probeResult, payload.mediaId, 0, coverDataUrl))
        .catch(() => p(I.probeResult, payload.mediaId, 0, null))
    }))
    unsubs.push(window.aurora.on(E.downloadsChanged, (dls: DownloadTask[]) => {
      setDownloads(dls)
      const done = dls.find((d) => d.status === 'completed')
      if (done) void 0
    }))
    unsubs.push(window.aurora.on(E.notify, (n: { kind: string; title: string; message?: string }) => {
      const kind: ToastItem['kind'] = n.kind === 'error' ? 'error' : n.kind === 'success' ? 'success' : 'info'
      toast(kind, n.message ? `${n.title}: ${n.message}` : n.title)
    }))
    unsubs.push(window.aurora.on(E.hudStats, (h: HudStats) => setHud(h)))
    unsubs.push(window.aurora.on(E.updateStatus, (u: UpdateStatus) => setUpdateStatus(u)))
    unsubs.push(window.aurora.on(E.mediaKey, (action: 'toggle' | 'previous' | 'next') => {
      if (action === 'toggle') togglePlayPause()
      else if (action === 'next') void playNext()
      else void playPrevious()
    }))
    unsubs.push(window.aurora.on(E.winState, (w: WindowState) => setWin(w)))
    unsubs.push(window.aurora.on(E.openFiles, (paths: string[]) => {
      void p<number>(I.libraryAddPaths, paths).then((n) => {
        toast('success', t('filesImportedNotification', { count: n }))
      })
    }))
    return () => unsubs.forEach((u) => u())
  }, [toast, t, togglePlayPause, playNext, playPrevious])

  const refreshPlaylists = useCallback(async () => {
    setPlaylists(await p<Playlist[]>(I.playlistsGet))
  }, [])
  const refreshSources = useCallback(async () => {
    setSources(await p<RemoteSource[]>(I.sourcesList))
  }, [])
  const refreshFolders = useCallback(async () => {
    setFolders(await p<ManagedFolder[]>(I.foldersList))
  }, [])
  const refreshDownloads = useCallback(async () => {
    setDownloads(await p<DownloadTask[]>(I.downloadsList))
  }, [])

  const api: RuntimeApi = {
    nav,
    navigate,
    engine,
    t,
    toast,
    pauseToast,
    resumeToast,
    clearNotifications,
    removeNotification,
    confirm,
    prompt,
    openCtxMenu,
    closeCtxMenu,
    closeDialog,
    play,
    playQueueEntry,
    retryPlayback,
    playNext,
    playPrevious,
    togglePlayPause,
    seek,
    beginSeek,
    commitSeek,
    leavePlayer,
    stopPlayback,
    setVolume,
    toggleMute,
    setSpeed,
    setRepeat,
    setShuffle,
    selectVideoTrack,
    selectAudioTrack,
    selectSubtitleTrack,
    enqueue,
    takeFromQueue,
    removeFromQueue,
    moveQueue,
    clearQueue,
    addMediaDialog,
    addFolderDialog,
    addUrl,
    addRemoteMedia,
    removeMedia,
    toggleFavorite,
    setFavorites,
    relocate,
    autoMatch,
    updateMeta,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removePlaylistEntry,
    movePlaylistEntry,
    saveSource,
    deleteSource,
    testSource,
    browseSource,
    startDownload,
    updateDownloadOptions,
    cancelDownload,
    pauseDownload,
    resumeDownload,
    removeDownload,
    retryDownload,
    openDownloadFolder,
    playDownloaded,
    addFolder,
    removeFolder,
    scanFolder,
    scanAll,
    requestProbe,
    cancelProbe,
    patchSettings,
    windowMinimize,
    windowMaximizeToggle,
    windowClose,
    setFullscreen,
    quitApp,
    checkUpdate,
    openUpdatePage,
    exportBundle,
    openPath,
    loadLyrics
  }

  const value = useMemo(
    () => ({
      booted: settings != null,
      settings: settings ?? (null as never),
      appIconUrl,
      appInfo,
      library,
      queue,
      playlists,
      sources,
      folders,
      downloads,
      downloadOptions,
      probe,
      session,
      tracks,
      lyrics,
      win,
      hud,
      updateStatus,
      toasts,
      notificationHistory,
      dialog,
      ctxMenu,
      lang: t,
      theme,
      ...api
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, appIconUrl, appInfo, library, queue, playlists, sources, folders, downloads, downloadOptions, probe, nav, session, tracks, lyrics, win, hud, updateStatus, toasts, notificationHistory, dialog, ctxMenu, t, theme]
  )

  const libraryValue = useMemo<LibraryRuntimeValue>(() => ({
    settings: settings ?? (null as never),
    library,
    currentMediaId: session.mediaId,
    t,
    play,
    addMediaDialog,
    addFolderDialog,
    enqueue,
    toggleFavorite,
    setFavorites,
    removeMedia,
    confirm,
    prompt,
    openPath,
    openCtxMenu,
    navigate,
    toast
  }), [
    settings,
    library,
    session.mediaId,
    t,
    play,
    addMediaDialog,
    addFolderDialog,
    enqueue,
    toggleFavorite,
    setFavorites,
    removeMedia,
    confirm,
    prompt,
    openPath,
    openCtxMenu,
    navigate,
    toast
  ])

  return (
    <RuntimeContext.Provider value={value}>
      <LibraryRuntimeContext.Provider value={libraryValue}>{children}</LibraryRuntimeContext.Provider>
    </RuntimeContext.Provider>
  )
}

async function captureVideoCover(url: string, signal?: AbortSignal): Promise<string | null> {
  return await new Promise((resolve) => {
    const video = document.createElement('video')
    const events = new AbortController()
    const onAbort = () => done(null)
    let settled = false
    const done = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      events.abort()
      signal?.removeEventListener('abort', onAbort)
      video.pause()
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const capture = () => {
      try {
        if (!video.videoWidth || !video.videoHeight) return done(null)
        const scale = Math.min(1, 640 / video.videoWidth, 640 / video.videoHeight)
        const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2)
        const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return done(null)
        context.drawImage(video, 0, 0, width, height)
        const data = canvas.toDataURL('image/jpeg', 0.84)
        canvas.width = canvas.height = 0
        done(data)
      } catch {
        done(null)
      }
    }
    const timeout = window.setTimeout(() => done(null), 30_000)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) return done(null)
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.muted = true
    video.addEventListener('error', () => done(null), { once: true, signal: events.signal })
    video.addEventListener('loadedmetadata', () => {
      const target = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(10, Math.max(0.2, video.duration * 0.1)) : 0.2
      video.currentTime = target
    }, { once: true, signal: events.signal })
    video.addEventListener('seeked', capture, { once: true, signal: events.signal })
    video.addEventListener('loadeddata', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) capture()
    }, { once: true, signal: events.signal })
    video.src = url
    video.load()
  })
}
