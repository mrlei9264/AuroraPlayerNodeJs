import { Client as FtpClient } from 'basic-ftp'
import { createClient, type WebDAVClient, type FileStat } from 'webdav'
import SMB2 from 'smb2'
import SftpClient from 'ssh2-sftp-client'
import * as http from 'http'
import * as https from 'https'
import fs from 'fs'
import type { RemoteProtocol } from '../../shared/types'
import { getNetworkAgent } from '../system/networkProxy'

export type RemoteErrorKind =
  | 'cancelled'
  | 'timeout'
  | 'authenticationFailed'
  | 'permissionDenied'
  | 'pathNotFound'
  | 'hostUnreachable'
  | 'tlsError'
  | 'protocolUnsupported'
  | 'networkError'

export class RemoteError extends Error {
  kind: RemoteErrorKind
  constructor(kind: RemoteErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface AdapterEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

export interface AdapterAccess {
  protocol: RemoteProtocol
  host: string
  port: number
  username: string
  password: string
  basePath: string
  secure?: boolean
  tlsMode?: 'none' | 'explicit' | 'implicit'
  domain?: string
  authMode?: 'password' | 'privateKey'
  privateKeyPath?: string
}

export interface OpenStreamResult {
  stream: NodeJS.ReadableStream
  size: number | null
  contentLength: number | null
}

export interface IRemoteAdapter {
  browse(path: string): Promise<AdapterEntry[]>
  stat(path: string): Promise<{ size: number }>
  openStream(path: string, start?: number, end?: number): Promise<OpenStreamResult>
  close(): Promise<void>
}

function errorText(err: unknown): string {
  const messages: string[] = []
  let current: unknown = err
  const seen = new Set<unknown>()
  while (current != null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) messages.push(current.message)
    else messages.push(String(current))
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : undefined
  }
  return messages.join(' ')
}

export function isTlsProtocolMismatch(err: unknown): boolean {
  const msg = errorText(err).toLowerCase()
  return msg.includes('wrong version number') || msg.includes('eproto') || msg.includes('packet length too long')
}

function classifyError(err: unknown): RemoteError {
  const originalMessage = errorText(err) || String(err)
  const msg = originalMessage.toLowerCase()
  if (isTlsProtocolMismatch(err) || msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate')) {
    return new RemoteError('tlsError', originalMessage)
  }
  if (msg.includes('530') || msg.includes('401') || msg.includes('credentials') || msg.includes('login') || msg.includes('authenticate') || msg.includes('ecode')) {
    return new RemoteError('authenticationFailed', originalMessage)
  }
  if (msg.includes('550') || msg.includes('404') || msg.includes('not found') || msg.includes('enoent') || msg.includes('no such')) {
    return new RemoteError('pathNotFound', originalMessage)
  }
  if (msg.includes('553') || msg.includes('403') || msg.includes('permission') || msg.includes('denied') || msg.includes('access')) {
    return new RemoteError('permissionDenied', originalMessage)
  }
  if (msg.includes('530') || msg.includes('535')) return new RemoteError('authenticationFailed', originalMessage)
  if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('eai_again') || msg.includes('ehostunreach')) {
    return new RemoteError('hostUnreachable', originalMessage)
  }
  return new RemoteError('networkError', originalMessage)
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RemoteError('timeout', `${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

export class FtpAdapter implements IRemoteAdapter {
  private client: FtpClient
  private secure: boolean

  constructor(private access: AdapterAccess) {
    this.client = new FtpClient(60000)
    this.secure = access.protocol === 'ftps' || access.tlsMode === 'explicit' || access.tlsMode === 'implicit'
  }

  private async connect(): Promise<void> {
    if (!this.client.closed) return
    try {
      await this.client.access({
        host: this.access.host,
        port: this.access.port,
        user: this.access.username,
        password: this.access.password,
        secure: this.access.tlsMode === 'implicit' ? 'implicit' : this.secure,
        secureOptions: this.secure ? { rejectUnauthorized: false } : undefined
      })
    } catch (err) {
      throw classifyError(err)
    }
  }

  private fullPath(p: string): string {
    const base = this.access.basePath.replace(/\/+$/, '')
    const pp = p.replace(/^\//, '')
    return base ? `${base}/${pp}` : pp
  }

  async browse(path: string): Promise<AdapterEntry[]> {
    await withTimeout(this.connect(), 15000, 'ftp connect')
    const entries = await withTimeout(this.client.list(this.fullPath(path)), 30000, 'ftp list')
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory,
        size: e.isDirectory ? 0 : e.size ?? 0,
        modifiedAt: e.modifiedAt ? new Date(e.modifiedAt).getTime() : 0
      }))
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
  }

  async stat(path: string): Promise<{ size: number }> {
    await withTimeout(this.connect(), 15000, 'ftp connect')
    const size = await withTimeout(this.client.size(this.fullPath(path)), 15000, 'ftp size')
    return { size }
  }

  async openStream(path: string, start?: number): Promise<OpenStreamResult> {
    await withTimeout(this.connect(), 15000, 'ftp connect')
    let size: number | null = null
    try {
      size = await withTimeout(this.client.size(this.fullPath(path)), 15000, 'ftp size')
    } catch {
      size = null
    }
    const { PassThrough } = await import('stream')
    const pt = new PassThrough()
    const task = this.client.downloadTo(pt, this.fullPath(path), start ?? 0)
    void task.catch((err) => {
      if (!(err instanceof Error && err.message.includes('550'))) pt.destroy(err as Error)
    })
    return { stream: pt, size, contentLength: size !== null && start !== undefined && start > 0 ? Math.max(0, size - start) : size }
  }

  async close(): Promise<void> {
    try {
      this.client.close()
    } catch {
      void 0
    }
  }
}

export class WebDavAdapter implements IRemoteAdapter {
  private client: WebDAVClient

  constructor(private access: AdapterAccess) {
    const url = webDavEndpoint(access)
    const auth = 'Basic ' + Buffer.from(`${access.username}:${access.password}`).toString('base64')
    this.client = createClient(url, {
      username: access.username,
      password: access.password,
      headers: { Authorization: auth },
      maxBodyLength: 512 * 1024 * 1024,
      maxContentLength: 512 * 1024 * 1024,
      httpAgent: getNetworkAgent(),
      httpsAgent: getNetworkAgent()
    })
  }

  private fullPath(p: string): string {
    return webDavPath(this.access.basePath, p)
  }

  private entryFromStat(s: FileStat): AdapterEntry {
    const isDir = !!s.type && s.type === 'directory'
    return {
      name: s.basename || s.filename.split('/').pop() || '',
      isDirectory: isDir,
      size: isDir ? 0 : s.size ?? 0,
      modifiedAt: s.lastmod ? new Date(s.lastmod).getTime() : 0
    }
  }

  async browse(path: string): Promise<AdapterEntry[]> {
    try {
      const items = await withTimeout(this.client.getDirectoryContents(this.fullPath(path) || '/'), 30000, 'webdav list')
      const list = (Array.isArray(items) ? items : (items as { items?: FileStat[] }).items ?? []).filter((s) => s.basename && !s.basename.startsWith('.'))
      return list
        .map((s) => this.entryFromStat(s))
        .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
    } catch (error) {
      throw classifyError(error)
    }
  }

  async stat(path: string): Promise<{ size: number }> {
    try {
      const s = await withTimeout(this.client.stat(this.fullPath(path)) as Promise<FileStat>, 20000, 'webdav stat')
      return { size: s.size ?? 0 }
    } catch (error) {
      throw classifyError(error)
    }
  }

  async openStream(path: string, start?: number, end?: number): Promise<OpenStreamResult> {
    const stat = await this.stat(path)
    let stream: NodeJS.ReadableStream
    let contentLength: number | null = stat.size
    if (start !== undefined) {
      // An open-ended browser range means "continue to EOF". Limiting that
      // request to a small chunk closes the response while the media element
      // is still expecting bytes, producing a stall at every chunk boundary.
      // Only cap requests that explicitly provide an end elsewhere upstream.
      const rangeEnd = end ?? Math.max(start, stat.size - 1)
      stream = this.client.createReadStream(this.fullPath(path), { range: { start, end: rangeEnd } })
      contentLength = Math.max(0, rangeEnd - start + 1)
    } else {
      stream = this.client.createReadStream(this.fullPath(path))
    }
    return { stream, size: stat.size, contentLength }
  }

  async close(): Promise<void> {
    void 0
  }
}

export function webDavEndpoint(access: Pick<AdapterAccess, 'host' | 'port' | 'secure'>): string {
  const secure = access.secure !== false && access.port !== 80
  const scheme = secure ? 'https' : 'http'
  const defaultPort = secure ? 443 : 80
  const port = access.port && access.port !== defaultPort ? `:${access.port}` : ''
  return `${scheme}://${access.host}${port}`
}

export function webDavPath(basePath: string, requestedPath: string): string {
  const base = basePath.trim().replace(/^\/+|\/+$/g, '')
  const requested = requestedPath === '/' ? '' : requestedPath.trim().replace(/^\/+|\/+$/g, '')
  return `/${[base, requested].filter(Boolean).join('/')}`.replace(/\/+/g, '/')
}

export class HttpAdapter implements IRemoteAdapter {
  constructor(private access: AdapterAccess) {}

  private target(path: string): URL {
    const secure = this.access.secure ?? this.access.port !== 80
    const scheme = secure ? 'https' : 'http'
    const defaultPort = secure ? 443 : 80
    const port = this.access.port === defaultPort ? '' : `:${this.access.port}`
    const base = this.access.basePath === '/' ? '' : this.access.basePath.replace(/\/+$/, '')
    const requested = path === '/' || path === this.access.basePath ? '' : '/' + path.replace(/^\/+/, '')
    return new URL(`${scheme}://${this.access.host}${port}${base}${requested}`)
  }

  private request(method: 'GET' | 'HEAD', path: string, start?: number, end?: number): Promise<http.IncomingMessage> {
    const url = this.target(path)
    const transport = url.protocol === 'https:' ? https : http
    const headers: Record<string, string> = {}
    if (this.access.username || this.access.password) {
      headers.Authorization = 'Basic ' + Buffer.from(`${this.access.username}:${this.access.password}`).toString('base64')
    }
    if (start != null) headers.Range = `bytes=${start}-${end ?? ''}`
    return withTimeout(new Promise((resolve, reject) => {
      const request = transport.request(url, { method, headers, agent: getNetworkAgent() }, (response) => {
        const status = response.statusCode ?? 0
        if (status >= 200 && status < 400) resolve(response)
        else {
          response.resume()
          reject(new RemoteError(status === 401 ? 'authenticationFailed' : status === 404 ? 'pathNotFound' : 'networkError', `HTTP ${status}`))
        }
      })
      request.on('error', (error) => reject(classifyError(error)))
      request.end()
    }), 20000, `http ${method.toLowerCase()}`)
  }

  async browse(path: string): Promise<AdapterEntry[]> {
    const response = await this.request('GET', path)
    response.resume()
    return []
  }

  async stat(path: string): Promise<{ size: number }> {
    const response = await this.request('HEAD', path)
    response.resume()
    return { size: Number(response.headers['content-length'] ?? 0) }
  }

  async openStream(path: string, start?: number, end?: number): Promise<OpenStreamResult> {
    const response = await this.request('GET', path, start, end)
    const size = Number(response.headers['content-range']?.split('/').pop() ?? response.headers['content-length'] ?? 0) || null
    const contentLength = Number(response.headers['content-length'] ?? 0) || null
    return { stream: response, size, contentLength }
  }

  async close(): Promise<void> {
    void 0
  }
}

interface SmbEntry {
  filename?: string
  name?: string
  attributes?: number
  size?: number
  mtimeMs?: number
}

export class SmbAdapter implements IRemoteAdapter {
  private client: SMB2 | null = null

  constructor(private access: AdapterAccess) {}

  private getClient(): SMB2 {
    if (this.client) return this.client
    const share = `\\\\${this.access.host}${this.access.basePath ? '\\' + this.access.basePath.replace(/[\\/]+/g, '\\') : ''}`
    this.client = new SMB2({
      share,
      domain: this.access.domain || '',
      username: this.access.username,
      password: this.access.password
    })
    return this.client
  }

  private fullPath(p: string): string {
    return p === '/' ? '\\' : '\\' + p.replace(/^[\\/]+/, '').replace(/\//g, '\\')
  }

  private promisify<T>(fn: (cb: (err: Error | null, data: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      fn((err, data) => (err ? reject(classifyError(err)) : resolve(data)))
    })
  }

  async browse(path: string): Promise<AdapterEntry[]> {
    const client = this.getClient()
    const entries = await withTimeout(
      this.promisify<SmbEntry[]>((cb) => client.list(this.fullPath(path) + '\\', cb)),
      30000,
      'smb list'
    )
    return entries
      .filter((e) => (e.filename ?? e.name ?? '').length > 0 && !(e.filename ?? e.name ?? '').startsWith('.'))
      .map((e) => {
        const name = e.filename ?? e.name ?? ''
        const isDir = ((e.attributes ?? 0) & 0x10) !== 0
        return {
          name,
          isDirectory: isDir,
          size: isDir ? 0 : e.size ?? 0,
          modifiedAt: e.mtimeMs ?? 0
        }
      })
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
  }

  async stat(path: string): Promise<{ size: number }> {
    const parts = path.replace(/^[\\/]+/, '').split('/')
    const name = parts.pop() ?? ''
    const parent = parts.length ? '\\' + parts.join('\\') : '\\'
    const client = this.getClient()
    const entries = await withTimeout(
      this.promisify<SmbEntry[]>((cb) => client.list(parent + '\\', cb)),
      30000,
      'smb stat'
    )
    const hit = entries.find((e) => (e.filename ?? e.name) === name)
    return { size: hit?.size ?? 0 }
  }

  async openStream(path: string, start?: number, end?: number): Promise<OpenStreamResult> {
    const client = this.getClient()
    const { PassThrough } = await import('stream')
    const pt = new PassThrough()
    const range = { start: start ?? 0, end: end ?? Number.MAX_SAFE_INTEGER }
    try {
      const data = await this.promisify<Buffer>((cb) => client.readFile(this.fullPath(path), range, cb))
      pt.end(data)
    } catch (err) {
      pt.destroy(err as Error)
    }
    return { stream: pt, size: null, contentLength: null }
  }

  async close(): Promise<void> {
    try {
      this.client?.close()
    } catch {
      void 0
    }
    this.client = null
  }
}

export class SftpAdapter implements IRemoteAdapter {
  private client = new SftpClient('aurora-player')
  private connected = false

  constructor(private access: AdapterAccess) {}

  private async connect(): Promise<void> {
    if (this.connected) return
    try {
      await withTimeout(this.client.connect({
        host: this.access.host,
        port: this.access.port,
        username: this.access.username,
        ...(this.access.authMode === 'privateKey'
          ? { privateKey: fs.readFileSync(this.access.privateKeyPath || ''), passphrase: this.access.password || undefined }
          : { password: this.access.password }),
        readyTimeout: 15000
      }), 18000, 'sftp connect')
      this.connected = true
    } catch (error) {
      throw classifyError(error)
    }
  }

  private fullPath(path: string): string {
    const base = this.access.basePath.replace(/\/+$/, '')
    const requested = path === '/' ? '' : path.replace(/^\/+/, '')
    const full = [base, requested].filter(Boolean).join('/')
    return full.startsWith('/') ? full : `/${full}`
  }

  async browse(path: string): Promise<AdapterEntry[]> {
    await this.connect()
    try {
      const entries = await withTimeout(this.client.list(this.fullPath(path)), 30000, 'sftp list')
      return entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          isDirectory: entry.type === 'd',
          size: entry.type === 'd' ? 0 : entry.size ?? 0,
          modifiedAt: entry.modifyTime ?? 0
        }))
        .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
    } catch (error) {
      throw classifyError(error)
    }
  }

  async stat(path: string): Promise<{ size: number }> {
    await this.connect()
    try {
      const result = await withTimeout(this.client.stat(this.fullPath(path)), 20000, 'sftp stat')
      return { size: result.size ?? 0 }
    } catch (error) {
      throw classifyError(error)
    }
  }

  async openStream(path: string, start?: number, end?: number): Promise<OpenStreamResult> {
    await this.connect()
    const stats = await this.stat(path)
    const options = start == null ? undefined : { start, end: end ?? Math.max(start, stats.size - 1) }
    const stream = this.client.createReadStream(this.fullPath(path), options)
    return { stream, size: stats.size, contentLength: start == null ? stats.size : Math.max(0, (options?.end ?? stats.size - 1) - start + 1) }
  }

  async close(): Promise<void> {
    if (!this.connected) return
    try {
      await this.client.end()
    } catch {
      void 0
    }
    this.connected = false
  }
}

export function createAdapter(access: AdapterAccess): IRemoteAdapter {
  switch (access.protocol) {
    case 'http':
      return new HttpAdapter(access)
    case 'ftp':
    case 'ftps':
      return new FtpAdapter(access)
    case 'webdav':
      return new WebDavAdapter(access)
    case 'smb':
      return new SmbAdapter(access)
    case 'sftp':
      return new SftpAdapter(access)
    default:
      throw new RemoteError('protocolUnsupported', `unsupported protocol: ${access.protocol}`)
  }
}

