import type { DragEvent, ReactNode } from 'react'

type Props = {
  onFile: (file: File) => void
  children: ReactNode
  className?: string
}

function isReadableFile(f: File) {
  const n = f.name.toLowerCase()
  return n.endsWith('.md') || n.endsWith('.markdown') || n.endsWith('.txt') || f.type === 'text/markdown' || f.type === 'text/plain'
}

export function DropZone({ onFile, children, className }: Props) {
  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file && isReadableFile(file)) {
      onFile(file)
    }
  }

  return (
    <div
      className={className}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="presentation"
    >
      {children}
    </div>
  )
}
