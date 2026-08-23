import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRuntime, p } from '../core/runtime'
import { I } from '../../shared/channels'
import { Icon, type IconName } from '../core/icons'
import type { RemoteSource, RemoteSourceInput, RemoteEntry, MediaItem } from '../../shared/types'
import { formatBytes, MEDIA_EXTS } from '../../shared/types'
import { DownloadsPage } from './downloads'

const MEDIA_RE = new RegExp(`\\.(${MEDIA_EXTS.join('|')})$`, 'i')

type NetworkProtocol = 'http' | 'webdav' | 'smb' | 'ftp' | 'sftp'
type ProtocolFilter = 'all' | NetworkProtocol
type TestState = { kind: 'success' | 'error'; message: string } | null

const NETWORK_PROTOCOLS: Array<{ key: NetworkProtocol; label: string; port: number; icon: IconName; descriptionKey: string }> = [
  { key: 'http', label: 'HTTP/HTTPS', port: 443, icon: 'link', descriptionKey: 'protocolHttpDescription' },
  { key: 'webdav', label: 'WebDAV', port: 443, icon: 'language', descriptionKey: 'protocolWebdavDescription' },
  { key: 'smb', label: 'SMB', port: 445, icon: 'network', descriptionKey: 'protocolSmbDescription' },
  { key: 'ftp', label: 'FTP/FTPS', port: 21, icon: 'server', descriptionKey: 'protocolFtpDescription' },
  { key: 'sftp', label: 'SFTP', port: 22, icon: 'archive', descriptionKey: 'protocolSftpDescription' }
]

function protocolForSource(source: RemoteSource): NetworkProtocol {
  return source.protocol === 'ftps' ? 'ftp' : source.protocol as NetworkProtocol
}

function protocolInfo(protocol: NetworkProtocol) {
  return NETWORK_PROTOCOLS.find((item) => item.key === protocol) ?? NETWORK_PROTOCOLS[0]
}

function emptySourceInput(protocol: NetworkProtocol): RemoteSourceInput {
  return {
    name: '', protocol, host: '', port: 0, username: '', password: '', basePath: '',
    secure: protocol === 'http' || protocol === 'webdav',
    tlsMode: protocol === 'ftp' ? 'none' : undefined,
    domain: '', authMode: protocol === 'sftp' ? 'password' : undefined,
    privateKeyPath: '', rememberPassword: true, autoReconnect: true
  }
}

function sourceToInput(source: RemoteSource): RemoteSourceInput {
  return {
    name: source.name, protocol: source.protocol, host: source.host, port: source.port,
    username: source.username, password: '', basePath: source.basePath || '',
    secure: source.secure ?? ((source.protocol === 'http' || source.protocol === 'webdav') && source.port !== 80),
    tlsMode: source.protocol === 'ftps' ? source.tlsMode ?? 'explicit' : source.tlsMode ?? 'none',
    domain: source.domain || '', authMode: source.authMode ?? 'password',
    privateKeyPath: source.privateKeyPath || '', rememberPassword: source.hasPassword,
    autoReconnect: source.autoReconnect ?? true
  }
}

function sourceAddress(source: Pick<RemoteSource, 'protocol' | 'host' | 'port' | 'basePath' | 'secure' | 'tlsMode'>): string {
  const scheme = source.protocol === 'http' || source.protocol === 'webdav'
    ? (source.secure === false || source.port === 80 ? 'http' : 'https')
    : source.protocol === 'ftps' || source.tlsMode === 'explicit' || source.tlsMode === 'implicit' ? 'ftps' : source.protocol
  const port = new Set([80, 443, 445, 21, 22, 990]).has(source.port) ? '' : `:${source.port}`
  const path = source.basePath && source.basePath !== '/' ? `/${source.basePath.replace(/^\/+/, '')}` : ''
  return `${scheme}://${source.host}${port}${path}`
}

function fileIcon(name: string, media: boolean): IconName {
  if (!media) return 'file'
  if (/\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(name)) return 'image'
  if (/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma)$/i.test(name)) return 'music'
  return 'video'
}

export function RemotePage() {
  const { nav, navigate, sources } = useRuntime()
  const tab = nav.remoteTab ?? 'sources'
  if (tab === 'config') {
    const source = nav.sourceId == null ? undefined : sources.find((item) => item.id === nav.sourceId)
    const initialProtocol = nav.remoteProtocol ?? 'http'
    return <NetworkConfigurationPage source={source} initialProtocol={initialProtocol} onClose={() => navigate({ section: 'remote', remoteTab: 'sources' })} />
  }
  if (tab === 'browser') return <BrowserPage />
  if (tab === 'downloads') return <DownloadsPage networkContext onBack={() => navigate({ section: 'remote', remoteTab: 'sources' })} />
  return <NetworkSourcesPage />
}

function NetworkSourcesPage() {
  const { t, sources, deleteSource, toast, confirm, navigate } = useRuntime()
  const [filter, setFilter] = useState<ProtocolFilter>('all')
  const visibleSources = useMemo(() => filter === 'all' ? sources : sources.filter((source) => protocolForSource(source) === filter), [filter, sources])
  const usedProtocols = useMemo(() => new Set(sources.map(protocolForSource)).size, [sources])
  const credentialCount = useMemo(() => sources.filter((source) => source.hasPassword).length, [sources])

  const addConnection = (protocol: NetworkProtocol = filter === 'all' ? 'http' : filter) => {
    navigate({ section: 'remote', remoteTab: 'config', remoteProtocol: protocol })
  }
  const onDelete = async (source: RemoteSource) => {
    if (!await confirm(t('deleteConfirm'), source.name, { danger: true, confirmLabel: t('delete') })) return
    await deleteSource(source.id)
    toast('success', t('sourceDeletedNotification', { name: source.name }))
  }

  return (
    <main className="network-page network-v2 network-sources-page" aria-labelledby="network-title">
      <header className="network-v2-header">
        <div className="network-v2-heading">
          <div className="network-eyebrow">{t('yourNetwork')}</div>
          <h1 id="network-title">{t('networkMedia')}</h1>
          <p>{t('networkOverview')}</p>
        </div>
        <div className="network-header-actions">
          <button type="button" className="network-secondary-action" onClick={() => navigate({ section: 'remote', remoteTab: 'downloads' })}><Icon name="download" size={17} />{t('manageDownloads')}</button>
          <button type="button" className="network-primary-action" onClick={() => addConnection()}><Icon name="plus" size={18} />{t('addConnection')}</button>
        </div>
      </header>

      <section className="network-overview" aria-label={t('networkOverview')}>
        <NetworkMetric icon="server" value={sources.length} label={t('allConnections')} />
        <NetworkMetric icon="network" value={usedProtocols} label={t('activeProtocols')} />
        <NetworkMetric icon="archive" value={credentialCount} label={t('savedCredentials')} />
      </section>

      <nav className="network-filter-strip" aria-label={t('networkProtocol')}>
        <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          <span className="network-filter-icon"><Icon name="grid" size={18} /></span>
          <span><strong>{t('all')}</strong><small>{sources.length}</small></span>
        </button>
        {NETWORK_PROTOCOLS.map((entry) => {
          const count = sources.filter((source) => protocolForSource(source) === entry.key).length
          return (
            <button key={entry.key} type="button" className={filter === entry.key ? 'active' : ''} aria-pressed={filter === entry.key} onClick={() => setFilter(entry.key)}>
              <span className="network-filter-icon"><Icon name={entry.icon} size={18} /></span>
              <span><strong>{entry.label}</strong><small>{count}</small></span>
            </button>
          )
        })}
      </nav>

      <section className="network-source-section" aria-labelledby="configured-links-title">
        <div className="network-section-heading">
          <div>
            <h2 id="configured-links-title">{filter === 'all' ? t('configuredLinks') : protocolInfo(filter).label}</h2>
            <p>{filter === 'all' ? t('networkDescription') : t(protocolInfo(filter).descriptionKey)}</p>
          </div>
          <span>{visibleSources.length}</span>
        </div>
        {visibleSources.length > 0 ? (
          <div className="network-source-grid">
            {visibleSources.map((source) => (
              <NetworkSourceCard
                key={source.id}
                source={source}
                onOpen={() => navigate({ section: 'remote', remoteTab: 'browser', sourceId: source.id })}
                onEdit={() => navigate({ section: 'remote', remoteTab: 'config', sourceId: source.id })}
                onDelete={() => void onDelete(source)}
              />
            ))}
          </div>
        ) : (
          <div className="network-source-empty">
            <span><Icon name={filter === 'all' ? 'server' : protocolInfo(filter).icon} size={25} /></span>
            <div><strong>{t('noLinksConfigured', { protocol: filter === 'all' ? t('networkMedia') : protocolInfo(filter).label })}</strong><p>{filter === 'all' ? t('addConnectionDescription') : t(protocolInfo(filter).descriptionKey)}</p></div>
            <button type="button" className="network-primary-action" onClick={() => addConnection()}>{t('addConnection')}</button>
          </div>
        )}
      </section>
    </main>
  )
}

function NetworkMetric({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  return <div className="network-metric"><span><Icon name={icon} size={18} /></span><strong>{value}</strong><small>{label}</small></div>
}

function NetworkSourceCard({ source, onOpen, onEdit, onDelete }: { source: RemoteSource; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t } = useRuntime()
  const info = protocolInfo(protocolForSource(source))
  return (
    <article className="network-source-card" onDoubleClick={onOpen}>
      <div className="network-source-card-top">
        <span className="network-source-symbol"><Icon name={info.icon} size={22} /></span>
        <div className="network-source-title"><span>{info.label}</span><h3>{source.name}</h3></div>
        <div className="network-source-menu">
          <button type="button" title={t('editConnection')} aria-label={`${t('editConnection')}: ${source.name}`} onClick={onEdit}><Icon name="edit" size={17} /></button>
          <button type="button" title={t('deleteConnection')} aria-label={`${t('deleteConnection')}: ${source.name}`} onClick={onDelete}><Icon name="trash" size={17} /></button>
        </div>
      </div>
      <p className="network-source-address" title={sourceAddress(source)}>{sourceAddress(source)}</p>
      <div className="network-source-meta">
        <span><Icon name="check" size={12} />{t('connectionReady')}</span>
        <span>{source.hasPassword ? t('savedCredentials') : t('optionalField')}</span>
        <span>{source.autoReconnect === false ? t('manualReconnect') : t('automaticReconnect')}</span>
      </div>
      <button type="button" className="network-open-source" onClick={onOpen}><span>{t('openConnection')}</span><Icon name="chevronRight" size={16} /></button>
    </article>
  )
}

function NetworkConfigurationPage({ source, initialProtocol, onClose }: { source?: RemoteSource; initialProtocol: NetworkProtocol; onClose: () => void }) {
  const { t, saveSource, testSource, toast } = useRuntime()
  const [form, setForm] = useState<RemoteSourceInput>(() => source ? sourceToInput(source) : emptySourceInput(initialProtocol))
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [testState, setTestState] = useState<TestState>(null)
  const protocol = form.protocol === 'ftps' ? 'ftp' : form.protocol as NetworkProtocol
  const info = protocolInfo(protocol)

  const selectProtocol = (next: NetworkProtocol) => {
    setForm((current) => ({ ...emptySourceInput(next), name: current.name }))
    setErrors({})
    setTestState(null)
    setShowPassword(false)
  }
  const change = (key: keyof RemoteSourceInput, value: string | number | boolean) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setTestState(null)
  }
  const validate = () => {
    const next: Record<string, string> = {}
    if (!form.name.trim()) next.name = t('requiredField')
    if (!form.host.trim()) next.host = t('requiredField')
    if (form.port && (form.port < 1 || form.port > 65535)) next.port = '1-65535'
    if (protocol === 'smb' && !form.basePath.trim()) next.basePath = t('shareNameRequired')
    if (protocol === 'sftp' && form.authMode === 'privateKey' && !form.privateKeyPath?.trim()) next.privateKeyPath = t('privateKeyPathRequired')
    setErrors(next)
    return Object.keys(next).length === 0
  }
  const onTest = async () => {
    if (!validate()) {
      setTestState({ kind: 'error', message: t('testFailed') })
      return
    }
    setTesting(true)
    setTestState(null)
    try {
      const result = await testSource(form, source?.id)
      if (result?.ok && result.secure === false && form.secure !== false) {
        setForm((current) => ({ ...current, secure: false }))
        setTestState({ kind: 'success', message: t('connectionOkHttpDetected') })
      } else if (result?.ok) {
        setTestState({ kind: 'success', message: t('testSuccessful') })
      } else {
        const message = result?.errorKind ? t(`remoteError.${result.errorKind}`) : result?.error || t('testFailed')
        setTestState({ kind: 'error', message })
      }
    } catch (error) {
      setTestState({ kind: 'error', message: error instanceof Error ? error.message : t('connectionFailed') })
    } finally {
      setTesting(false)
    }
  }
  const onSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      if (await saveSource(form, source?.id)) onClose()
    } catch (error) {
      toast('error', error instanceof Error ? error.message : t('connectionFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="network-page network-v2 network-config-v2" aria-labelledby="network-config-title">
      <header className="network-v2-header network-config-v2-header">
        <div className="network-v2-heading">
          <button type="button" className="network-back-button-v2" onClick={onClose}><Icon name="chevronLeft" size={17} />{t('backToConnections')}</button>
          <h1 id="network-config-title">{source ? t('editNetworkMedia') : t('addNetworkMedia')}</h1>
          <p>{source ? t('editConnectionDescription') : t('addConnectionDescription')}</p>
        </div>
        <span className="network-edit-state">{source ? t('editing') : t('newConnection')}</span>
      </header>

      <div className="network-config-workspace">
        <aside className="network-protocol-rail" aria-label={t('networkProtocol')}>
          <div className="network-rail-heading">{t('networkProtocol')}</div>
          {NETWORK_PROTOCOLS.map((entry) => (
            <button key={entry.key} type="button" className={protocol === entry.key ? 'active' : ''} aria-pressed={protocol === entry.key} onClick={() => selectProtocol(entry.key)}>
              <span><Icon name={entry.icon} size={19} /></span>
              <span><strong>{entry.label}</strong><small>{t('defaultPort', { port: entry.port })}</small></span>
              <Icon name="chevronRight" size={14} />
            </button>
          ))}
          <div className="network-protocol-note"><span><Icon name={info.icon} size={18} /></span><p>{t(info.descriptionKey)}</p></div>
        </aside>

        <form className="network-config-form-v2" onSubmit={(event) => { event.preventDefault(); void onSave() }}>
          <NetworkFormSection icon="edit" title={t('connectionIdentity')}>
            <NetworkField label={t('connectionName')} required error={errors.name}>
              <input aria-invalid={!!errors.name} value={form.name} onChange={(event) => change('name', event.target.value)} placeholder={t('connectionNamePlaceholder')} />
            </NetworkField>
          </NetworkFormSection>

          <NetworkFormSection icon="server" title={t('serverAndPath')}>
            <div className="network-field-grid network-field-grid-address">
              <NetworkField label={t('serverAddress')} required error={errors.host}>
                <input aria-invalid={!!errors.host} value={form.host} onChange={(event) => updateServerAddress(event.target.value, form, change)} placeholder={t('serverAddressPlaceholder')} />
              </NetworkField>
              <NetworkField label={t('port')} error={errors.port} hint={t('defaultPort', { port: info.port })}>
                <input aria-invalid={!!errors.port} type="number" min={1} max={65535} value={form.port || ''} onChange={(event) => change('port', Number(event.target.value))} placeholder={`${protocol === 'ftp' && form.tlsMode === 'implicit' ? 990 : info.port}`} />
              </NetworkField>
            </div>
            <NetworkField label={protocol === 'smb' ? t('shareName') : t('remotePath')} required={protocol === 'smb'} error={errors.basePath} hint={protocol === 'smb' ? t('shareNameRequired') : t('optionalField')}>
              <input aria-invalid={!!errors.basePath} value={form.basePath} onChange={(event) => change('basePath', event.target.value)} placeholder={protocol === 'smb' ? t('shareNamePlaceholder') : t('remotePathPlaceholder')} />
            </NetworkField>
            {(protocol === 'http' || protocol === 'webdav') && <NetworkOption checked={form.secure !== false} label={protocol === 'webdav' ? t('secureWebDav') : t('useHttps')} helper={protocol === 'webdav' ? t('secureWebDavDescription') : t('useHttpsDescription')} onChange={(checked) => updateSecureTransport(checked, form, change)} />}
            {protocol === 'ftp' && (
              <NetworkField label={t('encryption')}>
                <select value={form.tlsMode ?? 'none'} onChange={(event) => updateTlsMode(event.target.value, form, change)}>
                  <option value="none">{t('ftpUnencrypted')}</option>
                  <option value="explicit">{t('ftpExplicitTls')}</option>
                  <option value="implicit">{t('ftpImplicitTls')}</option>
                </select>
              </NetworkField>
            )}
          </NetworkFormSection>

          <NetworkFormSection icon="archive" title={t('credentialsAndAccess')}>
            {protocol === 'sftp' && (
              <NetworkField label={t('authentication')}>
                <select value={form.authMode ?? 'password'} onChange={(event) => change('authMode', event.target.value)}>
                  <option value="password">{t('passwordAuthentication')}</option>
                  <option value="privateKey">{t('privateKeyAuthentication')}</option>
                </select>
              </NetworkField>
            )}
            <div className="network-field-grid">
              <NetworkField label={t('username')} hint={t('optionalField')}><input value={form.username} onChange={(event) => change('username', event.target.value)} placeholder={t('usernamePlaceholder')} autoComplete="username" /></NetworkField>
              {protocol === 'smb' && <NetworkField label={t('domain')} hint={t('optionalField')}><input value={form.domain || ''} onChange={(event) => change('domain', event.target.value)} placeholder={t('domainPlaceholder')} /></NetworkField>}
            </div>
            {protocol === 'sftp' && form.authMode === 'privateKey' && <NetworkField label={t('privateKeyPath')} required error={errors.privateKeyPath}><input aria-invalid={!!errors.privateKeyPath} value={form.privateKeyPath || ''} onChange={(event) => change('privateKeyPath', event.target.value)} placeholder={t('privateKeyPathPlaceholder')} /></NetworkField>}
            <NetworkField label={protocol === 'sftp' && form.authMode === 'privateKey' ? t('privateKeyPassphrase') : t('password')} hint={source?.hasPassword && !form.password ? t('savedPasswordHint') : t('optionalField')}>
              <span className="network-password-input-v2">
                <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => change('password', event.target.value)} placeholder={source?.hasPassword && !form.password ? t('savedPasswordPlaceholder') : t('passwordPlaceholder')} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? t('hidePassword') : t('showPassword')}><Icon name="eye" size={18} /></button>
              </span>
            </NetworkField>
          </NetworkFormSection>

          <NetworkFormSection icon="sliders" title={t('connectionBehavior')} compact>
            <div className="network-option-grid-v2">
              <NetworkOption checked={form.rememberPassword !== false} label={t('rememberPassword')} helper={t('storeCredentials')} onChange={(checked) => change('rememberPassword', checked)} />
              <NetworkOption checked={form.autoReconnect !== false} label={t('autoReconnect')} helper={t('reconnectOnPlayback')} onChange={(checked) => change('autoReconnect', checked)} />
            </div>
          </NetworkFormSection>

          {testState && <div className={`network-test-result ${testState.kind}`} role={testState.kind === 'error' ? 'alert' : 'status'}><Icon name={testState.kind === 'success' ? 'check' : 'alert'} size={17} /><span>{testState.message}</span></div>}
          <footer className="network-form-footer-v2">
            <button type="button" className="network-cancel-button-v2" onClick={onClose}>{t('cancel')}</button>
            <button type="button" className="network-test-button-v2" disabled={testing || saving} onClick={() => void onTest()}>{testing && <span className="spin"><Icon name="refresh" size={15} /></span>}{testing ? t('testingConnection') : t('testConnection')}</button>
            <button type="submit" className="network-save-button-v2" disabled={testing || saving}>{t('saveConnection')}</button>
          </footer>
        </form>
      </div>
    </main>
  )
}

function updateSecureTransport(checked: boolean, form: RemoteSourceInput, change: (key: keyof RemoteSourceInput, value: string | number | boolean) => void) {
  change('secure', checked)
  if (form.port === 80 || form.port === 443 || form.port === 0) change('port', checked ? 443 : 80)
}
function updateServerAddress(value: string, form: RemoteSourceInput, change: (key: keyof RemoteSourceInput, value: string | number | boolean) => void) {
  change('host', value)
  const match = value.trim().match(/^(https?):\/\//i)
  if (!match) return
  const secure = match[1].toLowerCase() === 'https'
  change('secure', secure)
  if (form.port === 0 || form.port === 80 || form.port === 443) change('port', secure ? 443 : 80)
}
function updateTlsMode(value: string, form: RemoteSourceInput, change: (key: keyof RemoteSourceInput, value: string | number | boolean) => void) {
  const tlsMode = value as 'none' | 'explicit' | 'implicit'
  change('tlsMode', tlsMode)
  change('protocol', tlsMode === 'none' ? 'ftp' : 'ftps')
  if (form.port === 21 || form.port === 990 || form.port === 0) change('port', tlsMode === 'implicit' ? 990 : 21)
}

function NetworkFormSection({ icon, title, compact = false, children }: { icon: IconName; title: string; compact?: boolean; children: React.ReactNode }) {
  return <section className={`network-form-section-v2 ${compact ? 'compact' : ''}`}><header><span><Icon name={icon} size={17} /></span><h2>{title}</h2></header><div className="network-form-section-body">{children}</div></section>
}
function NetworkField({ label, hint, error, required = false, children }: { label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return <label className={`network-field-v2 ${error ? 'has-error' : ''}`}><span className="network-field-label"><strong>{label}</strong><small>{required ? '*' : hint}</small></span>{children}{error && <span className="network-field-error">{error}</span>}</label>
}
function NetworkOption({ checked, label, helper, onChange }: { checked: boolean; label: string; helper: string; onChange: (checked: boolean) => void }) {
  return <label className="network-option-v2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="network-switch-v2"><span /></span><span><strong>{label}</strong><small>{helper}</small></span></label>
}

const browserPathMemory = new Map<number, string>()
type CollectedRemoteFile = { path: string; name: string; size: number; relativePath: string }

function BrowserPage() {
  const { t, settings, sources, nav, navigate, browseSource, addRemoteMedia, startDownload, toast, play } = useRuntime()
  const source = sources.find((item) => item.id === nav.sourceId) ?? null
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expandedProtocols, setExpandedProtocols] = useState<Set<NetworkProtocol>>(() => source ? new Set([protocolForSource(source)]) : new Set())
  const [expandedSources, setExpandedSources] = useState<Set<number>>(() => source ? new Set([source.id]) : new Set())
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(new Set())
  const [treeDirectories, setTreeDirectories] = useState<Map<string, RemoteEntry[]>>(new Map())
  const [treeLoading, setTreeLoading] = useState<Set<string>>(new Set())
  const requestId = useRef(0)
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(settings?.language === 'zh' ? 'zh-CN' : 'en-US'), [settings?.language])

  const load = useCallback(async (targetPath: string) => {
    if (!source) return
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(null)
    const result = await browseSource(source.id, targetPath)
    if (currentRequest !== requestId.current) return
    setLoading(false)
    if (result == null) {
      setError(t('sourceUnavailable'))
      return
    }
    setEntries(result)
    setPath(targetPath)
    browserPathMemory.set(source.id, targetPath)
    setTreeDirectories((current) => {
      const next = new Map(current)
      next.set(`${source.id}:${targetPath}`, result.filter((entry) => entry.isDirectory))
      return next
    })
    const pathParts = targetPath.split('/').filter(Boolean)
    if (pathParts.length > 1) {
      let ancestor = ''
      setExpandedTreePaths((current) => {
        const next = new Set(current)
        for (const part of pathParts.slice(0, -1)) { ancestor += `/${part}`; next.add(`${source.id}:${ancestor}`) }
        return next
      })
    }
    setSelected(new Set())
    setQuery('')
  }, [browseSource, source, t])

  useEffect(() => {
    requestId.current += 1
    setEntries(null)
    setPath('/')
    setSelected(new Set())
    if (source) {
      setExpandedProtocols(new Set([protocolForSource(source)]))
      setExpandedSources(new Set([source.id]))
      const rememberedPath = browserPathMemory.get(source.id) ?? '/'
      void load(rememberedPath)
      if (rememberedPath !== '/') void revealTreePath(source.id, rememberedPath)
    }
  }, [source?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleProtocolTree = (protocol: NetworkProtocol) => {
    setExpandedProtocols((current) => {
      const next = new Set(current)
      if (next.has(protocol)) next.delete(protocol)
      else next.add(protocol)
      return next
    })
  }

  const openSource = (sourceId: number) => {
    if (sourceId === source?.id) void load(browserPathMemory.get(sourceId) ?? '/')
    else navigate({ section: 'remote', remoteTab: 'browser', sourceId })
  }

  const treeKey = (sourceId: number, targetPath: string) => `${sourceId}:${targetPath}`
  const loadTreeDirectories = useCallback(async (sourceId: number, targetPath: string) => {
    const key = treeKey(sourceId, targetPath)
    if (treeDirectories.has(key) || treeLoading.has(key)) return
    setTreeLoading((current) => new Set(current).add(key))
    const result = await browseSource(sourceId, targetPath)
    setTreeLoading((current) => { const next = new Set(current); next.delete(key); return next })
    if (result == null) return
    setTreeDirectories((current) => {
      const next = new Map(current)
      next.set(key, result.filter((entry) => entry.isDirectory))
      return next
    })
  }, [browseSource, treeDirectories, treeLoading])

  const revealTreePath = async (sourceId: number, targetPath: string) => {
    const parts = targetPath.split('/').filter(Boolean)
    let current = '/'
    await loadTreeDirectories(sourceId, current)
    for (const part of parts) {
      setExpandedTreePaths((paths) => new Set(paths).add(treeKey(sourceId, current)))
      current = current === '/' ? `/${part}` : `${current}/${part}`
      await loadTreeDirectories(sourceId, current)
    }
  }

  const toggleSourceTree = (candidate: RemoteSource) => {
    const opening = !expandedSources.has(candidate.id)
    setExpandedSources((current) => { const next = new Set(current); if (opening) next.add(candidate.id); else next.delete(candidate.id); return next })
    if (opening) void loadTreeDirectories(candidate.id, '/')
  }

  const toggleDirectoryTree = (sourceId: number, targetPath: string) => {
    const key = treeKey(sourceId, targetPath)
    const opening = !expandedTreePaths.has(key)
    setExpandedTreePaths((current) => { const next = new Set(current); if (opening) next.add(key); else next.delete(key); return next })
    if (opening) void loadTreeDirectories(sourceId, targetPath)
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return normalized ? (entries ?? []).filter((entry) => entry.name.toLocaleLowerCase().includes(normalized)) : entries ?? []
  }, [entries, query])
  const dirs = useMemo(() => filtered.filter((entry) => entry.isDirectory), [filtered])
  const files = useMemo(() => filtered.filter((entry) => !entry.isDirectory), [filtered])
  const allFiles = useMemo(() => (entries ?? []).filter((entry) => !entry.isDirectory), [entries])
  const selectedFiles = useMemo(() => allFiles.filter((entry) => selected.has(entry.name)), [allFiles, selected])
  const selectedMedia = useMemo(() => selectedFiles.filter((entry) => MEDIA_RE.test(entry.name)), [selectedFiles])
  const entryPath = (name: string) => path.endsWith('/') ? path + name : `${path}/${name}`
  const enterDir = (directory: RemoteEntry) => void load(entryPath(directory.name))
  const goUp = () => {
    if (path === '/') return
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    void load(parts.length ? `/${parts.join('/')}` : '/')
  }
  const toggleSelect = (name: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })
  const toggleAll = () => setSelected(allFiles.length > 0 && selected.size === allFiles.length ? new Set() : new Set(allFiles.map((entry) => entry.name)))
  const playRemote = async (file: RemoteEntry) => {
    if (!source || !MEDIA_RE.test(file.name)) return
    const remotePath = entryPath(file.name)
    await addRemoteMedia(source.id, [{ path: remotePath, name: file.name, size: file.size }])
    const library = await p<MediaItem[]>(I.libraryGet)
    const item = library.find((entry) => entry.sourceId === source.id && entry.remotePath === remotePath)
    if (item) void play([item.id], 0)
  }
  const collectDirectoryFiles = async (directoryPath: string, rootName: string): Promise<CollectedRemoteFile[]> => {
    if (!source) return []
    const collected: CollectedRemoteFile[] = []
    const pending = [{ remotePath: directoryPath, relativePath: rootName }]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const current = pending.shift()!
      if (visited.has(current.remotePath)) continue
      visited.add(current.remotePath)
      const children = await browseSource(source.id, current.remotePath)
      if (children == null) continue
      for (const child of children) {
        const childPath = current.remotePath.endsWith('/') ? current.remotePath + child.name : `${current.remotePath}/${child.name}`
        const childRelativePath = `${current.relativePath}/${child.name}`
        if (child.isDirectory) pending.push({ remotePath: childPath, relativePath: childRelativePath })
        else collected.push({ path: childPath, name: child.name, size: child.size, relativePath: childRelativePath })
      }
    }
    return collected
  }
  const importDirectory = async (directory: RemoteEntry) => {
    if (!source) return
    const files = (await collectDirectoryFiles(entryPath(directory.name), directory.name)).filter((file) => MEDIA_RE.test(file.name))
    if (files.length === 0) { toast('info', t('directoryNoMediaNotification', { name: directory.name })); return }
    await addRemoteMedia(source.id, files.map((file) => ({ path: file.path, name: file.name, size: file.size })), false)
    toast('success', t('directoryImportedNotification', { name: directory.name, count: files.length }))
  }
  const downloadDirectory = async (directory: RemoteEntry) => {
    if (!source) return
    const files = await collectDirectoryFiles(entryPath(directory.name), directory.name)
    for (const file of files) await startDownload(source.id, file.path, file.relativePath, false)
    toast(files.length > 0 ? 'success' : 'info', files.length > 0 ? t('directoryDownloadQueuedNotification', { name: directory.name, count: files.length }) : t('directoryEmptyNotification', { name: directory.name }))
    if (files.length > 0) navigate({ section: 'remote', remoteTab: 'downloads' })
  }
  const importSelected = async () => {
    if (!source || selectedMedia.length === 0) return
    await addRemoteMedia(source.id, selectedMedia.map((file) => ({ path: entryPath(file.name), name: file.name, size: file.size })))
    setSelected(new Set())
  }
  const downloadSelected = async () => {
    if (!source) return
    for (const file of selectedFiles) await startDownload(source.id, entryPath(file.name), undefined, false)
    toast('success', t('filesDownloadQueuedNotification', { count: selectedFiles.length }))
    navigate({ section: 'remote', remoteTab: 'downloads' })
  }
  const crumbs = useMemo(() => {
    const result: { label: string; path: string }[] = []
    let current = ''
    for (const part of path.split('/').filter(Boolean)) {
      current += `/${part}`
      result.push({ label: part, path: current })
    }
    return result
  }, [path])

  const renderTreeDirectories = (candidate: RemoteSource, parentPath: string, depth = 0): React.ReactNode => {
    const key = treeKey(candidate.id, parentPath)
    const directories = treeDirectories.get(key)
    if (treeLoading.has(key) && !directories) return <div className="network-tree-loading" style={{ '--tree-indent': `${Math.min(depth * 10, 40)}px` } as React.CSSProperties}>{t('loading')}</div>
    return directories?.map((directory) => {
      const directoryPath = parentPath === '/' ? `/${directory.name}` : `${parentPath}/${directory.name}`
      const directoryKey = treeKey(candidate.id, directoryPath)
      const expanded = expandedTreePaths.has(directoryKey)
      const active = candidate.id === source?.id && path === directoryPath
      return <React.Fragment key={directoryKey}>
        <div className={`network-tree-directory ${active ? 'active' : ''}`} style={{ '--tree-indent': `${Math.min(depth * 10, 40)}px` } as React.CSSProperties}>
          <button type="button" className="network-tree-expand" aria-label={t('expand')} aria-expanded={expanded} onClick={() => toggleDirectoryTree(candidate.id, directoryPath)}><Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={11} /></button>
          <button type="button" className="network-tree-open" onClick={() => { browserPathMemory.set(candidate.id, directoryPath); if (candidate.id === source?.id) void load(directoryPath); else navigate({ section: 'remote', remoteTab: 'browser', sourceId: candidate.id }) }}><Icon name="folder" size={13} /><span>{directory.name}</span></button>
        </div>
        {expanded && renderTreeDirectories(candidate, directoryPath, depth + 1)}
      </React.Fragment>
    })
  }

  if (!source) {
    return <main className="network-page network-v2 network-browser-v2"><div className="network-browser-empty"><Icon name="server" size={28} /><h2>{t('sourceUnavailable')}</h2><button type="button" className="network-primary-action" onClick={() => navigate({ section: 'remote', remoteTab: 'sources' })}>{t('backToConnections')}</button></div></main>
  }
  const info = protocolInfo(protocolForSource(source))
  return (
    <main className="network-page network-v2 network-browser-v2" aria-labelledby="network-browser-title">
      <header className="network-browser-header">
        <button type="button" className="network-back-button-v2" onClick={() => navigate({ section: 'remote', remoteTab: 'sources' })}><Icon name="chevronLeft" size={17} />{t('backToConnections')}</button>
        <div className="network-browser-source"><span><Icon name={info.icon} size={22} /></span><div><small>{t('browsingSource', { name: source.name })}</small><h1 id="network-browser-title">{source.name}</h1><p>{sourceAddress(source)}</p></div></div>
        <button type="button" className="network-secondary-action" onClick={() => navigate({ section: 'remote', remoteTab: 'config', sourceId: source.id })}><Icon name="edit" size={16} />{t('editSettings')}</button>
      </header>

      <div className="network-browser-workspace">
        <aside className="network-source-tree" aria-label={t('configuredLinks')}>
          <div className="network-source-tree-title"><Icon name="cast" size={16} /><span>{t('configuredLinks')}</span></div>
          {NETWORK_PROTOCOLS.map((protocol) => {
            const protocolSources = sources.filter((candidate) => protocolForSource(candidate) === protocol.key)
            if (protocolSources.length === 0) return null
            const expanded = expandedProtocols.has(protocol.key)
            return (
              <section key={protocol.key} className={`network-source-tree-group ${expanded ? 'expanded' : ''}`}>
                <button type="button" className="network-source-tree-protocol" aria-expanded={expanded} onClick={() => toggleProtocolTree(protocol.key)}>
                  <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
                  <span className="network-source-tree-protocol-icon"><Icon name={protocol.icon} size={15} /></span>
                  <strong>{protocol.label}</strong><small>{protocolSources.length}</small>
                </button>
                {expanded && <div className="network-source-tree-links">
                  {protocolSources.map((candidate) => {
                    const active = candidate.id === source.id
                    const sourceExpanded = expandedSources.has(candidate.id)
                    return <div key={candidate.id} className={`network-source-tree-link ${active ? 'active' : ''}`}>
                      <div className="network-source-tree-link-row">
                        <button type="button" className="network-tree-expand" aria-label={t('expand')} aria-expanded={sourceExpanded} onClick={() => toggleSourceTree(candidate)}><Icon name={sourceExpanded ? 'chevronDown' : 'chevronRight'} size={11} /></button>
                        <button type="button" className="network-tree-open" onClick={() => openSource(candidate.id)} title={sourceAddress(candidate)}><Icon name="server" size={14} /><span>{candidate.name}</span></button>
                      </div>
                      {sourceExpanded && <div className="network-source-current-path">{renderTreeDirectories(candidate, '/', 0)}</div>}
                    </div>
                  })}
                </div>}
              </section>
            )
          })}
        </aside>

      <section className="network-browser-shell">
        <div className="network-browser-toolbar">
          <div className="network-breadcrumbs" aria-label={t('remotePath')}>
            {crumbs.map((crumb, index) => <React.Fragment key={crumb.path}>{index > 0 && <Icon name="chevronRight" size={12} />}<button type="button" onClick={() => void load(crumb.path)}>{crumb.label}</button></React.Fragment>)}
          </div>
          <label className="network-browser-search"><Icon name="search" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('browserSearchPlaceholder')} /></label>
          <button type="button" className="network-toolbar-button" disabled={path === '/'} title={t('up')} onClick={goUp}><Icon name="up" size={16} /></button>
          <button type="button" className="network-toolbar-button" title={t('refresh')} onClick={() => void load(path)}><Icon name="refresh" size={16} /></button>
        </div>

        <div className="network-browser-summary">
          <span>{t('foldersCount', { count: (entries ?? []).filter((entry) => entry.isDirectory).length })}</span>
          <span>{t('filesCount', { count: allFiles.length })}</span>
          <button type="button" disabled={allFiles.length === 0} onClick={toggleAll}><Icon name={allFiles.length > 0 && selected.size === allFiles.length ? 'check' : 'plus'} size={13} />{t('selectAllFiles')}</button>
        </div>

        <div className="network-file-table">
          <div className="network-file-head"><span>{t('nameColumn')}</span><span>{t('sizeColumn')}</span><span>{t('modifiedColumn')}</span><span /></div>
          {loading && <NetworkBrowserSkeleton />}
          {!loading && error && (
            <div className="network-browser-error" role="alert">
              <span><Icon name="alert" size={22} /></span><div><strong>{error}</strong><p>{t('browserConnectionHint')}</p></div>
              <button type="button" className="network-secondary-action" onClick={() => void load(path)}>{t('retryConnection')}</button>
              <button type="button" className="network-quiet-action" onClick={() => navigate({ section: 'remote', remoteTab: 'config', sourceId: source.id })}>{t('editSettings')}</button>
            </div>
          )}
          {!loading && !error && dirs.map((directory) => (
            <div key={`d-${directory.name}`} className="network-file-row directory" onClick={() => enterDir(directory)}>
              <span className="network-file-name"><span className="network-file-icon"><Icon name="folder" size={18} /></span><strong>{directory.name}</strong></span><span>-</span><span>{directory.modifiedAt ? dateFormatter.format(new Date(directory.modifiedAt)) : '-'}</span>
              <span className="network-file-actions">
                <button type="button" title={t('addDirectoryToLibrary')} onClick={(event) => { event.stopPropagation(); void importDirectory(directory) }}><Icon name="library" size={15} /></button>
                <button type="button" title={t('downloadDirectory')} onClick={(event) => { event.stopPropagation(); void downloadDirectory(directory) }}><Icon name="download" size={15} /></button>
                <button type="button" title={t('open')} onClick={(event) => { event.stopPropagation(); enterDir(directory) }}><Icon name="chevronRight" size={16} /></button>
              </span>
            </div>
          ))}
          {!loading && !error && files.map((file) => {
            const media = MEDIA_RE.test(file.name)
            const checked = selected.has(file.name)
            return (
              <div key={`f-${file.name}`} className={`network-file-row ${checked ? 'selected' : ''}`} onClick={() => toggleSelect(file.name)} onDoubleClick={() => void playRemote(file)}>
                <span className="network-file-name">
                  <span className="network-file-icon"><Icon name={fileIcon(file.name, media)} size={18} /></span><strong title={file.name}>{file.name}</strong>
                </span>
                <span>{formatBytes(file.size)}</span><span>{file.modifiedAt ? dateFormatter.format(new Date(file.modifiedAt)) : '-'}</span>
                <span className="network-file-actions">
                  {media && <button type="button" title={t('play')} onClick={(event) => { event.stopPropagation(); void playRemote(file) }}><Icon name="play" size={15} /></button>}
                  <button type="button" title={t('download')} onClick={(event) => { event.stopPropagation(); void startDownload(source.id, entryPath(file.name)) }}><Icon name="download" size={15} /></button>
                </span>
              </div>
            )
          })}
          {!loading && !error && entries?.length === 0 && <div className="network-file-empty"><Icon name="folder" size={24} /><strong>{t('emptySource')}</strong></div>}
          {!loading && !error && entries && entries.length > 0 && filtered.length === 0 && <div className="network-file-empty"><Icon name="search" size={24} /><strong>{t('noFolderMatches')}</strong></div>}
        </div>
      </section>
      </div>

      {selectedFiles.length > 0 && (
        <div className="network-selection-bar">
          <span>{t('selectedCount', { count: selectedFiles.length })}</span>
          <button type="button" className="network-quiet-action" onClick={() => setSelected(new Set())}>{t('cancel')}</button>
          <button type="button" className="network-secondary-action" disabled={selectedMedia.length === 0} onClick={() => void importSelected()}><Icon name="library" size={16} />{t('addSelectedToLibrary')}</button>
          <button type="button" className="network-primary-action" onClick={() => void downloadSelected()}><Icon name="download" size={16} />{t('downloadSelected')}</button>
        </div>
      )}
    </main>
  )
}

function NetworkBrowserSkeleton() {
  return <div className="network-browser-skeleton" aria-hidden>{[0, 1, 2, 3, 4].map((item) => <div key={item}><span /><span /><span /></div>)}</div>
}
