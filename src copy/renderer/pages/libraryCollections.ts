export type CollectionMedia = {
  id: number
  title: string
  fileName: string
  duration: number
}

export type MediaCollection<T extends CollectionMedia> = {
  id: string
  title: string
  items: T[]
}

type CollectionIdentity = {
  key: string
  title: string
}

const EPISODE_TOKEN = /(^|[\s._\-[\]()])(?:s\d{1,2}[\s._-]*e\d{1,3}|(?:ep?|p|part|chapter|vol(?:ume)?)[\s._-]*0*\d{1,3}|第\s*[一二三四五六七八九十百零\d]+\s*[季集话期部])(?=$|[\s._\-[\]()])/gi
const TECH_TOKEN = /\b(?:2160p|1080p|720p|576p|480p|4k|8k|hdr10?|dolby|vision|bluray|blu-ray|web[- .]?dl|webrip|bdrip|remux|x26[45]|h[ .]?26[45]|hevc|av1|aac|dts|atmos)\b/gi
const YEAR_TOKEN = /(?:[\s._([{_-]|^)(?:19|20)\d{2}(?=$|[\s._)\]}-])/g

function stripExtension(value: string): string {
  return value.replace(/\.[a-z0-9]{2,5}$/i, '')
}

function identityFor(item: CollectionMedia): CollectionIdentity | null {
  const candidates = [item.title, item.fileName]
    .map((value) => stripExtension(value || '').trim())
    .filter(Boolean)
  const episodicSource = candidates.find((value) => {
      EPISODE_TOKEN.lastIndex = 0
      return value.length > 0 && EPISODE_TOKEN.test(value)
    })
  const source = episodicSource || candidates[0] || ''
  if (!source) return null

  EPISODE_TOKEN.lastIndex = 0

  const displayTitle = source
    .replace(EPISODE_TOKEN, '$1')
    .replace(TECH_TOKEN, ' ')
    .replace(YEAR_TOKEN, ' ')
    .replace(/[\s._-]+/g, ' ')
    .replace(/^[\s[\](){}-]+|[\s[\](){}-]+$/g, '')
    .trim()

  const key = displayTitle
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

  return key.length >= 3 ? { key, title: displayTitle } : null
}

function durationsAreSimilar(left: number, right: number): boolean {
  if (!(left > 0) || !(right > 0)) return true
  return Math.abs(left - right) <= Math.max(300, Math.max(left, right) * 0.25)
}

/** Detect episodic videos without mutating their order. */
export function collectSimilarVideos<T extends CollectionMedia>(items: T[]): MediaCollection<T>[] {
  const candidates = new Map<string, { title: string; items: T[] }>()
  for (const item of items) {
    const identity = identityFor(item)
    if (!identity) continue
    const candidate = candidates.get(identity.key) ?? { title: identity.title, items: [] }
    candidate.items.push(item)
    candidates.set(identity.key, candidate)
  }

  const result: MediaCollection<T>[] = []
  for (const [key, candidate] of candidates) {
    const durationClusters: T[][] = []
    for (const item of candidate.items) {
      const cluster = durationClusters.find((entries) => {
        const known = entries.find((entry) => entry.duration > 0)
        return !known || durationsAreSimilar(known.duration, item.duration)
      })
      if (cluster) cluster.push(item)
      else durationClusters.push([item])
    }
    durationClusters.forEach((cluster, index) => {
      if (cluster.length < 2) return
      result.push({
        id: `collection-${key}-${index}`,
        title: candidate.title,
        items: cluster
      })
    })
  }
  return result
}
