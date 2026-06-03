import { useState, useRef, useCallback, useEffect } from 'react'
import type React from 'react'
import { clampWidth, computeWidth } from './clampWidth'
import { KEYBOARD_STEP, KEYBOARD_STEP_LARGE, MOBILE_BREAKPOINT } from './constants'

export interface UseResizableOptions {
  defaultWidth: number
  minWidth: number
  maxWidthRatio: number
}

export interface UseResizableReturn {
  width: number
  isDragging: boolean
  isMobile: boolean
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void
    onKeyDown: (e: React.KeyboardEvent) => void
    tabIndex: number
    role: string
    'aria-orientation': string
    'aria-valuemin': number
    'aria-valuemax': number
    'aria-valuenow': number
    'aria-label': string
  }
}

export function useResizable(options: UseResizableOptions): UseResizableReturn {
  const { defaultWidth, minWidth, maxWidthRatio } = options

  const [width, setWidth] = useState(defaultWidth)
  const [isDragging, setIsDragging] = useState(false)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
  })

  const dragStartOffsetRef = useRef(0)
  const targetRef = useRef<Element | null>(null)
  const isDraggingRef = useRef(isDragging)
  isDraggingRef.current = isDragging

  // Stable refs for pointer handlers so the matchMedia effect can remove them
  const handlePointerMoveRef = useRef<(e: PointerEvent) => void>(() => {})
  const handlePointerEndRef = useRef<(e: PointerEvent) => void>(() => {})

  const getMaxWidth = useCallback(
    () => Math.floor(document.body.clientWidth * maxWidthRatio),
    [maxWidthRatio],
  )

  const cleanup = useCallback(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setIsDragging(false)
  }, [])

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const maxWidth = getMaxWidth()
      const newWidth = computeWidth(e.clientX, dragStartOffsetRef.current, minWidth, maxWidth)
      setWidth(newWidth)
    },
    [getMaxWidth, minWidth],
  )

  const handlePointerEnd = useCallback(
    (e: PointerEvent) => {
      const el = targetRef.current
      if (el) {
        ;(el as HTMLElement).releasePointerCapture(e.pointerId)
      }
      document.removeEventListener('pointermove', handlePointerMoveRef.current)
      document.removeEventListener('pointerup', handlePointerEndRef.current)
      document.removeEventListener('pointercancel', handlePointerEndRef.current)
      targetRef.current = null
      cleanup()
    },
    [cleanup],
  )

  // Keep refs in sync with latest callbacks
  handlePointerMoveRef.current = handlePointerMove
  handlePointerEndRef.current = handlePointerEnd

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return

      dragStartOffsetRef.current = e.clientX - width
      targetRef.current = e.currentTarget

      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      setIsDragging(true)

      document.addEventListener('pointermove', handlePointerMoveRef.current)
      document.addEventListener('pointerup', handlePointerEndRef.current)
      document.addEventListener('pointercancel', handlePointerEndRef.current)
    },
    [width],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP
      let delta: number | null = null

      if (e.key === 'ArrowRight') {
        delta = step
      } else if (e.key === 'ArrowLeft') {
        delta = -step
      }

      if (delta === null) return

      e.preventDefault()
      const maxWidth = getMaxWidth()
      setWidth((prev) => clampWidth(prev + delta, minWidth, maxWidth))
    },
    [getMaxWidth, minWidth],
  )

  // Mobile breakpoint listener — cancels drag if viewport transitions to mobile
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)

    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
      if (e.matches && isDraggingRef.current) {
        document.removeEventListener('pointermove', handlePointerMoveRef.current)
        document.removeEventListener('pointerup', handlePointerEndRef.current)
        document.removeEventListener('pointercancel', handlePointerEndRef.current)
        targetRef.current = null
        cleanup()
      }
    }

    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [cleanup])

  const maxWidth = getMaxWidth()

  const handleProps: UseResizableReturn['handleProps'] = {
    onPointerDown: handlePointerDown,
    onKeyDown: handleKeyDown,
    tabIndex: 0,
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuemin': minWidth,
    'aria-valuemax': maxWidth,
    'aria-valuenow': width,
    'aria-label': 'Resize sidebar',
  }

  return { width, isDragging, isMobile, handleProps }
}
