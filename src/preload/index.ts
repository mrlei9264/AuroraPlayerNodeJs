import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { exposeMpvApi } from 'electron-mpv-video/preload'
import { I, E } from '../shared/channels'
import type { InvokeChannel, EventChannel } from '../shared/channels'
import type { SessionState } from '../shared/types'

export interface AuroraApi {
  invoke: (channel: InvokeChannel, ...args: unknown[]) => Promise<unknown>
  on: <T = unknown>(channel: EventChannel, cb: (payload: T) => void) => () => void
  pathForFile: (file: File) => string
  persistSession: (state: SessionState) => void
  windowMinimize: () => void
  windowMaximizeToggle: () => Promise<boolean>
  windowClose: () => void
}

const api: AuroraApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload as never)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  persistSession: (state) => {
    ipcRenderer.sendSync(I.sessionSync, state)
  },
  windowMinimize: () => {
    void ipcRenderer.invoke(I.winMinimize)
  },
  windowMaximizeToggle: () => ipcRenderer.invoke(I.winMaximizeToggle) as Promise<boolean>,
  windowClose: () => {
    void ipcRenderer.invoke(I.winClose)
  }
}

contextBridge.exposeInMainWorld('aurora', api)
exposeMpvApi()
