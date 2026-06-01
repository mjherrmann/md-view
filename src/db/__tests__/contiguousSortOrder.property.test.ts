import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import {
  db,
  createChildGroup,
  reparentGroup,
  reorderSiblings,
  deleteGroupWithPromotion,
} from '../schema'

/**
 * Property 4: Contiguous sibling sortOrder
 *
 * For any parent (including null for root level), after any mutation
 * (create, reparent, reorder, delete), the sortOrder values among siblings
 * sharing that parent SHALL form a contiguous sequence starting at 0
 * with no gaps or duplicates.
 *
 * Validates: Requirements 1.5, 5.1
 */
describe('Feature: nested-groups, Property 4: Contiguous sibling sortOrder', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
  })

  type Op =
    | { type: 'create'; name: string; parentIdx: number }
    | { type: 'reparent'; groupIdx: number; targetIdx: number }
    | { type: 'reorder'; parentIdx: number; seed: number }
    | { type: 'delete'; groupIdx: number }

  const arbOp: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      type: fc.constant('create' as const),
      name: fc.string({ minLength: 1, maxLength: 8, unit: 'grapheme' }),
      parentIdx: fc.integer({ min: -1, max: 15 }),
    }),
    fc.record({
      type: fc.constant('reparent' as const),
      groupIdx: fc.integer({ min: 0, max: 15 }),
      targetIdx: fc.integer({ min: -1, max: 15 }),
    }),
    fc.record({
      type: fc.constant('reorder' as const),
      parentIdx: fc.integer({ min: -1, max: 15 }),
      seed: fc.integer({ min: 0, max: 1000 }),
    }),
    fc.record({
      type: fc.constant('delete' as const),
      groupIdx: fc.integer({ min: 0, max: 15 }),
    })
  )

  const arbOps = fc.array(arbOp, { minLength: 1, maxLength: 10 })

  /**
   * Deterministic shuffle using a seed to produce a permutation of an array.
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

  /**
   * Assert that for every parentId, siblings have sortOrder 0..N-1
   * with no gaps or duplicates.
   */
  async function assertContiguousSortOrder(): Promise<void> {
    const allGroups = await db.groups.toArray()

    // Group by parentId
    const byParent = new Map<number | null, number[]>()
    for (const g of allGroups) {
      const key = g.parentId
      const list = byParent.get(key) ?? []
      list.push(g.sortOrder)
      byParent.set(key, list)
    }

    for (const [parentId, sortOrders] of byParent) {
      const sorted = [...sortOrders].sort((a, b) => a - b)
      const expected = Array.from({ length: sorted.length }, (_, i) => i)
      expect(sorted, `siblings of parentId=${parentId}`).toEqual(expected)
    }
  }

  it('sortOrder forms contiguous 0..N-1 after arbitrary mutation sequences', async () => {
    await fc.assert(
      fc.asyncProperty(arbOps, async (ops) => {
        // Clean DB for each property run
        await db.groups.clear()
        await db.files.clear()

        const groupIds: number[] = []

        for (const op of ops) {
          try {
            switch (op.type) {
              case 'create': {
                const parentId =
                  op.parentIdx === -1 || groupIds.length === 0
                    ? null
                    : groupIds[op.parentIdx % groupIds.length] ?? null
                const id = await createChildGroup(op.name, parentId)
                groupIds.push(id)
                break
              }
              case 'reparent': {
                if (groupIds.length === 0) break
                const groupId = groupIds[op.groupIdx % groupIds.length]!
                const targetId =
                  op.targetIdx === -1
                    ? null
                    : groupIds[op.targetIdx % groupIds.length] ?? null
                await reparentGroup(groupId, targetId)
                break
              }
              case 'reorder': {
                const allGroups = await db.groups.toArray()
                const parentId =
                  op.parentIdx === -1 || groupIds.length === 0
                    ? null
                    : groupIds[op.parentIdx % groupIds.length] ?? null
                const siblings = allGroups
                  .filter((g) => g.parentId === parentId)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                if (siblings.length === 0) break
                const orderedIds = seededShuffle(
                  siblings.map((g) => g.id!),
                  op.seed
                )
                await reorderSiblings(parentId, orderedIds)
                break
              }
              case 'delete': {
                if (groupIds.length === 0) break
                const idx = op.groupIdx % groupIds.length
                const groupId = groupIds[idx]!
                // Verify group still exists before deleting
                const exists = await db.groups.get(groupId)
                if (!exists) break
                await deleteGroupWithPromotion(groupId)
                // Remove from tracking array
                groupIds.splice(idx, 1)
                break
              }
            }
          } catch {
            // Operations may throw (depth exceeded, invalid reparent, etc.)
            // That's expected — we only assert the invariant holds after all ops
          }
        }

        await assertContiguousSortOrder()
      }),
      { numRuns: 50 }
    )
  })
})
