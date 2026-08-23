import path from 'path'
import type { MediaItem } from '../../shared/types'
import { requestBuffer } from '../system/networkProxy'
import type { MetadataProvider } from '../system/settings-types'

export interface WebMediaMetadata {
  title?: string
  artist?: string
  album?: string
  duration?: number
  cover?: Buffer
  coverMime?: string
  source?: string
  externalId?: string
  mediaType?: 'movie' | 'series' | 'episode' | 'audio'
  year?: number
  description?: string
  genres?: string[]
  rating?: number
}

export interface MetadataLookupOptions {
  providers: MetadataProvider[]
  customSources: string[]
  tmdbAccessToken: string
  language: 'zh-CN' | 'en-US'
}

const ENTITY_TYPES = new Set(['movie', 'tvseries', 'tvepisode', 'videoobject', 'musicrecording', 'musicvideoobject'])
const MAX_HTML_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export function mediaSearchTitle(item: Pick<MediaItem, 'title' | 'fileName'>): string {
  const raw = item.title || path.basename(item.fileName, path.extname(item.fileName))
  return raw
    .replace(/[._]+/g, ' ')
    .replace(/\bS\d{1,2}E\d{1,3}\b.*$/i, ' ')
    .replace(/\[[^\]]*]|\([^)]*(?:rip|x26[45]|h26[45]|bluray|web[- .]?dl|1080p|2160p|4k)[^)]*\)/gi, ' ')
    .replace(/\b(?:2160p|1080p|720p|4k|uhd|bluray|brrip|webrip|web[- .]?dl|hdr|dv|x26[45]|h26[45]|hevc|aac|dts)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function metadataRequestUrl(source: string, query: string): URL | null {
  try {
    const template = source.trim()
    if (!template) return null
    const expanded = template.includes('{query}') ? template.replaceAll('{query}', encodeURIComponent(query)) : template
    const url = new URL(expanded)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!template.includes('{query}')) url.searchParams.set('q', query)
    return url
  } catch {
    return null
  }
}

export class MediaMetadataScraper {
  async lookup(item: Pick<MediaItem, 'title' | 'fileName' | 'isAudio'>, options: MetadataLookupOptions): Promise<WebMediaMetadata | null> {
    const query = mediaSearchTitle(item)
    if (!query) return null
    for (const provider of options.providers) {
      try {
        const found = provider === 'tmdb' && !item.isAudio
          ? await lookupTmdb(query, options)
          : provider === 'tvmaze' && !item.isAudio
            ? await lookupTvmaze(query)
            : provider === 'custom' && !item.isAudio
                ? await this.lookupCustom(query, options.customSources)
                : null
        if (found) return found
      } catch {
        // Sources are independent. A failed or rate-limited source should not
        // stop the remaining providers or the local artwork fallback.
      }
    }
    return null
  }

  private async lookupCustom(query: string, sources: string[]): Promise<WebMediaMetadata | null> {
    for (const source of sources) {
      const requestUrl = metadataRequestUrl(source, query)
      if (!requestUrl) continue
      try {
        const page = await fetchText(requestUrl)
        const parsed = parseMetadataPage(page, requestUrl)
        if (parsed) return { ...await attachCover(parsed, requestUrl), source: requestUrl.hostname }
        const links = extractCandidateLinks(page, requestUrl, query)
        for (const link of links.slice(0, 3)) {
          try {
            const candidatePage = await fetchText(link)
            const candidate = parseMetadataPage(candidatePage, link)
            if (candidate) return { ...await attachCover(candidate, link), source: link.hostname }
          } catch {
            void 0
          }
        }
      } catch {
        void 0
      }
    }
    return null
  }
}

async function lookupTmdb(query: string, options: MetadataLookupOptions): Promise<WebMediaMetadata | null> {
  const credential = options.tmdbAccessToken.trim()
  if (!credential) return null
  const searchUrl = new URL('https://api.themoviedb.org/3/search/multi')
  searchUrl.searchParams.set('query', query)
  searchUrl.searchParams.set('language', options.language)
  searchUrl.searchParams.set('include_adult', 'false')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (/^[a-f\d]{32}$/i.test(credential)) searchUrl.searchParams.set('api_key', credential)
  else headers.Authorization = `Bearer ${credential}`
  const search = await fetchJson<{ results?: Array<Record<string, unknown>> }>(searchUrl, headers)
  const match = search.results?.find((candidate) => candidate.media_type === 'movie' || candidate.media_type === 'tv')
  if (!match) return null
  const mediaType = match.media_type === 'tv' ? 'tv' : 'movie'
  const id = Number(match.id)
  let detail = match
  if (Number.isFinite(id)) {
    const detailUrl = new URL(`https://api.themoviedb.org/3/${mediaType}/${id}`)
    detailUrl.searchParams.set('language', options.language)
    if (/^[a-f\d]{32}$/i.test(credential)) detailUrl.searchParams.set('api_key', credential)
    try { detail = await fetchJson<Record<string, unknown>>(detailUrl, headers) } catch { void 0 }
  }
  const poster = textValue(detail.poster_path || match.poster_path)
  return attachRemoteCover({
    title: textValue(detail.title || detail.name || match.title || match.name),
    duration: finiteNumber(detail.runtime) ? Number(detail.runtime) * 60 : undefined,
    source: 'TMDB',
    externalId: Number.isFinite(id) ? String(id) : undefined,
    mediaType: mediaType === 'movie' ? 'movie' : 'series',
    year: yearFromDate(textValue(detail.release_date || detail.first_air_date)),
    description: textValue(detail.overview),
    genres: Array.isArray(detail.genres) ? detail.genres.map((genre) => textValue(asRecord(genre)?.name)).filter((name): name is string => Boolean(name)) : undefined,
    rating: finiteNumber(detail.vote_average) ? Number(detail.vote_average) : undefined
  }, poster ? `https://image.tmdb.org/t/p/w500${poster}` : undefined)
}

async function lookupTvmaze(query: string): Promise<WebMediaMetadata | null> {
  const url = new URL('https://api.tvmaze.com/singlesearch/shows')
  url.searchParams.set('q', query)
  const show = await fetchJson<Record<string, unknown>>(url)
  if (!show || !show.id) return null
  const image = asRecord(show.image)
  const rating = asRecord(show.rating)
  return attachRemoteCover({
    title: textValue(show.name),
    duration: finiteNumber(show.runtime) ? Number(show.runtime) * 60 : undefined,
    source: 'TVmaze',
    externalId: String(show.id),
    mediaType: 'series',
    year: yearFromDate(textValue(show.premiered)),
    description: stripTags(textValue(show.summary) || '') || undefined,
    genres: Array.isArray(show.genres) ? show.genres.map(textValue).filter((name): name is string => Boolean(name)) : undefined,
    rating: finiteNumber(rating?.average) ? Number(rating?.average) : undefined
  }, textValue(image?.original || image?.medium))
}

async function attachRemoteCover(metadata: WebMediaMetadata, imageUrl?: string): Promise<WebMediaMetadata> {
  if (!imageUrl) return metadata
  try {
    const image = await fetchLimited(new URL(imageUrl), MAX_IMAGE_BYTES, { Accept: 'image/*' })
    const mime = image.contentType.split(';')[0].trim().toLowerCase()
    return mime.startsWith('image/') ? { ...metadata, cover: image.data, coverMime: mime } : metadata
  } catch {
    return metadata
  }
}

function finiteNumber(value: unknown): boolean {
  return Number.isFinite(Number(value))
}

function yearFromDate(value?: string): number | undefined {
  const year = Number(value?.slice(0, 4))
  return year >= 1800 && year <= 2200 ? year : undefined
}

type ParsedPage = Omit<WebMediaMetadata, 'cover' | 'coverMime'> & { imageUrl?: string }

export function parseMetadataPage(html: string, pageUrl: URL): ParsedPage | null {
  const jsonLdBlocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const match of jsonLdBlocks) {
    try {
      const root = JSON.parse(decodeHtml(match[1])) as unknown
      for (const entity of flattenJsonLd(root)) {
        const type = String(entity['@type'] ?? '').toLowerCase()
        if (!ENTITY_TYPES.has(type)) continue
        const title = textValue(entity.name || entity.headline)
        const imageUrl = imageValue(entity.image, pageUrl)
        const artist = personValue(entity.director || entity.byArtist || entity.author)
        const album = textValue(asRecord(entity.inAlbum)?.name)
        const duration = parseIsoDuration(textValue(entity.duration))
        if (title || imageUrl) return { title, imageUrl, artist, album, duration }
      }
    } catch {
      void 0
    }
  }

  const type = metaContent(html, 'property', 'og:type').toLowerCase()
  if (!type.includes('video') && !type.includes('movie')) return null
  const title = metaContent(html, 'property', 'og:title') || metaContent(html, 'name', 'twitter:title')
  const rawImage = metaContent(html, 'property', 'og:image') || metaContent(html, 'name', 'twitter:image')
  const imageUrl = absoluteUrl(rawImage, pageUrl)
  return title || imageUrl ? { title: title || undefined, imageUrl } : null
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd)
  const record = asRecord(value)
  if (!record) return []
  return [record, ...flattenJsonLd(record['@graph'])]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return decodeHtml(value).trim() || undefined
  return undefined
}

function personValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'string') return first.trim() || undefined
  return textValue(asRecord(first)?.name)
}

function imageValue(value: unknown, pageUrl: URL): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'string') return absoluteUrl(first, pageUrl)
  const record = asRecord(first)
  return absoluteUrl(textValue(record?.url || record?.contentUrl) || '', pageUrl)
}

function parseIsoDuration(value?: string): number | undefined {
  if (!value) return undefined
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value)
  if (!match) return undefined
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
}

function metaContent(html: string, attribute: 'name' | 'property', key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)].map((match) => [match[1].toLowerCase(), match[3]]))
    if (attrs[attribute] === key && attrs.content) return decodeHtml(attrs.content)
  }
  return ''
}

function extractCandidateLinks(html: string, pageUrl: URL, query: string): URL[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2)
  const found = new Map<string, URL>()
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripTags(match[3]).toLowerCase()
    if (terms.length && !terms.some((term) => label.includes(term))) continue
    const candidate = absoluteUrl(match[2], pageUrl)
    if (!candidate) continue
    const url = new URL(candidate)
    if (url.origin === pageUrl.origin) found.set(url.href, url)
  }
  return [...found.values()]
}

async function attachCover(parsed: ParsedPage, pageUrl: URL): Promise<WebMediaMetadata> {
  const { imageUrl, ...metadata } = parsed
  if (!imageUrl) return metadata
  try {
    const image = await fetchLimited(new URL(imageUrl, pageUrl), MAX_IMAGE_BYTES)
    const mime = image.contentType.split(';')[0].trim().toLowerCase()
    if (!mime.startsWith('image/')) return metadata
    return { ...metadata, cover: image.data, coverMime: mime }
  } catch {
    return metadata
  }
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetchLimited(url, MAX_HTML_BYTES)
  return response.data.toString('utf8')
}

async function fetchJson<T>(url: URL, headers?: Record<string, string>): Promise<T> {
  const response = await fetchLimited(url, MAX_HTML_BYTES, { Accept: 'application/json', ...headers })
  return JSON.parse(response.data.toString('utf8')) as T
}

async function fetchLimited(url: URL, limit: number, headers?: Record<string, string>): Promise<{ data: Buffer; contentType: string }> {
  const response = await requestBuffer(url, {
    timeoutMs: 10_000,
    maxBytes: limit,
    headers: { 'User-Agent': 'AuroraPlayer/1.0 (media metadata parser)', Accept: 'text/html,application/xhtml+xml,image/*;q=0.8', ...headers }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { data: response.data, contentType: String(response.headers['content-type'] ?? '') }
}

function absoluteUrl(value: string, base: URL): string | undefined {
  try {
    if (!value) return undefined
    const url = new URL(decodeHtml(value), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}
