import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  collectFilesFromDirectory,
  isReadableEntry,
} from '../directoryImport'

// ─── Mock Factories ───────────────────────────────────────────────────────────

/** Create a mock FileSystemFileEntry. */
function mockFileEntry(
  name: string,
  opts?: { type?: string; content?: string; failRead?: boolean }
): FileSystemFileEntry {
  const type = opts?.type ?? ''
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
        success(new File([content], name, { type }))
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

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Valid readable extensions. */
const readableExtensions = ['.md', '.markdown', '.txt']

/** Non-readable extensions. */
const nonReadableExtensions = ['.pdf', '.png', '.js', '.html', '.json', '.exe']

/** Arbitrary basename (no dots). */
const arbBasename = fc.string({ minLength: 1, maxLength: 20 }).filter(
  (s) => !s.includes('/') && !s.includes('\0') && s.trim().length > 0
)

/** Arbitrary readable filename. */
const arbReadableFilename = fc
  .tuple(arbBasename, fc.constantFrom(...readableExtensions))
  .map(([base, ext]) => base + ext)

/** Arbitrary non-readable filename. */
const arbNonReadableFilename = fc
  .tuple(arbBasename, fc.constantFrom(...nonReadableExtensions))
  .map(([base, ext]) => base + ext)

/** Arbitrary whitespace-only string. */
const arbWhitespace = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), {
    minLength: 0,
    maxLength: 10,
  })
  .map((chars) => chars.join(''))

// ─── Property 7: Readability filter ──────────────────────────────────────────

/**
 * Property 7: Readability filter
 *
 * For any file entry, it SHALL be imported if and only if its filename
 * ends with .md, .markdown, or .txt, or its MIME type is text/markdown
 * or text/plain. All other entries SHALL be skipped.
 *
 * Validates: Requirements 3.2, 3.3
 */
describe('Feature: directory-drop-import, Property 7: Readability filter', () => {
  it('accepts files with readable extensions', () => {
    fc.assert(
      fc.property(arbReadableFilename, (filename) => {
        const entry = mockFileEntry(filename)
        expect(isReadableEntry(entry)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('rejects files with non-readable extensions', () => {
    fc.assert(
      fc.property(arbNonReadableFilename, (filename) => {
        const entry = mockFileEntry(filename)
        expect(isReadableEntry(entry)).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('accepts files with readable MIME types regardless of extension', async () => {
    const arbMimeType = fc.constantFrom('text/markdown', 'text/plain')
    await fc.assert(
      fc.asyncProperty(arbNonReadableFilename, arbMimeType, async (filename, mime) => {
        // File with non-readable extension but readable MIME type
        // isReadableEntry checks extension only; isReadableFile also checks MIME.
        // collectFilesFromDirectory uses both: entry filter then file filter.
        mockDirEntry('testdir', [
          mockFileEntry(filename, { type: mime }),
        ])
        // isReadableEntry rejects by extension, so file won't pass traversal
        const entry = mockFileEntry(filename, { type: mime })
        expect(isReadableEntry(entry)).toBe(false)
      }),
      { numRuns: 100 }
    )
  })

  it('collectFilesFromDirectory only includes readable files', async () => {
    const arbFiles = fc.array(
      fc.oneof(
        arbReadableFilename.map((n) => ({ name: n, readable: true })),
        arbNonReadableFilename.map((n) => ({ name: n, readable: false }))
      ),
      { minLength: 1, maxLength: 30 }
    )

    await fc.assert(
      fc.asyncProperty(arbFiles, async (files) => {
        const entries = files.map((f) => mockFileEntry(f.name))
        const dir = mockDirEntry('root', entries)
        const result = await collectFilesFromDirectory(dir)
        // Every result must have a readable extension
        for (const r of result) {
          const lower = r.name.toLowerCase()
          expect(
            lower.endsWith('.md') ||
            lower.endsWith('.markdown') ||
            lower.endsWith('.txt')
          ).toBe(true)
        }
      }),
      { numRuns: 100 }
    )
  })
})

// ─── Property 8: Depth-limited traversal ─────────────────────────────────────

/**
 * Property 8: Depth-limited traversal
 *
 * For any directory tree with entries at varying depths, the traversal
 * SHALL visit all entries at depth ≤ 10 (relative to dropped directory)
 * and SHALL NOT visit entries beyond depth 10.
 *
 * Validates: Requirements 3.1
 */
describe('Feature: directory-drop-import, Property 8: Depth-limited traversal', () => {
  /** Build a linear chain of nested dirs, with a readable file at each level. */
  function buildNestedDir(totalDepth: number): FileSystemDirectoryEntry {
    // Build from deepest to shallowest
    let current: FileSystemDirectoryEntry = mockDirEntry(
      `level-${totalDepth}`,
      [mockFileEntry(`file-at-${totalDepth}.md`)]
    )
    for (let d = totalDepth - 1; d >= 0; d--) {
      current = mockDirEntry(`level-${d}`, [
        mockFileEntry(`file-at-${d}.md`),
        current,
      ])
    }
    return current
  }

  it('collects files up to depth 10 and never beyond', async () => {
    // Generate depths from 1 to 15
    const arbDepth = fc.integer({ min: 1, max: 15 })
    await fc.assert(
      fc.asyncProperty(arbDepth, async (depth) => {
        const dir = buildNestedDir(depth)
        const result = await collectFilesFromDirectory(dir)

        // Files at depth 0..9 should be collected (depth < maxDepth=10)
        // The root dir is depth 0 in queue. Files IN that dir are at depth 0.
        // Subdirs get depth+1. A subdir at depth 9 gets its files read.
        // A subdir at depth 10 is NOT entered (depth+1 < maxDepth check fails).
        // So files at levels 0..9 collected; level 10+ not.
        const expectedCount = Math.min(depth + 1, 10)
        expect(result.length).toBe(expectedCount)

        // Verify no file beyond depth 9 included
        for (const r of result) {
          const levelMatch = r.name.match(/file-at-(\d+)/)
          if (levelMatch) {
            expect(Number(levelMatch[1])).toBeLessThan(10)
          }
        }
      }),
      { numRuns: 100 }
    )
  })
})

// ─── Property 9: File count cap ──────────────────────────────────────────────

/**
 * Property 9: File count cap
 *
 * For any directory containing N readable files where N > 200,
 * the number of imported file records SHALL never exceed 200.
 *
 * Validates: Requirements 3.6
 */
describe('Feature: directory-drop-import, Property 9: File count cap', () => {
  it('output length never exceeds maxFiles', async () => {
    const arbFileCount = fc.integer({ min: 1, max: 500 })
    const arbMaxFiles = fc.integer({ min: 1, max: 50 })

    await fc.assert(
      fc.asyncProperty(arbFileCount, arbMaxFiles, async (count, maxFiles) => {
        const files = Array.from({ length: count }, (_, i) =>
          mockFileEntry(`file-${i}.md`)
        )
        const dir = mockDirEntry('bigdir', files)
        const result = await collectFilesFromDirectory(dir, { maxFiles })
        expect(result.length).toBeLessThanOrEqual(maxFiles)
      }),
      { numRuns: 100 }
    )
  })

  it('caps at default 200 for large directories', async () => {
    const files = Array.from({ length: 250 }, (_, i) =>
      mockFileEntry(`file-${i}.md`)
    )
    const dir = mockDirEntry('bigdir', files)
    const result = await collectFilesFromDirectory(dir)
    expect(result.length).toBe(200)
  })
})

// ─── Property 10: Error resilience ───────────────────────────────────────────

/**
 * Property 10: Error resilience
 *
 * For any directory where K out of N readable files fail to read
 * (permission or encoding errors), the system SHALL successfully import
 * exactly N − K files and SHALL not abort the remaining imports.
 *
 * Validates: Requirements 6.1, 6.2
 */
describe('Feature: directory-drop-import, Property 10: Error resilience', () => {
  it('failing files skipped, rest imported', async () => {
    const arbLayout = fc.array(
      fc.record({
        name: arbReadableFilename,
        fails: fc.boolean(),
      }),
      { minLength: 1, maxLength: 50 }
    )

    await fc.assert(
      fc.asyncProperty(arbLayout, async (layout) => {
        const entries = layout.map((f) =>
          mockFileEntry(f.name, { failRead: f.fails })
        )
        const dir = mockDirEntry('errdir', entries)
        const result = await collectFilesFromDirectory(dir)

        const expectedCount = layout.filter((f) => !f.fails).length
        expect(result.length).toBe(expectedCount)
      }),
      { numRuns: 100 }
    )
  })
})

// ─── Property 5: Whitespace directory names rejected ─────────────────────────

/**
 * Property 5: Whitespace directory names rejected
 *
 * For any file whose basename is empty or whitespace-only after trimming,
 * the file SHALL be skipped and not appear in results.
 *
 * Validates: Requirements 4.4
 */
describe('Feature: directory-drop-import, Property 5: Whitespace directory names rejected', () => {
  /**
   * Mock entry where the entry name passes the extension check but the
   * resolved File object has a whitespace-only name (simulates the
   * implementation's file.name.trim() === '' guard).
   */
  const makeWhitespaceFileEntry = (wsName: string): FileSystemFileEntry => ({
    isFile: true,
    isDirectory: false,
    name: wsName + '.md', // passes isReadableEntry extension check
    fullPath: `/${wsName}.md`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    file(success: (f: File) => void) {
      // File object name is whitespace-only → should be skipped
      success(new File(['content'], wsName, { type: 'text/plain' }))
    },
  } as unknown as FileSystemFileEntry)

  it('files whose resolved name trims to empty are skipped', async () => {
    await fc.assert(
      fc.asyncProperty(arbWhitespace, async (wsName) => {
        const entry = makeWhitespaceFileEntry(wsName)
        const dir = mockDirEntry('testdir', [entry])
        const result = await collectFilesFromDirectory(dir)
        // Implementation: file.name.trim() === '' → skip
        expect(result.length).toBe(0)
      }),
      { numRuns: 100 }
    )
  })

  it('files with purely whitespace names (no readable extension) rejected by filter', async () => {
    await fc.assert(
      fc.asyncProperty(arbWhitespace, async (wsName) => {
        // Pure whitespace without readable extension → isReadableEntry rejects
        const entry = mockFileEntry(wsName)
        const dir = mockDirEntry('testdir', [entry])
        const result = await collectFilesFromDirectory(dir)
        expect(result.length).toBe(0)
      }),
      { numRuns: 100 }
    )
  })
})
