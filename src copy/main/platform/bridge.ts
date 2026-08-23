import { app, BrowserWindow, screen } from 'electron'
import { E } from '../../shared/channels'

export interface StartupInputs {
  files: string[]
  playRequested: boolean
}

export class ApplicationBridge {
  private win: BrowserWindow | null = null
  private inputs: StartupInputs = { files: [], playRequested: false }
  private gotLock: boolean

  constructor() {
    this.gotLock = app.requestSingleInstanceLock()
  }

  get isPrimary(): boolean {
    return this.gotLock
  }

  attachWindow(win: BrowserWindow): void {
    this.win = win
    const area = screen.getPrimaryDisplay().workArea
    const w = Math.min(1280, area.width - 80)
    const h = Math.min(820, area.height - 80)
    win.setBounds({ x: area.x + Math.round((area.width - w) / 2), y: area.y + Math.round((area.height - h) / 2), width: w, height: h })
  }

  install(): void {
    if (!this.gotLock) return
    app.on('second-instance', (_e, argv) => {
      const files = this.extractFiles(argv)
      if (this.win) {
        if (this.win.isMinimized()) this.win.restore()
        this.win.show()
        this.win.focus()
        this.win.webContents.send(E.openFiles, files)
      } else {
        this.inputs.files.push(...files)
      }
    })
    app.on('open-file', (e, filePath) => {
      e.preventDefault()
      if (this.win) this.win.webContents.send(E.openFiles, [filePath])
      else this.inputs.files.push(filePath)
    })
  }

  private extractFiles(argv: string[]): string[] {
    return argv.filter((a) => {
      if (a.startsWith('-') || a.startsWith('--') || a.startsWith('aurora:')) return false
      try {
        return require('fs').existsSync(a) && require('path').extname(a).length > 0
      } catch {
        return false
      }
    })
  }

  startupFiles(): StartupInputs {
    const files = this.extractFiles(process.argv.slice(1)).concat(this.inputs.files)
    return { files, playRequested: files.length > 0 }
  }

}
