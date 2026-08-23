import { Tray, Menu, Notification, nativeImage, app, BrowserWindow } from 'electron'
import { E } from '../../shared/channels'
import { makeAppIcon } from '../util'
import type { SessionState } from '../../shared/types'

export class TrayController {
  private tray: Tray | null = null
  private session: SessionState | null = null

  constructor(
    private getWindow: () => BrowserWindow | null,
    private notify: (title: string, message: string) => void,
    private getAppIconName: () => string = () => 'app_icon.png'
  ) {}

  init(): void {
    try {
      const icon = nativeImage.createFromBuffer(makeAppIcon(32, this.getAppIconName()))
      this.tray = new Tray(icon)
      this.tray.setToolTip('Aurora Player')
      this.tray.on('click', () => {
        const win = this.getWindow()
        if (win) {
          win.isVisible() ? win.hide() : win.show()
        }
      })
      this.tray.setContextMenu(this.buildMenu())
    } catch (err) {
      console.error('[tray] init failed', err)
    }
  }

  updateSession(session: SessionState): void {
    this.session = session
    this.tray?.setContextMenu(this.buildMenu())
  }

  refreshIcon(): void {
    this.tray?.setImage(nativeImage.createFromBuffer(makeAppIcon(32, this.getAppIconName())))
  }

  private buildMenu(): Menu {
    const s = this.session
    const active = !!s && !s.idle
    const playing = active && !s.paused
    return Menu.buildFromTemplate([
      { label: 'Show / Hide Aurora', click: () => this.toggleWindow() },
      { type: 'separator' },
      {
        label: playing ? 'Pause' : 'Play',
        enabled: active,
        click: () => this.emit('toggle')
      },
      { label: 'Previous', enabled: active, click: () => this.emit('previous') },
      { label: 'Next', enabled: active, click: () => this.emit('next') },
      { type: 'separator' },
      { label: 'Quit Aurora', click: () => app.quit() }
    ])
  }

  private emit(action: 'toggle' | 'previous' | 'next'): void {
    const win = this.getWindow()
    if (win) win.webContents.send(E.mediaKey, action)
  }

  private toggleWindow(): void {
    const win = this.getWindow()
    if (!win) return
    if (win.isVisible() && win.isFocused()) win.hide()
    else {
      win.show()
      win.focus()
    }
  }

  showNotification(title: string, message: string): void {
    this.notify(title, message)
    if (Notification.isSupported()) {
      new Notification({ title, body: message, icon: nativeImage.createFromBuffer(makeAppIcon(64, this.getAppIconName())) }).show()
    }
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
