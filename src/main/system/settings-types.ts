export type MetadataProvider = 'tmdb' | 'tvmaze' | 'custom'

export interface AppSettingsData {
  language: 'en' | 'zh'
  accentIndex: number
  appIcon: string
  fontFamily: string
  fontSize: 12 | 13 | 14 | 15 | 16
  reducedMotion: boolean
  reduceTransparency: boolean
  startupAnimationEnabled: boolean
  resumePlayback: boolean
  performanceHudEnabled: boolean
  autoplayNextMedia: boolean
  navigationPlayPrimaryAction: 'open-player' | 'toggle-playback'
  rememberPlaybackPosition: boolean
  startInFullscreen: boolean
  proxyEnabled: boolean
  proxyType: 'http' | 'https' | 'socks5'
  proxyServer: string
  proxyPort: string
  proxyUsername: string
  proxyPassword: string
  proxyBypassLocal: boolean
  metadataLookupEnabled: boolean
  metadataProviders: MetadataProvider[]
  metadataSources: string[]
  metadataTmdbAccessToken: string
  metadataLanguage: 'zh-CN' | 'en-US'
  metadataOverwriteExisting: boolean
}
