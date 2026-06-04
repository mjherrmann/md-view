import { render, fireEvent, act, within, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ImportSummaryToast, type ToastData } from '../ImportSummaryToast'

function makeToast(overrides: Partial<ToastData> = {}): ToastData {
  return {
    id: 'toast-1',
    groupsCreated: 2,
    groupsReused: 1,
    filesImported: 10,
    filesUpdated: 0,
    capReached: false,
    ...overrides,
  }
}

describe('ImportSummaryToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders nothing when toasts array is empty', () => {
    const { container } = render(
      <ImportSummaryToast toasts={[]} onDismiss={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders message with group and file counts', () => {
    const toast = makeToast({ groupsCreated: 3, groupsReused: 2, filesImported: 12 })
    const { container } = render(
      <ImportSummaryToast toasts={[toast]} onDismiss={vi.fn()} />,
    )

    expect(within(container).getByText('Imported 5 groups, 12 files')).toBeTruthy()
  })

  it('appends "(cap reached)" when capReached is true', () => {
    const toast = makeToast({ capReached: true })
    const { container } = render(
      <ImportSummaryToast toasts={[toast]} onDismiss={vi.fn()} />,
    )

    expect(within(container).getByText('Imported 3 groups, 10 files (cap reached)')).toBeTruthy()
  })

  it('uses singular "group" and "file" for count of 1', () => {
    const toast = makeToast({ groupsCreated: 1, groupsReused: 0, filesImported: 1 })
    const { container } = render(
      <ImportSummaryToast toasts={[toast]} onDismiss={vi.fn()} />,
    )

    expect(within(container).getByText('Imported 1 group, 1 file')).toBeTruthy()
  })

  it('auto-dismisses after 4 seconds', () => {
    const onDismiss = vi.fn()
    const toast = makeToast()
    render(<ImportSummaryToast toasts={[toast]} onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledWith('toast-1')
  })

  it('dismisses on click', () => {
    const onDismiss = vi.fn()
    const toast = makeToast({ id: 'click-test' })
    const { container } = render(
      <ImportSummaryToast toasts={[toast]} onDismiss={onDismiss} />,
    )

    const button = within(container).getByRole('button')
    fireEvent.click(button)

    expect(onDismiss).toHaveBeenCalledWith('click-test')
  })

  it('stacks multiple toasts', () => {
    const toasts = [
      makeToast({ id: 'a', groupsCreated: 1, groupsReused: 0, filesImported: 5 }),
      makeToast({ id: 'b', groupsCreated: 2, groupsReused: 0, filesImported: 8 }),
    ]
    const { container } = render(
      <ImportSummaryToast toasts={toasts} onDismiss={vi.fn()} />,
    )

    const buttons = within(container).getAllByRole('button')
    expect(buttons).toHaveLength(2)
  })

  it('adds fading class before dismiss', () => {
    const onDismiss = vi.fn()
    const toast = makeToast()
    const { container } = render(
      <ImportSummaryToast toasts={[toast]} onDismiss={onDismiss} />,
    )

    const button = within(container).getByRole('button')
    expect(button.classList.contains('import-toast--fading')).toBe(false)

    // Fade starts at 3700ms (4000 - 300)
    act(() => {
      vi.advanceTimersByTime(3700)
    })
    expect(button.classList.contains('import-toast--fading')).toBe(true)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
