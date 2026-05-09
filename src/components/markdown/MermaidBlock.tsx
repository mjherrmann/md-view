import mermaid from 'mermaid'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

let initDone = false

function ensureMermaid() {
  if (initDone) {
    return
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'default',
  })
  initDone = true
}

const SCALE_MIN = 0.25
const SCALE_MAX = 4

function clampScale(n: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n))
}

type MountProps = {
  code: string
  className?: string
  idNonce: string
  onRenderError: (message: string | null) => void
}

function MermaidSvgMount({
  code,
  className,
  idNonce,
  onRenderError,
}: MountProps) {
  const reactId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    ensureMermaid()
    const el = ref.current
    if (!el) {
      return
    }
    const renderId = `mmd-${idNonce}-${reactId.replace(/:/g, '')}-${el.offsetWidth}`
    onRenderError(null)
    let cancelled = false
    mermaid
      .render(renderId, code)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !ref.current) {
          return
        }
        ref.current.innerHTML = svg
        bindFunctions?.(ref.current)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          onRenderError(e.message)
        }
      })
    return () => {
      cancelled = true
      el.innerHTML = ''
    }
  }, [code, idNonce, reactId, onRenderError])

  return <div className={className} ref={ref} />
}

type LightboxContentProps = {
  code: string
  dialogRef: React.RefObject<HTMLDialogElement | null>
  idNonce: string
}

function MermaidLightboxContent({
  code,
  dialogRef,
  idNonce,
}: LightboxContentProps) {
  const [scale, setScale] = useState(1)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const [lightboxErr, setLightboxErr] = useState<string | null>(null)
  const measureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = measureRef.current
    if (!el) {
      return
    }
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) {
        return
      }
      const w = cr.width
      const h = cr.height
      setNaturalSize((prev) =>
        prev.w === w && prev.h === h ? prev : { w, h }
      )
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [code])

  const onViewportWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      return
    }
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * 0.002)
    setScale((s) => clampScale(s * factor))
  }, [])

  const spacerW = Math.max(1, naturalSize.w * scale)
  const spacerH = Math.max(1, naturalSize.h * scale)

  return (
    <div
      className="mermaid-lightbox__panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mermaid-lightbox__toolbar">
        <span className="mermaid-lightbox__zoom-label">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="mermaid-lightbox__btn"
          aria-label="Zoom out"
          onClick={() => setScale((s) => clampScale(s / 1.1))}
        >
          −
        </button>
        <button
          type="button"
          className="mermaid-lightbox__btn"
          aria-label="Reset zoom"
          onClick={() => setScale(1)}
        >
          Reset
        </button>
        <button
          type="button"
          className="mermaid-lightbox__btn"
          aria-label="Zoom in"
          onClick={() => setScale((s) => clampScale(s * 1.1))}
        >
          +
        </button>
        <button
          type="button"
          className="mermaid-lightbox__btn mermaid-lightbox__btn--close"
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </div>

      {lightboxErr ? (
        <pre className="mermaid-lightbox__error">{lightboxErr}</pre>
      ) : (
        <div className="mermaid-lightbox__viewport" onWheel={onViewportWheel}>
          <div
            className="mermaid-lightbox__spacer"
            style={{ width: spacerW, height: spacerH }}
          >
            <div
              className="mermaid-lightbox__scaled"
              style={{
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                width: naturalSize.w > 0 ? naturalSize.w : undefined,
                height: naturalSize.h > 0 ? naturalSize.h : undefined,
              }}
            >
              <div ref={measureRef} className="mermaid-lightbox__measure">
                <MermaidSvgMount
                  code={code}
                  className="mermaid-lightbox__canvas"
                  idNonce={idNonce}
                  onRenderError={setLightboxErr}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type Props = { code: string }

export function MermaidBlock({ code }: Props) {
  const blockId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxKey, setLightboxKey] = useState(0)

  const idNonceInline = `i-${blockId.replace(/:/g, '')}`

  const setErrStable = useCallback((msg: string | null) => {
    setErr(msg)
  }, [])

  useEffect(() => {
    const d = dialogRef.current
    if (!d) {
      return
    }
    if (lightboxOpen) {
      if (!d.open) {
        d.showModal()
      }
    } else if (d.open) {
      d.close()
    }
  }, [lightboxOpen])

  const openLightbox = useCallback(() => {
    setLightboxKey((k) => k + 1)
    setLightboxOpen(true)
  }, [])

  const onInlineKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openLightbox()
      }
    },
    [openLightbox]
  )

  const onDialogClick = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.close()
    }
  }, [])

  const onDialogClose = useCallback(() => {
    setLightboxOpen(false)
  }, [])

  if (err) {
    return <pre className="mermaid-block mermaid-block--error">{err}</pre>
  }

  const idNonceLb = `lb-${blockId.replace(/:/g, '')}-${lightboxKey}`

  return (
    <>
      <div
        className="mermaid-block mermaid-block--interactive"
        role="button"
        tabIndex={0}
        title="Click to enlarge"
        onClick={openLightbox}
        onKeyDown={onInlineKeyDown}
      >
        <MermaidSvgMount
          code={code}
          idNonce={idNonceInline}
          onRenderError={setErrStable}
        />
      </div>

      <dialog
        ref={dialogRef}
        className="mermaid-lightbox"
        aria-label="Diagram viewer"
        onClose={onDialogClose}
        onClick={onDialogClick}
      >
        {lightboxOpen ? (
          <MermaidLightboxContent
            key={lightboxKey}
            code={code}
            dialogRef={dialogRef}
            idNonce={idNonceLb}
          />
        ) : null}
      </dialog>
    </>
  )
}
