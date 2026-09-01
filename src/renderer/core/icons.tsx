import React from 'react'

const paths: Record<string, string> = {
  play: 'M8 5.14v14l11-7-11-7z',
  home: 'M3 11L12 3l9 8M5 10v10h5v-6h4v6h5V10',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  prev: 'M18 6l-8.5 6L18 18V6zM6 6h2v12H6V6z',
  stop: 'M6 6h12v12H6z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zM16 8a5 5 0 010 8M18.5 5.5a9 9 0 010 13',
  volumeMute: 'M3 9v6h4l5 5V4L7 9H3zm14 0l4 6m0-6l-4 6',
  shuffle: 'M18 4l2 2-2 2M2 6h3c5 0 5 12 10 12h3m0 0l-2-2m2 2l2-2M18 18l2-2-2-2M2 18h3c1.5 0 2.6-.4 3.4-1',
  repeat: 'M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3',
  repeatOne: 'M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3M12 9v6m0-6l-1.5 1M12 9l1.5 1',
  folder: 'M3 6a2 2 0 012-2h5l2 2h7a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z',
  video: 'M4 6h11a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zm11 3l5-2v10l-5-2',
  music: 'M9 18V5l12-2v13M9 18a2 2 0 11-2-2 2 2 0 012 2zm12-2a2 2 0 11-2-2 2 2 0 012 2z',
  image: 'M4 5h16v14H4V5zm0 10l4-4 3 3 4-5 5 6',
  playlist: 'M2 6h12v2H2V6zm0 5h12v2H2v-2zm0 5h8v2H2v-2zm14-1l5 3-5 3v-6z',
  remote: 'M12 12a4 4 0 100 8 4 4 0 000-8zm0 0a8 8 0 018 8M12 12a8 8 0 01-8 8M12 3a13 13 0 0113 13M12 3a13 13 0 00-13 13',
  network: 'M10 12a3 3 0 10-6 0 3 3 0 006 0zm11-6a3 3 0 10-6 0 3 3 0 006 0zm0 12a3 3 0 10-6 0 3 3 0 006 0zM9.5 10.5l5.8-3M9.5 13.5l5.8 3',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7.4 7.4 0 00-2-1.2L14.5 3h-5l-.5 2.6a7.4 7.4 0 00-2 1.2l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 000 2.4l-2 1.5 2 3.4 2.3-1a7.4 7.4 0 002 1.2l.5 2.7h5l.5-2.6a7.4 7.4 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  search: 'M21 21l-4.3-4.3M11 19a8 8 0 100-16 8 8 0 000 16z',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  heart: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z',
  heartFilled: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z',
  close: 'M6 6l12 12M18 6L6 18',
  minimize: 'M5 12h14',
  maximize: 'M5 5h14v14H5z',
  restore: 'M7 7h10v10H7zM5 5h10v2M17 5h2v10',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  more: 'M12 6a2 2 0 110-4 2 2 0 010 4zm0 8a2 2 0 110-4 2 2 0 010 4zm0 8a2 2 0 110-4 2 2 0 010 4z',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-13v5m0 3v.5',
  help: 'M9.7 9a2.5 2.5 0 115 1.4c0 1.8-2.7 2-2.7 4.1m0 3h.01M12 21a9 9 0 100-18 9 9 0 000 18z',
  speed: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-18v4m0 0l-4 4m4-4l3-1',
  subtitle: 'M4 5h16v14H4V5zm2 9h6m-6 3h10',
  language: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-18c3 2.5 3 12.5 0 18m0-18c-3 2.5-3 12.5 0 18M3.5 9h17m-17 6h17',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zm0-15v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M4 12.5l5 5L20 6.5',
  up: 'M12 19V5m0 0l-6 6m6-6l6 6',
  grid: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.5m-.5 6h.5m-.5 6h.5',
  edit: 'M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17v3zm9.5-12.5l3 3',
  trash: 'M4 7h16M9 7V4h6v3m-8 0l1 14h8l1-14',
  refresh: 'M20 12a8 8 0 11-2.3-5.6M20 4v4h-4',
  link: 'M10 14a5 5 0 007.1.1l3-3a5 5 0 00-7.1-7.1l-1.7 1.7M14 10a5 5 0 00-7.1-.1l-3 3a5 5 0 007.1 7.1l1.7-1.7',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-13v5l3 2',
  star: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17.5 6.5 20l1-6.1L3 9.5l6.3-.9L12 3z',
  starFilled: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17.5 6.5 20l1-6.1L3 9.5l6.3-.9L12 3z',
  alert: 'M12 3L2 20h20L12 3zm0 7v4m0 3v.5',
  tray: 'M3 15h5v-2h8v2h5v4H3v-4zM12 3v9m0 0l-3-3m3 3l3-3',
  mic: 'M12 15a4 4 0 004-4V6a4 4 0 00-8 0v5a4 4 0 004 4zm-7-5a7 7 0 0014 0m-7 7v3m-4 0h8',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  archive: 'M4 5h16v4H4V5zm2 4v11h12V9m-8 4h4',
  library: 'M4 4h5v16H4V4zm6 0h5v16h-5V4zm7 1l3-.5L22 19l-3 .5L17 5z',
  sidebar: 'M4 4h16v16H4V4zm5 0v16',
  sliders: 'M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4',
  paintbrush: 'M14.5 4.5l5 5M4 20l5.5-1 9-9a2.12 2.12 0 00-3-3l-9 9L4 20zm8-10l2 2',
  history: 'M12 3a9 9 0 11-9 9h2a7 7 0 107-7 7 7 0 00-6 3.4L14 12H5l3.6-3.6',
  bell: 'M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9zM9.5 20h5',
  disc: 'M12 12a2 2 0 100-4 2 2 0 000 4zm0 0a6 6 0 016-6M12 12a6 6 0 01-6 6',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  fullscreenExit: 'M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5',
  cast: 'M3 18.5a2.5 2.5 0 012.5 2.5M3 14a7 7 0 017 7M3 9.5A11.5 11.5 0 0114.5 21M7 5h12a2 2 0 012 2v10a2 2 0 01-2 2h-4',
  rewind10: 'M9 7H5V3M5 7a8.5 8.5 0 11-1 8',
  forward10: 'M15 7h3V3m0 4a8.5 8.5 0 101 8',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zm0 0v5h5',
  server: 'M3 4h18v6H3V4zm0 10h18v6H3v-6zm3-3v.5M3 5v.5M3 15v.5',
  track: 'M4 6h16v12H4V6zm2 3h6m-6 4h4M14 9h2m-2 4h2',
  logo: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 3a6 6 0 110 12 6 6 0 010-12z'
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 18, className, style, strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number }) {
  const hasTenLabel = name === 'rewind10' || name === 'forward10'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d={paths[name]} />
      {hasTenLabel && (
        <text
          x="11.45"
          y="11.55"
          fill="currentColor"
          stroke="none"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Space Grotesk Variable, Noto Sans SC Variable, Segoe UI, sans-serif"
          fontSize="7.2"
          fontWeight="650"
        >
          10
        </text>
      )}
    </svg>
  )
}

export function FilledIcon({ name, size = 18, className, style, color }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color ?? 'currentColor'} className={className} style={style} aria-hidden>
      <path d={paths[name]} />
    </svg>
  )
}
