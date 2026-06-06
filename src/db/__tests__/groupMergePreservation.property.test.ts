// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import { db, reorderSiblings, reparentGroup } from '../schema'
import type { GroupRecord } from '../schema'
import {
  buildGroupMaps,
  validateReparent,
  getDescendantIds,
  computeDepth,
  MAX_DEPTH,
} from '../groupTree'

/**
 * Property 2: Preservation — Non-Collision Drops Unchanged
 *
 * For any group drop where no sibling with the same name exists at the target
 * level (isBugCondition returns false), the system SHALL produce the same
 * behavior as the original code: reorder when same parent, reparent when
 * different parent, no-op on self/descendant/depth-overflow.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
describe('Property 2: Preservation — Non-Collision Drops Unchanged', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  /**
   * Generate a group tree where all names are unique (no same-name collisions
   * possible at any level). Uses numeric suffixes to guarantee uniqueness.
   */
  function arbUniqueNameTree(opts?: { minSize?: number; maxSize?: number }) {
    const min = opts?.minSize ?? 3
    const max = opts?.maxSize ?? 12
    return fc
      .integer({ min, max })
      .chain((count) =>
        fc.array(fc.integer({ min: 0, max: 5 }), {
          minLength: count,
          maxLength: count,
        }).map((depthHints) => {
          const groups: GroupRecord[] = []
          let nextId = 1

          // Always create at least 2 root groups
          const rootCount = Math.min(Math.max(2, Math.floor(count / 3)), 4)
          for (let i = 0; i < rootCount; i++) {
            const id = nextId++
            groups.push({
              id,
              name: `UniqueGroup_${id}`,
              sortOrder: i,
              parentId: null,
            })
          }

          // Add children, respecting MAX_DEPTH
          for (let i = rootCount; i < count; i++) {
            const id = nextId++
            const hint = depthHints[i] % groups.length
            const candidateParent = groups[hint]!
            const { byId } = buildGroupMaps(groups)
            const parentDepth = computeDepth(candidateParent.id!, byId)

            let parentId: number | null
            if (parentDepth >= MAX_DEPTH - 1) {
              // Attach to root instead
              parentId = null
            } else {
              parentId = candidateParent.id!
            }

            const siblingsCount = groups.filter(
              (g) => g.parentId === parentId
            ).length
            groups.push({
              id,
              name: `UniqueGroup_${id}`,
              sortOrder: siblingsCount,
              parentId,
            })
          }
          return groups
        })
      )
  }

  /**
   * Seed the DB with a group tree and return all groups.
   */
  async function seedGroups(groups: GroupRecord[]): Promise<void> {
    await db.groups.bulkAdd(groups)
  }

  describe('Same-parent reorder (no collision): only sortOrder changes', () => {
    it('reorderSiblings changes only sortOrder, not parentId', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbUniqueNameTree({ minSize: 4, maxSize: 10 }).chain((groups) => {
            // Pick a parentId that has at least 2 children
            const { childrenByParent } = buildGroupMaps(groups)
            const parentsWithMultiple: (number | null)[] = []
            for (const [pid, children] of childrenByParent) {
              if (children.length >= 2) parentsWithMultiple.push(pid)
            }
            if (parentsWithMultiple.length === 0) {
              // Fallback: use null (root) which always has >= 2 in our generator
              return fc.constant({ groups, parentId: null as number | null, seed: 42 })
            }
            return fc.record({
              groups: fc.constant(groups),
              parentId: fc.constantFrom(...parentsWithMultiple),
              seed: fc.integer({ min: 0, max: 10000 }),
            })
          }),
          async ({ groups, parentId, seed }) => {
            await db.groups.clear()
            await seedGroups(groups)

            const { childrenByParent } = buildGroupMaps(groups)
            const siblings = childrenByParent.get(parentId) ?? []
            if (siblings.length < 2) return // skip degenerate

            // Snapshot parentIds before
            const preParentIds = new Map<number, number | null>()
            for (const g of groups) {
              preParentIds.set(g.id!, g.parentId)
            }

            // Deterministic shuffle
            const ids = siblings.map((g) => g.id!)
            const shuffled = seededShuffle(ids, seed)

            await reorderSiblings(parentId, shuffled)

            // Verify: no parentId changed
            const postGroups = await db.groups.toArray()
            for (const g of postGroups) {
              expect(g.parentId).toBe(preParentIds.get(g.id!))
            }

            // Verify: siblings at this parent have sortOrder 0..N-1
            const postSiblings = postGroups
              .filter((g) => g.parentId === parentId)
              .sort((a, b) => a.sortOrder - b.sortOrder)
            for (let i = 0; i < postSiblings.length; i++) {
              expect(postSiblings[i]!.sortOrder).toBe(i)
            }

            // Verify: the order matches our requested shuffle
            const postOrder = postSiblings.map((g) => g.id!)
            expect(postOrder).toEqual(shuffled)
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  describe('Cross-parent reparent (no collision): parentId updates, subtree intact', () => {
    it('reparentGroup updates source parentId and preserves subtree structure', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbUniqueNameTree({ minSize: 4, maxSize: 10 }).chain((groups) => {
            // Pick a source group and a valid different target parent
            return fc
              .integer({ min: 0, max: groups.length - 1 })
              .chain((srcIdx) => {
                const source = groups[srcIdx]!
                const { byId, childrenByParent } = buildGroupMaps(groups)

                // Collect valid targets (different parent, passes validateReparent)
                const validTargets: (number | null)[] = []
                // Try null (root)
                if (source.parentId !== null) {
                  const err = validateReparent(source.id!, null, byId, childrenByParent)
                  if (!err) validTargets.push(null)
                }
                // Try each group as potential parent
                for (const g of groups) {
                  if (g.id === source.id) continue
                  if (g.parentId === source.parentId && g.id === source.parentId) continue
                  if (source.parentId === g.id) continue // already child of g
                  const err = validateReparent(source.id!, g.id!, byId, childrenByParent)
                  if (!err && g.id !== source.parentId) {
                    validTargets.push(g.id!)
                  }
                }

                if (validTargets.length === 0) {
                  return fc.constant(null)
                }
                return fc
                  .constantFrom(...validTargets)
                  .map((targetParentId) => ({
                    groups,
                    sourceId: source.id!,
                    targetParentId,
                  }))
              })
          }),
          async (scenario) => {
            if (!scenario) return // skip if no valid reparent found

            const { groups, sourceId, targetParentId } = scenario
            await db.groups.clear()
            await seedGroups(groups)

            // Snapshot subtree before reparent
            const { childrenByParent } = buildGroupMaps(groups)
            const descendantIds = getDescendantIds(sourceId, childrenByParent)
            const preDescendantParents = new Map<number, number | null>()
            for (const did of descendantIds) {
              const g = groups.find((gr) => gr.id === did)!
              preDescendantParents.set(did, g.parentId)
            }

            await reparentGroup(sourceId, targetParentId)

            const postGroups = await db.groups.toArray()
            const movedGroup = postGroups.find((g) => g.id === sourceId)!

            // Source parentId updated
            expect(movedGroup.parentId).toBe(targetParentId)

            // Subtree internal structure unchanged (descendants keep their parentId)
            for (const did of descendantIds) {
              const desc = postGroups.find((g) => g.id === did)!
              expect(desc.parentId).toBe(preDescendantParents.get(did))
            }

            // No groups were deleted
            expect(postGroups.length).toBe(groups.length)
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  describe('Invalid drops: DB state unchanged', () => {
    it('self-drop is rejected by validateReparent (no DB mutation)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbUniqueNameTree({ minSize: 3, maxSize: 8 }).map((groups) => {
            const idx = Math.floor(Math.random() * groups.length)
            return { groups, sourceId: groups[idx]!.id! }
          }),
          async ({ groups, sourceId }) => {
            await db.groups.clear()
            await seedGroups(groups)

            const { byId, childrenByParent } = buildGroupMaps(groups)
            const error = validateReparent(sourceId, sourceId, byId, childrenByParent)

            // Self-drop must be rejected
            expect(error).not.toBeNull()

            // Attempting reparent should throw
            await expect(reparentGroup(sourceId, sourceId)).rejects.toThrow()

            // DB unchanged
            const postGroups = await db.groups.toArray()
            for (const pre of groups) {
              const post = postGroups.find((g) => g.id === pre.id)!
              expect(post.parentId).toBe(pre.parentId)
              expect(post.sortOrder).toBe(pre.sortOrder)
            }
          }
        ),
        { numRuns: 30 }
      )
    })

    it('descendant-drop is rejected by validateReparent (no DB mutation)', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbUniqueNameTree({ minSize: 5, maxSize: 10 }).chain((groups) => {
            // Find a group with at least one descendant
            const { childrenByParent } = buildGroupMaps(groups)
            const withDescendants: { sourceId: number; descendantId: number }[] = []
            for (const g of groups) {
              const descs = getDescendantIds(g.id!, childrenByParent)
              if (descs.length > 0) {
                withDescendants.push({
                  sourceId: g.id!,
                  descendantId: descs[0]!,
                })
              }
            }
            if (withDescendants.length === 0) return fc.constant(null)
            return fc
              .constantFrom(...withDescendants)
              .map((pair) => ({ groups, ...pair }))
          }),
          async (scenario) => {
            if (!scenario) return
            const { groups, sourceId, descendantId } = scenario

            await db.groups.clear()
            await seedGroups(groups)

            // Reparenting into own descendant must be rejected
            const { byId, childrenByParent } = buildGroupMaps(groups)
            const error = validateReparent(sourceId, descendantId, byId, childrenByParent)
            expect(error).not.toBeNull()

            await expect(reparentGroup(sourceId, descendantId)).rejects.toThrow()

            // DB unchanged
            const postGroups = await db.groups.toArray()
            for (const pre of groups) {
              const post = postGroups.find((g) => g.id === pre.id)!
              expect(post.parentId).toBe(pre.parentId)
              expect(post.sortOrder).toBe(pre.sortOrder)
            }
          }
        ),
        { numRuns: 30 }
      )
    })

    it('depth-overflow drop is rejected by validateReparent (no DB mutation)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant(null).map(() => {
            // Build a tree at max depth to force overflow
            const groups: GroupRecord[] = []
            let id = 1
            // Chain of depth MAX_DEPTH - 1 (root=0, child=1, ... depth MAX_DEPTH-1)
            groups.push({ id, name: `Deep_${id}`, sortOrder: 0, parentId: null })
            for (let d = 1; d < MAX_DEPTH; d++) {
              const parentId = id
              id++
              groups.push({
                id,
                name: `Deep_${id}`,
                sortOrder: 0,
                parentId,
              })
            }
            const deepestId = id

            // Add a group with a child (subtree depth = 1)
            id++
            const subtreeRoot = id
            groups.push({
              id: subtreeRoot,
              name: `Sub_${subtreeRoot}`,
              sortOrder: 1,
              parentId: null,
            })
            id++
            groups.push({
              id,
              name: `SubChild_${id}`,
              sortOrder: 0,
              parentId: subtreeRoot,
            })

            return { groups, sourceId: subtreeRoot, targetId: deepestId }
          }),
          async ({ groups, sourceId, targetId }) => {
            await db.groups.clear()
            await seedGroups(groups)

            // Reparenting subtreeRoot under the deepest node would overflow
            const { byId, childrenByParent } = buildGroupMaps(groups)
            const error = validateReparent(sourceId, targetId, byId, childrenByParent)
            expect(error).not.toBeNull()
            expect(error).toContain('depth')

            await expect(reparentGroup(sourceId, targetId)).rejects.toThrow()

            // DB unchanged
            const postGroups = await db.groups.toArray()
            for (const pre of groups) {
              const post = postGroups.find((g) => g.id === pre.id)!
              expect(post.parentId).toBe(pre.parentId)
              expect(post.sortOrder).toBe(pre.sortOrder)
            }
          }
        ),
        { numRuns: 10 }
      )
    })
  })
})

/**
 * Deterministic shuffle using a seed.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr]
  let s = seed
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}
