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

  private async serve(req: http.IncomingMessage, res: http.ServerResponse, parsed: { sourceId: number; path: string }): Promise<void> {
    const fileName = safeBaseName(decodeURIComponent(parsed.path))
    const mime = mimeOf(fileName)
    let size: number | null = null
    try {
      const stat = await this.manager.stat(parsed.sourceId, parsed.path)
      size = stat?.size ?? null
    } catch {
      size = null
    }

    const rangeHeader = req.headers.range
    let start = 0
    let end: number | undefined
    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (m) {
        start = m[1] ? parseInt(m[1], 10) : 0
        if (m[2]) end = parseInt(m[2], 10)
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': `private, max-age=${RemoteStreamProxy.CACHE_WINDOW_SECONDS}`,
      'Vary': 'Range',
      'Access-Control-Allow-Origin': '*'
    }
    if (req.method === 'HEAD') {
      if (size !== null) headers['Content-Length'] = String(end !== undefined ? Math.max(0, Math.min(end, size - 1) - start + 1) : size - start)
      res.writeHead(200, headers)
      res.end()
      return
    }

    try {
      const result = await this.manager.openStream(parsed.sourceId, parsed.path, start, end)
      if (!result) {
        res.writeHead(404)
        res.end()
        return
      }
      const total = result.size ?? size
      const responseLength = result.contentLength ?? (end !== undefined
        ? Math.max(0, Math.min(end, (total ?? end) - 1) - start + 1)
        : total !== null ? Math.max(0, total - start) : null)
      if (responseLength !== null) headers['Content-Length'] = String(responseLength)
      if (total !== null && total > 0) {
        if (rangeHeader) {
          const actualEnd = responseLength !== null
            ? Math.min(total - 1, start + responseLength - 1)
            : (end ?? total - 1)
          res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${actualEnd}/${total}`
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
        res.writeHead(500)
        res.end()
      }
    }
  }
}
