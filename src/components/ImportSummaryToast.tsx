import { useEffect, useState } from 'react'

export interface ToastData {
  id: string
  groupsCreated: number
  groupsReused: number
  filesImported: number
  filesUpdated: number
  capReached: boolean
}

interface Props {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

const AUTO_DISMISS_MS = 4000
const FADE_OUT_MS = 300

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData
  onDismiss: (id: string) => void
}) {
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), AUTO_DISMISS_MS - FADE_OUT_MS)
    const dismissTimer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(dismissTimer)
    }
  }, [toast.id, onDismiss])

  const groups = toast.groupsCreated + toast.groupsReused
  const filesTotal = toast.filesImported + toast.filesUpdated
  const updatedSuffix = toast.filesUpdated > 0 ? ` (${toast.filesUpdated} updated)` : ''
  const message = `Imported ${groups} group${groups !== 1 ? 's' : ''}, ${filesTotal} file${filesTotal !== 1 ? 's' : ''}${updatedSuffix}${toast.capReached ? ' (cap reached)' : ''}`

  return (
    <button
      type="button"
      className={`import-toast${fading ? ' import-toast--fading' : ''}`}
      onClick={() => onDismiss(toast.id)}
      aria-label={`Dismiss: ${message}`}
    >
      <span className="import-toast__icon" aria-hidden="true">✓</span>
      <span className="import-toast__message">{message}</span>
    </button>
  )
}

export function ImportSummaryToast({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null

  return (
    <div className="import-toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
