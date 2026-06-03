import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useResizable } from '../useResizable'
import type { UseResizableOptions } from '../useResizable'

const defaultOptions: UseResizableOptions = {
  defaultWidth: 272,
  minWidth: 120,
  maxWidthRatio: 0.5,
}

/**
 * Mock matchMedia so the hook can create its mobile breakpoint listener.
 * Returns a controllable MQL stub.
 */
function createMatchMediaMock(initialMatches = false) {
  let listener: ((e: MediaQueryListEvent) => void) | null = null
  const mql = {
    matches: initialMatches,
    media: `(max-width: 768px)`,
    addEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) => {
      listener = cb
    },
    removeEventListener: () => {
      listener = null
    },
  }

  const matchMedia = vi.fn().mockReturnValue(mql)
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, writable: true })

  /** Simulate a media-query change event */
  function triggerChange(matches: boolean) {
    mql.matches = matches
    if (listener) {
      listener({ matches } as MediaQueryListEvent)
    }
  }

  return { mql, triggerChange }
}

/** Set a fake body clientWidth for maxWidth calculations. */
function setBodyWidth(px: number) {
  Object.defineProperty(document.body, 'clientWidth', { value: px, configurable: true })
}

describe('useResizable', () => {
  let savedCursor: string
  let savedUserSelect: string

  beforeEach(() => {
    savedCursor = document.body.style.cursor
    savedUserSelect = document.body.style.userSelect
    setBodyWidth(1200)
    createMatchMediaMock(false)
  })

  afterEach(() => {
    document.body.style.cursor = savedCursor
    document.body.style.userSelect = savedUserSelect
    vi.restoreAllMocks()
  })

  it('returns default width of 272px', () => {
    const { result } = renderHook(() => useResizable(defaultOptions))

    expect(result.current.width).toBe(272)
  })

  it('drag start sets body cursor to col-resize and user-select to none', () => {
    const { result } = renderHook(() => useResizable(defaultOptions))

    act(() => {
      const event = {
        button: 0,
        clientX: 280,
        currentTarget: createFakeElement(),
      } as unknown as React.PointerEvent
      result.current.handleProps.onPointerDown(event)
    })

    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(result.current.isDragging).toBe(true)
  })

  it('drag end reverts body cursor and user-select', () => {
    const { result } = renderHook(() => useResizable(defaultOptions))
    const fakeEl = createFakeElement()

    // Start drag
    act(() => {
      const downEvent = {
        button: 0,
        clientX: 280,
        currentTarget: fakeEl,
      } as unknown as React.PointerEvent
      result.current.handleProps.onPointerDown(downEvent)
    })

    // End drag via pointerup
    act(() => {
      const upEvent = new PointerEvent('pointerup', { clientX: 300, pointerId: 1 })
      document.dispatchEvent(upEvent)
    })

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(result.current.isDragging).toBe(false)
  })

  it('pointercancel ends drag', () => {
    const { result } = renderHook(() => useResizable(defaultOptions))
    const fakeEl = createFakeElement()

    act(() => {
      const downEvent = {
        button: 0,
        clientX: 280,
        currentTarget: fakeEl,
      } as unknown as React.PointerEvent
      result.current.handleProps.onPointerDown(downEvent)
    })

    act(() => {
      const cancelEvent = new PointerEvent('pointercancel', { pointerId: 1 })
      document.dispatchEvent(cancelEvent)
    })

    expect(result.current.isDragging).toBe(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('ArrowRight increases width by 10px', () => {
    const { result } = renderHook(() => useResizable(defaultOptions))

    act(() => {
      const keyEvent = {
        key: 'ArrowRight',
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent
      result.current.handleProps.onKeyDown(keyEvent)
    })

    expect(result.current.width).toBe(282)
  })

  it('Shift+ArrowLeft decreases width by 50px', () => {
    const { result } = renderHook(() => useResizable(defaultOptions))

    act(() => {
      const keyEvent = {
        key: 'ArrowLeft',
        shiftKey: true,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent
      result.current.handleProps.onKeyDown(keyEvent)
    })

    expect(result.current.width).toBe(222)
  })

  it('mobile breakpoint cancels active drag and sets isMobile', () => {
    const { triggerChange } = createMatchMediaMock(false)
    const { result } = renderHook(() => useResizable(defaultOptions))
    const fakeEl = createFakeElement()

    // Start drag
    act(() => {
      const downEvent = {
        button: 0,
        clientX: 280,
        currentTarget: fakeEl,
      } as unknown as React.PointerEvent
      result.current.handleProps.onPointerDown(downEvent)
    })

    expect(result.current.isDragging).toBe(true)

    // Simulate viewport shrinking below breakpoint
    act(() => {
      triggerChange(true)
    })

    expect(result.current.isDragging).toBe(false)
    expect(result.current.isMobile).toBe(true)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })
})

/** Creates a minimal fake element with setPointerCapture/releasePointerCapture stubs. */
function createFakeElement(): HTMLElement {
  return {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLElement
}
