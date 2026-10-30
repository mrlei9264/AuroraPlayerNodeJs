import React, { useCallback, useEffect, useState } from 'react'

const MAX_EDGE = 512
const MAX_IDLE_IMAGES = 24
const MAX_IDLE_BYTES = 12 * 1024 * 1024
const MAX_DECODERS = 2

type Listener = (url: string) => void
type Thumbnail = {
  source: string
  url: string
  bytes: number
  listeners: Set<Listener>
  controller: AbortController
  running: boolean
}

// Originals never enter <img>'s decoded image cache. Only bounded thumbnails
// do, and every object URL has a single owner and an explicit eviction path.
const thumbnails = new Map<string, Thumbnail>()
let decoding = 0

function discard(entry: Thumbnail): void {
  if (thumbnails.get(entry.source) === entry) thumbnails.delete(entry.source)
  entry.controller.abort()
  if (entry.url) URL.revokeObjectURL(entry.url)
  entry.url = ''
}

function trim(): void {
  const idle = [...thumbnails.values()].filter((entry) => entry.url && !entry.listeners.size)
  let bytes = idle.reduce((sum, entry) => sum + entry.bytes, 0)
  let count = idle.length
  for (const entry of idle) {
    if (count <= MAX_IDLE_IMAGES && bytes <= MAX_IDLE_BYTES) break
    bytes -= entry.bytes
    count--
    discard(entry)
  }
}

async function decode(entry: Thumbnail): Promise<void> {
  let bitmap: ImageBitmap | null = null
  let canvas: OffscreenCanvas | null = null
  const { signal } = entry.controller
  try {
    const response = await fetch(entry.source, { signal, cache: 'no-store' })
    if (!response.ok) throw new Error('Thumbnail request failed')
    const blob = await response.blob()
    if (signal.aborted) return
    bitmap = await createImageBitmap(blob)
    if (signal.aborted) return
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Thumbnail canvas unavailable')
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    bitmap = null
    const thumbnail = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
    if (signal.aborted || thumbnails.get(entry.source) !== entry) return
    entry.url = URL.createObjectURL(thumbnail)
    // Account for the decoded pixels as well as the encoded blob.
    entry.bytes = width * height * 4 + thumbnail.size
    for (const listener of entry.listeners) listener(entry.url)
  } catch {
    // Keep the card's existing fallback surface; do not decode the full-size
    // original in an <img> when the bounded pipeline fails or is cancelled.
    if (thumbnails.get(entry.source) === entry) discard(entry)
  } finally {
    bitmap?.close()
    if (canvas) canvas.width = canvas.height = 1
  }
}

function pump(): void {
  for (const entry of thumbnails.values()) {
    if (decoding >= MAX_DECODERS) break
    if (entry.url || entry.running || !entry.listeners.size || entry.controller.signal.aborted) continue
    entry.running = true
    decoding++
    void decode(entry).finally(() => {
      entry.running = false
      decoding--
      trim()
      pump()
    })
  }
}

function subscribe(source: string, listener: Listener): () => void {
  let entry = thumbnails.get(source)
  if (!entry) {
    entry = { source, url: '', bytes: 0, listeners: new Set(), controller: new AbortController(), running: false }
    thumbnails.set(source, entry)
  }
  const current = entry
  current.listeners.add(listener)
  if (current.url) listener(current.url)
  pump()
  return () => {
    current.listeners.delete(listener)
    if (current.listeners.size) return
    if (!current.url) discard(current)
    else {
      // Insertion order is the idle LRU order, refreshed on final release.
      thumbnails.delete(source)
      thumbnails.set(source, current)
      trim()
    }
  }
}

export function clearIdleThumbnails(): void {
  for (const entry of thumbnails.values()) if (!entry.listeners.size) discard(entry)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const entry of thumbnails.values()) discard(entry)
  })
}

/** Virtualized cards subscribe on mount and cancel/de-reference on unmount. */
export function ThumbnailImage({ src, ...props }: Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string }) {
  const [image, setImage] = useState<{ source: string; url: string } | null>(null)
  const imageUrl = image?.source === src ? image.url : undefined
  const attach = useCallback((node: HTMLImageElement | null) => {
    if (!node) return
    // Ref setup may repeat on the same node in development StrictMode.
    if (imageUrl) node.src = imageUrl
    // Release the decoded image even if a detached React fiber briefly keeps
    // the element alive after the virtual row has been removed.
    return () => { node.removeAttribute('src') }
  }, [imageUrl])
  useEffect(() => subscribe(src, (url) => setImage({ source: src, url })), [src])
  return <img {...props} ref={attach} src={imageUrl} />
}
