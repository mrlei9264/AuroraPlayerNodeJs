import { BrowserWindow, shell, ipcMain, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { E, I } from '../../shared/channels'
import { MEDIA_EXTS } from '../../shared/types'
import type { AppSettingsData } from './settings-types'
import { colorThemeAt, normalizeColorThemeIndex } from '../../shared/colorThemes'
import type { CredentialStore } from '../remote/credentials'
import { makeAppIcon } from '../util'

export type { AppSettingsData }

const execFileAsync = promisify(execFile)

async function getAvailableFontFamilies(): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const command = [
        'Add-Type -AssemblyName System.Drawing',
        '$fontCollection = New-Object System.Drawing.Text.InstalledFontCollection',
        '$fontCollection.Families.Name | Sort-Object -Unique | ConvertTo-Json -Compress'
      ].join('; ')
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true })
      const parsed = JSON.parse(stdout.trim() || '[]') as string | string[]
      return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean)
    }
    const { stdout } = await execFileAsync('fc-list', [':', 'family'], { windowsHide: true })
    return [...new Set(stdout.split(/\r?\n/).flatMap((line) => line.split(',')).map((font) => font.trim()).filter(Boolean))].sort()
  } catch {
    return ['Arial', 'Microsoft YaHei UI', 'Segoe UI', 'Segoe UI Variable', 'Tahoma', 'Times New Roman']
  }
}

const defaults: AppSettingsData = {
  language: 'zh',
  accentIndex: 1,
  appIcon: 'app_icon.png',
  fontFamily: '',
  fontSize: 13,
  reducedMotion: false,
  reduceTransparency: false,
  startupAnimationEnabled: true,
  playbackVolume: 80,
  resumePlayback: true,
  performanceHudEnabled: true,
  autoplayNextMedia: true,
  navigationPlayPrimaryAction: 'open-player',
  rememberPlaybackPosition: true,
  proxyEnabled: false,
  proxyType: 'http',
  proxyServer: '',
  proxyPort: '',
  proxyUsername: '',
  proxyPassword: '',
  proxyBypassLocal: true
}

export class SettingsStore {
  private data: AppSettingsData
  private file: string
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(settingsFile: string) {
    this.file = settingsFile
    this.data = { ...defaults }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.data = {
        ...defaults,
        ...sanitizeSettings(raw),
        accentIndex: normalizeColorThemeIndex(raw.accentIndex)
      }
    } catch {
      this.data = { ...defaults }
    }
    // Rewrite the normalized public settings shape so removed legacy fields and
    // plaintext proxy credentials do not remain in the configuration file.
    this.persist(true)
  }

  get<T extends keyof AppSettingsData>(key: T): AppSettingsData[T] {
    return this.data[key]
  }

  all(): AppSettingsData {
    return { ...this.data }
  }

  setTransient<K extends keyof AppSettingsData>(key: K, value: AppSettingsData[K]): void {
    this.data[key] = value
  }

  patch(partial: Partial<AppSettingsData>): void {
    const normalizedPartial = sanitizeSettings(partial)
    let changed = false
    for (const [k, v] of Object.entries(normalizedPartial)) {
      if ((this.data as unknown as Record<string, unknown>)[k] !== v) {
        changed = true
        ;(this.data as unknown as Record<string, unknown>)[k] = v
      }
    }
    if (changed) this.persist(true)
  }

  private persist(immediate = false): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null

    if (immediate) {
      this.writeToDisk()
      return
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.writeToDisk()
    }, 250)
  }

  private writeToDisk(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const { proxyPassword: _protectedCredential, ...persisted } = this.data
      fs.writeFileSync(this.file, JSON.stringify(persisted, null, 2), 'utf8')
    } catch (err) {
      console.error('[settings] save failed', err)
    }
  }
}

export class AppSettings {
  constructor(
    private store: SettingsStore,
    private broadcast: (channel: string, payload: unknown) => void,
    private credentials: CredentialStore,
    private onSettingsChanged: (settings: AppSettingsData, changedKeys: (keyof AppSettingsData)[]) => void | Promise<void>
  ) {}

  init(): void {
    ipcMain.handle(I.settingsGet, () => this.store.all())
    ipcMain.handle(I.fontsList, () => getAvailableFontFamilies())
    ipcMain.handle(I.settingsPatch, async (_e, partial: Partial<AppSettingsData>) => {
      const safe: Partial<AppSettingsData> = {}
      for (const [key, value] of Object.entries(partial ?? {})) {
        if (key in defaults) (safe as Record<string, unknown>)[key] = value
      }
      this.store.patch(safe)
      if (safe.proxyPassword !== undefined) await this.persistProxyPassword(safe.proxyPassword)
      this.broadcast(E.settingsChanged, this.store.all())
      const changedKeys = Object.keys(safe) as (keyof AppSettingsData)[]
      for (const key of changedKeys) this.applySystemEffects(key)
      await this.onSettingsChanged(this.store.all(), changedKeys)
      return this.store.all()
    })
    this.applySystemEffects('accentIndex')
    this.applySystemEffects('appIcon')
  }

  private applySystemEffects(key: keyof AppSettingsData): void {
    if (key === 'accentIndex') {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setBackgroundColor(colorThemeAt(this.store.get('accentIndex')).windowBackground)
    }
    if (key === 'appIcon') {
      const icon = nativeImage.createFromBuffer(makeAppIcon(256, this.store.get('appIcon')))
      BrowserWindow.getAllWindows()[0]?.setIcon(icon)
    }
  }

  private async persistProxyPassword(password: string): Promise<void> {
    if (password) await this.credentials.write('aurora:proxy', password, true)
    else await this.credentials.remove('aurora:proxy')
  }

}

function sanitizeSettings(input: unknown): Partial<AppSettingsData> {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const result: Partial<AppSettingsData> = {}
  if (raw.language === 'en' || raw.language === 'zh') result.language = raw.language
  if (Number.isFinite(raw.accentIndex)) result.accentIndex = normalizeColorThemeIndex(Number(raw.accentIndex))
  if (typeof raw.appIcon === 'string') result.appIcon = raw.appIcon
  if (typeof raw.fontFamily === 'string') result.fontFamily = raw.fontFamily
  if ([12, 13, 14, 15, 16].includes(Number(raw.fontSize))) result.fontSize = Number(raw.fontSize) as AppSettingsData['fontSize']
  if (Number.isFinite(raw.playbackVolume)) result.playbackVolume = Math.max(0, Math.min(100, Math.round(Number(raw.playbackVolume))))
  for (const key of ['reducedMotion', 'reduceTransparency', 'startupAnimationEnabled', 'resumePlayback', 'performanceHudEnabled', 'autoplayNextMedia', 'rememberPlaybackPosition', 'proxyEnabled', 'proxyBypassLocal'] as const) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key]
  }
  if (raw.navigationPlayPrimaryAction === 'open-player' || raw.navigationPlayPrimaryAction === 'toggle-playback') result.navigationPlayPrimaryAction = raw.navigationPlayPrimaryAction
  if (raw.proxyType === 'http' || raw.proxyType === 'https' || raw.proxyType === 'socks5') result.proxyType = raw.proxyType
  for (const key of ['proxyServer', 'proxyPort', 'proxyUsername', 'proxyPassword'] as const) {
    if (typeof raw[key] === 'string') result[key] = raw[key]
  }
  return result
}

export function openInShell(p: string): void {
  void shell.openPath(p)
}

export async function pickMediaFiles(win: BrowserWindow): Promise<string[] | null> {
  const { dialog } = await import('electron')
  const res = await dialog.showOpenDialog(win, {
    title: 'Add Media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Media',
        extensions: MEDIA_EXTS
      },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return res.canceled ? null : res.filePaths
}

export async function pickFolder(win: BrowserWindow): Promise<string | null> {
  const { dialog } = await import('electron')
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose Folder',
    properties: ['openDirectory']
  })
  return res.canceled ? null : res.filePaths[0] ?? null
}

