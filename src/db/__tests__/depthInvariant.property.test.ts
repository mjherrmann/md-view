import { describe, it } from 'vitest'
import fc from 'fast-check'
import type { GroupRecord } from '../schema'
import {
  buildGroupMaps,
  computeDepth,
  validateReparent,
} from '../groupTree'

/**
 * Property 1: Depth invariant
 *
 * For any sequence of group creation and reparent operations, no group in the
 * resulting tree SHALL have a depth greater than 3.
 *
 * Validates: Requirements 1.4, 3.5
 */
describe('Feature: nested-groups, Property 1: Depth invariant', () => {
  /** Generate a valid tree of groups respecting max depth 3. */
  function arbValidTree(maxGroups: number): fc.Arbitrary<GroupRecord[]> {
    return fc
      .integer({ min: 1, max: maxGroups })
      .chain((count) =>
        fc.array(
          fc.record({
            parentIndex: fc.integer({ min: -1, max: count - 1 }),
            name: fc.string({ minLength: 1, maxLength: 10 }),
          }),
          { minLength: count, maxLength: count }
        )
      )
      .map((entries) => {
        // Build groups ensuring depth ≤ 3
        const groups: GroupRecord[] = []
        const depthOf = new Map<number, number>()

        for (let i = 0; i < entries.length; i++) {
          const id = i + 1
          const entry = entries[i]!
          let parentId: number | null = null

          if (entry.parentIndex >= 0 && entry.parentIndex < i) {
            const candidateParentId = entry.parentIndex + 1
            const parentDepth = depthOf.get(candidateParentId) ?? 0
            // Only assign parent if it won't exceed depth 3
            if (parentDepth + 1 <= 3) {
              parentId = candidateParentId
            }
          }

          const depth = parentId === null ? 0 : (depthOf.get(parentId) ?? 0) + 1
          depthOf.set(id, depth)
          groups.push({ id, name: entry.name, sortOrder: i, parentId })
        }

        return groups
      })
  }

  type Operation =
    | { type: 'createChild'; parentIndex: number }
    | { type: 'reparent'; groupIndex: number; targetIndex: number }

  /** Generate a sequence of createChild and reparent operations. */
  function arbOperations(maxOps: number): fc.Arbitrary<Operation[]> {
    return fc.array(
      fc.oneof(
        fc.record({
          type: fc.constant('createChild' as const),
          parentIndex: fc.integer({ min: -1, max: 50 }),
        }),
        fc.record({
          type: fc.constant('reparent' as const),
          groupIndex: fc.integer({ min: 0, max: 50 }),
          targetIndex: fc.integer({ min: -1, max: 50 }),
        })
      ),
      { minLength: 1, maxLength: maxOps }
    )
  }

  /**
   * Apply operations to a mutable group list, enforcing depth constraints
   * the same way the real system does.
   */
  function applyOperations(
    groups: GroupRecord[],
    operations: Operation[]
  ): GroupRecord[] {
    let nextId = groups.length > 0 ? Math.max(...groups.map((g) => g.id!)) + 1 : 1

    for (const op of operations) {
      const { byId, childrenByParent } = buildGroupMaps(groups)

      if (op.type === 'createChild') {
        const parentIndex = op.parentIndex
        // Resolve parent from current groups
        let parentId: number | null = null
        if (parentIndex >= 0 && parentIndex < groups.length) {
          parentId = groups[parentIndex]!.id!
        }

        // Check depth constraint before creating
        if (parentId !== null) {
          const parentDepth = computeDepth(parentId, byId)
          if (parentDepth + 1 > 3) {
            continue // Skip — would exceed max depth
          }
        }

        groups.push({
          id: nextId++,
          name: `g${nextId}`,
          sortOrder: groups.length,
          parentId,
        })
      } else if (op.type === 'reparent') {
        const groupIndex = op.groupIndex
        const targetIndex = op.targetIndex

        if (groupIndex < 0 || groupIndex >= groups.length) continue

        const groupId = groups[groupIndex]!.id!
        let targetParentId: number | null = null
        if (targetIndex >= 0 && targetIndex < groups.length) {
          targetParentId = groups[targetIndex]!.id!
        }

        // Use validateReparent — same as production code
        const error = validateReparent(groupId, targetParentId, byId, childrenByParent)
        if (error !== null) continue // Invalid — skip

        // Apply the reparent
        const group = groups.find((g) => g.id === groupId)!
        group.parentId = targetParentId
      }
    }

    return groups
  }

  it('no group exceeds depth 3 after arbitrary createChild and reparent sequences', () => {
    fc.assert(
      fc.property(
        arbValidTree(15),
        arbOperations(20),
        (initialTree, operations) => {
          const groups = applyOperations(
            initialTree.map((g) => ({ ...g })), // clone
            operations
          )

          const { byId } = buildGroupMaps(groups)

          for (const group of groups) {
            const depth = computeDepth(group.id!, byId)
            if (depth > 3) {
              return false
            }
          }
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
})
