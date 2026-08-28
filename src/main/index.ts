import { app, BrowserWindow, ipcMain, nativeImage } from 'electron'
import type { MpvMain } from 'electron-mpv-video/main'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { E, I } from '../shared/channels'
import type { MediaItem, PlayPlan, PlayRequest, SessionState } from '../shared/types'
import { openDatabase } from './library/db'
import { LibraryRepository } from './library/repository'
import { LibraryController } from './library/controller'
import { ManagedFolderController } from './library/managedFolders'
import { QueueController, PlaylistController } from './playback/queue'
import { PlaybackLaunchPlanner, PlaybackQueueCoordinator } from './playback/planner'
import { SettingsStore } from './system/settings'
import { AppSettings } from './system/settings'
import { Logger, DiagnosticsController, UpdateChecker } from './system/diagnostics'
import { PerformanceMonitor, DisplaySyncMonitor } from './system/performance'
import { TrayController } from './platform/tray'
import { ApplicationBridge } from './platform/bridge'
import { CredentialStore } from './remote/credentials'
import { RemoteSourceManager, readRemoteNfo, readRemoteTags } from './remote/manager'
import { RemoteStreamProxy } from './remote/proxy'
import { DownloadManager } from './remote/downloads'
import { MediaProbeService, MediaIndexerService } from './media/probe'
import { LyricsService } from './media/lyrics'
import { PlaybackIpc, makePlannerDeps } from './ipc'
import { makeAppIcon } from './util'
import { LocalMediaServer } from './media/localMediaServer'
import type { AppSettingsData } from './system/settings-types'
import { initializeAppDataPaths, type AppDataPaths } from './system/dataPaths'
import { NotificationHistoryStore } from './system/notifications'
import { colorThemeAt } from '../shared/colorThemes'
import { applyNetworkProxy, installProxyAuthentication } from './system/networkProxy'

let mainWindow: BrowserWindow | null = null
let mpvMain: MpvMain | null = null
let mediaServer: LocalMediaServer
let isQuitting = false
let bridge: ApplicationBridge
let settingsStore: SettingsStore
let logger: Logger
let repo: LibraryRepository
let library: LibraryController
let folders: ManagedFolderController
let queueCtrl: QueueController
let playlistsCtrl: PlaylistController
let planner: PlaybackLaunchPlanner
let coordinator: PlaybackQueueCoordinator
let remote: RemoteSourceManager
let proxy: RemoteStreamProxy
let downloads: DownloadManager
let probe: MediaProbeService
let indexer: MediaIndexerService
let lyrics: LyricsService
let perfMonitor: PerformanceMonitor
let displaySync: DisplaySyncMonitor
let tray: TrayController
let updateChecker: UpdateChecker
let hudEnabled = false
let dataPaths: AppDataPaths

const broadcast = (channel: string, payload: unknown) => {
  if (channel === E.settingsChanged && perfMonitor) {
    const nextEnabled = Boolean((payload as AppSettingsData).performanceHudEnabled)
    if (nextEnabled !== hudEnabled) {
      hudEnabled = nextEnabled
      perfMonitor.setEnabled(nextEnabled)
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function createWindow(): void {
  const colorTheme = colorThemeAt(settingsStore.get('accentIndex'))
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: colorTheme.windowBackground,
    icon: nativeImage.createFromBuffer(makeAppIcon(256, settingsStore.get('appIcon'))),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      webSecurity: true
    }
  })

  bridge.attachWindow(mainWindow)
  mpvMain?.attachWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send(E.winState, { maximized: true, fullscreen: false }))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(E.winState, { maximized: false, fullscreen: false }))
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send(E.winState, { maximized: mainWindow?.isMaximized() ?? false, fullscreen: true }))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send(E.winState, { maximized: mainWindow?.isMaximized() ?? false, fullscreen: false }))

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env.AURORA_DEV_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'))
  }
}

function sourceUrlForItem(item: MediaItem): string {
  let sourceUrl: string
  if (item.protocol === 'local') {
    // libmpv can open local video paths directly. Audio and renderer-owned
    // assets still use the loopback range server because Chromium cannot load
    // arbitrary filesystem paths under context isolation.
    sourceUrl = !item.isAudio
      ? item.url
      : `http://127.0.0.1:${mediaServer.port}/media?t=${mediaServer.token}&p=${encodeURIComponent(item.url)}`
  } else if (item.sourceId !== null && item.remotePath) {
    sourceUrl = remote.playbackUrl(item.sourceId, item.remotePath)
  } else {
    sourceUrl = item.url
  }
  return sourceUrl
}

function urlForItem(item: MediaItem): string {
  const sourceUrl = sourceUrlForItem(item)
  return sourceUrl
}

async function bootstrap(): Promise<void> {
  app.setName('Aurora Player')
  app.setAppUserModelId('com.aurora.player')

  dataPaths = initializeAppDataPaths()
  settingsStore = new SettingsStore(dataPaths.settingsFile)
  logger = new Logger(dataPaths.logs)
  logger.install()
  new NotificationHistoryStore(dataPaths.notificationsFile).init()

  bridge = new ApplicationBridge()
  bridge.install()
  if (!bridge.isPrimary) {
    app.quit()
    return
  }

  mediaServer = new LocalMediaServer()
  mediaServer.onRequest = (line) => logger.debug('protocol', `http ${line}`)
  await mediaServer.portReady
  logger.info('protocol', `media server ready http://127.0.0.1:${mediaServer.port} token=${mediaServer.token}`)
  ipcMain.handle(I.mediaBase, () => `http://127.0.0.1:${mediaServer.port}/media?t=${mediaServer.token}&p=`)

  await app.whenReady()
  installProxyAuthentication()
  try {
    const { createMpvMain } = await import('electron-mpv-video/main')
    mpvMain = createMpvMain()
  } catch (error) {
    logger.error('playback', `libmpv initialization failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const db = openDatabase(dataPaths.databaseFile)
  repo = new LibraryRepository(db)
  repo.migrateCoverPaths(dataPaths.covers)
  const migrated = await repo.migrateLegacyLibrary(path.join(dataPaths.database, 'library.json'))
  if (migrated) logger.info('app', `migrated ${migrated} legacy items`)

  const credentials = new CredentialStore(dataPaths.credentialsFile)
  const legacyProxyPassword = settingsStore.get('proxyPassword')
  const protectedProxyPassword = await credentials.read('aurora:proxy', true)
  if (!protectedProxyPassword && legacyProxyPassword) await credentials.write('aurora:proxy', legacyProxyPassword, true)
  settingsStore.setTransient('proxyPassword', protectedProxyPassword ?? legacyProxyPassword)
  const legacyMetadataToken = settingsStore.get('metadataTmdbAccessToken')
  const protectedMetadataToken = await credentials.read('aurora:metadata:tmdb', true)
  if (!protectedMetadataToken && legacyMetadataToken) await credentials.write('aurora:metadata:tmdb', legacyMetadataToken, true)
  settingsStore.setTransient('metadataTmdbAccessToken', protectedMetadataToken ?? legacyMetadataToken)
  await applyNetworkProxy(settingsStore.all())
  remote = new RemoteSourceManager(dataPaths.sourcesFile, credentials, logger, broadcast)
  remote.init()

  proxy = new RemoteStreamProxy(remote, logger)
  await proxy.start()
  ipcMain.handle(I.networkStats, () => proxy.bytesRead())
  perfMonitor = new PerformanceMonitor(broadcast, () => proxy.bytesRead() + netBytesLocal())

  displaySync = new DisplaySyncMonitor(broadcast)
  displaySync.init()

  probe = new MediaProbeService(
    repo,
    logger,
    broadcast,
    dataPaths.covers,
    (item) => readRemoteTags(remote, item),
    (item) => readRemoteNfo(remote, item),
    settingsStore,
    sourceUrlForItem
  )
  probe.init()
  ipcMain.handle(I.probeRefreshAll, () => probe.requestAll(true))
  ipcMain.handle(I.probeRefreshMedia, (_event, mediaId: number) => probe.requestAgain(mediaId))
  indexer = new MediaIndexerService(repo, probe, logger, broadcast)
  indexer.init()

  library = new LibraryController(repo, logger, broadcast, (items) => {
    for (const item of items) {
      probe.removeTemporaryCover(item.coverPath)
      queueCtrl?.removeMediaId(item.id)
      playlistsCtrl?.removeMediaIdFromAll(item.id)
    }
  }, (items) => {
    for (const item of items) probe.request(item.id)
  })
  library.init()
  queueCtrl = new QueueController(repo, logger, broadcast)
  queueCtrl.init()
  playlistsCtrl = new PlaylistController(repo, logger, broadcast)
  playlistsCtrl.init()
  folders = new ManagedFolderController(repo, logger, broadcast)
  folders.init()

  planner = new PlaybackLaunchPlanner(
    makePlannerDeps({
      repo,
      remote,
      settings: settingsStore,
      urlFor: urlForItem,
      fileExists: fs.existsSync
    })
  )
  coordinator = new PlaybackQueueCoordinator()

  lyrics = new LyricsService(
    (title, msg) => broadcast(E.notify, { kind: 'info', title, message: msg }),
    async (sourceId, remotePath) => {
      const result = await remote.openStream(sourceId, remotePath, 0, 256 * 1024)
      if (!result || !result.stream) return null
      try {
        return await new Promise<Buffer | null>((resolve, reject) => {
          const chunks: Buffer[] = []
          result.stream.on('data', (c: Buffer) => chunks.push(c))
          result.stream.on('end', () => resolve(Buffer.concat(chunks)))
          result.stream.on('error', reject)
        })
      } catch {
        return null
      }
    }
  )
  lyrics.init()

  tray = new TrayController(() => mainWindow, (title, msg) => logger.info('tray', `${title}: ${msg}`), () => settingsStore.get('appIcon'))
  tray.init()

  updateChecker = new UpdateChecker(broadcast)
  updateChecker.init()

  const appSettings = new AppSettings(settingsStore, broadcast, credentials, async (settings, changedKeys) => {
    if (changedKeys.some((key) => key.startsWith('proxy'))) {
      await applyNetworkProxy(settings)
      remote.reloadNetworkSettings()
    }
    if (changedKeys.includes('appIcon')) tray.refreshIcon()
  })
  appSettings.init()

  const diagnostics = new DiagnosticsController(logger, dataPaths.root, dataPaths.diagnosticsTemp, dataPaths.diagnostics, dataPaths.settingsFile, dataPaths.databaseFile, broadcast)
  diagnostics.init()

  const playbackIpc = new PlaybackIpc({
    repo,
    library,
    queue: queueCtrl,
    playlists: playlistsCtrl,
    planner,
    coordinator,
    remote,
    probe,
    settings: settingsStore,
    logger,
    broadcast,
    onPlay: () => {
      void 0
    },
    urlFor: urlForItem
  })
  playbackIpc.init()

  downloads = new DownloadManager(remote, logger, broadcast, dataPaths.downloads, db)
  downloads.init()

  registerWindowIpc()

  hudEnabled = settingsStore.get('performanceHudEnabled')
  perfMonitor.setEnabled(hudEnabled)

  createWindow()

  const startup = bridge.startupFiles()
  if (startup.files.length) {
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send(E.openFiles, startup.files)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    isQuitting = true
    mediaServer.dispose()
    void mpvMain?.dispose()
  })

  app.on('will-quit', () => {
    try {
      db.close()
    } catch {
      void 0
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (!isQuitting) {
        isQuitting = true
        app.quit()
      }
    }
  })
}

let localBytes = 0
function netBytesLocal(): number {
  return localBytes
}

function registerWindowIpc(): void {
  ipcMain.handle(I.winMinimize, () => mainWindow?.minimize())
  ipcMain.handle(I.winMaximizeToggle, () => {
    if (!mainWindow) return false
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle(I.winClose, () => {
    isQuitting = true
    app.quit()
  })
  ipcMain.handle(I.winState, () => {
    const win = mainWindow
    return win ? { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } : { maximized: false, fullscreen: false }
  })
  ipcMain.handle(I.appGetInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    homeDir: os.homedir(),
    userData: dataPaths.runtime,
    dataRoot: dataPaths.root,
    dataDirectories: {
      config: dataPaths.config,
      database: dataPaths.database,
      security: dataPaths.security,
      logs: dataPaths.logs,
      temp: dataPaths.temp,
      downloads: dataPaths.downloads,
      diagnostics: dataPaths.diagnostics,
      runtime: dataPaths.runtime
    },
    refreshRate: displaySync?.refreshRate() ?? 0
  }))
  ipcMain.handle(I.appQuit, () => {
    isQuitting = true
    app.quit()
  })
}

process.env.AURORA_SMOKE === '1' &&
  app.whenReady().then(() => {
    setTimeout(() => {
      console.log('AURORA-SMOKE-OK')
      app.quit()
    }, 6000)
  })

app.on('render-process-gone', (_e, _wc, details) => {
  logger.error('app', `renderer gone: ${details.reason}`)
})

void bootstrap()




