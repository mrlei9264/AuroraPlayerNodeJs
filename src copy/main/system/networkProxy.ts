import * as http from 'http'
import * as https from 'https'
import { isIP } from 'net'
import { app, session } from 'electron'
import { ProxyAgent } from 'proxy-agent'
import type { AppSettingsData } from './settings-types'

type ProxySettings = Pick<AppSettingsData, 'proxyEnabled' | 'proxyType' | 'proxyServer' | 'proxyPort' | 'proxyUsername' | 'proxyPassword' | 'proxyBypassLocal'>

let current: ProxySettings | null = null
let networkAgent: ProxyAgent | null = null
let authenticationInstalled = false

export function installProxyAuthentication(): void {
  if (authenticationInstalled) return
  authenticationInstalled = true
  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || !current?.proxyEnabled || (!current.proxyUsername && !current.proxyPassword)) return
    event.preventDefault()
    callback(current.proxyUsername, current.proxyPassword)
  })
}

export async function applyNetworkProxy(settings: ProxySettings): Promise<void> {
  current = { ...settings }
  networkAgent?.destroy()
  networkAgent = settings.proxyEnabled && settings.proxyServer.trim() && validPort(settings.proxyPort)
    ? new ProxyAgent({ getProxyForUrl: (url) => shouldBypass(url, settings) ? '' : proxyUrl(settings) })
    : null

  if (!session.defaultSession) return
  if (!networkAgent) {
    await session.defaultSession.setProxy({ mode: 'direct' })
    return
  }
  await session.defaultSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: proxyEndpoint(settings),
    proxyBypassRules: settings.proxyBypassLocal ? '<local>;localhost;127.0.0.1;[::1];10.*;192.168.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2?.*;172.30.*;172.31.*' : ''
  })
}

export function getNetworkAgent(): http.Agent | undefined {
  return networkAgent ?? undefined
}

export interface NetworkResponse {
  status: number
  ok: boolean
  headers: http.IncomingHttpHeaders
  data: Buffer
  url: URL
}

export async function requestBuffer(
  input: string | URL,
  options: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {},
  redirects = 0
): Promise<NetworkResponse> {
  const url = input instanceof URL ? input : new URL(input)
  const transport = url.protocol === 'https:' ? https : http
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = transport.request(url, { method: 'GET', headers: options.headers, agent: getNetworkAgent() }, resolve)
    request.setTimeout(options.timeoutMs ?? 10_000, () => request.destroy(new Error('request timed out')))
    request.once('error', reject)
    request.end()
  })
  const status = response.statusCode ?? 0
  const location = response.headers.location
  if (location && status >= 300 && status < 400) {
    response.resume()
    if (redirects >= 5) throw new Error('too many redirects')
    return requestBuffer(new URL(location, url), options, redirects + 1)
  }
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024
  const declared = Number(response.headers['content-length'] ?? 0)
  if (declared > maxBytes) {
    response.destroy()
    throw new Error('response is too large')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const value of response) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    total += chunk.length
    if (total > maxBytes) {
      response.destroy()
      throw new Error('response is too large')
    }
    chunks.push(chunk)
  }
  return { status, ok: status >= 200 && status < 300, headers: response.headers, data: Buffer.concat(chunks), url }
}

function proxyUrl(settings: ProxySettings): string {
  const protocol = settings.proxyType === 'socks5' ? 'socks5' : settings.proxyType
  const auth = settings.proxyUsername || settings.proxyPassword
    ? `${encodeURIComponent(settings.proxyUsername)}:${encodeURIComponent(settings.proxyPassword)}@`
    : ''
  return `${protocol}://${auth}${settings.proxyServer.trim()}:${Number(settings.proxyPort)}`
}

function proxyEndpoint(settings: ProxySettings): string {
  const protocol = settings.proxyType === 'socks5' ? 'socks5' : settings.proxyType
  return `${protocol}://${settings.proxyServer.trim()}:${Number(settings.proxyPort)}`
}

function validPort(value: string): boolean {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535
}

function shouldBypass(input: string, settings: ProxySettings): boolean {
  if (!settings.proxyBypassLocal) return false
  try {
    const host = new URL(input).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (host === 'localhost' || host.endsWith('.local')) return true
    const kind = isIP(host)
    if (kind === 4) {
      const [a, b] = host.split('.').map(Number)
      return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    }
    return kind === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))
  } catch {
    return false
  }
}

export function currentProxySettings(): ProxySettings | null {
  return current ? { ...current } : null
}
