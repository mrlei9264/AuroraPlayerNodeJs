import { deflateSync } from 'zlib'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs'

let seq = 0
export function nextId(): number {
  seq += 1
  return Date.now() * 1000 + (seq % 1000)
}

export function randomToken(len = 24): string {
  return crypto.randomBytes(len).toString('hex')
}

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : ''
}

export function safeBaseName(p: string): string {
  const base = path.basename(p).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
  return base || 'untitled'
}

export function unixJoin(a: string, b: string): string {
  if (!b) return a
  if (b.startsWith('/')) return b
  const sep = a.endsWith('/') ? '' : '/'
  return a + sep + b
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  m4p: 'video/x-m4v',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  divx: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  asf: 'video/x-ms-asf',
  flv: 'video/x-flv',
  f4v: 'video/x-flv',
  f4p: 'video/x-flv',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mpe: 'video/mpeg',
  m1v: 'video/mpeg',
  m2v: 'video/mpeg',
  vob: 'video/mpeg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  ogv: 'video/ogg',
  ogm: 'video/ogg',
  rm: 'application/vnd.rn-realmedia',
  rmvb: 'application/vnd.rn-realmedia',
  dv: 'video/x-dv',
  mxf: 'application/mxf',
  wtv: 'video/x-ms-wtv',
  nsv: 'video/x-nsv',
  mj2: 'video/mj2',
  mjp2: 'video/mj2',
  mp3: 'audio/mpeg',
  mp2: 'audio/mpeg',
  mp1: 'audio/mpeg',
  mpa: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
  au: 'audio/basic',
  snd: 'audio/basic',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  ogx: 'audio/ogg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  wma: 'audio/x-ms-wma',
  ape: 'audio/x-ape',
  mka: 'audio/x-matroska',
  amr: 'audio/amr',
  wv: 'audio/x-wavpack',
  tta: 'audio/x-tta',
  dts: 'audio/vnd.dts',
  ac3: 'audio/ac3',
  eac3: 'audio/eac3',
  dsf: 'audio/x-dsf',
  dff: 'audio/x-dff',
  mpc: 'audio/x-musepack',
  mid: 'audio/midi',
  midi: 'audio/midi',
  ra: 'audio/vnd.rn-realaudio',
  ram: 'audio/vnd.rn-realaudio',
  spx: 'audio/ogg',
  xm: 'audio/x-mod',
  mod: 'audio/x-mod',
  s3m: 'audio/x-mod',
  it: 'audio/x-mod',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  dib: 'image/bmp',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  lrc: 'text/plain'
}

export function mimeOf(fileName: string): string {
  return MIME[extOf(fileName)] || 'application/octet-stream'
}

function decodeStrict(buf: Buffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

function decodeUtf16beText(buf: Buffer): string {
  const evenLength = buf.length - (buf.length % 2)
  const swapped = Buffer.allocUnsafe(evenLength)
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = buf[index + 1]
    swapped[index + 1] = buf[index]
  }
  return swapped.toString('utf16le')
}

function finishDecodedText(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim()
}

function looksLikeUtf16(buf: Buffer, zeroOffset: 0 | 1): boolean {
  if (buf.length < 4) return false
  let pairs = 0
  let zeroes = 0
  for (let index = 0; index + 1 < Math.min(buf.length, 256); index += 2) {
    pairs++
    if (buf[index + zeroOffset] === 0) zeroes++
  }
  return pairs > 0 && zeroes / pairs >= 0.6
}

function cjkCount(value: string): number {
  return (value.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) ?? []).length
}

/** Decode user-authored text files and legacy media tags without assuming UTF-8. */
export function decodeTextBuffer(buf: Buffer): string {
  if (!buf.length) return ''
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return finishDecodedText(buf.subarray(2).toString('utf16le'))
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return finishDecodedText(decodeUtf16beText(buf.subarray(2)))
  }
  if (looksLikeUtf16(buf, 1)) return finishDecodedText(buf.toString('utf16le'))
  if (looksLikeUtf16(buf, 0)) return finishDecodedText(decodeUtf16beText(buf))

  const utf8 = decodeStrict(buf, 'utf-8')
  if (utf8 !== null) return finishDecodedText(utf8)

  const gb18030 = decodeStrict(buf, 'gb18030')
  const highByteCount = buf.reduce((count, byte) => count + (byte >= 0x80 ? 1 : 0), 0)
  if (gb18030 !== null && highByteCount >= 2 && cjkCount(gb18030) > 0) {
    return finishDecodedText(gb18030)
  }

  return finishDecodedText(new TextDecoder('windows-1252').decode(buf))
}

/** Repair UTF-8 or GB18030 bytes that were previously persisted as Latin-1 text. */
export function repairLegacyTextEncoding(value: string): string {
  if (!value || cjkCount(value) > 0 || Array.from(value).some((char) => char.codePointAt(0)! > 0xff)) return value
  const bytes = Buffer.from(value, 'latin1')
  for (const encoding of ['utf-8', 'gb18030']) {
    const decoded = decodeStrict(bytes, encoding)
    if (decoded !== null && cjkCount(decoded) > 0) return finishDecodedText(decoded)
  }
  return value
}

export function decodeUtf8(buf: Buffer, enc?: number): string {
  if (enc === 1) return finishDecodedText(buf.toString('utf16le'))
  return decodeTextBuffer(buf)
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'ascii')
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
    return Buffer.concat([len, typeBuf, data, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export interface AppIconOption {
  value: string
  label: string
  dataUrl: string
}

function appIconDirectories(): string[] {
  const external = process.env.AURORA_DEV_URL
    ? path.join(process.cwd(), 'icon')
    : path.join(path.dirname(process.execPath), 'icon')
  return [
    external,
    path.join(__dirname, '..', 'src', 'renderer', 'assets', 'icon'),
    path.join(__dirname, '..', 'dist', 'renderer', 'assets', 'icon'),
    path.join(__dirname, '..', 'dist', 'renderer')
  ]
}

export function appIconDirectory(): string {
  return appIconDirectories()[0]
}

function imageMime(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.ico') return 'image/x-icon'
  return null
}

export function listAppIcons(): AppIconOption[] {
  const seen = new Set<string>()
  const result: AppIconOption[] = []
  for (const directory of appIconDirectories()) {
    let files: string[] = []
    try {
      files = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && imageMime(entry.name))
        .map((entry) => entry.name)
    } catch {
      continue
    }
    for (const fileName of files.sort((a, b) => a.localeCompare(b))) {
      const value = path.basename(fileName)
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      try {
        const buffer = fs.readFileSync(path.join(directory, fileName))
        const mime = imageMime(fileName)
        if (!mime) continue
        seen.add(key)
        result.push({ value, label: value, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` })
      } catch {
        // Ignore unreadable files and keep the remaining previews available.
      }
    }
  }
  return result
}

export function appIconPath(preferredName?: string): string | null {
  const preferred = preferredName ? path.basename(preferredName) : null
  if (preferred) {
    for (const directory of appIconDirectories()) {
      const candidate = path.join(directory, preferred)
      if (fs.existsSync(candidate) && imageMime(candidate)) return candidate
    }
  }
  const source = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'icon', 'app_icon.png')
  const built = path.join(__dirname, '..', 'dist', 'renderer', 'app_icon.png')
  const candidates = process.env.AURORA_DEV_URL
    ? [source, built]
    : [built, source]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

export function makeAppIcon(size = 256, preferredName?: string): Buffer {
  const source = appIconPath(preferredName)
  if (source) return fs.readFileSync(source)
  return makeGeneratedAppIcon(size)
}

function makeGeneratedAppIcon(size = 256): Buffer {
  const cx = size / 2
  const aurora = (x: number, y: number) => {
    const a1 = Math.hypot(x - size * 0.32, y - size * 0.42)
    const a2 = Math.hypot(x - size * 0.66, y - size * 0.3)
    const a3 = Math.hypot(x - size * 0.52, y - size * 0.62)
    return [1.0, 0.55, 0.85][0] * Math.max(0, 1 - a1 / (size * 0.5)) * 0.8 + (1 - a2 / (size * 0.55)) * 0.6 * 0.7 + (1 - a3 / (size * 0.6)) * 0.7
  }
  const saturate = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return encodePng(size, size, (x, y) => {
    const d = Math.hypot(x - cx, y - cx)
    const r = size * 0.46
    if (d > r) return [0, 0, 0, 0]
    const t = aurora(x, y)
    const edge = Math.max(0, 1 - (r - d) / (size * 0.05))
    const r1 = saturate(60 + 195 * t)
    const g1 = saturate(120 + 100 * t)
    const b1 = saturate(210 + 45 * t)
    const a = Math.min(255, Math.round(255 * Math.max(edge * 0.55, t * 0.92)))
    return [r1, g1, b1, a]
  })
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  const wrapped = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }
  return wrapped as T
}


