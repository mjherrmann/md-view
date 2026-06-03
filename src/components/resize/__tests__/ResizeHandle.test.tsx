import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ResizeHandle } from '../ResizeHandle'
import type { UseResizableReturn } from '../useResizable'

function createHandleProps(overrides: Partial<UseResizableReturn['handleProps']> = {}): UseResizableReturn['handleProps'] {
  return {
    onPointerDown: vi.fn(),
    onKeyDown: vi.fn(),
    tabIndex: 0,
    role: 'separator',
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': 120,
    'aria-valuemax': 600,
    'aria-valuenow': 272,
    'aria-label': 'Resize sidebar',
    ...overrides,
  }
}

describe('ResizeHandle', () => {
  it('renders with correct ARIA attributes when isMobile=false', () => {
    const handleProps = createHandleProps()
    const { container } = render(<ResizeHandle isDragging={false} isMobile={false} handleProps={handleProps} />)

    const el = container.querySelector('[role="separator"]')!
    expect(el).not.toBeNull()
    expect(el.getAttribute('aria-orientation')).toBe('vertical')
    expect(el.getAttribute('aria-valuemin')).toBe('120')
    expect(el.getAttribute('aria-valuemax')).toBe('600')
    expect(el.getAttribute('aria-valuenow')).toBe('272')
    expect(el.getAttribute('aria-label')).toBe('Resize sidebar')
    expect(el.className).toContain('resize-handle')
  })

  it('returns null when isMobile=true (nothing rendered)', () => {
    const handleProps = createHandleProps()
    const { container } = render(<ResizeHandle isDragging={false} isMobile={true} handleProps={handleProps} />)

    expect(container.innerHTML).toBe('')
  })

  it('applies resize-handle--active class when isDragging=true', () => {
    const handleProps = createHandleProps()
    const { container } = render(<ResizeHandle isDragging={true} isMobile={false} handleProps={handleProps} />)

    const el = container.querySelector('[role="separator"]')!
    expect(el.className).toContain('resize-handle--active')
  })

  it('has resize-handle class for col-resize cursor styling', () => {
    const handleProps = createHandleProps()
    const { container } = render(<ResizeHandle isDragging={false} isMobile={false} handleProps={handleProps} />)

    const el = container.querySelector('[role="separator"]')!
    expect(el.className).toContain('resize-handle')
    expect(el.className).not.toContain('resize-handle--active')
  })
})
