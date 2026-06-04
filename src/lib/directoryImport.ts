/** A file collected from directory traversal. */
export interface CollectedFile {
  /** Basename of the file (last path component). */
  name: string
  /** UTF-8 text content. */
  content: string
}

/**
 * Determine if a FileSystemFileEntry is readable based on name/extension.
 * Reuses same logic as DropZone's isReadableFile filter:
 * extensions .md, .markdown, .txt or MIME types text/markdown, text/plain.
 */
export function isReadableEntry(entry: FileSystemFileEntry): boolean {
  const n = entry.name.toLowerCase()
  return (
    n.endsWith('.md') ||
    n.endsWith('.markdown') ||
    n.endsWith('.txt')
  )
}

/**
 * Check readability of a File object (includes MIME type check).
 * Used after resolving a FileSystemFileEntry to a File.
 */
export function isReadableFile(file: File): boolean {
  const n = file.name.toLowerCase()
  return (
    n.endsWith('.md') ||
    n.endsWith('.markdown') ||
    n.endsWith('.txt') ||
    file.type === 'text/markdown' ||
    file.type === 'text/plain'
  )
}

interface QueueItem {
  entry: FileSystemDirectoryEntry
  depth: number
}

/**
 * Wrap DirectoryReader.readEntries in a Promise.
 */
function readEntriesBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(
      (entries) => resolve(entries),
      (err) => reject(err)
    )
  })
}

/**
 * Read all entries from a DirectoryReader by calling readEntries
 * repeatedly until an empty array is returned (per FileSystem API spec).
 */
export async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = []
  let batch = await readEntriesBatch(reader)
  while (batch.length > 0) {
    all.push(...batch)
    batch = await readEntriesBatch(reader)
  }
  return all
}

/**
 * Resolve a FileSystemFileEntry to a File object.
 */
export function fileEntryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(file),
      (err) => reject(err)
    )
  })
}

/**
 * Recursively traverse a FileSystemDirectoryEntry, collecting readable files.
 * - BFS traversal with queue.
 * - Respects depth limit (default 10).
 * - Applies readability filter (same extensions/MIME types as DropZone).
 * - Caps output at maxFiles (default 200).
 * - Skips files that fail to read (permission/encoding errors).
 * - Skips files whose basename is empty or whitespace-only after trimming.
 */
export async function collectFilesFromDirectory(
  dirEntry: FileSystemDirectoryEntry,
  options?: { maxDepth?: number; maxFiles?: number }
): Promise<CollectedFile[]> {
  const maxDepth = options?.maxDepth ?? 10
  const maxFiles = options?.maxFiles ?? 200
  const result: CollectedFile[] = []
  const queue: QueueItem[] = [{ entry: dirEntry, depth: 0 }]

  while (queue.length > 0 && result.length < maxFiles) {
    const { entry, depth } = queue.shift()!
    let entries: FileSystemEntry[]
    try {
      const reader = entry.createReader()
      entries = await readAllEntries(reader)
    } catch {
      continue // skip unreadable directories
    }

    for (const child of entries) {
      if (result.length >= maxFiles) break

      if (child.isFile) {
        const fileEntry = child as FileSystemFileEntry
        if (!isReadableEntry(fileEntry)) continue

        try {
          const file = await fileEntryToFile(fileEntry)
          if (!isReadableFile(file)) continue
          const basename = file.name.trim()
          if (basename === '') continue
          const content = await file.text()
          result.push({ name: basename, content })
        } catch {
          continue // skip files that fail to read
        }
      } else if (child.isDirectory && depth + 1 < maxDepth) {
        queue.push({
          entry: child as FileSystemDirectoryEntry,
          depth: depth + 1,
        })
      }
    }
  }

  return result
}
