import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { spawn } from 'child_process'
import { E, I } from '../../shared/channels'
import type { HudStats } from '../../shared/types'

export class PerformanceMonitor {
  private cpuDelta = 0
  private memMb = 0
  private netBps = 0
  private cpuUnavailable = false
  private gpu = 0
  private gpuUnavailable = true
  private windowsMemoryAvailable = false
  private timer: ReturnType<typeof setInterval> | null = null
  private lastCpu = process.cpuUsage()
  private lastNet = 0

  constructor(
    private broadcast: (channel: string, payload: unknown) => void,
    private readNetBytes: () => number
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled && !this.timer) {
      this.lastCpu = process.cpuUsage()
      this.lastNet = this.readNetBytes()
      this.sample()
      this.timer = setInterval(() => this.sample(), 1000)
    } else if (!enabled && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private sample(): void {
    const cpu = process.cpuUsage()
    const cpuMicro = cpu.user - this.lastCpu.user + (cpu.system - this.lastCpu.system)
    this.lastCpu = cpu
    const cores = Math.max(1, require('os').cpus().length)
    this.cpuDelta = Math.max(0, Math.min(100, (cpuMicro / 10000 / cores)))
    this.cpuUnavailable = false

    let appProcessIds: number[] = []
    try {
      const metrics = app.getAppMetrics()
      appProcessIds = metrics.map((metric) => metric.pid)
      let bytes = 0
      let appCpu = 0
      for (const m of metrics) {
        const mem = m.memory as { privateBytes?: number; workingSetSize?: number; size?: number }
        bytes += (mem?.privateBytes ?? mem?.workingSetSize ?? mem?.size ?? 0) * 1024
        appCpu += Number(m.cpu?.percentCPUUsage) || 0
      }
      if (appCpu > 0) this.cpuDelta = Math.max(0, Math.min(100, appCpu))
      if (process.platform !== 'win32' || !this.windowsMemoryAvailable) {
        if (bytes > 0) this.memMb = bytes / 1024 / 1024
        else this.memMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
      }
    } catch {
      this.windowsMemoryAvailable = false
      this.memMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
    }

    const net = this.readNetBytes()
    this.netBps = net - this.lastNet
    this.lastNet = net
    if (this.netBps < 0) this.netBps = 0

    if (process.platform === 'win32') {
      void this.sampleWindowsMetrics(appProcessIds)
    }

    const stats: HudStats = {
      cpu: this.cpuDelta,
      gpu: this.gpu,
      memoryMb: this.memMb,
      networkBps: this.netBps,
      fps: 0,
      cpuUnavailable: this.cpuUnavailable,
      gpuUnavailable: this.gpuUnavailable
    }
    this.broadcast(E.hudStats, stats)
  }

  private lastWindowsMetricsAt = 0
  private windowsMetricsBusy = false

  private sampleWindowsMetrics(processIds: number[]): void {
    const now = Date.now()
    if (!processIds.length || this.windowsMetricsBusy || now - this.lastWindowsMetricsAt < 2000) return
    this.windowsMetricsBusy = true
    const pidList = processIds.filter((pid) => Number.isInteger(pid) && pid > 0).join(',')
    const script = [
      `$targetPids = @(${pidList})`,
      '$processes = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop | Where-Object { $targetPids -contains [int]$_.IDProcess }',
      '$memoryBytes = ($processes | Measure-Object -Property WorkingSetPrivate -Sum).Sum',
      'if ($null -eq $memoryBytes) { $memoryBytes = 0 }',
      '$memoryMb = [double]$memoryBytes / 1MB',
      "$gpuText = ''",
      "$pattern = '^pid_(' + (($targetPids | ForEach-Object { [string]$_ }) -join '|') + ')_'",
      "try { $samples = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -match $pattern }; $engines = $samples | Group-Object -Property @{ Expression = { $_.Name -replace '^pid_\\d+_', '' } }; $gpuValue = ($engines | ForEach-Object { ($_.Group | Measure-Object -Property UtilizationPercentage -Sum).Sum } | Measure-Object -Maximum).Maximum; if ($null -eq $gpuValue) { $gpuValue = 0 }; $gpuText = ([double]$gpuValue).ToString([Globalization.CultureInfo]::InvariantCulture) } catch { $gpuText = '' }",
      "[Console]::Write(([double]$memoryMb).ToString([Globalization.CultureInfo]::InvariantCulture) + '|' + $gpuText)"
    ].join('; ')
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true
    })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.on('error', () => {
      this.windowsMemoryAvailable = false
      this.gpuUnavailable = true
      this.windowsMetricsBusy = false
    })
    child.on('close', () => {
      const [memoryText = '', gpuText = ''] = out.trim().split('|')
      const memoryMb = parseFloat(memoryText)
      const gpu = parseFloat(gpuText)
      if (isFinite(memoryMb) && memoryMb > 0) {
        this.memMb = memoryMb
        this.windowsMemoryAvailable = true
      } else {
        this.windowsMemoryAvailable = false
      }
      if (isFinite(gpu)) {
        this.gpu = Math.max(0, Math.min(100, gpu))
        this.gpuUnavailable = false
      } else {
        this.gpuUnavailable = true
      }
      this.lastWindowsMetricsAt = Date.now()
      this.windowsMetricsBusy = false
    })
  }
}

export class DisplaySyncMonitor {
  private fps = 0

  constructor(private broadcast: (channel: string, payload: unknown) => void) {}

  init(): void {
    ipcMain.handle(I.winSetFullscreen, (_e, full: boolean) => {
      const win = this.mainWindow()
      win?.setFullScreen(!!full)
      return true
    })
  }

  private mainWindow() {
    const { BrowserWindow } = require('electron') as typeof import('electron')
    return BrowserWindow.getAllWindows()[0]
  }

  refreshRate(): number {
    return refreshRateForMainWindow()
  }

  reportFps(fps: number): void {
    this.fps = fps
  }

  currentFps(): number {
    return this.fps
  }
}

function refreshRateForMainWindow(): number {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return 0
  try {
    const bounds = win.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.floor(bounds.width / 2),
      y: bounds.y + Math.floor(bounds.height / 2)
    })
    const value = display as typeof display & { displayFrequency?: number; refreshRate?: number }
    return Number(value.displayFrequency ?? value.refreshRate) || 0
  } catch {
    return 0
  }
}
