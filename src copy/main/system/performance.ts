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
  private gpuUnavailable = false
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

    try {
      const metrics = app.getAppMetrics()
      let bytes = 0
      let appCpu = 0
      for (const m of metrics) {
        const mem = m.memory as { workingSetSize?: number; size?: number }
        bytes += (mem?.workingSetSize ?? mem?.size ?? 0) * 1024
        appCpu += Number(m.cpu?.percentCPUUsage) || 0
      }
      if (appCpu > 0) this.cpuDelta = Math.max(0, Math.min(100, appCpu))
      if (bytes > 0) this.memMb = bytes / 1024 / 1024
      else this.memMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
    } catch {
      this.memMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
    }

    const net = this.readNetBytes()
    this.netBps = net - this.lastNet
    this.lastNet = net
    if (this.netBps < 0) this.netBps = 0

    if (process.platform === 'win32') {
      void this.sampleNvidia()
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

  private lastNvidiaAt = 0
  private nvidiaBusy = false

  private sampleNvidia(): void {
    const now = Date.now()
    if (this.nvidiaBusy || now - this.lastNvidiaAt < 2000) return
    this.nvidiaBusy = true
    const child = spawn('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], {
      windowsHide: true
    })
    let out = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.on('error', () => {
      this.gpuUnavailable = true
      this.nvidiaBusy = false
    })
    child.on('close', () => {
      const v = parseFloat(out.trim())
      if (isFinite(v)) {
        this.gpu = Math.max(0, Math.min(100, v))
        this.gpuUnavailable = false
      } else {
        this.gpuUnavailable = true
      }
      this.lastNvidiaAt = Date.now()
      this.nvidiaBusy = false
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
