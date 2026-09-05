import fs from 'fs'
import path from 'path'
import { decodeTextBuffer, decodeUtf8 } from '../util'
import { cleanMediaText } from '../../shared/types'

export interface ParsedTags {
  title?: string
  artist?: string
  album?: string
  duration?: number
  cover?: Buffer
  coverMime?: string
  lyrics?: string
}

function readHead(p: string, n: number): Buffer {
  const fd = fs.openSync(p, 'r')
  try {
    const size = Math.min(n, fs.statSync(p).size)
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, 0)
    return buf
  } finally {
    fs.closeSync(fd)
  }
}

function readTail(p: string, n: number): Buffer {
  const fd = fs.openSync(p, 'r')
  try {
    const fileSize = fs.statSync(p).size
    const size = Math.min(n, fileSize)
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, fileSize - size)
    return buf
  } finally {
    fs.closeSync(fd)
  }
}

function parseId3v1(tail: Buffer): ParsedTags {
  if (tail.length !== 128 || tail.toString('ascii', 0, 3) !== 'TAG') return {}
  const field = (start: number, end: number) => cleanMediaText(decodeTextBuffer(tail.subarray(start, end)).replace(/\u0000/g, ''))
  const title = field(3, 33)
  const artist = field(33, 63)
  const album = field(63, 93)
  return { title: title || undefined, artist: artist || undefined, album: album || undefined }
}

function syncSafe(buf: Buffer, off: number): number {
  return ((buf[off] & 0x7f) << 21) | ((buf[off + 1] & 0x7f) << 14) | ((buf[off + 2] & 0x7f) << 7) | (buf[off + 3] & 0x7f)
}

function parseId3(buf: Buffer): { frames: Map<string, Buffer>; headerSize: number; extended: boolean } {
  const frames = new Map<string, Buffer>()
  if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'ID3') return { frames, headerSize: 0, extended: false }
  const ver = buf[3]
  const flags = buf[5]
  let size = syncSafe(buf, 6)
  const headerSize = 10 + size
  let off = 10
  if (flags & 0x40) {
    const extSize = syncSafe(buf, off)
    off += 4 + extSize
  }
  const end = off + size
  const target = ver === 2 ? '32' : '42'
  while (off + 10 <= end) {
    const id = buf.toString('ascii', off, off + (target === '32' ? 3 : 4))
    if (!/^[A-Z0-9]{3,4}$/.test(id) || id === '\u0000\u0000\u0000\u0000') break
    const bodySize = target === '32' ? ((buf[off + 3] & 0x7f) << 16) | ((buf[off + 4] & 0x7f) << 8) | (buf[off + 5] & 0x7f) : syncSafe(buf, off + 4)
    const frameOff = off + (target === '32' ? 6 : 10)
    if (frameOff + bodySize > buf.length) break
    frames.set(id, buf.subarray(frameOff, frameOff + bodySize))
    off = frameOff + bodySize
  }
  return { frames, headerSize, extended: false }
}

export function decodeUtf16be(buf: Buffer): string {
  const out: number[] = []
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out.push((buf[i] << 8) | buf[i + 1])
  }
  return String.fromCharCode(...out).replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim()
}

function id3Text(payload: Buffer): string | undefined {
  if (payload.length < 1) return undefined
  const enc = payload[0]
  return decodeId3Text(payload.subarray(1), enc)
}

function decodeId3Text(body: Buffer, enc: number): string {
  if (enc === 1) {
    if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) return decodeUtf16be(body.subarray(2))
    const text = body.length >= 2 && body[0] === 0xff && body[1] === 0xfe ? body.subarray(2) : body
    return text.toString('utf16le').replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim()
  }
  if (enc === 2) return decodeUtf16be(body)
  return (enc === 3 ? decodeUtf8(body) : decodeTextBuffer(body)).replace(/\u0000/g, '').trim()
}

function id3Lyrics(payload: Buffer): string | undefined {
  if (payload.length < 5) return undefined
  const enc = payload[0]
  let body = payload.subarray(4)
  if (enc === 1 || enc === 2) {
    let terminator = -1
    for (let index = 0; index + 1 < body.length; index += 2) {
      if (body[index] === 0 && body[index + 1] === 0) {
        terminator = index
        break
      }
    }
    if (terminator >= 0) body = body.subarray(terminator + 2)
  } else {
    const terminator = body.indexOf(0)
    if (terminator >= 0) body = body.subarray(terminator + 1)
  }
  return decodeId3Text(body, enc) || undefined
}

function id3Picture(payload: Buffer): { cover?: Buffer; mime?: string } {
  if (payload.length < 4) return {}
  const enc = payload[0]
  let off = 1
  let mimeEnd = payload.indexOf(0, off)
  if (mimeEnd < 0) return {}
  const mime = payload.toString('ascii', off, mimeEnd)
  off = mimeEnd + 1
  if (enc === 1) {
    let descLen = payload.indexOf(0, off)
    if (descLen < 0) return {}
    let nullPos = payload.indexOf(0, descLen + 1)
    if (nullPos < 0) nullPos = payload.length
    off = nullPos + 1
  } else {
    off += 2
    while (off < payload.length && payload[off] !== 0) off++
    off++
  }
  if (off + 4 > payload.length) return {}
  const dataSize = payload.readUInt32BE(off)
  off += 4
  if (off + dataSize > payload.length) return {}
  return { cover: payload.subarray(off, off + dataSize), mime: mime || 'image/jpeg' }
}

function parseVorbisComments(buf: Buffer, marker: string): { comments: Map<string, string>; pic?: Buffer; picMime?: string; sampleRate?: number } {
  const comments = new Map<string, string>()
  const idx = buf.indexOf(marker)
  if (idx < 0) return { comments }
  let off = idx + marker.length
  const readU32 = (o: number) => buf.readUInt32LE(o)
  const count = readU32(off)
  off += 4
  for (let i = 0; i < count && off + 4 <= buf.length; i++) {
    const len = readU32(off)
    off += 4
    if (off + len > buf.length) break
    const kv = buf.toString('utf8', off, off + len)
    off += len
    const eq = kv.indexOf('=')
    if (eq > 0) comments.set(kv.slice(0, eq).toUpperCase(), kv.slice(eq + 1))
  }
  if (marker === '\u0001vorbis' && off + 4 <= buf.length) {
    const blocksize = readU32(off)
    off += 4
    void blocksize
  }
  const picKey = marker === 'OpusTags' ? 'METADATA_BLOCK_PICTURE' : 'METADATA_BLOCK_PICTURE'
  const b64 = comments.get(picKey)
  if (b64) {
    try {
      const raw = Buffer.from(b64, 'base64')
      const mimeLen = raw.readUInt32BE(4)
      const mime = raw.toString('ascii', 8, 8 + mimeLen)
      let o = 8 + mimeLen + 4
      const descLen = raw.readUInt32BE(o)
      o += 4 + descLen + 20
      const dataLen = raw.readUInt32BE(o)
      o += 4
      if (o + dataLen <= raw.length) {
        comments.set('__PIC__', '1')
        return { comments, pic: raw.subarray(o, o + dataLen), picMime: mime, sampleRate: undefined }
      }
    } catch {
      void 0
    }
  }
  return { comments, sampleRate: undefined }
}

function parseFlac(buf: Buffer): { comments: Map<string, string>; pic?: Buffer; picMime?: string; sampleRate?: number; duration?: number } {
  if (buf.toString('ascii', 0, 4) !== 'fLaC') return { comments: new Map() }
  let off = 4
  let sampleRate: number | undefined
  let totalSamples: number | undefined
  let pic: Buffer | undefined
  let picMime: string | undefined
  while (off + 4 <= buf.length) {
    const header = buf[off]
    const isLast = header & 0x80
    const type = header & 0x7f
    const len = buf.readUIntBE(off + 1, 3)
    off += 4
    if (off + len > buf.length) break
    const block = buf.subarray(off, off + len)
    if (type === 0 && len >= 18) {
      sampleRate = block.readUIntBE(10, 3)
      const ls = block.readUInt32BE(14) >>> 4
      totalSamples = ls
    } else if (type === 4) {
      const comments = new Map<string, string>()
      // Vorbis comments begin with a vendor string, followed by the entry count.
      if (block.length < 8) break
      const vendorLength = block.readUInt32LE(0)
      let o = 4 + vendorLength
      if (o + 4 > block.length) break
      const count = block.readUInt32LE(o)
      o += 4
      for (let i = 0; i < count && o + 4 <= block.length; i++) {
        const l = block.readUInt32LE(o)
        o += 4
        if (o + l > block.length) break
        const kv = block.toString('utf8', o, o + l)
        o += l
        const eq = kv.indexOf('=')
        if (eq > 0) comments.set(kv.slice(0, eq).toUpperCase(), kv.slice(eq + 1))
      }
      if (comments.get('METADATA_BLOCK_PICTURE')) {
        const raw = Buffer.from(comments.get('METADATA_BLOCK_PICTURE')!, 'base64')
        const mimeLen = raw.readUInt32BE(4)
        picMime = raw.toString('ascii', 8, 8 + mimeLen)
        let p = 8 + mimeLen + 4
        const descLen = raw.readUInt32BE(p)
        p += 4 + descLen + 20
        const dataLen = raw.readUInt32BE(p)
        p += 4
        if (p + dataLen <= raw.length) pic = raw.subarray(p, p + dataLen)
      }
      return { comments, pic, picMime, sampleRate, duration: undefined }
    }
    off += len
    if (isLast) break
  }
  void totalSamples
  return { comments: new Map(), pic, picMime, sampleRate, duration: undefined }
}

function readAtom(buf: Buffer, off: number, size: number, atomType: string, target: string): { found: boolean; offset: number; contentSize: number; childOffset: number } {
  void size
  let o = off
  while (o + 8 <= buf.length) {
    const s = buf.readUInt32BE(o)
    const type = buf.toString('ascii', o + 4, o + 8)
    if (s < 8 || o + s > buf.length) break
    if (type === target) {
      return { found: true, offset: o, contentSize: s, childOffset: o + 8 }
    }
    o += s
  }
  return { found: false, offset: -1, contentSize: 0, childOffset: -1 }
}

function findMoov(buf: Buffer): number {
  const markers = [Buffer.from('moov'), Buffer.from('ftyp')]
  let off = 0
  while (off < buf.length - 4) {
    const m = buf.indexOf(markers[0], off)
    if (m < 0) return -1
    return m - 4
  }
  return -1
}

function parseMp4(buf: Buffer): { tags: ParsedTags; duration?: number; sampleRate?: number } {
  const tags: ParsedTags = {}
  const ftypOff = buf.indexOf('ftyp')
  if (ftypOff < 0) return { tags }
  const moov = findMoov(buf)
  if (moov < 0) return { tags }
  const moovSize = buf.readUInt32BE(moov)
  const moovEnd = Math.min(moov + moovSize, buf.length)

  let o = moov + 8
  let mvhdTimeScale: number | undefined
  let mvhdDuration: number | undefined
  let udtaOff = -1
  while (o + 8 <= moovEnd) {
    const s = buf.readUInt32BE(o)
    const type = buf.toString('ascii', o + 4, o + 8)
    if (s < 8 || o + s > moovEnd) break
    if (type === 'mvhd' && s >= 32) {
      const ver = buf[o + 8]
      if (ver === 1 && s >= 44) {
        mvhdTimeScale = buf.readUInt32BE(o + 28)
        mvhdDuration = Number(buf.readBigUInt64BE(o + 32))
      } else if (s >= 28) {
        mvhdTimeScale = buf.readUInt32BE(o + 20)
        mvhdDuration = buf.readUInt32BE(o + 24)
      }
    } else if (type === 'udta') {
      udtaOff = o
      break
    }
    o += s
  }
  if (mvhdTimeScale && mvhdDuration) tags.duration = Number(mvhdDuration) / mvhdTimeScale

  if (udtaOff >= 0) {
    const udtaEnd = Math.min(udtaOff + buf.readUInt32BE(udtaOff), buf.length)
    let p = udtaOff + 8
    while (p + 8 <= udtaEnd) {
      const s = buf.readUInt32BE(p)
      const type = buf.toString('ascii', p + 4, p + 8)
      if (s < 8 || p + s > udtaEnd) break
      if (type === 'meta') {
        const ilstOff = p + 4 + 8
        const ilstEnd = Math.min(p + s, udtaEnd)
        let q = ilstOff
        while (q + 8 <= ilstEnd) {
          const is = buf.readUInt32BE(q)
          const itype = buf.toString('ascii', q + 4, q + 8)
          if (is < 8 || q + is > ilstEnd) break
          if (itype === 'ilst') {
            parseIlst(buf, q + 8, q + is, tags)
          }
          q += is
        }
      }
      p += s
    }
  }
  return { tags, duration: tags.duration }
}

function parseIlst(buf: Buffer, start: number, end: number, tags: ParsedTags): void {
  let p = start
  const map: Record<string, keyof ParsedTags> = {
    '\u00a9nam': 'title',
    '\u00a9ART': 'artist',
    '\u00a9alb': 'album',
    '\u00a9wrt': 'artist',
    aART: 'artist',
    '\u00a9lyr': 'lyrics'
  }
  while (p + 8 <= end) {
    const s = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    if (s < 8 || p + s > end) break
    if (map[type]) {
      const dataOff = p + 8
      let q = dataOff
      while (q + 12 <= p + s) {
        const ds = buf.readUInt32BE(q)
        const dtype = buf.toString('ascii', q + 4, q + 8)
        if (ds < 12 || q + ds > p + s) break
        if (dtype === 'data') {
          const flags = buf.readUInt32BE(q + 8)
          const payload = buf.subarray(q + 16, q + ds)
          const target = map[type]
          if (target === 'lyrics' && (flags & 1)) {
            tags.lyrics = payload.toString('utf8').trim()
          } else if (!(flags & 1) && (target === 'title' || target === 'artist' || target === 'album')) {
            tags[target] = decodeUtf8(payload)
          }
        }
        q += ds
      }
    } else if (type === 'covr') {
      let q = p + 8
      while (q + 12 <= p + s) {
        const ds = buf.readUInt32BE(q)
        const dtype = buf.toString('ascii', q + 4, q + 8)
        if (ds < 12 || q + ds > p + s) break
        if (dtype === 'data') {
          const flags = buf.readUInt32BE(q + 8)
          const payload = buf.subarray(q + 16, q + ds)
          const mime = flags === 13 ? 'image/jpeg' : flags === 14 ? 'image/png' : flags === 27 ? 'image/bmp' : 'image/jpeg'
          tags.cover = payload
          tags.coverMime = mime
        }
        q += ds
      }
    }
    p += s
  }
}

function parseWav(buf: Buffer): number | undefined {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return undefined
  let o = 12
  let byteRate = 0
  let dataSize = 0
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4)
    const size = buf.readUInt32LE(o + 4)
    if (id === 'fmt ' && size >= 16) {
      byteRate = buf.readUInt32LE(o + 8 + 8)
    } else if (id === 'data') {
      dataSize = size
    }
    o += 8 + size + (size % 2)
  }
  if (byteRate > 0 && dataSize > 0) return dataSize / byteRate
  return undefined
}

export function probeTags(p: string): ParsedTags {
  try {
    const head = readHead(p, 4 * 1024 * 1024)
    if (head.length < 16) return {}
    const tags = probeTagsFromBuffer(head)
    if (path.extname(p).toLowerCase() !== '.mp3' || tags.title || tags.artist || tags.album) return tags
    return { ...parseId3v1(readTail(p, 128)), ...tags }
  } catch {
    return {}
  }
}

export function probeTagsFromBuffer(head: Buffer): ParsedTags {
  try {
    if (head.length < 16) return {}
    if (head.toString('ascii', 0, 3) === 'ID3') {
      const { frames, headerSize } = parseId3(head)
      const tags: ParsedTags = {}
      const title = frames.get('TIT2') ?? frames.get('TT2')
      const artist = frames.get('TPE1') ?? frames.get('TP1')
      const album = frames.get('TALB') ?? frames.get('TAL')
      if (title) tags.title = id3Text(title)
      if (artist) tags.artist = id3Text(artist)
      if (album) tags.album = id3Text(album)
      const pic = frames.get('APIC') ?? frames.get('PIC')
      if (pic) {
        const { cover, mime } = id3Picture(pic)
        if (cover) {
          tags.cover = cover
          tags.coverMime = mime ?? 'image/jpeg'
        }
      }
      const uslt = frames.get('USLT')
      if (uslt) tags.lyrics = id3Lyrics(uslt)
      if (frames.get('TDRC') || frames.get('TYER')) void 0
      const tl = frames.get('TLEN')
      if (tl) {
        const ms = parseInt(id3Text(tl) ?? '', 10)
        if (isFinite(ms) && ms > 0) tags.duration = ms / 1000
      }
      return tags
    }
    if (head.toString('ascii', 0, 4) === 'fLaC') {
      const { comments, pic, picMime } = parseFlac(head)
      const tags: ParsedTags = {
        title: comments.get('TITLE'),
        artist: comments.get('ARTIST'),
        album: comments.get('ALBUM')
      }
      if (pic) {
        tags.cover = pic
        tags.coverMime = picMime ?? 'image/jpeg'
      }
      return tags
    }
    if (head.toString('ascii', 0, 4) === 'OggS') {
      const vorbis = parseVorbisComments(head, '\u0001vorbis')
      const opus = vorbis.comments.size ? null : parseVorbisComments(head, 'OpusTags')
      const res = vorbis.comments.size ? vorbis : opus
      if (res && res.comments.size) {
        const tags: ParsedTags = {
          title: res.comments.get('TITLE'),
          artist: res.comments.get('ARTIST'),
          album: res.comments.get('ALBUM')
        }
        if (res.pic) {
          tags.cover = res.pic
          tags.coverMime = res.picMime ?? 'image/jpeg'
        }
        return tags
      }
    }
    if (head.toString('ascii', 0, 4) === 'RIFF') {
      const duration = parseWav(head)
      return duration !== undefined ? { duration } : {}
    }
    if (head.indexOf('ftyp') >= 0 && head.indexOf('moov') >= 0) {
      const { tags } = parseMp4(head)
      return tags
    }
    return {}
  } catch {
    return {}
  }
}

function probeMp3Duration(p: string, skip: number): number | undefined {
  try {
    const st = fs.statSync(p)
    const fd = fs.openSync(p, 'r')
    try {
      const buf = Buffer.alloc(2)
      fs.readSync(fd, buf, 0, 2, skip)
      if (buf[0] !== 0xff || (buf[1] & 0xe0) !== 0xe0) return undefined
      const bitrateIdx = (buf[1] >> 2) & 0x0f
      const sampleRateIdx = (buf[1] >> 0) & 0x03
      const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
      const rates = [44100, 48000, 32000, 0]
      const br = bitrates[bitrateIdx] * 1000
      const sr = rates[sampleRateIdx]
      if (!br || !sr) return undefined
      return (st.size - skip) / (br / 8)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return undefined
  }
}

export function probeEmbeddedLyrics(p: string): string | undefined {
  try {
    const head = readHead(p, 1 * 1024 * 1024)
    if (head.toString('ascii', 0, 3) === 'ID3') {
      const { frames } = parseId3(head)
      const uslt = frames.get('USLT')
      if (uslt) {
        const text = id3Lyrics(uslt)
        if (!text) return undefined
        if (text.includes('[') && text.includes(']')) return text
        return text
      }
    }
    if (head.toString('ascii', 0, 4) === 'fLaC') {
      const { comments } = parseFlac(head)
      return ['LYRICS', 'UNSYNCEDLYRICS', 'UNSYNCED LYRICS', 'SYNCEDLYRICS', 'SYNCED LYRICS']
        .map((key) => comments.get(key)?.trim()).find(Boolean)
    }
    if (head.indexOf('ftyp') >= 0) {
      const { tags } = parseMp4(head)
      return tags.lyrics
    }
    return undefined
  } catch {
    return undefined
  }
}

const mkId = (buf: Buffer, off: number): number => {
  const b = buf[off]
  if (b < 0x80) return b
  let id = b & 0x7f
  let i = off + 1
  while (i < off + 4 && i < buf.length) {
    const nb = buf[i]
    id = (id << 8) | (nb & 0x7f)
    if (nb < 0x80) break
    i++
  }
  return id
}

const mkSize = (buf: Buffer, off: number): number => {
  let size = 0
  let i = off
  for (; i < off + 8 && i < buf.length; i++) {
    const b = buf[i]
    size = size * 128 + (b & 0x7f)
    if (b < 0x80) break
  }
  return size
}

const CH_ID = 0x1043a770
const EDITION_ID = 0x45b9
const ATOM_ID = 0xb6
const TSTART_ID = 0x33
const TEND_ID = 0x45a3
const DISPLAY_ID = 0x80
const STRING_ID = 0x85
const LANG_ID = 0x437c

export function probeMkvChapters(p: string): { title: string; time: number; duration: number }[] {
  try {
    const st = fs.statSync(p)
    const total = st.size
    const fd = fs.openSync(p, 'r')
    try {
      const CH = Buffer.from([0x10, 0x43, 0xa7, 0x70])
      const chunk = 4 * 1024 * 1024
      let pos = 0
      while (pos < total) {
        const size = Math.min(chunk, total - pos)
        const buf = Buffer.alloc(size)
        fs.readSync(fd, buf, 0, size, pos)
        let hit = buf.indexOf(CH)
        while (hit >= 0) {
          let off = hit + 4
          const chaptersSize = mkSize(buf, off)
          off += 1 + (buf[off] < 0x80 ? 0 : buf[off] < 0x4000 ? 1 : buf[off] < 0x200000 ? 2 : 3)
          const end = Math.min(buf.length, off + chaptersSize)
          const chapters = walkChapters(buf, off, end)
          if (chapters.length) return chapters
          hit = buf.indexOf(CH, hit + 1)
        }
        pos += size - 8
      }
      return []
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }
}

function walkChapters(buf: Buffer, start: number, end: number): { title: string; time: number; duration: number }[] {
  const out: { title: string; time: number; duration: number }[] = []
  let off = start
  while (off + 2 <= end) {
    const id = mkId(buf, off)
    off += id < 0x80 ? 1 : id < 0x4000 ? 2 : id < 0x200000 ? 3 : 4
    const size = mkSize(buf, off)
    off += 1
    if (off + size > end) break
    const childStart = off
    if (id === EDITION_ID) {
      out.push(...walkChapters(buf, childStart, childStart + size))
    } else if (id === ATOM_ID) {
      let time = -1
      let dur = 0
      let title = ''
      let p = childStart
      while (p + 2 <= childStart + size) {
        const cid = mkId(buf, p)
        p += cid < 0x80 ? 1 : cid < 0x4000 ? 2 : cid < 0x200000 ? 3 : 4
        const csize = mkSize(buf, p)
        p += 1
        if (p + csize > childStart + size) break
        if (cid === TSTART_ID && csize >= 8) {
          time = Number(buf.readBigUInt64BE(p)) / 1e9
        } else if (cid === TEND_ID && csize >= 8) {
          dur = Number(buf.readBigUInt64BE(p)) / 1e9 - time
        } else if (cid === DISPLAY_ID) {
          let q = p
          while (q + 2 <= p + csize) {
            const did = mkId(buf, q)
            q += did < 0x80 ? 1 : did < 0x4000 ? 2 : did < 0x200000 ? 3 : 4
            const dsize = mkSize(buf, q)
            q += 1
            if (q + dsize > p + csize) break
            if (did === STRING_ID) title = buf.toString('utf8', q, q + dsize).trim()
            q += dsize
          }
        }
        p += csize
      }
      if (time >= 0) out.push({ title: title || `Chapter ${out.length + 1}`, time, duration: dur })
    }
    off = childStart + size
  }
  return out
}
