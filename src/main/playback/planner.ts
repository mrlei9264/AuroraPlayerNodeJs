import type { MediaItem, PlayPlan, PlayRequest, MediaKind } from '../../shared/types'
import { getResumePosition } from '../../shared/playback'

export interface PlannerDeps {
  itemById: (id: number) => MediaItem | null
  fileExists: (p: string) => boolean
  sourceAvailable: (sourceId: number) => boolean
  resumePlayback: () => boolean
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
      if (!item.sourceAvailable || !this.deps.fileExists(item.url)) {
        return { ok: false, result: 'localFileMissing', item, url: '', kind, resumePosition: 0 }
      }
    } else if (item.sourceId !== null) {
      if (!item.sourceAvailable || !this.deps.sourceAvailable(item.sourceId)) {
        return { ok: false, result: 'remoteSourceMissing', item, url: '', kind, resumePosition: 0 }
      }
    }

    if (!item.sourceAvailable) return { ok: false, result: 'remoteSourceMissing', item, url: '', kind, resumePosition: 0 }
    const url = this.deps.urlFor(item)
    // Accept both URLs (http/https) and local file paths
    const isValidUrl = /^https?:\/\//.test(url)
    const isLocalPath = !isValidUrl && url.length > 0 && !url.startsWith('data:')
    if (!isValidUrl && !isLocalPath) {
      return { ok: false, result: 'invalidRequest', item, url: '', kind, resumePosition: 0 }
    }
    if (request.action === 'restart' || request.action === 'playNext' || request.action === 'playPrevious') {
      return { ok: true, result: 'ready', item, url, kind, resumePosition: 0 }
    }
    const resumePosition = getResumePosition(item, this.deps.resumePlayback())
    return { ok: true, result: 'ready', item, url, kind, resumePosition }
  }
}
