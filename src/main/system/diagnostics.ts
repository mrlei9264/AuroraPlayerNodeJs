import { app, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { I, E } from '../../shared/channels'
import type { UpdateStatus } from '../../shared/types'
import { requestBuffer } from './networkProxy'

const MAX_SIZE = 2 * 1024 * 1024
const MAX_FILES = 6
const MAX_QUEUE = 4000

type Level = 'debug' | 'info' | 'warn' | 'error'

export class Logger {
  private dir: string
  private file: string
  private stream: fs.WriteStream | null = null
  private queue: string[] = []

  constructor(logDirectory: string) {
    this.dir = logDirectory
    this.file = path.join(this.dir, 'aurora.log')
  }

  install(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      this.rotateIfNeeded()
      // Keep both the file and Windows terminal output explicitly UTF-8.
      // The BOM makes the log readable by legacy Windows editors as well.
      if (!fs.existsSync(this.file) || fs.statSync(this.file).size === 0) {
        fs.writeFileSync(this.file, '\ufeff', { encoding: 'utf8' })
      }
      process.stdout.setDefaultEncoding?.('utf8')
      process.stderr.setDefaultEncoding?.('utf8')
      this.stream = fs.createWriteStream(this.file, { flags: 'a', encoding: 'utf8' })
      this.stream.on('error', (error) => {
        // Logging must never become an uncaught exception source.
        this.stream = null
        console.error(`[ERROR] [logger] log file unavailable: ${error.message}`)
      })
      const old = process.listeners('uncaughtException').slice()
      process.removeAllListeners('uncaughtException')
      process.on('uncaughtException', (err) => {
        this.error('uncaughtException', 'uncaught exception', err)
        for (const l of old) {
          try {
            ;(l as (e: Error) => void)(err)
          } catch {
            void 0
          }
        }
      })
      process.on('unhandledRejection', (reason) => {
        this.error('unhandledRejection', 'unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)))
      })
    } catch {
      this.stream = null
    }
  }

  private rotateIfNeeded(): void {
    try {
      const st = fs.statSync(this.file)
      if (st.size > MAX_SIZE) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const rotated = path.join(this.dir, `aurora-${stamp}.log`)
        fs.renameSync(this.file, rotated)
        const logs = fs.readdirSync(this.dir).filter((f) => f.startsWith('aurora-') && f.endsWith('.log')).sort()
        while (logs.length > MAX_FILES) {
          const victim = path.join(this.dir, logs.shift()!)
          fs.rmSync(victim, { force: true })
        }
      }
    } catch {
      void 0
    }
  }

  private redact(line: string): string {
    const home = os.homedir().replace(/\\/g, '/')
    let out = line
      .replace(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~')
      .replace(/\\+/g, '~')
    out = out.replace(/(password|passwd|token|secret|apikey)(["'\s:=]+)[^\s,;"']+/gi, '$1$2***')
    out = out.replace(/https?:\/\/[^/\s@]+@/gi, 'https://***@')
    return out
  }

  private write(level: Level, tag: string, msg: string): void {
    const safeMessage = this.redact(msg).replace(/\r?\n/g, '\n  ')
    const line = `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] [${tag}] ${safeMessage}`
    // Debug traces remain available in aurora.log without flooding the terminal.
    if (level !== 'debug') {
      const consoleMessage = safeMessage.split('\n')[0]
      if (level === 'error') console.error(consoleMessage)
      else if (level === 'warn') console.warn(consoleMessage)
      else console.log(consoleMessage)
    }
    if (!this.stream) return
    if (this.queue.length >= MAX_QUEUE) {
      // Prefer keeping recent diagnostics over an unbounded memory queue.
      this.queue.splice(0, Math.ceil(MAX_QUEUE / 4))
      this.queue.unshift(`${new Date().toISOString()} [WARN ] [logger] log queue trimmed`)
    }
    this.queue.push(line)
    if (this.queue.length > 1) return
    const flush = () => {
      while (this.queue.length && this.stream) {
        const l = this.queue.shift()!
        if (!this.stream.write(l + '\n')) {
          this.queue.unshift(l)
          this.stream.once('drain', flush)
          return
        }
      }
    }
    flush()
  }

  debug = (tag: string, msg: string) => this.write('debug', tag, msg)
  info = (tag: string, msg: string) => this.write('info', tag, msg)
  warn = (tag: string, msg: string, err?: unknown) => this.write('warn', tag, err instanceof Error ? `${msg} :: ${err.message}` : msg)
  error = (tag: string, msg: string, err?: unknown) =>
    this.write('error', tag, err instanceof Error ? `${msg} :: ${err.stack ?? err.message}` : msg)

  bundleDir(): string {
    return this.dir
  }
}

export class DiagnosticsController {
  constructor(
    private logger: Logger,
    private dataRoot: string,
    private tempDir: string,
    private exportDir: string,
    private settingsFile: string,
    private databaseFile: string,
    private broadcast: (channel: string, payload: unknown) => void
  ) {}

  init(): void {
    ipcMain.handle(I.appExportBundle, async () => {
      try {
        const target = await this.exportBundle(path.join(this.exportDir, `aurora-diagnostics-${Date.now()}.zip`))
        return { ok: true, path: target }
      } catch (err) {
        this.logger.error('diagnostics', 'export failed', err)
        return { ok: false, error: String(err) }
      }
    })
  }

  async exportBundle(destPath: string): Promise<string> {
    const tmp = path.join(this.tempDir, 'export-bundle')
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.mkdirSync(tmp, { recursive: true })

    const logsDir = path.join(tmp, 'logs')
    fs.cpSync(this.logger.bundleDir(), logsDir, { recursive: true })

    const settingsFile = this.settingsFile
    if (fs.existsSync(settingsFile)) {
      const redacted = this.redactSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8')))
      fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify(redacted, null, 2), 'utf8')
    }

    const dbFile = this.databaseFile
    const manifest: Record<string, unknown> = {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: `${process.platform} ${os.release()} ${os.arch()}`,
      exportedAt: new Date().toISOString(),
      dataRoot: this.dataRoot,
      mediaCount: 0
    }
    if (fs.existsSync(dbFile)) {
      try {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(dbFile, { readOnly: true })
        const row = db.prepare('SELECT COUNT(*) AS n FROM media').get() as { n: number }
        manifest.mediaCount = row.n
        const queue = db.prepare('SELECT media_id FROM queue ORDER BY position').all() as { media_id: number }[]
        manifest.queueIds = queue.map((r) => r.media_id)
        db.close()
      } catch {
        void 0
      }
    }
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    const destDir = path.dirname(destPath)
    fs.mkdirSync(destDir, { recursive: true })
    const zipPath = path.join(destDir, path.basename(destPath))
    fs.rmSync(zipPath, { force: true })

    if (process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        const ps = spawn(
          'powershell',
          ['-NoProfile', '-Command', `Compress-Archive -Path '${tmp.replace(/'/g, "''")}/*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`],
          { windowsHide: true }
        )
        ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('compress failed'))))
        ps.on('error', reject)
      })
    } else {
      fs.cpSync(tmp, zipPath, { recursive: true })
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    return zipPath
  }

  private redactSettings(s: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s)) {
      if (Array.isArray(v)) {
        out[k] = v.map((item) =>
          item && typeof item === 'object'
            ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([ik, iv]) => (ik === 'password' ? [ik, '***'] : [ik, iv])))
            : item
        )
      } else {
        out[k] = v
      }
    }
    return out
  }
}

export class UpdateChecker {
  private last: UpdateStatus = { status: 'disabled' }
  private inFlight: Promise<UpdateStatus> | null = null

  constructor(private broadcast: (channel: string, payload: unknown) => void) {}

  init(): void {
    ipcMain.handle(I.appCheckUpdate, async () => this.check())
    ipcMain.handle(I.appOpenUpdatePage, async () => {
      await shell.openExternal(RELEASES_LATEST_URL)
    })
  }

  get lastStatus(): UpdateStatus {
    return this.last
  }

  async check(): Promise<UpdateStatus> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.performCheck()
    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  private async performCheck(): Promise<UpdateStatus> {
    this.last = { status: 'checking' }
    this.broadcast(E.updateStatus, this.last)
    try {
      const res = await requestBuffer(RELEASES_API_URL, {
        timeoutMs: 10_000,
        maxBytes: 1024 * 1024,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `AuroraPlayer/${app.getVersion()}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = JSON.parse(res.data.toString('utf8')) as { tag_name?: string; draft?: boolean; prerelease?: boolean }
      if (data.draft || data.prerelease) throw new Error('latest release is not stable')
      const remote = normalizeVersion(data.tag_name)
      const local = normalizeVersion(app.getVersion())
      if (!remote) throw new Error('release version is missing or invalid')
      if (!local) throw new Error('application version is invalid')
      if (compareVersions(remote, local) > 0) {
        this.last = { status: 'available', version: remote, url: RELEASES_LATEST_URL }
      } else {
        this.last = { status: 'uptodate', version: local }
      }
    } catch (err) {
      this.last = { status: 'error', message: err instanceof Error ? err.message : String(err) }
    }
    this.broadcast(E.updateStatus, this.last)
    return this.last
  }
}

const RELEASES_API_URL = 'https://api.github.com/repos/mrlei9264/AuroraPlayerNodeJs/releases/latest'
const RELEASES_LATEST_URL = 'https://github.com/mrlei9264/AuroraPlayerNodeJs/releases/latest'

function normalizeVersion(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/^[vV]/, '').split('+', 1)[0]
  return /^\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?$/.test(normalized) ? normalized : null
}

function compareVersions(a: string, b: string): number {
  const [aCore, aPrerelease] = a.split('-', 2)
  const [bCore, bPrerelease] = b.split('-', 2)
  const aParts = aCore.split('.').map(Number)
  const bParts = bCore.split('.').map(Number)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const x = aParts[i] ?? 0
    const y = bParts[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (!aPrerelease && !bPrerelease) return 0
  if (!aPrerelease) return 1
  if (!bPrerelease) return -1
  const aIdentifiers = aPrerelease.split('.')
  const bIdentifiers = bPrerelease.split('.')
  for (let i = 0; i < Math.max(aIdentifiers.length, bIdentifiers.length); i++) {
    const x = aIdentifiers[i]
    const y = bIdentifiers[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) > Number(y) ? 1 : -1
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}
