import http from 'http'
import https from 'https'
import crypto from 'crypto'
import type { Readable } from 'stream'
import type { MediaItem } from '../../shared/types'
import type { RemoteSourceManager } from '../remote/manager'
import type { OpenStreamResult } from '../remote/adapters'
import { getNetworkAgent } from '../system/networkProxy'

const MIB = 1024 * 1024
const BLOCK = 256 * 1024
const CACHE_BLOCKS = 32 * MIB / BLOCK

export class PreviewReadLimitError extends Error {
  constructor(message: string, readonly reason: 'read-limit' | 'range-unsupported' = 'range-unsupported') { super(message) }
}

function directRequest(url: URL, method: 'HEAD' | 'GET', signal: AbortSignal, range?: string, redirects = 0): Promise<http.IncomingMessage> {
  if (!['http:', 'https:'].includes(url.protocol) || redirects > 5) return Promise.reject(new PreviewReadLimitError('Unsupported preview URL'))
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method, signal, agent: getNetworkAgent(), headers: range ? { Range: range } : {}
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.destroy()
        directRequest(new URL(response.headers.location, url), method, signal, range, redirects + 1).then(resolve, reject)
      } else resolve(response)
    })
    request.setTimeout(15000, () => request.destroy(new Error('Preview request timed out')))
    request.once('error', reject)
    request.end()
  })
}

// Dedicated preview input: bounded byte ranges only; never downloads a full file.
export async function openPreviewInput(manager: RemoteSourceManager, item: MediaItem, signal: AbortSignal, options: { maxBytes?: number } = {}) {
  let size = 0
  let readRange: (start: number, end: number) => Promise<OpenStreamResult | null>
  if (item.sourceId && item.remotePath) {
    const sourceId = item.sourceId
    const remotePath = item.remotePath
    size = (await manager.stat(sourceId, remotePath))?.size ?? 0
    readRange = (start, end) => manager.openDownloadStream(sourceId, remotePath, start, end)
  } else if (/^https?:\/\//i.test(item.url)) {
    const url = new URL(item.url)
    const head = await directRequest(url, 'HEAD', signal)
    if (head.statusCode === 200) size = Number(head.headers['content-length'])
    head.destroy()
    if (!(size > 0)) {
      const response = await directRequest(url, 'GET', signal, 'bytes=0-0')
      if (response.statusCode === 206) size = Number(response.headers['content-range']?.split('/').pop())
      response.destroy()
    }
    readRange = async (start, end) => {
      const response = await directRequest(url, 'GET', signal, `bytes=${start}-${end}`)
      return { stream: response, size, contentLength: Number(response.headers['content-length']) || null }
    }
  } else throw new PreviewReadLimitError('No seekable source')
  if (!Number.isSafeInteger(size) || size <= 0 || signal.aborted) throw new PreviewReadLimitError('Unknown remote file size')
  const budget = Math.min(options.maxBytes ?? 64 * MIB, Math.floor(size / 4))
  const token = crypto.randomUUID()
  const blocks = new Map<number, Promise<Buffer>>()
  const streams = new Set<Readable>()
  let reserved = 0
  let failure: Error | null = null
  let closed = false

  const block = (index: number): Promise<Buffer> => {
    const cached = blocks.get(index)
    if (cached) {
      blocks.delete(index)
      blocks.set(index, cached)
      return cached
    }
    const start = index * BLOCK
    const end = Math.min(size - 1, start + BLOCK - 1)
    const length = end - start + 1
    if (reserved + length > budget) {
      throw new PreviewReadLimitError(`Preview read budget reached (${reserved}/${budget} bytes)`, 'read-limit')
    }
    reserved += length
    const pending = (async () => {
      let stream: Readable | undefined
      try {
        const result = await readRange(start, end)
        if (!result) throw new Error('Source unavailable')
        stream = result.stream as Readable
        streams.add(stream)
        if (closed || signal.aborted) throw new Error('Cancelled')
        // HTTP adapters expose the actual response, so reject ignored Range requests.
        if ('statusCode' in stream) {
          const response = stream as http.IncomingMessage
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(response.headers['content-range'] ?? ''))
          if (response.statusCode !== 206 || !match || Number(match[1]) !== start || Number(match[2]) !== end || Number(match[3]) !== size) {
            throw new PreviewReadLimitError('Remote server ignored byte ranges')
          }
        }
        const chunks: Buffer[] = []
        let received = 0
        for await (const raw of stream) {
          if (closed || signal.aborted) throw new Error('Cancelled')
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
          const take = Math.min(chunk.length, length - received)
          chunks.push(chunk.subarray(0, take))
          received += take
          if (received === length) break
        }
        if (received !== length) throw new Error('Incomplete preview range')
        return Buffer.concat(chunks, length)
      } catch (error) {
        // WebDAV also rejects responses that do not honor Range before piping them.
        if (/invalid response code for partial request|REST.*(?:not supported|not implemented|500|502)/i.test(String(error))) throw new PreviewReadLimitError('Remote server could not supply the requested byte range')
        throw error
      } finally {
        if (stream) { stream.destroy(); streams.delete(stream) }
      }
    })()
    blocks.set(index, pending)
    // Keep metadata and recent seek ranges without retaining the entire read budget in RAM.
    void pending.then(() => {
      while (blocks.size > CACHE_BLOCKS) blocks.delete(blocks.keys().next().value!)
    }, () => { if (blocks.get(index) === pending) blocks.delete(index) })
    return pending
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      if (request.url !== `/${token}` || !['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(403).end(); return }
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
      if (request.headers.range && !range) { response.writeHead(416).end(); return }
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0) { response.writeHead(416).end(); return }
      response.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
      })
      if (request.method === 'HEAD') { response.end(); return }
      for (let position = start; position <= end && !response.destroyed && !closed;) {
        const index = Math.floor(position / BLOCK)
        const buffer = await block(index)
        if (response.destroyed || closed) return
        const slice = buffer.subarray(position - index * BLOCK, Math.min(buffer.length, end - index * BLOCK + 1))
        position += slice.length
        if (!response.write(slice)) await new Promise<void>((resolve) => {
          const done = () => { response.off('drain', done); response.off('close', done); resolve() }
          response.once('drain', done); response.once('close', done)
        })
      }
      response.end()
    })().catch((error: unknown) => {
      if (!closed && !signal.aborted && !response.destroyed) failure = error instanceof Error ? error : new Error(String(error))
      response.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const close = () => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', close)
    for (const stream of streams) stream.destroy()
    streams.clear()
    blocks.clear()
    server.closeAllConnections()
    server.close()
  }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) close()
  const address = server.address()
  if (!address || typeof address === 'string') { close(); throw new Error('Preview input cancelled') }
  return { url: `http://127.0.0.1:${address.port}/${token}`, failure: () => failure, bytesRead: () => reserved, close }
}
