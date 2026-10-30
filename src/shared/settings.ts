export interface AppSettingsData {
  language: 'en' | 'zh'
  accentIndex: number
  themeStyle: 'classic'
  appIcon: string
  fontFamily: string
  fontSize: 12 | 13 | 14 | 15 | 16
  reducedMotion: boolean
  reduceTransparency: boolean
  startupAnimationEnabled: boolean
  backgroundImageEnabled: boolean
  backgroundImage: string
  playbackVolume: number
  resumePlayback: boolean
  performanceHudEnabled: boolean
  autoplayNextMedia: boolean
  navigationPlayPrimaryAction: 'open-player' | 'toggle-playback'
  proxyEnabled: boolean
  proxyType: 'http' | 'https' | 'socks5'
  proxyServer: string
  proxyPort: string
  proxyUsername: string
  proxyPassword: string
  proxyBypassLocal: boolean
}

// First launch and each settings category's reset use the same values.
export const DEFAULT_APP_SETTINGS: Readonly<AppSettingsData> = Object.freeze({
  language: 'zh',
  accentIndex: 1,
  themeStyle: 'classic',
  appIcon: 'app_icon.png',
  fontFamily: 'Space Grotesk Variable',
  fontSize: 13,
  reducedMotion: false,
  reduceTransparency: false,
  startupAnimationEnabled: true,
  backgroundImageEnabled: false,
  backgroundImage: '',
  playbackVolume: 80,
  resumePlayback: true,
  performanceHudEnabled: false,
  autoplayNextMedia: true,
  navigationPlayPrimaryAction: 'open-player',
  proxyEnabled: false,
  proxyType: 'http',
  proxyServer: '',
  proxyPort: '',
  proxyUsername: '',
  proxyPassword: '',
  proxyBypassLocal: true
})
