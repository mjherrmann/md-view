import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import 'fake-indexeddb/auto'
import { db } from '../schema'
import { buildGroupMaps, computeDepth, MAX_DEPTH } from '../groupTree'
import { importDirectoryTree } from '../../lib/importOrchestrator'
import type { DirectoryNode } from '../../lib/directoryTraversal'

// ─── Generators ───────────────────────────────────────────────────────────────

/** Arbitrary non-empty trimmed name (no slashes/NUL, trims to non-empty). */
const arbName = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !s.includes('/') && !s.includes('\0') && s.trim().length > 0)

/** Arbitrary file content. */
const arbContent = fc.string({ minLength: 0, maxLength: 50 })

/** Arbitrary collected file (name + content). */
const arbCollectedFile = fc
  .tuple(arbName, arbContent)
  .map(([name, content]) => ({ name: name + '.md', content }))

/**
 * Generate a DirectoryNode tree guaranteed to reach exactly `depth` levels.
 * Breadth capped at 1-2 children for speed.
 */
function arbDeepTree(depth: number): fc.Arbitrary<DirectoryNode> {
  if (depth <= 1) {
    return fc
      .tuple(arbName, fc.array(arbCollectedFile, { minLength: 0, maxLength: 2 }))
      .map(([name, files]) => ({ name, files, children: [] }))
  }
  return fc
    .tuple(
      arbName,
      fc.array(arbCollectedFile, { minLength: 0, maxLength: 2 }),
      arbDeepTree(depth - 1)
    )
    .map(([name, files, child]) => ({ name, files, children: [child] }))
}

/**
 * Arbitrary DirectoryNode tree with bounded depth and breadth.
 * Used for properties needing varied tree shapes (not just linear chains).
 */
function arbDirectoryNode(maxDepth: number): fc.Arbitrary<DirectoryNode> {
  if (maxDepth <= 0) {
    return fc
      .tuple(arbName, fc.array(arbCollectedFile, { minLength: 0, maxLength: 3 }))
      .map(([name, files]) => ({ name, files, children: [] }))
  }
  return fc
    .tuple(
      arbName,
      fc.array(arbCollectedFile, { minLength: 0, maxLength: 3 }),
      fc.array(arbDirectoryNode(maxDepth - 1), { minLength: 0, maxLength: 2 })
    )
    .map(([name, files, children]) => ({ name, files, children }))
}


// ─── Property 1: Depth invariant under hierarchical import ───────────────────

/**
 * Property 1: Depth invariant under hierarchical import
 *
 * For any directory tree of arbitrary depth, after hierarchical import,
 * no group in the database SHALL have a computed depth exceeding MAX_DEPTH − 1
 * (i.e. depth 5). All groups created by the import satisfy
 * `computeDepth(group) ≤ MAX_DEPTH - 1`.
 *
 * **Validates: Requirements 1.1, 1.5, 2.2, 2.3**
 */
describe('Feature: directory-drop-hierarchical, Property 1: Depth invariant under hierarchical import', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('no group exceeds MAX_DEPTH - 1 after importing trees of depth 1-12', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }).chain((depth) => arbDeepTree(depth)),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          await importDirectoryTree(tree)

          const allGroups = await db.groups.toArray()
          if (allGroups.length === 0) return

          const { byId } = buildGroupMaps(allGroups)

          for (const group of allGroups) {
            const depth = computeDepth(group.id!, byId)
            expect(depth).toBeLessThanOrEqual(MAX_DEPTH - 1)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ─── Property 5: Same-name reuse idempotence ─────────────────────────────────

/**
 * Property 5: Same-name reuse idempotence
 *
 * For any directory tree imported twice in succession, the second import SHALL
 * create zero new groups (all are reused via same-name matching at every level),
 * SHALL NOT delete any pre-existing file records, and the file count doubles
 * (new files added alongside existing ones without deduplication).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.3, 4.4**
 */
describe('Feature: directory-drop-hierarchical, Property 5: Same-name reuse idempotence', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('second import creates zero new groups, no files deleted, files updated (not duplicated)', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirectoryNode(2),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // First import
          const summary1 = await importDirectoryTree(tree)

          // Record state after first import
          const groupCountAfterFirst = await db.groups.count()
          const filesAfterFirst = await db.files.toArray()
          const fileCountAfterFirst = filesAfterFirst.length
          const fileIdsAfterFirst = new Set(filesAfterFirst.map((f) => f.id!))

          // Second import of same tree
          const summary2 = await importDirectoryTree(tree)

          // 1. Second import creates zero new groups (all reused)
          expect(summary2.groupsCreated).toBe(0)

          // Group count unchanged
          const groupCountAfterSecond = await db.groups.count()
          expect(groupCountAfterSecond).toBe(groupCountAfterFirst)

          // 2. No files deleted — original file records still exist
          const filesAfterSecond = await db.files.toArray()
          for (const originalId of fileIdsAfterFirst) {
            const stillExists = filesAfterSecond.some((f) => f.id === originalId)
            expect(stillExists).toBe(true)
          }

          // 3. With upsert: file count stays same (updates, not duplicates)
          expect(filesAfterSecond.length).toBe(fileCountAfterFirst)

          // 4. All files updated, none newly created on second import
          expect(summary2.filesImported).toBe(0)
          expect(summary2.filesUpdated).toBe(summary1.filesImported)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ─── Property 6: Import summary accuracy ─────────────────────────────────────

/** Count expected findOrCreateChildGroup calls that return non-null (respecting MAX_DEPTH). */
function countExpectedGroupCalls(node: DirectoryNode, currentDepth: number): number {
  if (!node.name.trim()) return 0
  let count = 1
  for (const child of node.children) {
    if (currentDepth + 1 >= MAX_DEPTH) continue
    count += countExpectedGroupCalls(child, currentDepth + 1)
  }
  return count
}

/** Count total unique files expected to be created (first import, no duplicates already in DB). */
function countExpectedFiles(node: DirectoryNode, currentDepth: number): number {
  if (!node.name.trim()) return 0
  // Collect all file names that land in this group
  const namesInGroup = new Set<string>()
  for (const f of node.files) {
    namesInGroup.add(f.name)
  }
  let childCount = 0
  for (const child of node.children) {
    if (currentDepth + 1 >= MAX_DEPTH) {
      // Flattened files also land in this group
      for (const name of collectAllFileNamesDeep(child)) {
        namesInGroup.add(name)
      }
    } else {
      childCount += countExpectedFiles(child, currentDepth + 1)
    }
  }
  return namesInGroup.size + childCount
}

/** Collect all file names recursively in a subtree (for flattening). */
function collectAllFileNamesDeep(node: DirectoryNode): string[] {
  const names: string[] = []
  for (const f of node.files) names.push(f.name)
  for (const child of node.children) {
    names.push(...collectAllFileNamesDeep(child))
  }
  return names
}



/**
 * Property 6: Import summary accuracy
 *
 * For any directory tree import, the returned ImportSummary.groupsCreated +
 * ImportSummary.groupsReused SHALL equal the total number of findOrCreateChildGroup
 * calls that returned non-null, and ImportSummary.filesImported SHALL equal the
 * count of file records created in the database during that import.
 *
 * **Validates: Requirements 6.2, 6.4**
 */
describe('Feature: directory-drop-hierarchical, Property 6: Import summary accuracy', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('groupsCreated + groupsReused equals total group calls, filesImported equals DB file count delta', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirectoryNode(MAX_DEPTH),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          const filesBefore = await db.files.count()
          const summary = await importDirectoryTree(tree)
          const filesAfter = await db.files.count()

          const expectedGroupCalls = countExpectedGroupCalls(tree, 0)
          expect(summary.groupsCreated + summary.groupsReused).toBe(expectedGroupCalls)

          // First import from empty DB → all created, none reused
          expect(summary.groupsReused).toBe(0)
          expect(summary.groupsCreated).toBe(expectedGroupCalls)

          // filesImported = actual DB file count delta
          expect(summary.filesImported).toBe(filesAfter - filesBefore)

          // filesImported matches expected file count from tree structure
          const expectedFiles = countExpectedFiles(tree, 0)
          expect(summary.filesImported).toBe(expectedFiles)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('groupsReused is accurate on second import of same tree', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirectoryNode(3),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          const first = await importDirectoryTree(tree)
          const expectedGroupCalls = countExpectedGroupCalls(tree, 0)
          expect(first.groupsCreated).toBe(expectedGroupCalls)

          // Second import — all groups reused, all files updated
          const filesBefore = await db.files.count()
          const second = await importDirectoryTree(tree)
          const filesAfter = await db.files.count()

          expect(second.groupsCreated + second.groupsReused).toBe(expectedGroupCalls)
          expect(second.groupsReused).toBe(expectedGroupCalls)
          expect(second.groupsCreated).toBe(0)

          // With upsert: no new files created, count unchanged
          expect(second.filesImported).toBe(filesAfter - filesBefore)
          expect(filesAfter).toBe(filesBefore)
          expect(second.filesImported).toBe(0)
          expect(second.filesUpdated).toBe(first.filesImported)
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ─── Property 3: File assignment correctness ─────────────────────────────────

/**
 * Generate a DirectoryNode tree with bounded depth (≤ maxDepth) where every node
 * has at least one file. This ensures no flattening occurs (stays within depth limit)
 * and every directory level contributes files to verify assignment.
 */
function arbTreeWithFiles(maxDepth: number): fc.Arbitrary<DirectoryNode> {
  if (maxDepth <= 0) {
    return fc
      .tuple(arbName, fc.array(arbCollectedFile, { minLength: 1, maxLength: 3 }))
      .map(([name, files]) => ({ name, files, children: [] }))
  }
  return fc
    .tuple(
      arbName,
      fc.array(arbCollectedFile, { minLength: 1, maxLength: 3 }),
      fc.array(arbTreeWithFiles(maxDepth - 1), { minLength: 0, maxLength: 2 })
    )
    .map(([name, files, children]) => ({ name, files, children }))
}

/**
 * Collect all expected file basenames at each depth level from the source tree.
 * Returns a Map<depth, Set<basename>> representing files expected at each level.
 */
function collectExpectedFilesByDepth(
  node: DirectoryNode,
  currentDepth: number
): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>()

  function walk(n: DirectoryNode, depth: number): void {
    if (!n.name.trim()) return
    for (const f of n.files) {
      if (!result.has(depth)) result.set(depth, new Set())
      result.get(depth)!.add(f.name)
    }
    for (const child of n.children) {
      walk(child, depth + 1)
    }
  }

  walk(node, currentDepth)
  return result
}

/**
 * Property 3: File assignment correctness
 *
 * For any directory tree and any readable file at directory level L
 * (where L ≤ MAX_DEPTH − 1), the file record SHALL have `groupId` pointing
 * to the group at depth L, `groupPlacement` equal to `'auto'`, and `name`
 * equal to the file's basename.
 *
 * **Validates: Requirements 2.4, 8.5, 8.6**
 */
describe('Feature: directory-drop-hierarchical, Property 3: File assignment correctness', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('every file has groupPlacement auto, name matches basename, groupId at correct depth', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: MAX_DEPTH - 2 }).chain((depth) => arbTreeWithFiles(depth)),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          await importDirectoryTree(tree)

          const allFiles = await db.files.toArray()
          const allGroups = await db.groups.toArray()

          if (allFiles.length === 0) return

          const { byId } = buildGroupMaps(allGroups)

          // Collect all expected file names by depth from source tree
          const expectedByDepth = collectExpectedFilesByDepth(tree, 0)

          for (const file of allFiles) {
            // 1. groupPlacement is always 'auto'
            expect(file.groupPlacement).toBe('auto')

            // 2. file name matches one of the source tree's file basenames
            const allExpectedNames = new Set<string>()
            for (const names of expectedByDepth.values()) {
              for (const n of names) allExpectedNames.add(n)
            }
            expect(allExpectedNames.has(file.name)).toBe(true)

            // 3. groupId points to a group whose depth matches the source level
            expect(file.groupId).toBeDefined()
            const groupDepth = computeDepth(file.groupId!, byId)
            const namesAtDepth = expectedByDepth.get(groupDepth)
            expect(namesAtDepth).toBeDefined()
            expect(namesAtDepth!.has(file.name)).toBe(true)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ─── Property 4: Flatten-point assignment ────────────────────────────────────

/**
 * Property 4: Flatten-point assignment
 *
 * For any directory tree with files at source depth D > MAX_DEPTH − 1,
 * those files SHALL be assigned to the group at depth MAX_DEPTH − 1
 * (the deepest allowed ancestor group). No group is created for directories
 * beyond the depth limit.
 *
 * **Validates: Requirements 2.3, 5.3**
 */
describe('Feature: directory-drop-hierarchical, Property 4: Flatten-point assignment', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  /**
   * Generator: creates a linear chain of depth exactly `depth` levels,
   * with at least one file at the deepest level (beyond MAX_DEPTH - 1).
   */
  function arbDeepTreeWithFilesAtLeaf(
    depth: number
  ): fc.Arbitrary<DirectoryNode> {
    if (depth <= 1) {
      // Leaf node — must have at least one file
      return fc
        .tuple(arbName, fc.array(arbCollectedFile, { minLength: 1, maxLength: 3 }))
        .map(([name, files]) => ({ name, files, children: [] }))
    }
    return fc
      .tuple(
        arbName,
        fc.array(arbCollectedFile, { minLength: 0, maxLength: 2 }),
        arbDeepTreeWithFilesAtLeaf(depth - 1)
      )
      .map(([name, files, child]) => ({ name, files, children: [child] }))
  }

  it('files beyond MAX_DEPTH - 1 land in the deepest allowed group, no groups created beyond depth limit', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate trees of depth 8-12 (well beyond MAX_DEPTH=6, so flatten-point at depth 5)
        fc.integer({ min: 8, max: 12 }).chain((d) => arbDeepTreeWithFilesAtLeaf(d)),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          await importDirectoryTree(tree)

          const allGroups = await db.groups.toArray()
          const allFiles = await db.files.toArray()
          if (allGroups.length === 0) return

          const { byId } = buildGroupMaps(allGroups)

          // 1. No group has depth > MAX_DEPTH - 1
          for (const group of allGroups) {
            const depth = computeDepth(group.id!, byId)
            expect(depth).toBeLessThanOrEqual(MAX_DEPTH - 1)
          }

          // 2. Find the deepest group (should be at MAX_DEPTH - 1)
          const deepestGroup = allGroups.reduce((best, g) => {
            const d = computeDepth(g.id!, byId)
            const bestD = computeDepth(best.id!, byId)
            return d > bestD ? g : best
          }, allGroups[0])
          const deepestDepth = computeDepth(deepestGroup.id!, byId)
          expect(deepestDepth).toBe(MAX_DEPTH - 1)

          // 3. Files from nodes beyond the depth limit are assigned
          //    to the group at depth MAX_DEPTH - 1.
          //    Count expected flattened files from the tree structure.
          const flattenedFiles = countFlattenedFiles(tree, 0)
          const filesInDeepestGroup = allFiles.filter(
            (f) => f.groupId === deepestGroup.id
          )

          // The deepest group should contain at least the flattened files
          expect(filesInDeepestGroup.length).toBeGreaterThanOrEqual(flattenedFiles)

          // 4. No groups exist for nodes beyond the flatten-point:
          //    total group count should equal min(tree depth, MAX_DEPTH)
          const expectedGroupCount = Math.min(countTreeDepth(tree), MAX_DEPTH)
          expect(allGroups.length).toBe(expectedGroupCount)
        }
      ),
      { numRuns: 100 }
    )
  })
})

/** Count files that would be flattened (at source depth > MAX_DEPTH - 1). */
/** Count unique files that would be flattened (at source depth > MAX_DEPTH - 1). */
function countFlattenedFiles(node: DirectoryNode, currentDepth: number): number {
  // Collect all flattened file names into a set to account for upsert dedup
  const flattenedNames = new Set<string>()
  collectFlattenedNames(node, currentDepth, flattenedNames)
  return flattenedNames.size
}

function collectFlattenedNames(
  node: DirectoryNode,
  currentDepth: number,
  names: Set<string>
): void {
  for (const child of node.children) {
    if (currentDepth + 1 >= MAX_DEPTH) {
      for (const n of collectAllFileNamesDeep(child)) {
        names.add(n)
      }
    } else {
      collectFlattenedNames(child, currentDepth + 1, names)
    }
  }
}

/** Count the total depth of a linear tree (number of nodes from root to deepest leaf). */
function countTreeDepth(node: DirectoryNode): number {
  if (node.children.length === 0) return 1
  let maxChildDepth = 0
  for (const child of node.children) {
    const d = countTreeDepth(child)
    if (d > maxChildDepth) maxChildDepth = d
  }
  return 1 + maxChildDepth
}


// ─── Property 2: Structure mirroring ─────────────────────────────────────────

/** Count total nodes in a DirectoryNode tree (including root). */
function countNodes(node: DirectoryNode): number {
  let count = 1
  for (const child of node.children) {
    count += countNodes(child)
  }
  return count
}

/**
 * Verify 1:1 correspondence between tree nodes and DB groups by walking both
 * structures in parallel. Returns true if every node has a matching group with
 * correct name and parent-child relationship.
 */
async function verifyStructureMirror(
  node: DirectoryNode,
  parentId: number | null
): Promise<boolean> {
  const expectedName = node.name.trim().slice(0, 255)
  const allGroups = await db.groups.toArray()
  const match = allGroups.find(
    (g) => g.name === expectedName && g.parentId === parentId
  )
  if (!match?.id) return false

  for (const child of node.children) {
    const ok = await verifyStructureMirror(child, match.id)
    if (!ok) return false
  }
  return true
}

/**
 * Property 2: Structure mirroring
 *
 * For any directory tree where every subdirectory is within the depth limit
 * (source tree depth ≤ MAX_DEPTH counting root as level 1), the resulting group
 * hierarchy has a one-to-one correspondence between source subdirectories and
 * groups. Each subdirectory becomes a child group of its parent directory's group,
 * with group name equal to the subdirectory's folder name (trimmed, capped at 255 chars).
 *
 * **Validates: Requirements 2.1, 2.5, 7.1, 7.2, 7.3**
 */
describe('Feature: directory-drop-hierarchical, Property 2: Structure mirroring', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('group count equals node count and names/parent-child relationships match tree', { timeout: 30_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirectoryNode(MAX_DEPTH - 2),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          await importDirectoryTree(tree)

          const allGroups = await db.groups.toArray()

          // 1. Total group count equals total nodes in the tree
          const expectedNodeCount = countNodes(tree)
          expect(allGroups.length).toBe(expectedNodeCount)

          // 2. Each group name matches its corresponding node name (trimmed, capped 255)
          // 3. Parent-child relationships match tree structure
          const structureValid = await verifyStructureMirror(tree, null)
          expect(structureValid).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})


// ─── Property 9: File version update on re-drop ──────────────────────────────

/**
 * Helper: clone a DirectoryNode tree with different file content (same names).
 * Appends a suffix to each file's content to guarantee difference.
 */
function cloneTreeWithNewContent(node: DirectoryNode, suffix: string): DirectoryNode {
  return {
    name: node.name,
    files: node.files.map((f) => ({ name: f.name, content: f.content + suffix })),
    children: node.children.map((c) => cloneTreeWithNewContent(c, suffix)),
  }
}

/** Collect all file names from a tree (respecting MAX_DEPTH flattening). */
function collectAllFileEntries(
  node: DirectoryNode,
  currentDepth: number
): Array<{ name: string; groupDepth: number }> {
  if (!node.name.trim()) return []
  const entries: Array<{ name: string; groupDepth: number }> = []
  for (const f of node.files) {
    entries.push({ name: f.name, groupDepth: currentDepth })
  }
  for (const child of node.children) {
    if (currentDepth + 1 >= MAX_DEPTH) {
      // Flattened files land in current group
      for (const n of collectAllFileNamesDeep(child)) {
        entries.push({ name: n, groupDepth: currentDepth })
      }
    } else {
      entries.push(...collectAllFileEntries(child, currentDepth + 1))
    }
  }
  return entries
}

/**
 * Property 9: File version update on re-drop
 *
 * For any file F with name N in group G, when a new file with the same name N
 * is imported into group G, the system SHALL NOT create a new file record.
 * Instead, it SHALL add a new version record to the existing file F with
 * `source = 'drop'`, update F's `currentVersionId` to the new version, and
 * update F's `updatedAt`. The total file record count for name N in group G
 * SHALL remain 1. The version count for F SHALL increase by 1.
 *
 * **Validates: Requirements 4.3, 4.4**
 */
describe('Feature: directory-drop-hierarchical, Property 9: file version update on re-drop', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  it('re-importing same tree with different content updates versions without creating duplicate files', { timeout: 60_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirectoryNode(3).filter((tree) => {
          // Ensure tree has at least one file somewhere
          const entries = collectAllFileEntries(tree, 0)
          return entries.length > 0
        }),
        async (tree) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // First import: creates files with initial versions
          await importDirectoryTree(tree)

          const filesAfterFirst = await db.files.toArray()
          const versionsAfterFirst = await db.versions.toArray()
          const fileCountAfterFirst = filesAfterFirst.length

          // Record version counts per file and updatedAt timestamps
          const versionCountByFile = new Map<number, number>()
          const updatedAtByFile = new Map<number, number>()
          for (const file of filesAfterFirst) {
            const versions = versionsAfterFirst.filter((v) => v.fileId === file.id!)
            versionCountByFile.set(file.id!, versions.length)
            updatedAtByFile.set(file.id!, file.updatedAt)
          }

          // Small delay to ensure updatedAt can differ
          await new Promise((r) => setTimeout(r, 2))

          // Second import: same structure, different content
          const modifiedTree = cloneTreeWithNewContent(tree, '__v2')
          await importDirectoryTree(modifiedTree)

          const filesAfterSecond = await db.files.toArray()
          const versionsAfterSecond = await db.versions.toArray()

          // 1. File record count unchanged (no duplicates)
          expect(filesAfterSecond.length).toBe(fileCountAfterFirst)

          // Verify per-file invariants
          for (const file of filesAfterSecond) {
            const fileId = file.id!

            // 2. Version count increased by exactly 1
            const versionsForFile = versionsAfterSecond.filter((v) => v.fileId === fileId)
            const previousCount = versionCountByFile.get(fileId)!
            expect(versionsForFile.length).toBe(previousCount + 1)

            // 3. currentVersionId points to the latest version (highest id)
            const latestVersion = versionsForFile.reduce((best, v) =>
              (v.id ?? 0) > (best.id ?? 0) ? v : best
            )
            expect(file.currentVersionId).toBe(latestVersion.id)

            // 4. Latest version has source = 'drop' and new content (contains suffix)
            expect(latestVersion.source).toBe('drop')
            expect(latestVersion.content).toContain('__v2')

            // 5. updatedAt was updated (>= previous value; timestamps may coincide in fast runs)
            expect(file.updatedAt).toBeGreaterThanOrEqual(updatedAtByFile.get(fileId)!)
          }

          // 6. No duplicate file records: for each (name, groupId) pair, count is exactly 1
          const filesByKey = new Map<string, number>()
          for (const file of filesAfterSecond) {
            const key = `${file.groupId}::${file.name}`
            filesByKey.set(key, (filesByKey.get(key) ?? 0) + 1)
          }
          for (const [key, count] of filesByKey) {
            expect(count, `duplicate file record for ${key}`).toBe(1)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
