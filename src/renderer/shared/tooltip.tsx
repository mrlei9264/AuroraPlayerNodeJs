import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type TooltipTarget = { element: HTMLElement; text: string }
const TOOLTIP_SELECTOR = '[data-tooltip]'

/** One tooltip layer for controls, truncated text and contextual help. */
export function TooltipHost() {
  const id = useId()
  const [target, setTarget] = useState<TooltipTarget | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer = 0
    let current: HTMLElement | null = null
    const hide = () => {
      window.clearTimeout(timer)
      current = null
      setTarget(null)
    }
    const find = (node: EventTarget | null) => node instanceof Element
      ? node.closest<HTMLElement>(TOOLTIP_SELECTOR) : null
    const show = (element: HTMLElement | null, delay: number) => {
      if (current === element) return
      hide()
      if (!element?.dataset.tooltip?.trim()) return
      current = element
      timer = window.setTimeout(() => {
        if (element.isConnected && element.dataset.tooltip?.trim()) {
          setPosition(null)
          setTarget({ element, text: element.dataset.tooltip.trim() })
        }
      }, delay)
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      show(find(event.target), 300)
    }
    const out = (event: PointerEvent) => {
      if (current && event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) return
      if (event.target instanceof Node && current?.contains(event.target)) hide()
    }
    const focus = (event: FocusEvent) => show(find(event.target), 0)
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && current?.contains(event.relatedTarget)) return
      hide()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', blur)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('blur', hide)
    window.addEventListener('resize', hide)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', blur)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('blur', hide)
      window.removeEventListener('resize', hide)
    }
  }, [])

  useLayoutEffect(() => {
    if (!target || !tooltipRef.current) return
    const anchor = target.element.getBoundingClientRect()
    const tip = tooltipRef.current.getBoundingClientRect()
    const margin = 8
    const gap = 8
    let left = anchor.left + (anchor.width - tip.width) / 2
    let top = anchor.bottom + gap
    if (target.element.dataset.tooltipSide === 'right') {
      left = anchor.right + gap
      if (left + tip.width > window.innerWidth - margin) left = anchor.left - gap - tip.width
      top = anchor.top + (anchor.height - tip.height) / 2
    } else if (top + tip.height > window.innerHeight - margin) {
      top = anchor.top - gap - tip.height
    }
    setPosition({
      left: Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - tip.height - margin))
    })
  }, [target])

  useEffect(() => {
    if (!target) return
    const { element } = target
    const descriptions = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    element.setAttribute('aria-describedby', [...new Set([...descriptions, id])].join(' '))
    const observer = new MutationObserver(() => {
      const text = element.dataset.tooltip?.trim()
      if (!element.isConnected || !text) setTarget(null)
      else if (text !== target.text) {
        setPosition(null)
        setTarget({ element, text })
      }
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tooltip'] })
    return () => {
      observer.disconnect()
      const remaining = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((value) => value && value !== id)
      if (remaining.length) element.setAttribute('aria-describedby', remaining.join(' '))
      else element.removeAttribute('aria-describedby')
    }
  }, [target, id])

  if (!target) return null
  return createPortal(
    <div ref={tooltipRef} id={id} role="tooltip" className="app-tooltip"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
      {target.text}
    </div>,
    document.fullscreenElement ?? document.body
  )
}
