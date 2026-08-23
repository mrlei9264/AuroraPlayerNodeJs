import type { AuroraApi } from '../preload/index'

declare global {
  interface Window {
    aurora: AuroraApi
  }
}

export {}
