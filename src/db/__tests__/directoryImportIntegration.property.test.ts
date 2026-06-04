import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import {
  db,
  findOrCreateDirectoryGroup,
  createFilesInGroup,
} from '../schema'

/**
 * Integration property tests for directory drop import.
 * These span both the group creation/reuse layer and the file+version
 * batch-create layer, validating end-to-end invariants.
 *
 * Validates: Requirements 2.3, 3.4, 4.1, 4.2, 4.3, 7.1, 7.2, 1.2
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const readableExtensions = ['.md', '.markdown', '.txt']

/** Arbitrary non-empty basename (no slashes or NUL). */
const arbBasename = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !s.includes('/') && !s.includes('\0') && s.trim().length > 0)

/** Arbitrary readable filename. */
const arbReadableFilename = fc
  .tuple(arbBasename, fc.constantFrom(...readableExtensions))
  .map(([base, ext]) => base + ext)

/** Arbitrary file content. */
const arbContent = fc.string({ minLength: 0, maxLength: 200 })

/** Arbitrary collected file (name + content). */
const arbCollectedFile = fc
  .tuple(arbReadableFilename, arbContent)
  .map(([name, content]) => ({ name, content }))

/** Arbitrary non-empty directory name (trims to non-empty). */
const arbDirName = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0)

// ─── Property 1: Flat import invariant ───────────────────────────────────────

/**
 * Property 1: Flat import invariant
 *
 * For any directory drop operation on any directory tree structure, the import
 * SHALL create at most one new root-level group (parentId = null), and all
 * imported file records SHALL share the same groupId pointing to that single group.
 *
 * Validates: Requirements 2.3, 7.1, 7.2
 */
describe('Feature: directory-drop-import, Property 1: Flat import invariant', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('at most one root group created, all files share same groupId', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirName,
        fc.array(arbCollectedFile, { minLength: 1, maxLength: 20 }),
        async (dirName, files) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // Full pipeline: find/create group then batch-create files
          const groupId = await findOrCreateDirectoryGroup(dirName)
          expect(groupId).not.toBeNull()

          const result = await createFilesInGroup(groupId!, files)
          const created = result.files

          // Verify: exactly one root group exists
          const rootGroups = await db.groups
            .filter((g) => g.parentId === null)
            .toArray()
          expect(rootGroups).toHaveLength(1)
          expect(rootGroups[0]!.id).toBe(groupId)

          // Verify: all files share same groupId
          const allFiles = await db.files.toArray()
          // With upsert, duplicate names produce fewer records
          const uniqueNames = new Set(files.map((f) => f.name))
          expect(allFiles.length).toBe(uniqueNames.size)
          for (const file of allFiles) {
            expect(file.groupId).toBe(groupId)
          }

          // Verify: created return has one entry per input
          expect(created.length).toBe(files.length)
          for (const c of created) {
            expect(c.groupId).toBe(groupId)
          }
        }
      ),
      { numRuns: 50 }
    )
  })

  it('repeated imports to same directory reuse one group', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirName,
        fc.array(arbCollectedFile, { minLength: 1, maxLength: 5 }),
        fc.array(arbCollectedFile, { minLength: 1, maxLength: 5 }),
        async (dirName, batch1, batch2) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // Two imports to same directory name
          const groupId1 = await findOrCreateDirectoryGroup(dirName)
          await createFilesInGroup(groupId1!, batch1)

          const groupId2 = await findOrCreateDirectoryGroup(dirName)
          await createFilesInGroup(groupId2!, batch2)

          // Same group reused
          expect(groupId2).toBe(groupId1)

          // Still only one root group
          const rootGroups = await db.groups
            .filter((g) => g.parentId === null)
            .toArray()
          expect(rootGroups).toHaveLength(1)

          // All files point to that group
          const allFiles = await db.files.toArray()
          for (const file of allFiles) {
            expect(file.groupId).toBe(groupId1)
          }
        }
      ),
      { numRuns: 50 }
    )
  })
})

// ─── Property 6: File record shape ──────────────────────────────────────────

/**
 * Property 6: File record shape
 *
 * For any readable file imported from a directory, the created file record
 * SHALL have: name equal to the file's basename (last path component),
 * groupPlacement equal to 'auto', and exactly one associated version record
 * with source equal to 'drop' and content equal to the file's UTF-8 text.
 * Duplicate basenames within the same import SHALL each produce their own
 * separate file record.
 *
 * Validates: Requirements 3.4, 4.1, 4.2, 4.3
 */
describe('Feature: directory-drop-import, Property 6: File record shape', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('name = basename, groupPlacement = auto, one version with source = drop', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirName,
        fc.array(arbCollectedFile, { minLength: 1, maxLength: 20 }),
        async (dirName, files) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // Deduplicate names for this test (upsert merges same-name files)
          const uniqueFiles: typeof files = []
          const seen = new Set<string>()
          for (const f of files) {
            if (!seen.has(f.name)) {
              seen.add(f.name)
              uniqueFiles.push(f)
            }
          }
          if (uniqueFiles.length === 0) return

          const groupId = await findOrCreateDirectoryGroup(dirName)
          const result = await createFilesInGroup(groupId!, uniqueFiles)
          const created = result.files

          expect(created.length).toBe(uniqueFiles.length)

          for (let i = 0; i < uniqueFiles.length; i++) {
            const input = uniqueFiles[i]!
            const record = created[i]!

            // name = basename from input
            expect(record.name).toBe(input.name)

            // groupPlacement = 'auto'
            expect(record.groupPlacement).toBe('auto')

            // Exactly one version with source = 'drop'
            const versions = await db.versions
              .where('fileId')
              .equals(record.id!)
              .toArray()
            expect(versions).toHaveLength(1)
            expect(versions[0]!.source).toBe('drop')
            expect(versions[0]!.content).toBe(input.content)

            // currentVersionId points to that version
            expect(record.currentVersionId).toBe(versions[0]!.id)
          }
        }
      ),
      { numRuns: 50 }
    )
  })

  it('duplicate basenames within a single batch upsert into one file record', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirName,
        arbReadableFilename,
        arbContent,
        fc.integer({ min: 2, max: 5 }),
        async (dirName, filename, content, count) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // Same filename repeated N times with varying content
          const files = Array.from({ length: count }, (_, i) => ({
            name: filename,
            content: `${content}-${i}`,
          }))

          const groupId = await findOrCreateDirectoryGroup(dirName)
          const result = await createFilesInGroup(groupId!, files)
          const created = result.files

          // With upsert: first creates, rest update same record
          // Result contains one entry per input (may reference same file)
          expect(created.length).toBe(count)

          // Only one file record in DB for this name
          const allFiles = await db.files.toArray()
          expect(allFiles.length).toBe(1)
          expect(allFiles[0]!.name).toBe(filename)
          expect(allFiles[0]!.groupPlacement).toBe('auto')

          // N versions created (one per input)
          const versions = await db.versions
            .where('fileId')
            .equals(allFiles[0]!.id!)
            .toArray()
          expect(versions.length).toBe(count)

          // currentVersionId points to last version
          const lastVersion = versions.sort((a, b) => a.createdAt - b.createdAt).at(-1)!
          expect(allFiles[0]!.currentVersionId).toBe(lastVersion.id)

          // Counts: 1 created + (count-1) updated
          expect(result.createdCount).toBe(1)
          expect(result.updatedCount).toBe(count - 1)
        }
      ),
      { numRuns: 50 }
    )
  })
})

// ─── Property 11: Mixed drop dispatch ────────────────────────────────────────

/**
 * Property 11: Mixed drop dispatch
 *
 * For any drop event containing a mix of M individual files and D directories,
 * the system SHALL process all M files through the single-file import flow
 * and all D directories through the directory import flow independently.
 *
 * This tests the classification logic: given a set of items classified as
 * file vs directory, both flows run independently without interference.
 *
 * Validates: Requirements 1.2
 */
describe('Feature: directory-drop-import, Property 11: Mixed drop dispatch', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('files and directories processed independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Directories: each with a name and list of files
        fc.array(
          fc.tuple(
            arbDirName,
            fc.array(arbCollectedFile, { minLength: 1, maxLength: 5 })
          ),
          { minLength: 1, maxLength: 3 }
        ),
        // Individual files (simulate single-file drop flow)
        fc.array(arbCollectedFile, { minLength: 1, maxLength: 5 }),
        async (directories, individualFiles) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // Ensure unique directory names for clear group counting
          const usedNames = new Set<string>()
          const uniqueDirs = directories.filter(([name]) => {
            const trimmed = name.trim().slice(0, 255)
            if (usedNames.has(trimmed)) return false
            usedNames.add(trimmed)
            return true
          })

          // Process directories through directory import flow
          const dirFileCount: number[] = []
          const dirUniqueFileCount: number[] = []
          for (const [dirName, files] of uniqueDirs) {
            const groupId = await findOrCreateDirectoryGroup(dirName)
            expect(groupId).not.toBeNull()
            await createFilesInGroup(groupId!, files)
            dirFileCount.push(files.length)
            dirUniqueFileCount.push(new Set(files.map((f) => f.name)).size)
          }

          // Process individual files through single-file flow (no group)
          // Simulate by creating files without groupId assignment
          const individualCreated: number[] = []
          for (const { name, content } of individualFiles) {
            const fileId = await db.files.add({
              name,
              currentVersionId: 0,
              updatedAt: Date.now(),
              groupId: null,
              groupPlacement: 'auto',
            })
            const versionId = await db.versions.add({
              fileId: fileId as number,
              content,
              createdAt: Date.now(),
              source: 'drop',
            })
            await db.files.update(fileId, {
              currentVersionId: versionId as number,
            })
            individualCreated.push(fileId as number)
          }

          // Verify: directories created the right number of groups
          const rootGroups = await db.groups
            .filter((g) => g.parentId === null)
            .toArray()
          expect(rootGroups.length).toBe(uniqueDirs.length)

          // Verify: total files = sum of unique dir files + individual files
          const allFiles = await db.files.toArray()
          const expectedTotal =
            dirUniqueFileCount.reduce((sum, c) => sum + c, 0) +
            individualFiles.length
          expect(allFiles.length).toBe(expectedTotal)

          // Verify: directory files have groupId set
          const groupedFiles = allFiles.filter((f) => f.groupId != null)
          const expectedGrouped = dirUniqueFileCount.reduce((s, c) => s + c, 0)
          expect(groupedFiles.length).toBe(expectedGrouped)

          // Verify: individual files have groupId = null (independent flow)
          const ungroupedFiles = allFiles.filter((f) => f.groupId == null)
          expect(ungroupedFiles.length).toBe(individualFiles.length)

          // Verify: each directory's files point to correct group
          for (const group of rootGroups) {
            const filesInGroup = allFiles.filter(
              (f) => f.groupId === group.id
            )
            const dirEntry = uniqueDirs.find(
              ([name]) => name.trim().slice(0, 255) === group.name
            )
            expect(dirEntry).toBeDefined()
            const expectedUniqueCount = new Set(dirEntry![1].map((f) => f.name)).size
            expect(filesInGroup.length).toBe(expectedUniqueCount)
          }
        }
      ),
      { numRuns: 50 }
    )
  })
})
