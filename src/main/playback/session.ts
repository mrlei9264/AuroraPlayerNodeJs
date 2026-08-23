import type { SessionPhase, SessionState, MediaKind } from '../../shared/types'

export type SessionEvent =
  | { type: 'loadStart'; mediaId: number | null }
  | { type: 'loaded' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'buffering' }
  | { type: 'seekStart' }
  | { type: 'seekEnd' }
  | { type: 'error'; message: string }
  | { type: 'ended' }
  | { type: 'position'; position: number; duration: number }
  | { type: 'volume'; volume: number }
  | { type: 'muted'; muted: boolean }
  | { type: 'speed'; speed: number }
  | { type: 'repeat'; mode: 'none' | 'all' | 'one' }
  | { type: 'shuffle'; shuffle: boolean }
  | { type: 'idle' }

export function createSessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    phase: 'idle',
    kind: 'video',
    mediaId: null,
    position: 0,
    duration: 0,
    paused: true,
    loaded: false,
    buffering: false,
    seeking: false,
    idle: true,
    error: null,
    volume: 80,
    muted: false,
    speed: 1,
    repeatMode: 'none',
    shuffle: false,
    lastPositionKnown: 0,
    ...overrides
  }
}

export class PlaybackSessionController {
  state: SessionState = createSessionState()
  private listeners = new Set<(s: SessionState) => void>()

  constructor(private initial: Partial<SessionState> = {}) {
    this.state = createSessionState(initial)
  }

  on(listener: (s: SessionState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): SessionState {
    return { ...this.state }
  }

  dispatch(ev: SessionEvent): void {
    switch (ev.type) {
      case 'loadStart':
        this.state = {
          ...this.state,
          phase: 'loading',
          mediaId: ev.mediaId,
          loaded: false,
          buffering: false,
          seeking: false,
          idle: false,
          error: null,
          position: 0,
          duration: 0,
          paused: true
        }
        break
      case 'loaded':
        this.state = { ...this.state, loaded: true, buffering: false, phase: this.state.paused ? 'paused' : 'playing' }
        break
      case 'playing':
        this.state = { ...this.state, phase: 'playing', paused: false, buffering: false, idle: false, error: null }
        break
      case 'paused':
        this.state = { ...this.state, phase: 'paused', paused: true, buffering: false }
        break
      case 'buffering':
        this.state = { ...this.state, phase: 'buffering', buffering: true, paused: true }
        break
      case 'seekStart':
        this.state = { ...this.state, seeking: true }
        break
      case 'seekEnd':
        this.state = { ...this.state, seeking: false }
        break
      case 'error':
        this.state = { ...this.state, phase: 'error', error: ev.message, idle: false, loaded: false, paused: true, buffering: false, seeking: false }
        break
      case 'ended':
        this.state = { ...this.state, paused: true, position: this.state.duration }
        break
      case 'position':
        this.state = { ...this.state, position: ev.position, duration: ev.duration || this.state.duration }
        break
      case 'volume':
        this.state = { ...this.state, volume: ev.volume }
        break
      case 'muted':
        this.state = { ...this.state, muted: ev.muted }
        break
      case 'speed':
        this.state = { ...this.state, speed: ev.speed }
        break
      case 'repeat':
        this.state = { ...this.state, repeatMode: ev.mode }
        break
      case 'shuffle':
        this.state = { ...this.state, shuffle: ev.shuffle }
        break
      case 'idle':
        this.state = { ...this.state, phase: 'idle', idle: true, loaded: false, mediaId: null, position: 0, duration: 0, paused: true, buffering: false, seeking: false, error: null }
        break
    }
    for (const l of this.listeners) l(this.snapshot())
  }

  setKind(kind: MediaKind): void {
    this.state.kind = kind
    for (const l of this.listeners) l(this.snapshot())
  }

  setLastPosition(pos: number): void {
    this.state.lastPositionKnown = pos
  }
}

export function phaseLabel(phase: SessionPhase): string {
  return phase
}
