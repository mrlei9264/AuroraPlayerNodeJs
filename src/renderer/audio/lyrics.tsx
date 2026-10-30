import React, { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import type { LyricsData, LyricsLine, SessionState } from '../../shared/types'

type LyricsProps = {
  lyrics: LyricsData | null
  session: SessionState
  reducedMotion: boolean
  label: string
  emptyLabel: string
}

export function AudioLyrics({ lyrics, session, reducedMotion, label, emptyLabel }: LyricsProps) {
  const systemReducedMotion = useReducedMotion()
  const reduceMotion = reducedMotion || Boolean(systemReducedMotion)
  const viewportRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const previousIndex = useRef<number | null>(null)
  const lines = useMemo(() => {
    const all = lyrics?.lines ?? []
    // Keep timed empty lines: they mark instrumental pauses in many LRC files.
    return all.some((line) => line.time >= 0)
      ? all.filter((line) => line.time >= 0)
      : all.filter((line) => line.text.trim())
  }, [lyrics])
  const endTimes = useMemo(() => {
    const times: (number | undefined)[] = new Array(lines.length)
    let nextTime: number | undefined
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (index + 1 < lines.length && lines[index + 1].time > lines[index].time) nextTime = lines[index + 1].time
      times[index] = nextTime
    }
    return times
  }, [lines])
  const timed = lines.some((line) => line.time >= 0)
  const position = session.position - (lyrics?.offsetMs ?? 0) / 1000
  const running = session.loaded && !session.paused && !session.buffering && !session.seeking && session.phase === 'playing'
  let activeIndex = -1
  for (let index = 0; timed && index < lines.length; index += 1) {
    if (lines[index].time > position) break
    activeIndex = index
  }
  // Keep translations with the same timestamp in the same focal plane.
  while (activeIndex > 0 && lines[activeIndex - 1].time === lines[activeIndex].time) activeIndex -= 1
  const activeTime = activeIndex < 0 ? undefined : lines[activeIndex].time

  useLayoutEffect(() => {
    previousIndex.current = null
  }, [lyrics, session.mediaId])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track || !timed) return
    const index = Math.max(0, activeIndex)
    const focal = track.children[index] as HTMLElement | undefined
    if (!focal) return
    const move = (animate: boolean) => {
      const last = Array.from(track.children).filter((child) => child.getAttribute('data-active') === 'true').at(-1) as HTMLElement | undefined
      const bottom = last ? last.offsetTop + last.offsetHeight : focal.offsetTop + focal.offsetHeight
      const groupHeight = bottom - focal.offsetTop
      // Very long lines start near the top instead of being clipped on both sides.
      const anchor = groupHeight > viewport.clientHeight * .72
        ? viewport.clientHeight * .14 - focal.offsetTop
        : viewport.clientHeight * .46 - (focal.offsetTop + bottom) / 2
      track.style.transition = animate ? '' : 'none'
      track.style.transform = `translate3d(0, ${anchor}px, 0)`
    }
    const previous = previousIndex.current
    move(!reduceMotion && !session.seeking && previous !== null && Math.abs(index - previous) <= 3)
    previousIndex.current = index
    let size = `${viewport.clientWidth}:${viewport.clientHeight}:${track.offsetHeight}`
    const observer = new ResizeObserver(() => {
      const nextSize = `${viewport.clientWidth}:${viewport.clientHeight}:${track.offsetHeight}`
      // The observer's initial notification must not cancel the camera transition.
      if (size === nextSize) return
      size = nextSize
      move(false)
    })
    observer.observe(viewport)
    observer.observe(track)
    return () => observer.disconnect()
  }, [activeIndex, lines, reduceMotion, session.seeking, timed])

  return (
    <section
      ref={viewportRef}
      className={`audio-lyrics-panel ${reduceMotion ? 'is-reduced' : ''} ${timed ? 'is-timed' : 'is-untimed'}`}
      aria-label={label}
      tabIndex={!timed && lines.length ? 0 : undefined}
    >
      {lines.length ? (
        <div className="audio-lyrics-track" ref={trackRef}>
          {lines.map((line, index) => {
            const active = timed && activeTime !== undefined && line.time === activeTime
            const distance = timed ? Math.min(3, Math.abs(index - Math.max(0, activeIndex))) : 0
            return (
              <div
                key={index}
                className={`audio-lyric-line ${active ? 'active' : timed && index < activeIndex ? 'played' : 'upcoming'}`}
                data-active={active}
                data-distance={active ? 0 : distance}
                aria-current={active ? 'true' : undefined}
              >
                <LyricText
                  line={line}
                  active={active}
                  position={position}
                  endTime={endTimes[index]}
                  running={running}
                  speed={session.speed}
                  reduceMotion={reduceMotion}
                />
              </div>
            )
          })}
        </div>
      ) : <div className="audio-lyrics-empty">{emptyLabel}</div>}
    </section>
  )
}

const LyricText = memo(function LyricText({ line, active, position, endTime, running, speed, reduceMotion }: {
  line: LyricsLine
  active: boolean
  position: number
  endTime?: number
  running: boolean
  speed: number
  reduceMotion: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const wordTimed = Boolean(line.words?.length)
  const segments = useMemo(() => {
    if (line.words?.length) return line.words.map((word) => ({ text: word.text, start: 0, end: 1, word }))
    // These ranges control the visual entrance only; they are not word timestamps.
    const parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(line.text), (part) => part.segment)
    const length = Math.max(1, line.text.length)
    let offset = 0
    return (parts.length ? parts : ['']).map((text) => {
      const start = offset / length
      offset += text.length
      return { text, start, end: offset / length, word: undefined }
    })
  }, [line])
  const clock = useRef({ position, receivedAt: performance.now(), running, speed })
  useLayoutEffect(() => {
    clock.current = { position, receivedAt: performance.now(), running, speed }
  }, [position, running, speed])

  useLayoutEffect(() => {
    if (!active || reduceMotion) return
    const tokens = ref.current?.querySelectorAll<HTMLElement>('.audio-lyric-token')
    if (!tokens) return
    let frame = 0
    const paint = () => {
      const sample = clock.current
      // Bound interpolation so a stalled playback clock cannot keep singing ahead.
      const elapsed = sample.running ? Math.min(.3, (performance.now() - sample.receivedAt) / 1000) * sample.speed : 0
      const now = sample.position + elapsed
      const available = endTime === undefined ? 3 : Math.max(.1, endTime - line.time)
      const settle = available > 1.2 ? Math.min(.32, available * .15) : 0
      const revealDuration = Math.min(2.6, Math.max(.12, available - settle - .08))
      const entrance = Math.min(1, Math.max(0, (now - line.time - settle) / revealDuration))
      tokens.forEach((token, index) => {
        const segment = segments[index]
        const word = segment.word
        const end = word?.endTime ?? line.words?.[index + 1]?.time ?? endTime
        const progress = word
          ? end !== undefined && end > word.time
            ? Math.min(1, Math.max(0, (now - word.time) / (end - word.time)))
            : now >= word.time ? 1 : 0
          : Math.min(1, Math.max(0, (entrance - segment.start) / Math.max(.001, segment.end - segment.start)))
        token.style.setProperty('--word-fill', `${progress * 116 - 8}%`)
        token.style.setProperty('--word-light', progress > 0 && progress < 1 ? String(Math.pow(Math.sin(progress * Math.PI), .5)) : '0')
      })
      if (sample.running) frame = requestAnimationFrame(paint)
    }
    paint()
    return () => cancelAnimationFrame(frame)
  }, [active, line, segments, endTime, reduceMotion, running, position])

  return (
    <span ref={ref} className={`audio-lyric-text ${wordTimed ? 'has-word-timing' : 'line-reveal'}`}>
      <span className="audio-lyric-accessible">{line.text}</span>
      <span aria-hidden="true">
        {segments.map((segment, index) => (
          <span className="audio-lyric-token" key={index}>
            <span className="audio-lyric-base">{segment.text || '\u00a0'}</span>
            <span className="audio-lyric-ink">{segment.text || '\u00a0'}</span>
            <span className="audio-lyric-light">{segment.text || '\u00a0'}</span>
          </span>
        ))}
      </span>
    </span>
  )
}, (previous, next) => previous.line === next.line && previous.active === next.active
  && previous.endTime === next.endTime && previous.running === next.running
  && previous.speed === next.speed && previous.reduceMotion === next.reduceMotion
  && (!next.active || previous.position === next.position))
