import React, { useEffect, useRef, useState } from 'react'

const MIN_WIDTH = 160
const DEFAULT_WIDTH = 248
const MAX_WIDTH = 440
const STORAGE_KEY = 'aurora.network.sidebar-width.v1'

function readWidth() {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(value) && value >= MIN_WIDTH) return Math.min(MAX_WIDTH, value)
  } catch { /* Use the default when storage is unavailable. */ }
  return DEFAULT_WIDTH
}

export function ResizableWorkspace({ sidebar, children, label }: {
  sidebar: React.ReactNode
  children: React.ReactNode
  label: string
}) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const [width, setWidth] = useState(readWidth)
  const [maximum, setMaximum] = useState(MAX_WIDTH)
  const [dragging, setDragging] = useState(false)
  const actualWidth = Math.min(width, maximum)
  const clamp = (value: number) => Math.max(MIN_WIDTH, Math.min(maximum, value))

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const update = () => setMaximum(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, workspace.clientWidth - 368)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, String(width)) } catch { /* Resizing still works without storage. */ }
  }, [width])

  return <div ref={workspaceRef} className="network-browser-workspace" data-resizing={dragging || undefined}
    style={{ '--browser-tree-width': `${actualWidth}px` } as React.CSSProperties}>
    {sidebar}
    <div className="network-workspace-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={label}
      aria-valuemin={MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={Math.round(actualWidth)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 16
        const next = event.key === 'ArrowLeft' ? actualWidth - step : event.key === 'ArrowRight' ? actualWidth + step
          : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? maximum : null
        if (next === null) return
        event.preventDefault()
        setWidth(clamp(next))
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        dragRef.current = { pointerId: event.pointerId, x: event.clientX, width: actualWidth }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (drag?.pointerId === event.pointerId) setWidth(clamp(drag.width + event.clientX - drag.x))
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return
        dragRef.current = null
        setDragging(false)
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => { dragRef.current = null; setDragging(false) }}
      onPointerCancel={() => { dragRef.current = null; setDragging(false) }}>
      <span />
    </div>
    {children}
  </div>
}
