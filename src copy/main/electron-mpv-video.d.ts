declare module 'electron-mpv-video/main' {
  import type { BrowserWindow } from 'electron'

  export interface MpvMain {
    attachWindow(window: BrowserWindow): void
    detachWindow(window: BrowserWindow): Promise<void>
    dispose(): Promise<void>
  }

  export function createMpvMain(options?: { addonPath?: string }): MpvMain
}

declare module 'electron-mpv-video/preload' {
  export function exposeMpvApi(): void
}
