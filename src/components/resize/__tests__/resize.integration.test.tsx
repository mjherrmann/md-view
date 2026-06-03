import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useResizable } from '../useResizable'
import { ResizeHandle } from '../ResizeHandle'

/**
 * Minimal integration wrapper that wires useResizable + ResizeHandle + a sidebar div.
 * Avoids full App rendering (IndexedDB / Dexie) while testing the real resize flow.
 */
function ResizeTestHarness() {
  const { width, isDragging, isMobile, handleProps } = useResizable({
    defaultWidth: 272,
    minWidth: 120,
    maxWidthRatio: 0.5,
  })

  return (
    <div style={{ display: 'flex', width: '100%' }}>
      <aside data-testid="sidebar" style={{ width }}>
        Sidebar
      </aside>
      <ResizeHandle isDragging={isDragging} isMobile={isMobile} handleProps={handleProps} />
      <main style={{ flex: 1 }}>Content</main>
    </div>
  )
}

/** Creates a controllable matchMedia mock. */
function createMatchMediaMock(initialMatches = false) {
  let listener: ((e: MediaQueryListEvent) => void) | null = null
  const mql = {
    matches: initialMatches,
    media: '(max-width: 768px)',
    addEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) => {
      listener = cb
    },
    removeEventListener: () => {
      listener = null
    },
  }

  const matchMedia = vi.fn().mockReturnValue(mql)
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, writable: true })

  function triggerChange(matches: boolean) {
    mql.matches = matches
    if (listener) {
      listener({ matches } as MediaQueryListEvent)
    }
  }

  return { mql, triggerChange }
}

function setBodyWidth(px: number) {
  Object.defineProperty(document.body, 'clientWidth', { value: px, configurable: true })
}

/** Patch setPointerCapture/releasePointerCapture on Element prototype for jsdom. */
function patchPointerCapture() {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
}

describe('Resize integration: full drag flow', () => {
  beforeEach(() => {
    setBodyWidth(1200)
    createMatchMediaMock(false)
    patchPointerCapture()
  })

  afterEach(() => {
    cleanup()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  it('drag on handle changes sidebar width', () => {
    render(<ResizeTestHarness />)

    const sidebar = screen.getByTestId('sidebar')
    const handle = screen.getByRole('separator')

    expect(sidebar.style.width).toBe('272px')

    // pointerdown at clientX 280 → offset = 280 - 272 = 8
    fireEvent.pointerDown(handle, { button: 0, clientX: 280, pointerId: 1 })

    // pointermove to clientX 400 → width = clamp(400 - 8, 120, 600) = 392
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }))
    })

    expect(sidebar.style.width).toBe('392px')

    // Drag further to clientX 500 → width = clamp(500 - 8, 120, 600) = 492
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 }))
    })

    expect(sidebar.style.width).toBe('492px')

    // Release pointer — width stays at last value, body styles revert
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    })

    expect(sidebar.style.width).toBe('492px')
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('drag respects minimum width clamp', () => {
    render(<ResizeTestHarness />)

    const sidebar = screen.getByTestId('sidebar')
    const handle = screen.getByRole('separator')

    // pointerdown at clientX 280, offset = 8
    fireEvent.pointerDown(handle, { button: 0, clientX: 280, pointerId: 1 })

    // Move to clientX 50 → raw = 50 - 8 = 42, clamped to 120
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 50 }))
    })

    expect(sidebar.style.width).toBe('120px')

    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    })
  })

  it('drag respects maximum width clamp (50% of body)', () => {
    render(<ResizeTestHarness />)

    const sidebar = screen.getByTestId('sidebar')
    const handle = screen.getByRole('separator')

    // pointerdown at clientX 280, offset = 8
    fireEvent.pointerDown(handle, { button: 0, clientX: 280, pointerId: 1 })

    // Move to clientX 900 → raw = 900 - 8 = 892, clamped to 600 (1200 * 0.5)
    act(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 900 }))
    })

    expect(sidebar.style.width).toBe('600px')

    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    })
  })
})

describe('Resize integration: mobile breakpoint', () => {
  beforeEach(() => {
    patchPointerCapture()
  })

  afterEach(() => {
    cleanup()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  it('handle not rendered when viewport is mobile', () => {
    setBodyWidth(600)
    createMatchMediaMock(true)

    render(<ResizeTestHarness />)

    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('sidebar is present but handle is absent on mobile (column layout preserved)', () => {
    setBodyWidth(600)
    createMatchMediaMock(true)

    render(<ResizeTestHarness />)

    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toBeTruthy()
    expect(screen.queryByRole('separator')).toBeNull()
  })
})
