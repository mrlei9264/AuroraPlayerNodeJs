import fs from 'fs'
import type { MediaItem, PlayPlan, PlayRequest, MediaKind } from '../../shared/types'

export interface PlannerDeps {
  itemById: (id: number) => MediaItem | null
  itemsByIds: (ids: number[]) => MediaItem[]
  fileExists: (p: string) => boolean
  sourceAvailable: (sourceId: number) => boolean
  resumePlayback: () => boolean
  rememberPlaybackPosition: () => boolean
  urlFor: (item: MediaItem) => string
}

export type PlanResult = 'ready' | 'invalidRequest' | 'localFileMissing' | 'remoteSourceMissing'

export class PlaybackLaunchPlanner {
  constructor(private deps: PlannerDeps) {}

  plan(request: PlayRequest): PlayPlan {
    const ids = request.mediaIds
    if (!ids.length || request.index < 0 || request.index >= ids.length) {
      return { ok: false, result: 'invalidRequest', item: null, url: '', kind: 'video', resumePosition: 0 }
    }
    const id = ids[request.index]
    const item = this.deps.itemById(id)
    if (!item || item.isImage) {
      return { ok: false, result: 'invalidRequest', item: null, url: '', kind: 'video', resumePosition: 0 }
    }

    const kind: MediaKind = item.isAudio ? 'audio' : 'video'

    if (item.protocol === 'local') {
      if (!this.deps.fileExists(item.url)) {
        return { ok: false, result: 'localFileMissing', item, url: '', kind, resumePosition: 0 }
      }
    } else if (item.sourceId !== null) {
      if (!this.deps.sourceAvailable(item.sourceId)) {
        return { ok: false, result: 'remoteSourceMissing', item, url: '', kind, resumePosition: 0 }
      }
    }

    const url = this.deps.urlFor(item)
    if (request.action === 'restart' || request.action === 'playNext' || request.action === 'playPrevious') {
      return { ok: true, result: 'ready', item, url, kind, resumePosition: 0 }
    }
    const resumePosition = this.decideResume(item, kind)
    return { ok: true, result: 'ready', item, url, kind, resumePosition }
  }

  decideResume(item: MediaItem, kind: MediaKind): number {
    if (!this.deps.resumePlayback() || !this.deps.rememberPlaybackPosition()) return 0
    const pos = item.lastPosition
    if (pos <= 0 || pos > Math.max(30, item.duration || 0) - 5) return 0
    return pos
  }
}

export class PlaybackQueueCoordinator {
  naturalEnd(current: number, count: number, repeat: 'none' | 'all' | 'one'): number | null {
    if (count === 0) return null
    if (repeat === 'one') return current
    const next = current + 1
    if (next < count) return next
    return repeat === 'all' ? 0 : null
  }

  previous(current: number, count: number, repeat: 'none' | 'all' | 'one'): number | null {
    if (count === 0) return null
    if (repeat === 'one') return current
    const prev = current - 1
    if (prev >= 0) return prev
    return repeat === 'all' ? count - 1 : null
  }

  next(current: number, count: number, repeat: 'none' | 'all' | 'one'): number | null {
    return this.naturalEnd(current, count, repeat)
  }

  shuffleOrder(count: number, seed?: number): number[] {
    const order = Array.from({ length: count }, (_, i) => i)
    let s = seed ?? Date.now() % 100000
    for (let i = order.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280
      const j = Math.floor((s / 233280) * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    return order
  }

  moveCorrectsIndex(current: number, from: number, to: number): number {
    if (current === from) return to
    if (from < current && to >= current) return current - 1
    if (from > current && to <= current) return current + 1
    return current
  }
}

export function defaultPlannerDeps(partial: Partial<PlannerDeps>): PlannerDeps {
  return {
    itemById: () => null,
    itemsByIds: () => [],
    fileExists: (p) => fs.existsSync(p),
    sourceAvailable: () => false,
    resumePlayback: () => true,
    rememberPlaybackPosition: () => true,
    urlFor: (item) => item.url,
    ...partial
  }
}
