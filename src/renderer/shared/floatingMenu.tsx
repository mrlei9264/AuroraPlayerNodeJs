import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface FloatingMenuProps {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  className: string
  children: React.ReactNode
  role?: React.AriaRole
  ariaLabel?: string
  align?: 'start' | 'end'
  width?: number | 'anchor'
  gap?: number
  viewportMargin?: number
  maxHeight?: number
}

interface FloatingPosition {
  top: number
  left: number
  width?: number
  maxHeight: number
  variables: Record<string, string>
}

const SCOPED_THEME_VARIABLES = [
  '--font-scale', '--control-scale',
  '--settings-font-small', '--settings-font-large', '--settings-text', '--settings-muted',
  '--network-font-scale', '--network-v2-panel', '--network-v2-panel-solid', '--network-v2-raised', '--network-v2-border', '--network-v2-border-strong'
]

export function FloatingMenu({
  open,
  anchorRef,
  onClose,
  className,
  children,
  role,
  ariaLabel,
  align = 'start',
  width = 'anchor',
  gap = 7,
  viewportMargin = 8,
  maxHeight: heightLimit = 360
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<FloatingPosition | null>(null)

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return

    const anchorRect = anchor.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const anchorStyle = window.getComputedStyle(anchor)
    const variables = Object.fromEntries(SCOPED_THEME_VARIABLES.flatMap((name) => {
      const value = anchorStyle.getPropertyValue(name).trim()
      return value ? [[name, value]] : []
    }))
    const requestedWidth = width === 'anchor' ? anchorRect.width : width
    const menuWidth = Math.min(requestedWidth, Math.max(32, window.innerWidth - viewportMargin * 2))
    const availableBelow = Math.max(32, window.innerHeight - anchorRect.bottom - gap - viewportMargin)
    const availableAbove = Math.max(32, anchorRect.top - gap - viewportMargin)
    const desiredHeight = Math.min(menu.scrollHeight, heightLimit)
    const placeAbove = desiredHeight > availableBelow && availableAbove > availableBelow
    const maxHeight = Math.min(heightLimit, placeAbove ? availableAbove : availableBelow)
    const measuredHeight = Math.min(desiredHeight, maxHeight)
    const desiredTop = placeAbove ? anchorRect.top - gap - measuredHeight : anchorRect.bottom + gap
    const desiredLeft = align === 'end' ? anchorRect.right - menuWidth : anchorRect.left
    const left = Math.min(Math.max(viewportMargin, desiredLeft), Math.max(viewportMargin, window.innerWidth - menuWidth - viewportMargin))

    setPosition({
      top: Math.min(Math.max(viewportMargin, desiredTop), window.innerHeight - measuredHeight - viewportMargin),
      left,
      width: menuWidth,
      maxHeight,
      variables
    })
  }, [align, anchorRef, gap, heightLimit, viewportMargin, width])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    const resizeObserver = new ResizeObserver(updatePosition)
    if (anchorRef.current) resizeObserver.observe(anchorRef.current)
    if (menuRef.current) resizeObserver.observe(menuRef.current)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open, updatePosition])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [anchorRef, onClose, open])

  if (!open) return null

  return createPortal(
    <div
      ref={menuRef}
      className={`floating-menu-layer ${className}`.trim()}
      role={role}
      aria-label={ariaLabel}
      style={{
        ...(position?.variables ?? {}),
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: position?.width,
        maxHeight: position?.maxHeight,
        visibility: position ? 'visible' : 'hidden'
      } as React.CSSProperties}
    >
      {children}
    </div>,
    document.body
  )
}
