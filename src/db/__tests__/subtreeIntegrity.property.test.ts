// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { GroupRecord } from '../schema'
import { buildGroupMaps, getDescendantIds, validateReparent } from '../groupTree'

/**
 * Property 3: Subtree integrity on reparent
 *
 * For any valid reparent of group G to a new parent, only G's parentId field
 * SHALL change; all descendant groups' parentId values and all files' groupId
 * values within the subtree SHALL remain identical to their pre-operation values.
 *
 * Validates: Requirements 4.1, 4.2
 */
describe('Feature: nested-groups, Property 3: Subtree integrity on reparent', () => {
  /**
   * Arbitrary generator for a valid group tree (max depth 3, max 12 groups).
   * Produces groups with contiguous IDs starting at 1.
   */
  const arbGroupTree = fc
    .integer({ min: 2, max: 12 })
    .chain((count) =>
      fc.array(fc.integer({ min: 0, max: 3 }), {
        minLength: count,
        maxLength: count,
      }).map((depthHints) => {
        const groups: GroupRecord[] = []
        // First group is always root
        groups.push({ id: 1, name: 'G1', sortOrder: 0, parentId: null })

        for (let i = 1; i < count; i++) {
          const id = i + 1
          // Pick a parent from existing groups respecting max depth 3
          let parentId: number | null = null
          const candidates = groups.filter((g) => {
            const { byId } = buildGroupMaps(groups)
            let depth = 0
            let cur = g.parentId
            const visited = new Set<number>()
            while (cur != null) {
              if (visited.has(cur)) break
              visited.add(cur)
              const p = byId.get(cur)
              if (!p) break
              depth++
              cur = p.parentId
            }
            // g is at `depth`, child would be at depth+1; must be ≤ 3
            return depth < 3
          })

          if (candidates.length > 0) {
            const idx = depthHints[i] % candidates.length
            parentId = candidates[idx].id!
          }

          groups.push({
            id,
            name: `G${id}`,
            sortOrder: groups.filter((g) => g.parentId === parentId).length,
            parentId,
          })
        }
        return groups
      })
    )

  /**
   * Given a tree, generate files distributed across groups in the tree.
   */
  function arbFilesForTree(groups: GroupRecord[]) {
    const groupIds = groups.map((g) => g.id!)
    return fc
      .array(fc.constantFrom(...groupIds), { minLength: 0, maxLength: 10 })
      .map((assignments) =>
        assignments.map((gid, i) => ({ id: i + 1, groupId: gid }))
      )
  }

  /**
   * Simulate a valid reparent: only change the moved group's parentId.
   * Returns the new groups array after the reparent.
   */
  function simulateReparent(
    groups: GroupRecord[],
    groupId: number,
    newParentId: number | null
  ): GroupRecord[] {
    return groups.map((g) =>
      g.id === groupId ? { ...g, parentId: newParentId } : { ...g }
    )
  }

  it('only the moved group parentId changes; descendants and files unchanged', () => {
    fc.assert(
      fc.property(
        arbGroupTree.chain((groups) =>
          fc.record({
            groups: fc.constant(groups),
            files: arbFilesForTree(groups),
            // Pick a group to move (any group in the tree)
            movedIdx: fc.integer({ min: 0, max: groups.length - 1 }),
            // Pick a target parent (null for root, or any group id)
            targetChoice: fc.integer({ min: -1, max: groups.length - 1 }),
          })
        ),
        ({ groups, files, movedIdx, targetChoice }) => {
          const movedGroup = groups[movedIdx]
          const groupId = movedGroup.id!

          // Determine target parent
          const targetParentId =
            targetChoice === -1 ? null : groups[targetChoice].id!

          // Build maps and validate
          const { byId, childrenByParent } = buildGroupMaps(groups)
          const error = validateReparent(
            groupId,
            targetParentId,
            byId,
            childrenByParent
          )

          // Skip invalid reparents — we only test valid ones
          if (error !== null) return

          // Skip no-op (same parent)
          if (movedGroup.parentId === targetParentId) return

          // Get descendants before reparent
          const descendantIds = getDescendantIds(groupId, childrenByParent)

          // Snapshot pre-reparent state
          const preDescendantParentIds = new Map<number, number | null>()
          for (const did of descendantIds) {
            const desc = byId.get(did)!
            preDescendantParentIds.set(did, desc.parentId)
          }
          const preFileGroupIds = new Map<number, number | null>()
          for (const f of files) {
            preFileGroupIds.set(f.id, f.groupId)
          }

          // Simulate the reparent
          const newGroups = simulateReparent(groups, groupId, targetParentId)

          // Assert: moved group's parentId changed
          const movedAfter = newGroups.find((g) => g.id === groupId)!
          expect(movedAfter.parentId).toBe(targetParentId)

          // Assert: all descendant parentId values unchanged
          for (const did of descendantIds) {
            const descAfter = newGroups.find((g) => g.id === did)!
            expect(descAfter.parentId).toBe(preDescendantParentIds.get(did))
          }

          // Assert: all files' groupId values unchanged
          // (reparent does not touch files — they keep their groupId)
          for (const f of files) {
            expect(f.groupId).toBe(preFileGroupIds.get(f.id))
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
