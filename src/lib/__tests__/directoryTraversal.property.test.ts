import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { traverseDirectoryTree } from '../directoryTraversal'
import type { DirectoryNode } from '../directoryTraversal'

// ─── Mock Factories ───────────────────────────────────────────────────────────

/** Create a mock FileSystemFileEntry. */
function mockFileEntry(
  name: string,
  opts?: { content?: string; failRead?: boolean }
): FileSystemFileEntry {
  const content = opts?.content ?? `content of ${name}`
  const failRead = opts?.failRead ?? false
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    file(success: (f: File) => void, error?: (e: DOMException) => void) {
      if (failRead) {
        error?.(new DOMException('permission denied'))
      } else {
        success(new File([content], name, { type: 'text/plain' }))
      }
    },
  } as unknown as FileSystemFileEntry
}

/** Create a mock FileSystemDirectoryEntry with given children. */
function mockDirEntry(
  name: string,
  children: FileSystemEntry[]
): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    createReader() {
      let read = false
      return {
        readEntries(
          success: (entries: FileSystemEntry[]) => void,
          _error?: (e: DOMException) => void
        ) {
          if (!read) {
            read = true
            success(children)
          } else {
            success([])
          }
        },
      } as unknown as FileSystemDirectoryReader
    },
    getFile: () => {},
    getDirectory: () => {},
  } as unknown as FileSystemDirectoryEntry
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count all files recursively in a DirectoryNode tree. */
function countFilesInTree(node: DirectoryNode): number {
  let count = node.files.length
  for (const child of node.children) {
    count += countFilesInTree(child)
  }
  return count
}

/** Check that at least one child node exists in the tree (groups were traversed). */
function hasAnyChildren(node: DirectoryNode): boolean {
  if (node.children.length > 0) return true
  for (const child of node.children) {
    if (hasAnyChildren(child)) return true
  }
  return false
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Generate a mock directory tree structure that guarantees totalFiles > 200
 * readable files spread across multiple subdirectories.
 *
 * Strategy: create a configurable number of subdirectories, each with
 * a configurable number of files. Total files will always exceed 200.
 */
interface TreeShape {
  numSubdirs: number
  filesPerDir: number[]
  rootFiles: number
}

const arbTreeShapeOver200 = fc
  .record({
    numSubdirs: fc.integer({ min: 2, max: 8 }),
    filesPerRootDir: fc.integer({ min: 5, max: 40 }),
  })
  .chain(({ numSubdirs, filesPerRootDir }) => {
    // Distribute files so total > 200
    const minPerSubdir = Math.ceil(201 / numSubdirs)
    return fc
      .tuple(
        fc.integer({ min: filesPerRootDir, max: filesPerRootDir }),
        fc.array(
          fc.integer({ min: minPerSubdir, max: minPerSubdir + 20 }),
          { minLength: numSubdirs, maxLength: numSubdirs }
        )
      )
      .map(([rootFiles, filesPerDir]) => ({
        numSubdirs,
        filesPerDir,
        rootFiles,
      }))
  })
  .filter(
    (shape) =>
      shape.rootFiles + shape.filesPerDir.reduce((a, b) => a + b, 0) > 200
  )

/** Build a mock FileSystemDirectoryEntry from a TreeShape. */
function buildMockTree(shape: TreeShape): FileSystemDirectoryEntry {
  const rootChildren: FileSystemEntry[] = []

  // Root-level files
  for (let i = 0; i < shape.rootFiles; i++) {
    rootChildren.push(mockFileEntry(`root-file-${i}.md`))
  }

  // Subdirectories with files
  for (let d = 0; d < shape.numSubdirs; d++) {
    const dirChildren: FileSystemEntry[] = []
    for (let f = 0; f < shape.filesPerDir[d]!; f++) {
      dirChildren.push(mockFileEntry(`subdir${d}-file-${f}.md`))
    }
    rootChildren.push(mockDirEntry(`subdir-${d}`, dirChildren))
  }

  return mockDirEntry('root', rootChildren)
}

// ─── Property 7: File cap enforcement ────────────────────────────────────────

/**
 * Property 7: File cap enforcement
 *
 * For any directory tree containing N > 200 readable files, the number of
 * file records collected SHALL be exactly 200. Groups corresponding to all
 * traversed directories SHALL still be created regardless of the file cap.
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */
describe('Feature: directory-drop-hierarchical, Property 7: File cap enforcement', () => {
  it('collects exactly 200 files when tree has more than 200 readable files', async () => {
    await fc.assert(
      fc.asyncProperty(arbTreeShapeOver200, async (shape) => {
        const totalFiles =
          shape.rootFiles + shape.filesPerDir.reduce((a, b) => a + b, 0)

        // Sanity: tree has > 200 files
        expect(totalFiles).toBeGreaterThan(200)

        const dirEntry = buildMockTree(shape)
        const result = await traverseDirectoryTree(dirEntry)

        // Exactly 200 files collected across all levels
        const collectedFiles = countFilesInTree(result.root)
        expect(collectedFiles).toBe(200)

        // capReached is true
        expect(result.capReached).toBe(true)

        // totalFilesFound reflects the collected count (capped at 200)
        expect(result.totalFilesFound).toBe(200)
      }),
      { numRuns: 100 }
    )
  })

  it('groups/directories are still traversed after file cap is reached', async () => {
    await fc.assert(
      fc.asyncProperty(arbTreeShapeOver200, async (shape) => {
        const dirEntry = buildMockTree(shape)
        const result = await traverseDirectoryTree(dirEntry)

        // Groups (children) must still be present in the tree even though
        // the file cap was reached — directories are not subject to the cap
        expect(result.root.children.length).toBeGreaterThan(0)

        // Verify the tree has child nodes (directories were traversed)
        expect(hasAnyChildren(result.root)).toBe(true)

        // Total number of directory nodes equals numSubdirs
        expect(result.root.children.length).toBe(shape.numSubdirs)
      }),
      { numRuns: 100 }
    )
  })
})
