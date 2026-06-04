import type { CollectedFile } from './directoryImport'
import {
  isReadableEntry,
  isReadableFile,
  readAllEntries,
  fileEntryToFile,
} from './directoryImport'

/** A node in the in-memory directory tree. */
export interface DirectoryNode {
  /** Folder name (untrimmed — trimming happens at group-creation time). */
  name: string
  /** Files directly in this directory (readable, content loaded). */
  files: CollectedFile[]
  /** Subdirectories. */
  children: DirectoryNode[]
}

/** Result of traversal including cap status. */
export interface TraversalResult {
  root: DirectoryNode
  /** Total readable files found (may exceed cap). */
  totalFilesFound: number
  /** Whether the file cap was reached. */
  capReached: boolean
}

const DEFAULT_MAX_FILES = 200
const DEFAULT_MAX_TRAVERSAL_DEPTH = 20

/**
 * Recursively traverse a FileSystemDirectoryEntry, building a DirectoryNode tree.
 * - DFS traversal with depth tracking.
 * - Applies readability filter on files.
 * - Enforces global file cap (default 200) across all levels.
 * - Skips files that fail to read.
 * - Safety max traversal depth of 20 prevents runaway recursion.
 */
export async function traverseDirectoryTree(
  dirEntry: FileSystemDirectoryEntry,
  options?: { maxFiles?: number; maxTraversalDepth?: number }
): Promise<TraversalResult> {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES
  const maxTraversalDepth = options?.maxTraversalDepth ?? DEFAULT_MAX_TRAVERSAL_DEPTH

  let fileCount = 0
  let capReached = false

  async function buildNode(
    entry: FileSystemDirectoryEntry,
    depth: number
  ): Promise<DirectoryNode> {
    const node: DirectoryNode = { name: entry.name, files: [], children: [] }

    let entries: FileSystemEntry[]
    try {
      const reader = entry.createReader()
      entries = await readAllEntries(reader)
    } catch {
      return node // skip unreadable directories
    }

    for (const child of entries) {
      if (child.isFile) {
        if (fileCount >= maxFiles) {
          capReached = true
          continue
        }

        const fileEntry = child as FileSystemFileEntry
        if (!isReadableEntry(fileEntry)) continue

        try {
          const file = await fileEntryToFile(fileEntry)
          if (!isReadableFile(file)) continue
          const basename = file.name.trim()
          if (basename === '') continue
          const content = await file.text()
          node.files.push({ name: basename, content })
          fileCount++
        } catch {
          continue // skip files that fail to read
        }
      } else if (child.isDirectory && depth + 1 < maxTraversalDepth) {
        const childNode = await buildNode(
          child as FileSystemDirectoryEntry,
          depth + 1
        )
        node.children.push(childNode)
      }
    }

    return node
  }

  const root = await buildNode(dirEntry, 0)
  return { root, totalFilesFound: fileCount, capReached }
}
