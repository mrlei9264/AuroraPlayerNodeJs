import type { MediaItem } from './types'

export function isPlaybackComplete(item: Pick<MediaItem, 'lastPosition' | 'duration'>): boolean {
  return item.duration > 0 && item.lastPosition > 0 && item.lastPosition >= item.duration - 5
}

/** Shared by the launch planner and resume buttons, so their behavior agrees. */
export function getResumePosition(item: Pick<MediaItem, 'lastPosition' | 'duration'>, enabled: boolean): number {
  if (!enabled || !Number.isFinite(item.lastPosition) || item.lastPosition <= 0) return 0
  if (isPlaybackComplete(item)) return 0
  return item.lastPosition
}
