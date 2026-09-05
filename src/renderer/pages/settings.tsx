import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import type { AppSettingsData } from '../../main/system/settings-types'
import { Icon, type IconName } from '../core/icons'
import { p, useRuntime } from '../core/runtime'
import { I } from '../../shared/channels'
import { applyTypographySettings } from '../core/appearance'
import { COLOR_THEMES, normalizeColorThemeIndex } from '../../shared/colorThemes'
import bundledAppIconUrl from '../assets/icon/app_icon.png'
import { MEDIA_AUDIO_EXTS, MEDIA_VIDEO_EXTS, type UpdateStatus } from '../../shared/types'
import { FloatingMenu } from '../shared/floatingMenu'

type SettingsCategory = 'general' | 'proxy' | 'appearance' | 'about'
type DraftUpdater<T> = (update: (draft: T) => T) => void

// Keep the last settings panel in renderer memory only. It is restored when
// navigating back during this app launch, but naturally resets after restart.
let lastSettingsCategory: SettingsCategory = 'general'

interface GeneralDraft {
  language: AppSettingsData['language']
  autoplayNextMedia: boolean
  navigationPlayPrimaryAction: AppSettingsData['navigationPlayPrimaryAction']
  resumePlayback: boolean
  rememberPlaybackPosition: boolean
  performanceHudEnabled: boolean
}

interface ProxyDraft {
  enabled: boolean
  type: AppSettingsData['proxyType']
  server: string
  port: string
  username: string
  password: string
  bypassLocal: boolean
}

interface AppearanceDraft {
  accentIndex: number
  appIcon: string
  fontFamily: string
  fontSize: AppSettingsData['fontSize']
  startupAnimationEnabled: boolean
  reducedMotion: boolean
  reduceTransparency: boolean
}

const CATEGORIES: { key: SettingsCategory; icon: IconName }[] = [
  { key: 'general', icon: 'sliders' },
  { key: 'proxy', icon: 'language' },
  { key: 'appearance', icon: 'paintbrush' },
  { key: 'about', icon: 'info' }
]

const SETTINGS_COPY = {
  en: {
    categoriesLabel: 'Settings categories',
    categories: { general: 'General', proxy: 'Proxy', appearance: 'Appearance', about: 'About' },
    restoreDefaults: 'Restore Defaults',
    language: 'Language',
    english: 'English (US)',
    chinese: 'Simplified Chinese',
    autoplayNext: 'Autoplay next media',
    navigationPlayButton: 'Navigation play button',
    navigationPlayButtonDescription: 'Choose the left-click action. Right-click automatically uses the other action.',
    openPlayerAndResume: 'Open player',
    togglePlayback: 'Play / Pause',
    resumePlayback: 'Resume playback',
    rememberPosition: 'Remember playback position',
    performanceHud: 'Performance HUD',
    performanceHudDescription: 'Show CPU, GPU, memory usage in MB, and the application rendering refresh rate.',
    enableProxy: 'Enable proxy',
    proxyType: 'Proxy type',
    server: 'Server',
    serverPlaceholder: 'e.g. 127.0.0.1',
    port: 'Port',
    portPlaceholder: 'e.g. 7890',
    username: 'Username',
    password: 'Password',
    optional: 'Optional',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    bypassLocal: 'Bypass proxy for local addresses',
    bypassLocalDescription: 'Connect directly to local network resources.',
    colorTheme: 'Color theme',
    colorThemeDescription: 'Changes the background, surfaces, text, controls, and player colors throughout the application.',
    appearanceThemeGroup: 'Theme & branding',
    appearanceTypographyGroup: 'Typography & scale',
    appearanceMotionGroup: 'Motion & material',
    appIcon: 'Application icon',
    appIconDescription: 'Place PNG, JPG, WEBP, or ICO files in the icon folder next to the app executable; Aurora Player reads them automatically. Some system icon changes take effect after restarting the app.',
    applicationFont: 'Application font',
    applicationFontDescription: 'Applied throughout the interface.',
    systemDefault: 'Aurora Default',
    installedFonts: (count: number) => `${count} installed fonts available`,
    loadingFonts: 'Loading installed fonts...',
    fontSize: 'Interface and text size',
    fontSizeDescription: 'Scales all interface text consistently and adjusts control sizes gently. Player subtitles remain independent.',
    recommended: 'Recommended',
    startupAnimation: 'Startup animation',
    reduceTransparency: 'Reduce transparency',
    reduceMotion: 'Reduce motion',
    application: 'Application',
    version: 'Version',
    platform: 'Platform',
    runtime: 'Application runtime',
    mediaEngine: 'Media Engine',
    applicationLicense: 'Application license',
    supportedFormats: 'Supported file formats',
    supportedFormatsDescription: 'Extensions recognized by the library and available for local or network playback. Codec availability is provided by the bundled media engine.',
    videoFormats: 'Video',
    audioFormats: 'Audio',
    embeddedSubtitleSupport: 'Subtitle tracks embedded in supported video containers are detected automatically. Standalone subtitle files are not imported as media items.',
    dataStorage: 'Application data',
    dataStorageDescription: 'All files created by Aurora Player are organized under this data directory. Original media files remain in their existing locations.',
    dataRoot: 'Data root',
    openDataFolder: 'Open Data Folder',
    dataDirectories: {
      config: ['Configuration', 'Preferences and interface settings'],
      database: ['Media database', 'Library records, playlists, and playback history'],
      security: ['Protected credentials', 'Encrypted network-media credentials'],
      logs: ['Logs', 'Application and runtime diagnostic logs'],
      temp: ['Temporary files', 'Generated video covers and diagnostic working files'],
      downloads: ['Downloads', 'Files downloaded from network media'],
      diagnostics: ['Diagnostics', 'Exported diagnostic bundles'],
      runtime: ['Runtime data', 'Cache, sessions, and crash information']
    },
    checking: 'Checking...',
    upToDate: 'Up to Date',
    checkUpdates: 'Check for Updates',
    softwareUpdate: 'Software update',
    updateDescription: 'Check GitHub Releases for the latest stable version of Aurora Player.',
    updateAvailableFor: (version: string) => `Aurora Player ${version} is available.`,
    currentVersionIsLatest: (version: string) => `Version ${version} is the latest version.`,
    updateCheckFailed: 'Unable to check for updates. Please verify the network or proxy settings and try again.',
    getUpdate: 'Get Update',
    retryUpdate: 'Try Again',
    checkAgain: 'Check Again',
    generalError: 'Unable to apply general settings',
    proxyError: 'Unable to apply proxy settings',
    appearanceError: 'Unable to apply appearance settings',
    restoreError: 'Unable to restore appearance settings'
  },
  zh: {
    categoriesLabel: '设置分类',
    categories: { general: '通用', proxy: '代理', appearance: '外观', about: '关于' },
    restoreDefaults: '恢复默认设置',
    language: '语言',
    english: '英语（美国）',
    chinese: '简体中文',
    autoplayNext: '自动播放下一个媒体',
    navigationPlayButton: '导航栏播放按钮',
    navigationPlayButtonDescription: '选择鼠标左键功能，鼠标右键会自动使用另一个功能。',
    openPlayerAndResume: '打开播放器',
    togglePlayback: '播放 / 暂停',
    resumePlayback: '继续上次播放',
    rememberPosition: '记住播放位置',
    performanceHud: '性能指标 HUD',
    performanceHudDescription: '显示 CPU、GPU、内存占用（MB）和程序实时渲染刷新率。',
    enableProxy: '启用代理',
    proxyType: '代理类型',
    server: '服务器',
    serverPlaceholder: '例如 127.0.0.1',
    port: '端口',
    portPlaceholder: '例如 7890',
    username: '用户名',
    password: '密码',
    optional: '可选',
    showPassword: '显示密码',
    hidePassword: '隐藏密码',
    bypassLocal: '本地地址不使用代理',
    bypassLocalDescription: '连接本地网络资源时使用直连。',
    colorTheme: '颜色主题',
    colorThemeDescription: '同步修改整个程序的背景、面板、文字、控件与播放器颜色。',
    appearanceThemeGroup: '主题与品牌',
    appearanceTypographyGroup: '字体与尺寸',
    appearanceMotionGroup: '动效与材质',
    appIcon: '应用图标',
    appIconDescription: '将 PNG、JPG、WEBP 或 ICO 图片放入应用程序旁的 icon 文件夹，Aurora Player 会自动读取。部分系统图标变化需要重启程序后生效。',
    applicationFont: '应用字体',
    applicationFontDescription: '应用于整个软件界面。',
    systemDefault: 'Aurora 默认字体',
    installedFonts: (count: number) => `可使用 ${count} 种已安装字体`,
    loadingFonts: '正在加载已安装字体...',
    fontSize: '界面与文字大小',
    fontSizeDescription: '统一调整所有界面文字，并适度联动控件尺寸；播放器字幕仍单独设置。',
    recommended: '推荐',
    startupAnimation: '启动动画',
    reduceTransparency: '降低透明效果',
    reduceMotion: '减少动画',
    application: '应用程序',
    version: '版本',
    platform: '运行平台',
    runtime: '应用运行时',
    mediaEngine: '媒体引擎',
    applicationLicense: '应用许可证',
    supportedFormats: '支持的文件格式',
    supportedFormatsDescription: '以下扩展名可被媒体库识别，并支持本地或网络播放。具体编解码能力由程序内置媒体引擎提供。',
    videoFormats: '视频',
    audioFormats: '音频',
    embeddedSubtitleSupport: '支持自动识别视频容器中的内嵌字幕轨道；独立字幕文件不会作为媒体项目导入。',
    dataStorage: '应用数据',
    dataStorageDescription: 'Aurora Player 运行时产生的文件均分类保存在此 data 目录中，原始音视频文件仍保留在其原有位置。',
    dataRoot: '数据根目录',
    openDataFolder: '打开数据目录',
    dataDirectories: {
      config: ['配置', '偏好设置与界面设置'],
      database: ['媒体数据库', '媒体库记录、播放列表与播放历史'],
      security: ['安全凭据', '加密保存的网络媒体连接凭据'],
      logs: ['日志', '应用与运行诊断日志'],
      temp: ['临时文件', '自动生成的视频封面与诊断工作文件'],
      downloads: ['下载文件', '从网络媒体下载的文件'],
      diagnostics: ['诊断文件', '导出的诊断数据包'],
      runtime: ['运行时数据', '缓存、会话与崩溃信息']
    },
    checking: '正在检查...',
    upToDate: '已是最新版本',
    checkUpdates: '检查更新',
    softwareUpdate: '软件更新',
    updateDescription: '通过 GitHub Releases 检查 Aurora Player 的最新稳定版本。',
    updateAvailableFor: (version: string) => `发现 Aurora Player ${version}，可前往更新。`,
    currentVersionIsLatest: (version: string) => `当前 ${version} 已是最新版本。`,
    updateCheckFailed: '检查更新失败，请确认网络或代理设置后重试。',
    getUpdate: '获取更新',
    retryUpdate: '重新检查',
    checkAgain: '再次检查',
    generalError: '无法应用通用设置',
    proxyError: '无法应用代理设置',
    appearanceError: '无法应用外观设置',
    restoreError: '无法恢复外观默认设置'
  }
} as const

type SettingsCopy = (typeof SETTINGS_COPY)[keyof typeof SETTINGS_COPY]

const defaultGeneral: GeneralDraft = {
  language: 'zh',
  autoplayNextMedia: true,
  navigationPlayPrimaryAction: 'open-player',
  resumePlayback: true,
  rememberPlaybackPosition: true,
  performanceHudEnabled: true
}

const defaultProxy: ProxyDraft = {
  enabled: false,
  type: 'http',
  server: '',
  port: '',
  username: '',
  password: '',
  bypassLocal: true
}

const defaultAppearance: AppearanceDraft = {
  accentIndex: 1,
  appIcon: 'app_icon.png',
  fontFamily: '',
  fontSize: 13,
  startupAnimationEnabled: true,
  reducedMotion: false,
  reduceTransparency: false
}

function generalFrom(settings: AppSettingsData): GeneralDraft {
  return {
    language: settings.language,
    autoplayNextMedia: settings.autoplayNextMedia,
    navigationPlayPrimaryAction: settings.navigationPlayPrimaryAction,
    resumePlayback: settings.resumePlayback,
    rememberPlaybackPosition: settings.rememberPlaybackPosition,
    performanceHudEnabled: settings.performanceHudEnabled
  }
}

function proxyFrom(settings: AppSettingsData): ProxyDraft {
  return {
    enabled: settings.proxyEnabled,
    type: settings.proxyType,
    server: settings.proxyServer,
    port: settings.proxyPort,
    username: settings.proxyUsername,
    password: settings.proxyPassword,
    bypassLocal: settings.proxyBypassLocal
  }
}

function appearanceFrom(settings: AppSettingsData): AppearanceDraft {
  return {
    accentIndex: normalizeColorThemeIndex(settings.accentIndex),
    appIcon: settings.appIcon,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    startupAnimationEnabled: settings.startupAnimationEnabled,
    reducedMotion: settings.reducedMotion,
    reduceTransparency: settings.reduceTransparency
  }
}

export function SettingsPage() {
  const { settings, patchSettings, toast, appInfo, updateStatus, checkUpdate, openUpdatePage, openPath } = useRuntime()
  const copy = SETTINGS_COPY[settings.language]
  const [category, setCategory] = useState<SettingsCategory>(() => lastSettingsCategory)
  const [general, setGeneral] = useState<GeneralDraft>(() => generalFrom(settings))
  const [proxy, setProxy] = useState<ProxyDraft>(() => proxyFrom(settings))
  const [appearance, setAppearance] = useState<AppearanceDraft>(() => appearanceFrom(settings))
  const [showProxyPassword, setShowProxyPassword] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [categoryDirection, setCategoryDirection] = useState(1)
  const [themePulse, setThemePulse] = useState(0)
  const [restoreCycle, setRestoreCycle] = useState(0)
  const [restoreCategory, setRestoreCategory] = useState<SettingsCategory | null>(null)
  const feedbackTimersRef = useRef(new Map<HTMLElement, number>())
  const systemReducedMotion = useReducedMotion()
  const reduceMotion = settings.reducedMotion || systemReducedMotion

  useEffect(() => {
    setGeneral(generalFrom(settings))
    setProxy(proxyFrom(settings))
    setAppearance(appearanceFrom(settings))
  }, [settings])

  useEffect(() => () => {
    for (const timer of feedbackTimersRef.current.values()) window.clearTimeout(timer)
    feedbackTimersRef.current.clear()
  }, [])

  const updateGeneral: DraftUpdater<GeneralDraft> = (update) => {
    const next = update(general)
    setGeneral(next)
    void patchSettings({
      language: next.language,
      autoplayNextMedia: next.autoplayNextMedia,
      navigationPlayPrimaryAction: next.navigationPlayPrimaryAction,
      resumePlayback: next.resumePlayback,
      rememberPlaybackPosition: next.rememberPlaybackPosition,
      performanceHudEnabled: next.performanceHudEnabled
    }).catch(() => toast('error', copy.generalError))
  }

  const updateProxy: DraftUpdater<ProxyDraft> = (update) => {
    const next = update(proxy)
    setProxy(next)
    void patchSettings({
      proxyEnabled: next.enabled,
      proxyType: next.type,
      proxyServer: next.server.trim(),
      proxyPort: next.port.trim(),
      proxyUsername: next.username.trim(),
      proxyPassword: next.password,
      proxyBypassLocal: next.bypassLocal
    }).catch(() => toast('error', copy.proxyError))
  }

  const updateAppearance: DraftUpdater<AppearanceDraft> = (update) => {
    const next = update(appearance)
    setAppearance(next)
    applyTypographySettings(next)
    void patchSettings({
      accentIndex: next.accentIndex,
      appIcon: next.appIcon,
      fontFamily: next.fontFamily.trim(),
      fontSize: next.fontSize,
      startupAnimationEnabled: next.startupAnimationEnabled,
      reducedMotion: next.reducedMotion,
      reduceTransparency: next.reduceTransparency
    }).catch(() => toast('error', copy.appearanceError))
  }

  const restoreCurrentCategory = () => {
    if (category === 'general') updateGeneral(() => defaultGeneral)
    if (category === 'proxy') updateProxy(() => defaultProxy)
    if (category === 'appearance') {
      setAppearance(defaultAppearance)
      applyTypographySettings(defaultAppearance)
      void patchSettings(defaultAppearance).catch(() => toast('error', copy.restoreError))
    }
  }

  const selectCategory = (nextCategory: SettingsCategory) => {
    const currentIndex = CATEGORIES.findIndex((item) => item.key === category)
    const nextIndex = CATEGORIES.findIndex((item) => item.key === nextCategory)
    if (currentIndex !== nextIndex) setCategoryDirection(nextIndex > currentIndex ? 1 : -1)
    if (nextCategory !== category) setRestoreCategory(null)
    lastSettingsCategory = nextCategory
    setCategory(nextCategory)
  }

  const signalSettingFeedback = (target: EventTarget | null) => {
    if (reduceMotion || !(target instanceof HTMLElement)) return
    const surface = target.closest<HTMLElement>('.settings-row, .settings-toggle-card')
    if (!surface) return
    const previousTimer = feedbackTimersRef.current.get(surface)
    if (previousTimer) window.clearTimeout(previousTimer)
    surface.removeAttribute('data-feedback')
    void surface.offsetWidth
    surface.dataset.feedback = 'true'
    const timer = window.setTimeout(() => {
      surface.removeAttribute('data-feedback')
      feedbackTimersRef.current.delete(surface)
    }, 620)
    feedbackTimersRef.current.set(surface, timer)
  }

  const restoreWithAnimation = () => {
    setRestoreCategory(category)
    setRestoreCycle((cycle) => cycle + 1)
    restoreCurrentCategory()
  }

  const panel = CATEGORIES.find((item) => item.key === category)!
  const panelTitle = copy.categories[category]

  return (
    <main
      className="settings-page"
      data-reduced-motion={reduceMotion ? 'true' : 'false'}
      onChangeCapture={(event) => signalSettingFeedback(event.target)}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest('.settings-switch, .settings-segmented button, .settings-select-menu [role="option"]')) signalSettingFeedback(event.target)
      }}
    >
      {themePulse > 0 && <span key={themePulse} className="settings-theme-diffusion" aria-hidden="true" />}
      <div className="settings-workspace">
        <LayoutGroup id="settings-category-selection">
          <nav className="settings-category-panel" aria-label={copy.categoriesLabel}>
            {CATEGORIES.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`settings-category ${category === item.key ? 'active' : ''}`}
                title={copy.categories[item.key]}
                onClick={() => selectCategory(item.key)}
                aria-current={category === item.key ? 'page' : undefined}
              >
                {category === item.key && (
                  <motion.span
                    className="settings-category-active-motion"
                    layoutId="settings-category-active"
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 390, damping: 34, mass: 0.74 }}
                    aria-hidden="true"
                  />
                )}
                <Icon name={item.icon} size={32} strokeWidth={1.65} />
                <span>{copy.categories[item.key]}</span>
              </button>
            ))}
          </nav>
        </LayoutGroup>

        <section className="settings-detail-panel" aria-labelledby="settings-panel-title">
          <div className="settings-panel-title">
            <Icon name={category === 'general' ? 'settings' : panel.icon} size={38} strokeWidth={1.55} />
            <h2 id="settings-panel-title">{panelTitle}</h2>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className={`settings-detail-content ${restoreCycle > 0 && restoreCategory === category ? `settings-restore-${restoreCycle % 2 ? 'a' : 'b'}` : ''}`}
              key={category}
              data-direction={categoryDirection > 0 ? 'forward' : 'back'}
              initial={reduceMotion ? false : { opacity: 0, x: categoryDirection * 14, scale: 0.994 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: categoryDirection * -8, scale: 0.997 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {category === 'general' && <GeneralPanel value={general} onChange={updateGeneral} copy={copy} />}
              {category === 'proxy' && (
                <ProxyPanel
                  value={proxy}
                  onChange={updateProxy}
                  copy={copy}
                  showPassword={showProxyPassword}
                  onTogglePassword={() => setShowProxyPassword((visible) => !visible)}
                />
              )}
              {category === 'appearance' && <AppearancePanel value={appearance} onChange={updateAppearance} copy={copy} language={settings.language} onThemeChange={() => setThemePulse((pulse) => pulse + 1)} />}
              {category === 'about' && (
                <AboutPanel
                  application={appInfo?.name ?? 'Aurora Player'}
                  version={appInfo?.version ?? '-'}
                  platform={formatPlatform(appInfo?.platform, appInfo?.arch)}
                  runtime={`Electron ${appInfo?.electron ?? '-'} · Chromium ${appInfo?.chrome ?? '-'}`}
                  engine={appInfo?.mediaEngine ?? 'libmpv'}
                  updateStatus={updateStatus}
                  checking={checkingUpdates}
                  copy={copy}
                  dataRoot={appInfo?.dataRoot ?? ''}
                  dataDirectories={appInfo?.dataDirectories ?? null}
                  onOpenData={() => appInfo?.dataRoot && void openPath(appInfo.dataRoot)}
                  onCheck={async () => {
                    setCheckingUpdates(true)
                    try {
                      await checkUpdate()
                    } finally {
                      setCheckingUpdates(false)
                    }
                  }}
                  onOpenUpdate={() => void openUpdatePage()}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {category !== 'about' && (
            <footer className="settings-panel-footer">
              <button type="button" className="settings-button settings-button-ghost" onClick={restoreWithAnimation}>{copy.restoreDefaults}</button>
            </footer>
          )}
        </section>
      </div>
    </main>
  )
}

function GeneralPanel({ value, onChange, copy }: { value: GeneralDraft; onChange: DraftUpdater<GeneralDraft>; copy: SettingsCopy }) {
  return (
    <div className="settings-rows settings-general-rows">
      <SettingRow label={copy.language}>
        <SettingsSelect
          label={copy.language}
          value={value.language}
          options={[{ value: 'en', label: copy.english }, { value: 'zh', label: copy.chinese }]}
          onChange={(language) => onChange((draft) => ({ ...draft, language: language as AppSettingsData['language'] }))}
        />
      </SettingRow>
      <SettingRow label={copy.autoplayNext}>
        <SettingsSwitch checked={value.autoplayNextMedia} label={copy.autoplayNext} onChange={(checked) => onChange((draft) => ({ ...draft, autoplayNextMedia: checked }))} />
      </SettingRow>
      <SettingRow label={copy.navigationPlayButton} description={copy.navigationPlayButtonDescription}>
        <SegmentedControl
          label={copy.navigationPlayButton}
          options={[
            { value: 'open-player', label: copy.openPlayerAndResume },
            { value: 'toggle-playback', label: copy.togglePlayback }
          ]}
          selected={value.navigationPlayPrimaryAction}
          onSelect={(selected) => onChange((draft) => ({ ...draft, navigationPlayPrimaryAction: selected as AppSettingsData['navigationPlayPrimaryAction'] }))}
        />
      </SettingRow>
      <SettingRow label={copy.resumePlayback}>
        <SettingsSwitch checked={value.resumePlayback} label={copy.resumePlayback} onChange={(checked) => onChange((draft) => ({ ...draft, resumePlayback: checked }))} />
      </SettingRow>
      <SettingRow label={copy.rememberPosition}>
        <SettingsSwitch checked={value.rememberPlaybackPosition} label={copy.rememberPosition} onChange={(checked) => onChange((draft) => ({ ...draft, rememberPlaybackPosition: checked }))} />
      </SettingRow>
      <SettingRow label={copy.performanceHud} description={copy.performanceHudDescription}>
        <SettingsSwitch checked={value.performanceHudEnabled} label={copy.performanceHud} onChange={(checked) => onChange((draft) => ({ ...draft, performanceHudEnabled: checked }))} />
      </SettingRow>
    </div>
  )
}

function ProxyPanel({
  value,
  onChange,
  copy,
  showPassword,
  onTogglePassword
}: {
  value: ProxyDraft
  onChange: DraftUpdater<ProxyDraft>
  copy: SettingsCopy
  showPassword: boolean
  onTogglePassword: () => void
}) {
  const field = (key: keyof Pick<ProxyDraft, 'server' | 'port' | 'username' | 'password'>, next: string) => {
    onChange((draft) => ({ ...draft, [key]: next }))
  }

  return (
    <div className="settings-rows settings-proxy-rows">
      <SettingRow label={copy.enableProxy}>
        <SettingsSwitch checked={value.enabled} label={copy.enableProxy} onChange={(checked) => onChange((draft) => ({ ...draft, enabled: checked }))} />
      </SettingRow>
      <SettingRow label={copy.proxyType}>
        <SettingsSelect
          label={copy.proxyType}
          value={value.type}
          options={[{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }, { value: 'socks5', label: 'SOCKS5' }]}
          onChange={(type) => onChange((draft) => ({ ...draft, type: type as ProxyDraft['type'] }))}
        />
      </SettingRow>
      <SettingRow label={copy.server}>
        <input className="settings-input" aria-label={copy.server} placeholder={copy.serverPlaceholder} value={value.server} onChange={(event) => field('server', event.target.value)} />
      </SettingRow>
      <SettingRow label={copy.port}>
        <input className="settings-input" aria-label={copy.port} inputMode="numeric" placeholder={copy.portPlaceholder} value={value.port} onChange={(event) => field('port', event.target.value.replace(/\D/g, ''))} />
      </SettingRow>
      <SettingRow label={copy.username}>
        <input className="settings-input" aria-label={copy.username} placeholder={copy.optional} value={value.username} onChange={(event) => field('username', event.target.value)} />
      </SettingRow>
      <SettingRow label={copy.password}>
        <div className="settings-password-field">
          <input className="settings-input" aria-label={copy.password} type={showPassword ? 'text' : 'password'} placeholder={copy.optional} value={value.password} onChange={(event) => field('password', event.target.value)} />
          <button type="button" onClick={onTogglePassword} aria-label={showPassword ? copy.hidePassword : copy.showPassword} title={showPassword ? copy.hidePassword : copy.showPassword}>
            <Icon name="eye" size={21} />
          </button>
        </div>
      </SettingRow>
      <SettingRow label={copy.bypassLocal} description={copy.bypassLocalDescription}>
        <SettingsSwitch checked={value.bypassLocal} label={copy.bypassLocal} onChange={(checked) => onChange((draft) => ({ ...draft, bypassLocal: checked }))} />
      </SettingRow>
    </div>
  )
}

function AppearancePanel({ value, onChange, copy, language, onThemeChange }: { value: AppearanceDraft; onChange: DraftUpdater<AppearanceDraft>; copy: SettingsCopy; language: AppSettingsData['language']; onThemeChange: () => void }) {
  const fontSizes: AppSettingsData['fontSize'][] = [12, 13, 14, 15, 16]
  const [fontFamilies, setFontFamilies] = useState<string[]>([])
  const [appIcons, setAppIcons] = useState<AppIconOption[]>([])
  const selectableFontFamilies = useMemo(() => {
    const families = new Map<string, string>()
    for (const font of [value.fontFamily, ...fontFamilies]) {
      const name = font.trim()
      if (name) families.set(name.toLocaleLowerCase(), name)
    }
    return [...families.values()].sort((a, b) => a.localeCompare(b))
  }, [fontFamilies, value.fontFamily])

  useEffect(() => {
    let active = true
    void p<string[]>(I.fontsList).then((families) => {
      if (active) setFontFamilies([...new Set(families)].sort((a, b) => a.localeCompare(b)))
    }).catch(() => {
      if (active) setFontFamilies([])
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void p<AppIconOption[]>(I.appIconsList).then((icons) => {
      if (active) setAppIcons(icons)
    }).catch(() => {
      if (active) setAppIcons([])
    })
    return () => { active = false }
  }, [])

  const appIconOptions: SettingsSelectOption[] = (appIcons.length ? appIcons : [{ value: 'app_icon.png', label: 'app_icon.png', dataUrl: bundledAppIconUrl }]).map((icon) => ({
    value: icon.value,
    label: icon.label,
    image: icon.dataUrl,
    imageOnly: true
  }))

  return (
    <div className="settings-rows settings-appearance-rows">
      <SettingsGroup title={copy.appearanceThemeGroup}>
        <SettingRow label={copy.colorTheme} description={copy.colorThemeDescription}>
          <SettingsSelect
            label={copy.colorTheme}
            value={String(value.accentIndex)}
            className="settings-color-theme-control"
            options={COLOR_THEMES.map((colorTheme) => ({
              value: String(colorTheme.index),
              label: language === 'zh' ? colorTheme.nameZh : colorTheme.name,
              swatch: [colorTheme.windowBackground, colorTheme.palette.bg3, colorTheme.start] as [string, string, string]
            }))}
            onChange={(accentIndex) => {
              onThemeChange()
              onChange((draft) => ({ ...draft, accentIndex: normalizeColorThemeIndex(accentIndex) }))
            }}
          />
        </SettingRow>
        <SettingRow label={copy.appIcon} description={copy.appIconDescription}>
          <SettingsSelect
            label={copy.appIcon}
            value={value.appIcon}
            className="settings-app-icon-control"
            options={appIconOptions}
            onChange={(appIcon) => onChange((draft) => ({ ...draft, appIcon }))}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={copy.appearanceTypographyGroup}>
        <SettingRow label={copy.applicationFont} description={copy.applicationFontDescription}>
          <div className="settings-font-picker">
            <FontFamilySelect
              fonts={selectableFontFamilies}
              value={value.fontFamily}
              copy={copy}
              onChange={(fontFamily) => onChange((draft) => ({ ...draft, fontFamily }))}
            />
            <small>{fontFamilies.length ? copy.installedFonts(fontFamilies.length) : copy.loadingFonts}</small>
          </div>
        </SettingRow>
        <SettingRow label={copy.fontSize} description={copy.fontSizeDescription}>
          <SettingsSelect
            label={copy.fontSize}
            value={String(value.fontSize)}
            options={fontSizes.map((size) => {
              const visualSize = size - 2
              return { value: String(size), label: `${visualSize} px${visualSize === 11 ? ` (${copy.recommended})` : ''}` }
            })}
            onChange={(fontSize) => onChange((draft) => ({ ...draft, fontSize: Number(fontSize) as AppSettingsData['fontSize'] }))}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={copy.appearanceMotionGroup}>
        <div className="settings-toggle-grid">
          <div className="settings-toggle-card">
            <span>{copy.startupAnimation}</span>
            <SettingsSwitch checked={value.startupAnimationEnabled} label={copy.startupAnimation} onChange={(checked) => onChange((draft) => ({ ...draft, startupAnimationEnabled: checked }))} />
          </div>
          <div className="settings-toggle-card">
            <span>{copy.reduceTransparency}</span>
            <SettingsSwitch checked={value.reduceTransparency} label={copy.reduceTransparency} onChange={(checked) => onChange((draft) => ({ ...draft, reduceTransparency: checked }))} />
          </div>
          <div className="settings-toggle-card">
            <span>{copy.reduceMotion}</span>
            <SettingsSwitch checked={value.reducedMotion} label={copy.reduceMotion} onChange={(checked) => onChange((draft) => ({ ...draft, reducedMotion: checked }))} />
          </div>
        </div>
      </SettingsGroup>
    </div>
  )
}

interface SettingsSelectOption {
  value: string
  label: string
  swatch?: [string, string, string]
  fontFamily?: string
  image?: string
  imageOnly?: boolean
}

interface AppIconOption {
  value: string
  label: string
  dataUrl: string
}

function SettingsSelect({
  label,
  value,
  options,
  onChange,
  className = ''
}: {
  label: string
  value: string
  options: SettingsSelectOption[]
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex] ?? options[0]

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, selectedIndex])

  const choose = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const moveOptionFocus = (currentIndex: number, offset: number) => {
    const nextIndex = (currentIndex + offset + options.length) % options.length
    optionRefs.current[nextIndex]?.focus()
  }

  return (
    <div className={`settings-font-select settings-custom-select ${className}`.trim()} ref={rootRef} data-open={open ? 'true' : 'false'}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-font-select-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <span className="settings-select-option-main">
          {selected?.swatch && <ColorThemeSwatch colors={selected.swatch} />}
          {selected?.image && <img className="settings-select-image-preview" src={selected.image} alt="" />}
          {!selected?.imageOnly && <span style={selected?.fontFamily ? { fontFamily: selected.fontFamily } : undefined}>{selected?.label ?? ''}</span>}
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={rootRef}
        onClose={() => setOpen(false)}
        className={`settings-font-menu settings-select-menu ${className}`.trim()}
        role="listbox"
        ariaLabel={label}
        maxHeight={className.includes('settings-color-theme-control') ? 304 : 224}
      >
          {options.map((option, index) => (
            <button
              ref={(node) => { optionRefs.current[index] = node }}
              type="button"
              role="option"
              aria-selected={value === option.value}
              aria-label={option.label}
              title={option.label}
              className={value === option.value ? 'selected' : ''}
              key={option.value}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); moveOptionFocus(index, 1) }
                if (event.key === 'ArrowUp') { event.preventDefault(); moveOptionFocus(index, -1) }
                if (event.key === 'Home') { event.preventDefault(); optionRefs.current[0]?.focus() }
                if (event.key === 'End') { event.preventDefault(); optionRefs.current[options.length - 1]?.focus() }
                if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
              }}
            >
              <span className="settings-select-option-main">
                {option.swatch && <ColorThemeSwatch colors={option.swatch} />}
                {option.image && <img className="settings-select-image-preview" src={option.image} alt="" />}
                {!option.imageOnly && <span style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}>{option.label}</span>}
              </span>
              {value === option.value && <Icon name="check" size={17} />}
            </button>
          ))}
      </FloatingMenu>
    </div>
  )
}

function ColorThemeSwatch({ colors }: { colors: [string, string, string] }) {
  return <span className="settings-color-theme-swatch" aria-hidden="true" style={{ background: `linear-gradient(110deg, ${colors[0]} 0% 38%, ${colors[1]} 38% 67%, ${colors[2]} 67% 100%)` }} />
}

function FontFamilySelect({ fonts, value, onChange, copy }: { fonts: string[]; value: string; onChange: (font: string) => void; copy: SettingsCopy }) {
  return (
    <SettingsSelect
      label={copy.applicationFont}
      value={value}
      options={[
        { value: '', label: copy.systemDefault },
        ...fonts.map((font) => ({
          value: font,
          label: font,
          fontFamily: `"${font.replace(/["\\]/g, '\\$&')}"`
        }))
      ]}
      onChange={onChange}
    />
  )
}

function AboutPanel({
  application,
  version,
  platform,
  runtime,
  engine,
  updateStatus,
  checking,
  copy,
  dataRoot,
  dataDirectories,
  onOpenData,
  onCheck,
  onOpenUpdate
}: {
  application: string
  version: string
  platform: string
  runtime: string
  engine: string
  updateStatus: UpdateStatus
  checking: boolean
  copy: SettingsCopy
  dataRoot: string
  dataDirectories: Record<'config' | 'database' | 'security' | 'logs' | 'temp' | 'downloads' | 'diagnostics' | 'runtime', string> | null
  onOpenData: () => void
  onCheck: () => Promise<void>
  onOpenUpdate: () => void
}) {
  const { appIconUrl } = useRuntime()
  const isChecking = checking || updateStatus.status === 'checking'
  const updateMessage = updateStatus.status === 'available'
    ? copy.updateAvailableFor(updateStatus.version ?? '-')
    : updateStatus.status === 'uptodate'
      ? copy.currentVersionIsLatest(updateStatus.version ?? version)
      : updateStatus.status === 'error'
        ? copy.updateCheckFailed
        : copy.updateDescription
  const updateButtonLabel = isChecking
    ? copy.checking
    : updateStatus.status === 'disabled'
      ? copy.checkUpdates
      : updateStatus.status === 'error'
        ? copy.retryUpdate
        : copy.checkAgain
  const rows = [
    [copy.application, application],
    [copy.version, version],
    [copy.platform, platform],
    [copy.runtime, runtime],
    [copy.mediaEngine, engine],
    [copy.applicationLicense, 'MIT']
  ]
  return (
    <div className="settings-about-content">
      <div className="settings-about-summary">
        <div className="settings-about-mark"><img src={appIconUrl ?? bundledAppIconUrl} alt="Aurora Player" className="aurora-icon-animated" /></div>
        <div className="settings-about-list">
          {rows.map(([label, detail]) => (
            <div className="settings-about-row" key={label}>
              <span>{label}</span>
              <strong>{detail}</strong>
            </div>
          ))}
        </div>
      </div>
      <section className={`settings-update-section ${updateStatus.status}`} aria-live="polite">
        <div className="settings-update-copy">
          <span className="settings-update-icon" aria-hidden="true">
            <Icon name={updateStatus.status === 'available' ? 'download' : updateStatus.status === 'error' ? 'alert' : updateStatus.status === 'uptodate' ? 'check' : 'refresh'} size={20} />
          </span>
          <div>
            <h3>{copy.softwareUpdate}</h3>
            <p>{updateMessage}</p>
          </div>
        </div>
        <div className="settings-update-actions">
          <button
            type="button"
            className="settings-button settings-update-button"
            onClick={() => void onCheck()}
            disabled={isChecking}
          >
            <Icon name="refresh" size={17} />
            {updateButtonLabel}
          </button>
          {updateStatus.status === 'available' && (
            <button type="button" className="settings-button settings-button-primary settings-update-button" onClick={onOpenUpdate}>
              <Icon name="download" size={17} />
              {copy.getUpdate}
            </button>
          )}
        </div>
      </section>
      <section className="settings-format-section" aria-labelledby="settings-format-title">
        <div className="settings-format-heading">
          <h3 id="settings-format-title">{copy.supportedFormats}</h3>
          <p>{copy.supportedFormatsDescription}</p>
        </div>
        <div className="settings-format-groups">
          <FormatGroup label={copy.videoFormats} extensions={MEDIA_VIDEO_EXTS} />
          <FormatGroup label={copy.audioFormats} extensions={MEDIA_AUDIO_EXTS} />
        </div>
        <p className="settings-format-note">{copy.embeddedSubtitleSupport}</p>
      </section>
      <section className="settings-data-section" aria-labelledby="settings-data-title">
        <div className="settings-data-heading">
          <div>
            <h3 id="settings-data-title">{copy.dataStorage}</h3>
            <p>{copy.dataStorageDescription}</p>
          </div>
          <button type="button" className="settings-button settings-data-open" onClick={onOpenData} disabled={!dataRoot}>
            <Icon name="folder" size={18} />
            {copy.openDataFolder}
          </button>
        </div>
        <div className="settings-data-root">
          <span>{copy.dataRoot}</span>
          <code title={dataRoot}>{dataRoot || '-'}</code>
        </div>
        <div className="settings-data-list">
          {dataDirectories && (Object.keys(copy.dataDirectories) as (keyof typeof copy.dataDirectories)[]).map((key) => (
            <div className="settings-data-row" key={key}>
              <div>
                <strong>{copy.dataDirectories[key][0]}</strong>
                <span>{copy.dataDirectories[key][1]}</span>
              </div>
              <code title={dataDirectories[key]}>{`data/${key}`}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function formatPlatform(platform?: string, arch?: string): string {
  const platformName = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform || '-'
  return arch ? `${platformName} · ${arch}` : platformName
}

function FormatGroup({ label, extensions }: { label: string; extensions: readonly string[] }) {
  return (
    <div className="settings-format-group">
      <div className="settings-format-group-title">
        <strong>{label}</strong>
        <span>{extensions.length}</span>
      </div>
      <div className="settings-format-list">
        {extensions.map((extension) => <code key={extension}>.{extension.toUpperCase()}</code>)}
      </div>
    </div>
  )
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">
          <span>{label}</span>
          {description && <SettingsHelp label={label} description={description} />}
        </span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function SettingsHelp({ label, description }: { label: string; description: string }) {
  return (
    <span className="settings-help">
      <button type="button" className="settings-help-trigger" aria-label={`${label}: ${description}`} title={description}>
        <Icon name="help" size={16} strokeWidth={1.8} />
      </button>
      <span className="settings-help-tooltip" role="tooltip">{description}</span>
    </span>
  )
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="settings-group-title">{title}</h3>
      <div className="settings-group-rows">{children}</div>
    </section>
  )
}

function SettingsSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      className={`settings-switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function SegmentedControl({ label, options, selected, onSelect }: { label: string; options: { value: string; label: string }[]; selected: string; onSelect: (selected: string) => void }) {
  return (
    <div className="settings-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button type="button" key={option.value} className={selected === option.value ? 'active' : ''} aria-pressed={selected === option.value} title={option.label} onClick={() => onSelect(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}
