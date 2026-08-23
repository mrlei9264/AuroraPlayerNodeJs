import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import { mimeOf, randomToken } from '../util'

/**
 * Loopback file server used only to give the renderer/libmpv a stable local
 * URL with byte-range support. Decoding, track selection and subtitle handling
 * belong to libmpv; this server must never spawn FFmpeg or transcode media.
 */
export class LocalMediaServer {
  private readonly server: http.Server
  readonly token: string
  private _port = 0
  readonly portReady: Promise<void>
  onRequest: ((line: string) => void) | null = null

  constructor() {
    this.token = randomToken(24)
    this.server = http.createServer((request, response) => this.handle(request, response))
    this.portReady = new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        this._port = (this.server.address() as AddressInfo).port
        resolve()
      })
    })
  }

  get port(): number { return this._port }

  private handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/media' || url.searchParams.get('t') !== this.token) {
      response.writeHead(403)
      response.end()
      return
    }
    const filePath = url.searchParams.get('p')
    if (!filePath) {
      response.writeHead(400)
      response.end()
      return
    }
    let stats: fs.Stats
    try {
      stats = fs.statSync(filePath)
    } catch {
      response.writeHead(404)
      response.end()
      return
    }
    if (!stats.isFile()) {
      response.writeHead(400)
      response.end()
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': mimeOf(extensionOf(filePath)) || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'private, max-age=0'
    }
    const range = request.headers.range
    this.onRequest?.(`req ${baseName(filePath)} size=${stats.size} Range=${range ?? '-'}`)
    if (stats.size === 0) {
      if (range) this.rangeNotSatisfiable(response, 0)
      else { response.writeHead(200, { ...headers, 'Content-Length': '0' }); response.end() }
      return
    }

    let start = 0
    let end = stats.size - 1
    let partial = false
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (!match || (!match[1] && !match[2])) {
        this.rangeNotSatisfiable(response, stats.size)
        return
      }
      partial = true
      if (!match[1]) {
        const suffixLength = Number(match[2])
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          this.rangeNotSatisfiable(response, stats.size)
          return
        }
        start = Math.max(0, stats.size - suffixLength)
      } else {
        start = Number(match[1])
        end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stats.size || start > end) {
        this.rangeNotSatisfiable(response, stats.size)
        return
      }
    }

    response.writeHead(partial ? 206 : 200, partial
      ? { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stats.size}` }
      : { ...headers, 'Content-Length': String(stats.size) })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = fs.createReadStream(filePath, { start, end })
    stream.on('error', () => response.destroy())
    response.on('close', () => stream.destroy())
    stream.pipe(response)
  }

  private rangeNotSatisfiable(response: http.ServerResponse, size: number): void {
    response.writeHead(416, {
      'Content-Range': `bytes */${size}`,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    })
    response.end()
  }

  dispose(): void { this.server.close() }
}

function extensionOf(value: string): string {
  const index = value.lastIndexOf('.')
  return index >= 0 ? value.slice(index) : ''
}

function baseName(value: string): string {
  return value.slice(Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/')) + 1)
}
