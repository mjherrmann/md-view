import type { DragEvent, ReactNode } from 'react'
import { isInternalLibraryDrag } from '../dnd'

type Props = {
  onFiles: (files: File[]) => void
  children: ReactNode
  className?: string
}

function isReadableFile(f: File) {
  const n = f.name.toLowerCase()
  return (
    n.endsWith('.md') ||
    n.endsWith('.markdown') ||
    n.endsWith('.txt') ||
    f.type === 'text/markdown' ||
    f.type === 'text/plain'
  )
}

function collectReadableFiles(dtl: DataTransfer) {
  const out: File[] = []
  const { files: fl } = dtl
  if (!fl) {
    return out
  }
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i]
    if (f && isReadableFile(f)) {
      out.push(f)
    }
  }
  return out
}

export function DropZone({ onFiles, children, className }: Props) {
  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isInternalLibraryDrag(e.dataTransfer)) {
      return
    }
    const list = collectReadableFiles(e.dataTransfer)
    if (list.length) {
      onFiles(list)
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
