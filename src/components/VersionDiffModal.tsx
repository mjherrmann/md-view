import { createTwoFilesPatch } from 'diff'
import { useEffect } from 'react'

export type VersionDiffModalProps = {
  open: boolean
  onClose: () => void
  fileName: string
  leftOrdinal: string
  rightOrdinal: string
  leftContent: string
  rightContent: string
}

const MAX_COMBINED = 400_000

export function VersionDiffModal({
  open,
  onClose,
  fileName,
  leftOrdinal,
  rightOrdinal,
  leftContent,
  rightContent,
}: VersionDiffModalProps) {
  useEffect(() => {
    if (!open) {
      return
    }
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [open, onClose])

  if (!open) {
    return null
  }

  const identical = leftContent === rightContent
  let truncated = false
  let l = leftContent
  let r = rightContent
  const combined = leftContent.length + rightContent.length
  if (!identical && combined > MAX_COMBINED) {
    truncated = true
    const half = Math.floor(MAX_COMBINED / 2)
    l = leftContent.slice(0, half)
    r = rightContent.slice(0, half)
  }

  const patch = identical
    ? ''
    : createTwoFilesPatch(
        `${fileName} (${leftOrdinal})`,
        `${fileName} (${rightOrdinal})`,
        l,
        r,
        leftOrdinal,
        rightOrdinal
      )

  return (
    <div
      className="version-diff-modal__backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="version-diff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-diff-modal-title"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div className="version-diff-modal__toolbar">
          <h2 id="version-diff-modal-title" className="version-diff-modal__title">
            Diff: {fileName}
          </h2>
          <button
            type="button"
            className="version-diff-modal__close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="version-diff-modal__body">
          {identical ? (
            <p className="version-diff-modal__note">No differences.</p>
          ) : (
            <>
              {truncated && (
                <p className="version-diff-modal__warn" role="status">
                  Large files: diff is truncated for preview (
                  {MAX_COMBINED.toLocaleString()} characters max).
                </p>
              )}
              <pre className="version-diff-modal__pre">{patch}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
