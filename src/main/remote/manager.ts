import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { I, E } from '../../shared/channels'
import type { RemoteSource, RemoteSourceInput, RemoteEntry } from '../../shared/types'
import { nextId, randomToken } from '../util'
import { CredentialStore } from './credentials'
import { createAdapter, isTlsProtocolMismatch, RemoteError, type IRemoteAdapter, type AdapterAccess, type RemoteErrorKind } from './adapters'
import { Logger } from '../system/diagnostics'

export class RemoteSourceManager {
  private sources: RemoteSource[] = []
  private adapters = new Map<number, IRemoteAdapter>()
  private token: string

  constructor(
    private sourcesFile: string,
    private credentials: CredentialStore,
    private logger: Logger,
    private broadcast: (channel: string, payload: unknown) => void
  ) {
    this.sources = this.loadSources()
    this.token = randomToken()
  }

  get streamToken(): string {
    return this.token
  }

  init(): void {
    ipcMain.handle(I.sourcesList, async () => {
      await this.refreshCredentialFlags()
      return this.sources
    })
    ipcMain.handle(I.sourceSave, async (_e, input: RemoteSourceInput, id?: number | null) => {
      return this.saveSource(input, id)
    })
    ipcMain.handle(I.sourceRemove, async (_e, id: number) => {
      this.sources = this.sources.filter((s) => s.id !== id)
      await this.credentials.remove(`aurora:source:${id}`)
      this.persist()
      return true
    })
    ipcMain.handle(I.sourceTest, (_e, input: RemoteSourceInput, id?: number | null) => this.testConnection(input, id))
    ipcMain.handle(I.sourceBrowse, (_e, sourceId: number, path: string) => this.browse(sourceId, path))
  }

  listSources(): RemoteSource[] {
    return this.sources
  }

  getSource(id: number): RemoteSource | undefined {
    return this.sources.find((s) => s.id === id)
  }

  private persist(): void {
    const snapshot = this.sources.map((source) => ({ ...source }))
    this.sources = snapshot
    try {
      fs.mkdirSync(path.dirname(this.sourcesFile), { recursive: true })
      fs.writeFileSync(this.sourcesFile, JSON.stringify(snapshot, null, 2), 'utf8')
    } catch (error) {
      this.logger.error('remote', 'cannot persist remote sources', error as Error)
    }
    this.broadcast(E.sourcesChanged, snapshot)
  }

  private loadSources(): RemoteSource[] {
    try {
      const value = JSON.parse(fs.readFileSync(this.sourcesFile, 'utf8')) as unknown
      return Array.isArray(value) ? value.filter((item): item is RemoteSource => !!item && typeof item === 'object' && Number.isFinite((item as RemoteSource).id)) : []
    } catch {
      return []
    }
  }

  reloadNetworkSettings(): void {
    for (const source of this.sources) this.disposeAdapter(source.id)
  }

  private async refreshCredentialFlags(): Promise<void> {
    let changed = false
    for (const source of this.sources) {
      if (!source.hasPassword) continue
      const password = await this.credentials.read(`aurora:source:${source.id}`, true)
      if (!password) {
        source.hasPassword = false
        changed = true
      }
    }
    if (changed) this.persist()
  }

  private async resolveAccess(input: RemoteSourceInput, id: number): Promise<AdapterAccess> {
    const password = await this.credentials.read(`aurora:source:${id}`, true)
    const normalized = normalizeHost(input.host)
    const secure = normalized.secure ?? input.secure
    return {
      protocol: input.protocol,
      host: normalized.host,
      port: normalized.port || input.port || defaultPort(input.protocol, secure),
      username: input.username,
      password: input.password || password || '',
      basePath: input.basePath || normalized.basePath || '',
      secure,
      tlsMode: input.tlsMode,
      domain: input.domain || '',
      authMode: input.authMode,
      privateKeyPath: input.privateKeyPath || ''
    }
  }

  private async saveSource(input: RemoteSourceInput, id?: number | null): Promise<RemoteSource> {
    const normalized = normalizeHost(input.host)
    const secure = normalized.secure ?? input.secure
    const port = normalized.port || input.port || defaultPort(input.protocol, secure)
    const basePath = input.basePath || normalized.basePath || ''
    if (id != null) {
      const existing = this.sources.find((s) => s.id === id)
      if (!existing) return Promise.reject(new Error('source not found'))
      existing.name = input.name
      existing.protocol = input.protocol
      existing.host = normalized.host
      existing.port = port
      existing.username = input.username
      existing.basePath = basePath
      existing.secure = secure
      existing.tlsMode = input.tlsMode
      existing.domain = input.domain || ''
      existing.authMode = input.authMode
      existing.privateKeyPath = input.privateKeyPath || ''
      existing.autoReconnect = input.autoReconnect ?? true
      if (input.password) {
        await this.credentials.write(`aurora:source:${id}`, input.password, input.rememberPassword !== false)
        existing.hasPassword = input.rememberPassword !== false
      } else if (input.rememberPassword === false) {
        await this.credentials.remove(`aurora:source:${id}`)
        existing.hasPassword = false
      } else if (existing.hasPassword) {
        const storedPassword = await this.credentials.read(`aurora:source:${id}`, true)
        existing.hasPassword = !!storedPassword
      }
      this.disposeAdapter(id)
      this.persist()
      return existing
    }
    const id2 = nextId()
    const source: RemoteSource = {
      id: id2,
      name: input.name,
      protocol: input.protocol,
      host: normalized.host,
      port,
      username: input.username,
      basePath,
      secure,
      tlsMode: input.tlsMode,
      domain: input.domain || '',
      authMode: input.authMode,
      privateKeyPath: input.privateKeyPath || '',
      hasPassword: !!input.password && input.rememberPassword !== false,
      autoReconnect: input.autoReconnect ?? true,
      createdAt: Date.now()
    }
    if (input.password) await this.credentials.write(`aurora:source:${id2}`, input.password, input.rememberPassword !== false)
    this.sources.push(source)
    this.persist()
    return source
  }

  async testConnection(input: RemoteSourceInput, id?: number | null): Promise<{ ok: boolean; error?: string; errorKind?: RemoteErrorKind; secure?: boolean }> {
    const tmpId = id ?? -Date.now()
    const access = await this.resolveAccess(input, tmpId)
    let adapter: IRemoteAdapter | null = null
    try {
      adapter = createAdapter(access)
      await adapter.browse('/')
      return { ok: true }
    } catch (err) {
      if ((input.protocol === 'webdav' || input.protocol === 'http') && access.secure !== false && isTlsProtocolMismatch(err)) {
        if (adapter) await adapter.close()
        adapter = createAdapter({ ...access, secure: false })
        try {
          await adapter.browse('/')
          if (id != null) {
            const source = this.getSource(id)
            if (source) {
              source.secure = false
              this.disposeAdapter(id)
              this.persist()
            }
          }
          return { ok: true, secure: false }
        } catch (fallbackError) {
          const fallback = fallbackError instanceof RemoteError ? fallbackError : new RemoteError('networkError', String(fallbackError))
          return { ok: false, error: fallback.message, errorKind: fallback.kind }
        }
      }
      const re = err instanceof RemoteError ? err : new RemoteError('networkError', String(err))
      return { ok: false, error: re.message, errorKind: re.kind }
    } finally {
      if (adapter) void adapter.close()
    }
  }

  async browse(sourceId: number, path: string): Promise<{ entries: RemoteEntry[]; error?: string }> {
    const source = this.getSource(sourceId)
    if (!source) return { entries: [], error: 'source not found' }
    try {
      const adapter = await this.adapterFor(source)
      const entries = await adapter.browse(path || '/')
      return { entries }
    } catch (err) {
      if ((source.protocol === 'webdav' || source.protocol === 'http') && source.secure !== false && isTlsProtocolMismatch(err)) {
        source.secure = false
        this.disposeAdapter(sourceId)
        this.persist()
        try {
          const adapter = await this.adapterFor(source)
          const entries = await adapter.browse(path || '/')
          return { entries }
        } catch (fallbackError) {
          const fallback = fallbackError instanceof RemoteError ? fallbackError : new RemoteError('networkError', String(fallbackError))
          return { entries: [], error: fallback.message }
        }
      }
      const re = err instanceof RemoteError ? err : new RemoteError('networkError', String(err))
      return { entries: [], error: re.message }
    }
  }

  private async adapterFor(source: RemoteSource): Promise<IRemoteAdapter> {
    const existing = this.adapters.get(source.id)
    if (existing) return existing
    const adapter = await this.createAdapterFor(source)
    this.adapters.set(source.id, adapter)
    return adapter
  }

  private async createAdapterFor(source: RemoteSource): Promise<IRemoteAdapter> {
    const password = await this.credentials.read(`aurora:source:${source.id}`, true)
    const { host, port: hostPort } = normalizeHost(source.host)
    return createAdapter({
      protocol: source.protocol,
      host,
      port: source.port || hostPort || defaultPort(source.protocol),
      username: source.username,
      password: password ?? '',
      basePath: source.basePath || '',
      secure: source.secure,
      tlsMode: source.tlsMode,
      domain: source.domain || '',
      authMode: source.authMode,
      privateKeyPath: source.privateKeyPath || ''
    })
  }

  disposeAdapter(sourceId: number): void {
    const a = this.adapters.get(sourceId)
    if (a) {
      void a.close()
      this.adapters.delete(sourceId)
    }
  }

  async stat(sourceId: number, path: string): Promise<{ size: number } | null> {
    const source = this.getSource(sourceId)
    if (!source) return null
    try {
      const adapter = await this.adapterFor(source)
      return await adapter.stat(path)
    } catch {
      return null
    }
  }

  async openStream(sourceId: number, path: string, start?: number, end?: number): Promise<import('./adapters').OpenStreamResult | null> {
    const source = this.getSource(sourceId)
    if (!source) return null
    const adapter = await this.adapterFor(source)
    return adapter.openStream(path, start, end)
  }

  async openDownloadStream(sourceId: number, path: string, start?: number, end?: number): Promise<import('./adapters').OpenStreamResult | null> {
    const source = this.getSource(sourceId)
    if (!source) return null
    const adapter = await this.createAdapterFor(source)
    try {
      const result = await adapter.openStream(path, start, end)
      const close = () => { void adapter.close() }
      result.stream.once('end', close)
      result.stream.once('close', close)
      result.stream.once('error', close)
      return result
    } catch (error) {
      await adapter.close()
      throw error
    }
  }

  playbackUrl(sourceId: number, path: string): string {
    return `http://127.0.0.1:${this.proxyPort()}/s/${this.token}?source=${sourceId}&path=${encodeURIComponent(path)}`
  }

  proxyPort(): number {
    return (globalThis as unknown as { __proxyPort: number }).__proxyPort ?? 43100
  }

  setProxyPort(port: number): void {
    ;(globalThis as unknown as { __proxyPort: number }).__proxyPort = port
  }

  sourceAvailable(sourceId: number): boolean {
    return !!this.getSource(sourceId)
  }
}
export function defaultPort(protocol: string, secure?: boolean): number {
  switch (protocol) {
    case 'http':
    case 'webdav':
      return secure === false ? 80 : 443
    case 'sftp':
      return 22
    case 'ftps':
      return 21
    case 'ftp':
      return 21
    case 'smb':
      return 445
    default:
      return 443
  }
}

export function normalizeHost(host: string): { host: string; port?: number; secure?: boolean; basePath?: string } {
  let h = (host || '').trim()
  let port: number | undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) {
    try {
      const u = new URL(h)
      const protocol = u.protocol.toLowerCase()
      return {
        host: u.hostname,
        port: u.port ? Number(u.port) : undefined,
        secure: protocol === 'https:' ? true : protocol === 'http:' ? false : undefined,
        basePath: u.pathname && u.pathname !== '/' ? decodeURIComponent(u.pathname) : undefined
      }
    } catch {
      void 0
    }
  }
  h = h.replace(/^[a-z][a-z0-9+.-]*\/\//i, '')
  h = h.replace(/^\/+/, '')
  const slash = h.indexOf('/')
  if (slash >= 0) h = h.slice(0, slash)
  const at = h.lastIndexOf('@')
  if (at >= 0) h = h.slice(at + 1)
  const colon = h.lastIndexOf(':')
  if (colon >= 0 && !h.includes('[') && h.indexOf(':') === colon) {
    const maybePort = h.slice(colon + 1)
    if (/^\d+$/.test(maybePort)) {
      port = Number(maybePort)
      h = h.slice(0, colon)
    }
  }
  return { host: h, port }
}

export async function readRemoteTags(
  manager: RemoteSourceManager,
  item: { sourceId: number | null; remotePath: string | null; fileName: string }
): Promise<{ title?: string; artist?: string; album?: string; duration?: number; cover?: Buffer; coverMime?: string }> {
  if (!item.sourceId || !item.remotePath) return {}
  try {
    const stream = await manager.openStream(item.sourceId, item.remotePath, 0, 4 * 1024 * 1024)
    if (!stream) return {}
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of stream.stream as AsyncIterable<Buffer>) {
      chunks.push(chunk)
      total += chunk.length
      if (total >= 4 * 1024 * 1024) break
    }
    const buf = Buffer.concat(chunks)
    const { probeTagsFromBuffer } = await import('../media/tags')
    return probeTagsFromBuffer(buf)
  } catch {
    return {}
  }
}
