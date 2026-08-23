import fs from 'fs'
import path from 'path'
import type { WebMediaMetadata } from './metadata'
import { requestBuffer } from '../system/networkProxy'

export interface ParsedNfoMetadata extends WebMediaMetadata {
  coverReference?: string
}

const MAX_NFO_BYTES = 2 * 1024 * 1024
const MAX_COVER_BYTES = 12 * 1024 * 1024

export function nfoCandidateNames(mediaFileName: string, directoryEntries: string[] = []): string[] {
  const mediaStem = normalizeName(path.basename(mediaFileName, path.extname(mediaFileName)))
  const names = directoryEntries.filter((entry) => path.extname(entry).toLocaleLowerCase() === '.nfo')
  if (!names.length) return [`${path.basename(mediaFileName, path.extname(mediaFileName))}.nfo`]
  return [...new Set(names)].sort((left, right) => {
    const scoreDifference = nfoNameScore(right, mediaStem) - nfoNameScore(left, mediaStem)
    return scoreDifference || left.localeCompare(right)
  })
}

export function parseNfo(text: string): ParsedNfoMetadata {
  const xml = text.replace(/^\uFEFF/, '').trim()
  const root = xml.match(/<\s*(movie|tvshow|episodedetails)\b/i)?.[1]?.toLowerCase()
  if (!root) return parseReleaseNfo(xml)
  const title = firstTag(xml, 'title') || firstTag(xml, 'originaltitle')
  const year = parseYear(firstTag(xml, 'year') || firstTag(xml, 'premiered') || firstTag(xml, 'aired'))
  const genres = allTags(xml, 'genre')
  const runtimeMinutes = Number(firstTag(xml, 'runtime'))
  const ratingText = firstTag(xml, 'value') || firstTag(xml, 'rating')
  const rating = ratingText ? Number(ratingText) : Number.NaN
  const uniqueIds = [...xml.matchAll(/<uniqueid\b([^>]*)>([\s\S]*?)<\/uniqueid>/gi)]
  const preferredId = uniqueIds.find((match) => /default\s*=\s*["']true["']/i.test(match[1])) ?? uniqueIds[0]
  const idType = preferredId?.[1].match(/type\s*=\s*["']([^"']+)["']/i)?.[1]
  const externalId = decodeXml(preferredId?.[2] || firstTag(xml, 'tmdbid') || firstTag(xml, 'imdbid') || firstTag(xml, 'tvdbid')).trim() || undefined
  const posterThumb = [...xml.matchAll(/<thumb\b([^>]*)>([\s\S]*?)<\/thumb>/gi)]
    .find((match) => !/aspect\s*=\s*["'](?!poster|thumb)/i.test(match[1]))
  const coverReference = decodeXml(posterThumb?.[2] || firstTag(xml, 'poster') || '').trim() || undefined

  return {
    title: title || undefined,
    duration: Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 ? runtimeMinutes * 60 : undefined,
    source: idType ? `NFO · ${idType.toUpperCase()}` : 'NFO',
    externalId,
    mediaType: root === 'tvshow' ? 'series' : root === 'episodedetails' ? 'episode' : root === 'movie' ? 'movie' : undefined,
    year,
    description: firstTag(xml, 'plot') || firstTag(xml, 'outline') || undefined,
    genres: genres.length ? genres : undefined,
    rating: Number.isFinite(rating) && rating >= 0 ? rating : undefined,
    coverReference
  }
}

function parseReleaseNfo(text: string): ParsedNfoMetadata {
  const title = releaseField(text, 'NAME|TITLE')
  const genreText = releaseField(text, 'GENRE')
  const ratingText = releaseField(text, 'RAT(?:I|i)NG')
  const imdbText = releaseField(text, 'IMDB')
  const runtimeText = releaseField(text, 'RUNT(?:I|i)ME|DURATION')
  const releaseName = text.split(/\r?\n/).find((line) =>
    /\b(?:18|19|20|21)\d{2}\b/.test(line) && /\b(?:2160p|1080p|720p|4K|UHD|Blu-?Ray|WEB[ ._-]?DL)\b/i.test(line)
  )
  const externalId = imdbText.match(/\btt\d{5,12}\b/i)?.[0]
  const rating = Number(ratingText.match(/\d+(?:\.\d+)?/)?.[0])

  return {
    title: title || undefined,
    duration: parseReleaseRuntime(runtimeText),
    source: externalId ? 'NFO · IMDB' : 'NFO',
    externalId,
    mediaType: title ? 'movie' : undefined,
    year: parseYear(releaseName || ''),
    genres: parseReleaseGenres(genreText),
    rating: Number.isFinite(rating) ? rating : undefined
  }
}

export async function readLocalNfo(mediaPath: string): Promise<ParsedNfoMetadata | null> {
  const directory = path.dirname(mediaPath)
  let entries: string[]
  try { entries = fs.readdirSync(directory) } catch { return null }
  const lookup = new Map(entries.map((entry) => [entry.toLocaleLowerCase(), entry]))
  const candidate = nfoCandidateNames(path.basename(mediaPath), entries).map((name) => lookup.get(name.toLocaleLowerCase())).find(Boolean)
  if (!candidate) return null
  const nfoPath = path.join(directory, candidate)
  try {
    const stat = fs.statSync(nfoPath)
    if (!stat.isFile() || stat.size > MAX_NFO_BYTES) return null
    const parsed = parseNfo(fs.readFileSync(nfoPath, 'utf8'))
    const cover = await resolveLocalCover(directory, path.basename(mediaPath), parsed.coverReference, entries)
    return { ...parsed, ...cover }
  } catch {
    return null
  }
}

export async function fetchNfoCover(reference: string): Promise<Pick<WebMediaMetadata, 'cover' | 'coverMime'>> {
  try {
    const url = new URL(reference)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return {}
    const response = await requestBuffer(url, {
      timeoutMs: 10_000,
      maxBytes: MAX_COVER_BYTES,
      headers: { 'User-Agent': 'AuroraPlayer/1.0 (NFO artwork)', Accept: 'image/*' }
    })
    const mime = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    return response.ok && mime.startsWith('image/') ? { cover: response.data, coverMime: mime } : {}
  } catch {
    return {}
  }
}

export function mimeFromImageName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  return 'image/jpeg'
}

export const nfoLimits = { text: MAX_NFO_BYTES, cover: MAX_COVER_BYTES }

async function resolveLocalCover(directory: string, mediaFileName: string, reference: string | undefined, entries: string[]): Promise<Pick<WebMediaMetadata, 'cover' | 'coverMime'>> {
  if (reference && /^https?:\/\//i.test(reference)) return fetchNfoCover(reference)
  const stem = path.basename(mediaFileName, path.extname(mediaFileName))
  const names = [reference, `${stem}-poster.jpg`, `${stem}.jpg`, 'poster.jpg', 'folder.jpg', 'cover.jpg'].filter((name): name is string => Boolean(name))
  const lookup = new Map(entries.map((entry) => [entry.toLocaleLowerCase(), entry]))
  for (const name of names) {
    const baseName = path.basename(name.replace(/\\/g, '/'))
    const actual = lookup.get(baseName.toLocaleLowerCase())
    if (!actual) continue
    const resolved = path.resolve(directory, actual)
    if (path.dirname(resolved) !== path.resolve(directory)) continue
    try {
      const stat = fs.statSync(resolved)
      if (stat.isFile() && stat.size > 0 && stat.size <= MAX_COVER_BYTES) return { cover: fs.readFileSync(resolved), coverMime: mimeFromImageName(actual) }
    } catch { void 0 }
  }
  return {}
}

function firstTag(xml: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i').exec(xml)
  return match ? decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : ''
}

function allTags(xml: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...xml.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'gi'))]
    .map((match) => decodeXml(match[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function parseYear(value: string): number | undefined {
  const year = Number(value.match(/\b(18|19|20|21)\d{2}\b/)?.[0])
  return Number.isFinite(year) ? year : undefined
}

function releaseField(text: string, labelPattern: string): string {
  const match = new RegExp(`^\\s*(?:${labelPattern})\\s*\\.{2,}\\s*:?\\s*(.+?)\\s*$`, 'im').exec(text)
  return match?.[1]?.trim() || ''
}

function parseReleaseRuntime(value: string): number | undefined {
  const clock = value.match(/(?:(\d+)\s*h\s*:?\s*)?(?:(\d+)\s*m\s*:?\s*)?(?:(\d+)\s*s)?/i)
  if (clock?.[0]?.trim()) {
    const seconds = Number(clock[1] || 0) * 3600 + Number(clock[2] || 0) * 60 + Number(clock[3] || 0)
    if (seconds > 0) return seconds
  }
  const colon = value.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/)
  if (colon) return Number(colon[1] || 0) * 3600 + Number(colon[2]) * 60 + Number(colon[3])
  const minutes = Number(value.match(/\b(\d+)\s*(?:min|minutes?)\b/i)?.[1])
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : undefined
}

function parseReleaseGenres(value: string): string[] | undefined {
  if (!value) return undefined
  const knownGenres = /Science Fiction|Sci[ ._-]?Fi|Action|Adventure|Animation|Biography|Comedy|Crime|Documentary|Drama|Family|Fantasy|History|Horror|Music|Musical|Mystery|Romance|Sport|Thriller|War|Western/gi
  const genres = [...value.matchAll(knownGenres)].map((match) => {
    const genre = match[0].replace(/[ ._-]+/g, '-').toLowerCase()
    if (genre === 'sci-fi' || genre === 'science-fiction') return 'Sci-Fi'
    return genre.charAt(0).toUpperCase() + genre.slice(1)
  })
  return genres.length ? [...new Set(genres)] : value.split(/\s*[,/|;]\s*/).filter(Boolean)
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f\d]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function nfoNameScore(fileName: string, mediaStem: string): number {
  const nfoStem = normalizeName(path.basename(fileName, path.extname(fileName)))
  if (nfoStem === mediaStem) return 10_000
  const mediaTokens = new Set(mediaStem.split(' ').filter(Boolean))
  const nfoTokens = new Set(nfoStem.split(' ').filter(Boolean))
  const shared = [...mediaTokens].filter((token) => nfoTokens.has(token)).length
  const union = new Set([...mediaTokens, ...nfoTokens]).size
  const similarity = union ? shared / union : 0
  const genericBonus = nfoStem === 'movie' || nfoStem === 'tvshow' ? 5 : 0
  return Math.round(similarity * 1_000) + genericBonus
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase().replace(/[._-]+/g, ' ').replace(/\b(?:2160p|1080p|720p|4k|uhd|web.?dl|bluray|hdr|x26[45]|h26[45]|hevc)\b.*$/i, '').replace(/\s+/g, ' ').trim()
}
