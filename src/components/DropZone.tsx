import type { DragEvent, ReactNode } from 'react'
import { isInternalLibraryDrag } from '../dnd'

type Props = {
  onFiles: (files: File[]) => void
  /** Called when one or more directories are dropped. */
  onDirectories?: (entries: FileSystemDirectoryEntry[]) => void
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

function supportsWebkitGetAsEntry(item: DataTransferItem): boolean {
  return typeof item.webkitGetAsEntry === 'function'
}

/**
 * Classify DataTransferItems via webkitGetAsEntry into directories and files.
 * Returns null if webkitGetAsEntry is unavailable (fallback needed).
 */
function classifyDropItems(dt: DataTransfer): {
  directories: FileSystemDirectoryEntry[]
  files: File[]
} | null {
  const items = dt.items
  if (!items || items.length === 0) return null

  // Check first item for webkitGetAsEntry support
  const firstItem = items[0]
  if (!firstItem || !supportsWebkitGetAsEntry(firstItem)) return null

  const directories: FileSystemDirectoryEntry[] = []
  const files: File[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item || item.kind !== 'file') continue

    const entry = item.webkitGetAsEntry()
    if (!entry) continue

    if (entry.isDirectory) {
      directories.push(entry as FileSystemDirectoryEntry)
    } else if (entry.isFile) {
      const file = item.getAsFile()
      if (file && isReadableFile(file)) {
        files.push(file)
      }
    }
  }

  return { directories, files }
}

export function DropZone({
  onFiles,
  onDirectories,
  children,
  className,
}: Props) {
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

    const classified = classifyDropItems(e.dataTransfer)

    if (classified) {
      // webkitGetAsEntry available — dispatch independently
      if (classified.directories.length && onDirectories) {
        onDirectories(classified.directories)
      }
      if (classified.files.length) {
        onFiles(classified.files)
      }
    } else {
      // Fallback: webkitGetAsEntry unavailable, use DataTransfer.files
      const list = collectReadableFiles(e.dataTransfer)
      if (list.length) {
        onFiles(list)
      }
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
