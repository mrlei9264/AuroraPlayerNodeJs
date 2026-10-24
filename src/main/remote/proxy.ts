import http from 'http'
import { RemoteSourceManager } from './manager'
import { mimeOf, safeBaseName } from '../util'
import { Logger } from '../system/diagnostics'

export class RemoteStreamProxy {
  // Keep range responses available in Chromium's media cache for a short,
  // predictable window. This lets the video element re-use recently fetched
  // chunks when the remote connection briefly stalls instead of immediately
  // opening another request for the same bytes.
  private static readonly CACHE_WINDOW_SECONDS = 60
  private server: http.Server
  private token: string
  private port = 0
  private bytesServed = 0
  private active = new Set<http.ServerResponse>()
  private statCache = new Map<string, { size: number | null; expiresAt: number }>()

  constructor(
    private manager: RemoteSourceManager,
    private logger: Logger
  ) {
    this.token = manager.streamToken
    this.server = http.createServer((req, res) => this.handle(req, res))
  }

  get portNumber(): number {
    return this.port
  }

  bytesRead(): number {
    return this.bytesServed
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          this.manager.setProxyPort(this.port)
          this.logger.info('proxy', `streaming proxy listening on 127.0.0.1:${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('proxy bind failed'))
        }
      })
    })
  }

  stop(): void {
    for (const res of this.active) res.destroy()
    this.active.clear()
    this.server.close()
  }

  private parseUrl(raw: string): { token: string; sourceId: number; path: string } | null {
    try {
      const u = new URL(raw, 'http://127.0.0.1')
      const m = u.pathname.match(/^\/s\/([^/]+)/)
      if (!m) return null
      const sourceId = Number(u.searchParams.get('source'))
      const p = u.searchParams.get('path') ?? ''
      if (!sourceId || !p) return null
      return { token: m[1], sourceId, path: p }
    } catch {
      return null
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end()
      return
    }
    if (!req.url) {
      res.writeHead(400)
      res.end()
      return
    }
    const parsed = this.parseUrl(req.url)
    if (!parsed || parsed.token !== this.token) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (!this.manager.getSource(parsed.sourceId)) {
      res.writeHead(404)
      res.end('source not found')
      return
    }
    void this.serve(req, res, parsed)
  }

  private async statSize(sourceId: number, path: string): Promise<number | null> {
    const key = `${sourceId}:${path}`
    const cached = this.statCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.size
    let size: number | null = null
    try {
      const stat = await this.manager.stat(sourceId, path)
      size = typeof stat?.size === 'number' && Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : null
    } catch {
      size = null
    }
    if (this.statCache.size > 512) this.statCache.clear()
    this.statCache.set(key, { size, expiresAt: Date.now() + 60_000 })
    return size
  }

  private async serve(req: http.IncomingMessage, res: http.ServerResponse, parsed: { sourceId: number; path: string }): Promise<void> {
    // URLSearchParams has already decoded this value. Decoding it again can
    // throw for a literal percent in a valid remote filename and leaves the
    // request promise rejected outside the HTTP handler.
    const fileName = safeBaseName(parsed.path)
    const mime = mimeOf(fileName)
    const size = await this.statSize(parsed.sourceId, parsed.path)

    if (req.destroyed || res.destroyed) return
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined
    const requestedRange = parseByteRange(rangeHeader, size)
    if (requestedRange === 'invalid') {
      this.rangeNotSatisfiable(res, size)
      return
    }
    const start = requestedRange?.start ?? 0
    const end = requestedRange?.end

    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': `private, max-age=${RemoteStreamProxy.CACHE_WINDOW_SECONDS}`,
      'Vary': 'Range',
      'Access-Control-Allow-Origin': '*'
    }
    if (req.method === 'HEAD') {
      if (size !== null) {
        const resolvedRange = parseByteRange(rangeHeader, size)
        if (resolvedRange === 'invalid') {
          this.rangeNotSatisfiable(res, size)
          return
        }
        const responseStart = resolvedRange?.start ?? 0
        const responseEnd = resolvedRange?.end ?? size - 1
        headers['Content-Length'] = String(Math.max(0, responseEnd - responseStart + 1))
        if (resolvedRange) headers['Content-Range'] = `bytes ${responseStart}-${responseEnd}/${size}`
        res.writeHead(resolvedRange ? 206 : 200, headers)
      } else {
        res.writeHead(200, headers)
      }
      res.end()
      return
    }

try {
      const result = await Promise.race([
        this.manager.openStream(parsed.sourceId, parsed.path, start, end),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stream open timeout')), 15000))
      ])
      if (req.destroyed || res.destroyed) {
        ;(result?.stream as { destroy?: () => void } | undefined)?.destroy?.()
        return
      }
      if (!result) {
        res.writeHead(404)
        res.end()
        return
      }
      const total = result.size ?? size
      const resolvedRange = parseByteRange(rangeHeader, total)
      if (resolvedRange === 'invalid') {
        ;(result.stream as { destroy?: () => void }).destroy?.()
        this.rangeNotSatisfiable(res, total)
        return
      }
      const responseStart = resolvedRange?.start ?? 0
      const responseEnd = resolvedRange?.end
      const responseLength = result.contentLength ?? (responseEnd !== undefined
        ? responseEnd - responseStart + 1
        : total !== null ? Math.max(0, total - responseStart) : null)
      if (responseLength !== null) headers['Content-Length'] = String(responseLength)
      if (total !== null && total > 0) {
        if (resolvedRange) {
          const actualEnd = responseLength !== null
            ? Math.min(total - 1, responseStart + responseLength - 1)
            : (responseEnd ?? total - 1)
          res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${responseStart}-${actualEnd}/${total}`
          })
        } else {
          res.writeHead(200, headers)
        }
      } else {
        res.writeHead(rangeHeader ? 206 : 200, headers)
      }
      this.active.add(res)
      const counter = (chunk: Buffer) => {
        // Count every byte read from the remote stream. The renderer uses
        // successive counter values to show the real traffic rate instead of
        // estimating throughput from media duration or buffered seconds.
        this.bytesServed += chunk.length
      }
      const stream = result.stream as NodeJS.ReadableStream
      if (!stream || typeof stream.pipe !== 'function') {
        res.writeHead(502)
        res.end()
        return
      }
      stream.on('data', counter)
      stream.on('error', (err) => {
        this.logger.warn('proxy', `stream error: ${String(err)}`)
        if (!res.headersSent) {
          res.writeHead(502)
          res.end()
        } else {
          res.destroy()
        }
      })
      stream.pipe(res)
      res.on('close', () => {
        this.active.delete(res)
        ;(stream as { destroy?: () => void }).destroy?.()
      })
    } catch (err) {
      this.logger.warn('proxy', `serve failed for ${parsed.path}: ${String(err)}`)
      if (!res.headersSent) {
        res.writeHead(502)
        res.end()
      }
    }
  }

  private rangeNotSatisfiable(res: http.ServerResponse, total: number | null): void {
    res.writeHead(416, {
      'Accept-Ranges': 'bytes',
      ...(total !== null ? { 'Content-Range': `bytes */${total}` } : {})
    })
    res.end()
  }
}

type ParsedByteRange = { start: number; end?: number } | null | 'invalid'

function parseByteRange(header: string | undefined, total: number | null): ParsedByteRange {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return 'invalid'
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return 'invalid'
  if (first === null) {
    if (last === null || last <= 0 || total === null || total === 0) return 'invalid'
    return { start: Math.max(0, total - last), end: total - 1 }
  }
  if (first < 0 || (last !== null && last < first)) return 'invalid'
  if (total !== null) {
    if (first >= total) return 'invalid'
    return { start: first, end: last === null ? total - 1 : Math.min(last, total - 1) }
  }
  return { start: first, ...(last !== null ? { end: last } : {}) }
}
