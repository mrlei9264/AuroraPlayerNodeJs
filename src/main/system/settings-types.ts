export interface AppSettingsData {
  language: 'en' | 'zh'
  accentIndex: number
  appIcon: string
  fontFamily: string
  fontSize: 12 | 13 | 14 | 15 | 16
  reducedMotion: boolean
  reduceTransparency: boolean
  startupAnimationEnabled: boolean
  playbackVolume: number
  resumePlayback: boolean
  performanceHudEnabled: boolean
  autoplayNextMedia: boolean
  navigationPlayPrimaryAction: 'open-player' | 'toggle-playback'
  rememberPlaybackPosition: boolean
  proxyEnabled: boolean
  proxyType: 'http' | 'https' | 'socks5'
  proxyServer: string
  proxyPort: string
  proxyUsername: string
  proxyPassword: string
  proxyBypassLocal: boolean
}
