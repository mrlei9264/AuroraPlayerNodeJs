import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export interface AppDataPaths {
  root: string
  config: string
  database: string
  security: string
  logs: string
  temp: string
  covers: string
  diagnosticsTemp: string
  diagnostics: string
  downloads: string
  runtime: string
  settingsFile: string
  databaseFile: string
  credentialsFile: string
  notificationsFile: string
  sourcesFile: string
}

export function initializeAppDataPaths(): AppDataPaths {
  const applicationRoot = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath()
  const legacyUserData = app.getPath('userData')
  const root = path.join(applicationRoot, 'data')
  const paths: AppDataPaths = {
    root,
    config: path.join(root, 'config'),
    database: path.join(root, 'database'),
    security: path.join(root, 'security'),
    logs: path.join(root, 'logs'),
    temp: path.join(root, 'temp'),
    covers: path.join(root, 'temp'),
    diagnosticsTemp: path.join(root, 'temp', 'diagnostics'),
    diagnostics: path.join(root, 'diagnostics'),
    downloads: path.join(root, 'downloads'),
    runtime: path.join(root, 'runtime'),
    settingsFile: path.join(root, 'config', 'settings.json'),
    databaseFile: path.join(root, 'database', 'library.db'),
    credentialsFile: path.join(root, 'security', 'credentials.bin'),
    notificationsFile: path.join(root, 'logs', 'notifications.json'),
    sourcesFile: path.join(root, 'config', 'remote-sources.json')
  }

  for (const directory of [paths.root, paths.config, paths.database, paths.security, paths.logs, paths.temp, paths.covers, paths.diagnosticsTemp, paths.diagnostics, paths.downloads, paths.runtime]) {
    fs.mkdirSync(directory, { recursive: true })
  }

  migrateLegacyData(paths, legacyUserData, applicationRoot)
  migrateSourcesOutOfSettings(paths)

  const sessionData = path.join(paths.runtime, 'session')
  const cache = path.join(paths.runtime, 'cache')
  const crashDumps = path.join(paths.runtime, 'crash-dumps')
  const electronLogs = path.join(paths.logs, 'electron')
  for (const directory of [sessionData, cache, crashDumps, electronLogs]) fs.mkdirSync(directory, { recursive: true })
  app.setPath('userData', paths.runtime)
  app.setPath('sessionData', sessionData)
  app.setPath('cache', cache)
  app.setPath('crashDumps', crashDumps)
  app.setPath('logs', electronLogs)

  return paths
}

function migrateSourcesOutOfSettings(paths: AppDataPaths): void {
  if (fs.existsSync(paths.sourcesFile) || !fs.existsSync(paths.settingsFile)) return
  try {
    const settings = JSON.parse(fs.readFileSync(paths.settingsFile, 'utf8')) as { sources?: unknown }
    if (Array.isArray(settings.sources)) fs.writeFileSync(paths.sourcesFile, JSON.stringify(settings.sources, null, 2), 'utf8')
  } catch {
    void 0
  }
}

function migrateLegacyData(paths: AppDataPaths, legacyUserData: string, applicationRoot: string): void {
  const roots = [...new Set([legacyUserData, applicationRoot])].filter((root) => path.resolve(root) !== path.resolve(paths.root))
  for (const root of roots) {
    moveFileIfNeeded(path.join(root, 'settings.json'), paths.settingsFile)
    moveFileIfNeeded(path.join(root, 'credentials.bin'), paths.credentialsFile)
    moveFileIfNeeded(path.join(root, 'library.json'), path.join(paths.database, 'library.json'))
    for (const suffix of ['', '-wal', '-shm']) moveFileIfNeeded(path.join(root, `library.db${suffix}`), `${paths.databaseFile}${suffix}`)
    mergeDirectory(path.join(root, 'logs'), paths.logs)
    mergeDirectory(path.join(root, 'covers'), paths.covers)
    mergeDirectory(path.join(root, 'downloads'), paths.downloads)
  }
}

function moveFileIfNeeded(source: string, target: string): void {
  try {
    if (!fs.existsSync(source) || fs.existsSync(target)) return
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
      fs.renameSync(source, target)
    } catch {
      fs.copyFileSync(source, target)
      fs.rmSync(source, { force: true })
    }
  } catch {
    void 0
  }
}

function mergeDirectory(source: string, target: string): void {
  try {
    if (!fs.existsSync(source) || path.resolve(source) === path.resolve(target)) return
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name)
      const to = path.join(target, entry.name)
      if (entry.isDirectory()) mergeDirectory(from, to)
      else moveFileIfNeeded(from, to)
    }
    if (fs.readdirSync(source).length === 0) fs.rmdirSync(source)
  } catch {
    void 0
  }
}
