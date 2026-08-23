import React, { useEffect, useRef } from 'react'
import { useRuntime } from '../core/runtime'
import { coverUrl } from '../core/player'

export function AuroraBackground({ seed = 7 }: { seed?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { theme, settings } = useRuntime()
  const settingsReducedMotion = settings?.reducedMotion ?? false

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    let w = 0
    let h = 0
    let t = 0
    const c1 = theme.colors.accentStart
    const c2 = theme.colors.accentEnd
    const c3 = theme.colors.neonCyan
    const reduce = settingsReducedMotion

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, w * dpr)
      canvas.height = Math.max(1, h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const hexToRgb = (hex: string): [number, number, number] => {
      const n = parseInt(hex.slice(1), 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    const [r1, g1, b1] = hexToRgb(c1)
    const [r2, g2, b2] = hexToRgb(c2)
    const [r3, g3, b3] = hexToRgb(c3)
    const blob = (x: number, y: number, rad: number, r: number, g: number, b: number, a: number) => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rad)
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, rad, 0, Math.PI * 2)
      ctx.fill()
    }

    const draw = () => {
      t += 0.004
      ctx.clearRect(0, 0, w, h)
      const a = Math.min(1, theme.colors.accentSoft ? 0.16 : 0.16)
      const n = reduce ? 3 : 6
      for (let i = 0; i < n; i++) {
        const ph = t * (0.5 + i * 0.13) + i * 2.1
        const x = w / 2 + Math.sin(ph) * w * 0.32 + (seed % 5) * 20
        const y = h / 2 + Math.cos(ph * 1.3) * h * 0.26 + (seed % 3) * 16
        const rad = w * 0.22 + Math.sin(ph * 0.7) * w * 0.08
        const col = i % 3 === 0 ? [r1, g1, b1] : i % 3 === 1 ? [r2, g2, b2] : [r3, g3, b3]
        blob(x, y, rad, col[0], col[1], col[2], a)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [theme, seed])

  return <canvas ref={canvasRef} className="viz-canvas" style={{ opacity: theme.richEffectsEnabled ? 0.85 : 0.35 }} />
}

export function SpectrumBars({ samples, count = 32 }: { samples: Float32Array; count?: number }) {
  const bars = []
  for (let i = 0; i < count; i++) {
    const idx = Math.min(samples.length - 1, Math.floor((i / count) * samples.length))
    const v = Math.min(1, samples[idx] * 1.6)
    bars.push(v)
  }
  return (
    <div className="spectrum-bar">
      {bars.map((v, i) => (
        <div
          key={i}
          className="sb"
          style={{
            height: `${Math.max(3, v * 40)}px`,
          }}
        />
      ))}
    </div>
  )
}

export function Artwork({ src, size = 'md', rounded = 'lg', className }: { src?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; rounded?: string; className?: string }) {
  const dims = { sm: 44, md: 72, lg: 120, xl: 200 }[size]
  return (
    <div
      className={className}
      style={{
        width: dims,
        height: dims,
        borderRadius: rounded === 'lg' ? '16px' : rounded === 'full' ? '50%' : rounded,
        background: 'var(--accent-gradient-soft)',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        boxShadow: '0 4px 18px var(--shadow)'
      }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
      ) : (
        <div
          className="w-full h-full"
          style={{
            background: `radial-gradient(120% 120% at 30% 20%, var(--accent-soft), transparent 60%), radial-gradient(120% 120% at 70% 80%, var(--accent-soft), transparent 60%)`
          }}
        />
      )}
    </div>
  )
}

export function WaveformSvg({ points, className }: { points: number[]; className?: string }) {
  const w = 100
  const h = 24
  const n = points.length || 64
  const pts = points.length ? points : Array.from({ length: n }, (_, i) => 0.25 + 0.5 * Math.abs(Math.sin(i * 0.9)))
  const d = pts.map((p, i) => {
    const x = (i / (n - 1)) * w
    const y = h / 2 + (p - 0.5) * h
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} style={{ width: '100%', height: '100%' }}>
      <path d={d} fill="none" stroke="url(#wg)" strokeWidth={1.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <defs>
        <linearGradient id="wg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent-start)" />
          <stop offset="100%" stopColor="var(--accent-end)" />
        </linearGradient>
      </defs>
    </svg>
  )
}