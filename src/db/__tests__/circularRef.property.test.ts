import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { GroupRecord } from '../schema'
import { buildGroupMaps, getDescendantIds, validateReparent } from '../groupTree'

/**
 * Property 2: Circular reference prevention
 *
 * For any group tree and any attempted reparent of group G to target T,
 * if T is G itself or any transitive descendant of G, the operation SHALL
 * be rejected and the tree SHALL remain unchanged.
 *
 * Validates: Requirements 1.6, 3.3, 3.4, 6.1, 6.2, 6.3
 */
describe('Feature: nested-groups, Property 2: Circular reference prevention', () => {
  /**
   * Generate a valid group tree as GroupRecord[] with max depth 3.
   * Builds the tree level by level, assigning parentIds from the previous level.
   */
  const arbGroupTree = fc
    .integer({ min: 1, max: 15 })
    .chain((size) =>
      fc.array(
        fc.record({
          childCount: fc.integer({ min: 0, max: 3 }),
        }),
        { minLength: size, maxLength: size }
      )
    )
    .map((specs) => {
      const groups: GroupRecord[] = []
      let nextId = 1

      // Create at least one root group
      const rootCount = Math.max(1, Math.min(specs.length, 3))
      for (let i = 0; i < rootCount; i++) {
        groups.push({ id: nextId++, name: `G${nextId - 1}`, sortOrder: i, parentId: null })
      }

      // Build up to depth 3 by adding children to existing groups
      const maxDepth = 3
      const depthOf = new Map<number, number>()
      for (const g of groups) depthOf.set(g.id!, 0)

      let specIdx = rootCount
      for (const parent of [...groups]) {
        if (specIdx >= specs.length) break
        const parentDepth = depthOf.get(parent.id!) ?? 0
        if (parentDepth >= maxDepth) continue

        const childCount = Math.min(specs[specIdx]?.childCount ?? 0, 3)
        specIdx++
        for (let c = 0; c < childCount; c++) {
          const childId = nextId++
          groups.push({ id: childId, name: `G${childId}`, sortOrder: c, parentId: parent.id! })
          depthOf.set(childId, parentDepth + 1)
        }
      }

      return groups
    })
    .filter((groups) => groups.length >= 2) // need at least 2 groups for reparent

  /**
   * Given a tree, generate a reparent attempt that targets self or a descendant
   * (i.e., an invalid circular reparent).
   */
  function arbInvalidReparent(groups: GroupRecord[]) {
    return fc
      .integer({ min: 0, max: groups.length - 1 })
      .chain((groupIdx) => {
        const group = groups[groupIdx]
        const groupId = group.id!
        const { childrenByParent } = buildGroupMaps(groups)
        const descendants = getDescendantIds(groupId, childrenByParent)

        // Invalid targets: self + all descendants
        const invalidTargets = [groupId, ...descendants]
        if (invalidTargets.length === 0) {
          // Fallback: self-reference is always invalid
          return fc.constant({ groupId, targetParentId: groupId })
        }

        return fc
          .integer({ min: 0, max: invalidTargets.length - 1 })
          .map((targetIdx) => ({
            groupId,
            targetParentId: invalidTargets[targetIdx],
          }))
      })
  }

  /**
   * Given a tree, generate an arbitrary reparent attempt (may be valid or invalid).
   */
  function arbAnyReparent(groups: GroupRecord[]) {
    return fc
      .integer({ min: 0, max: groups.length - 1 })
      .chain((groupIdx) => {
        const group = groups[groupIdx]
        const groupId = group.id!
        // Target can be null (root), self, or any other group
        const possibleTargets: (number | null)[] = [null, ...groups.map((g) => g.id!)]
        return fc
          .integer({ min: 0, max: possibleTargets.length - 1 })
          .map((targetIdx) => ({
            groupId,
            targetParentId: possibleTargets[targetIdx],
          }))
      })
  }

  it('rejects reparent when target is self or a descendant of the group', () => {
    fc.assert(
      fc.property(
        arbGroupTree.chain((groups) =>
          arbInvalidReparent(groups).map((attempt) => ({ groups, attempt }))
        ),
        ({ groups, attempt }) => {
          const { groupId, targetParentId } = attempt
          const { byId, childrenByParent } = buildGroupMaps(groups)

          // Snapshot parentIds before the operation
          const parentIdsBefore = new Map(groups.map((g) => [g.id!, g.parentId]))

          const result = validateReparent(groupId, targetParentId, byId, childrenByParent)

          // Must be rejected (non-null error string)
          expect(result).not.toBeNull()
          expect(typeof result).toBe('string')

          // Tree must remain unchanged — no parentId mutations
          for (const group of groups) {
            expect(group.parentId).toBe(parentIdsBefore.get(group.id!))
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('for any reparent attempt, invalid ones are rejected and tree stays unchanged', () => {
    fc.assert(
      fc.property(
        arbGroupTree.chain((groups) =>
          arbAnyReparent(groups).map((attempt) => ({ groups, attempt }))
        ),
        ({ groups, attempt }) => {
          const { groupId, targetParentId } = attempt
          const { byId, childrenByParent } = buildGroupMaps(groups)

          // Determine if this is an invalid attempt (self or descendant)
          const descendants = getDescendantIds(groupId, childrenByParent)
          const isInvalid =
            targetParentId === groupId ||
            (targetParentId !== null && descendants.includes(targetParentId))

          // Snapshot parentIds before
          const parentIdsBefore = new Map(groups.map((g) => [g.id!, g.parentId]))

          const result = validateReparent(groupId, targetParentId, byId, childrenByParent)

          if (isInvalid) {
            // Must be rejected
            expect(result).not.toBeNull()
            expect(typeof result).toBe('string')

            // Tree unchanged
            for (const group of groups) {
              expect(group.parentId).toBe(parentIdsBefore.get(group.id!))
            }
          }
          // If valid (not self/descendant), result may be null or error (depth overflow)
          // — we only assert the circular reference property here
        }
      ),
      { numRuns: 100 }
    )
  })
})
