import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'

const HOLD_DELETE_MS = 700

export function FileDeleteHold({
  label,
  onHoldComplete,
  compact,
  title: holdTitle,
}: {
  label: string
  onHoldComplete: () => void | Promise<void>
  compact?: boolean
  title?: string
}) {
  const [progress, setProgress] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const doneRef = useRef(false)
  const holdingRef = useRef(false)

  const stopTracking = useCallback(() => {
    holdingRef.current = false
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setProgress(0)
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (e.button !== 0) {
      return
    }
    doneRef.current = false
    holdingRef.current = true
    startRef.current = performance.now()
    const step = () => {
      if (!holdingRef.current) {
        return
      }
      const elapsed = performance.now() - startRef.current
      const p = Math.min(1, elapsed / HOLD_DELETE_MS)
      setProgress(p)
      if (p < 1 && holdingRef.current) {
        rafRef.current = requestAnimationFrame(step)
      }
    }
    rafRef.current = requestAnimationFrame(step)
    timerRef.current = setTimeout(() => {
      if (doneRef.current) {
        return
      }
      doneRef.current = true
      stopTracking()
      void Promise.resolve(onHoldComplete()).catch(() => {
        /* ignore */
      })
    }, HOLD_DELETE_MS)
  }

  const endHold = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!doneRef.current) {
      stopTracking()
    }
  }

  useEffect(() => () => stopTracking(), [stopTracking])

  return (
    <button
      type="button"
      className={
        'file-library__delete-hold' +
        (compact ? ' file-library__delete-hold--compact' : '')
      }
      title={holdTitle ?? 'Hold to remove from library'}
      aria-label={
        compact ? `Hold to delete version ${label}` : `Hold to delete ${label}`
      }
      draggable={false}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onPointerDown={onPointerDown}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onPointerLeave={endHold}
    >
      <span
        className="file-library__delete-hold__fill"
        style={
          {
            '--hold-p': String(progress),
          } as CSSProperties
        }
      />
      <span className="file-library__delete-hold__icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4v2H5V4h3.5l1-1h5l1 1H19z" />
        </svg>
      </span>
    </button>
  )
}
