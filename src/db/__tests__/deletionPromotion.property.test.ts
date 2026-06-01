import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import { db, createChildGroup, deleteGroupWithPromotion } from '../schema'

/**
 * Property 7: Deletion promotes children and files
 *
 * For any group G with parent P (possibly null), deleting G SHALL result in
 * all of G's direct child groups having parentId equal to P, and all files
 * with groupId equal to G's id having groupId equal to P.
 *
 * Validates: Requirements 8.1, 8.2
 */
describe('Feature: nested-groups, Property 7: Deletion promotes children and files', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  /**
   * Arbitrary tree shape: array of { parentIndex } where -1 means root.
   * We build groups sequentially respecting depth ≤ 3.
   */
  const arbTreeShape = fc
    .integer({ min: 2, max: 8 })
    .chain((count) =>
      fc.array(fc.integer({ min: -1, max: 20 }), {
        minLength: count,
        maxLength: count,
      }).map((hints) => {
        // Build a valid tree shape as parentIndex references
        const parentIndices: (number | null)[] = []
        const depths: number[] = []

        for (let i = 0; i < count; i++) {
          if (i === 0) {
            parentIndices.push(null)
            depths.push(0)
          } else {
            // Pick a parent from existing nodes respecting depth < 3
            const candidates = parentIndices
              .map((_, idx) => idx)
              .filter((idx) => depths[idx] < 3)

            if (candidates.length === 0) {
              parentIndices.push(null)
              depths.push(0)
            } else {
              const parentIdx =
                candidates[Math.abs(hints[i]) % candidates.length]
              parentIndices.push(parentIdx)
              depths.push(depths[parentIdx] + 1)
            }
          }
        }
        return parentIndices
      })
    )

  /**
   * Generate file count per group (0-3 files each).
   */
  const arbFileCountsForTree = (groupCount: number) =>
    fc.array(fc.integer({ min: 0, max: 3 }), {
      minLength: groupCount,
      maxLength: groupCount,
    })

  it('deleting a group promotes its children and files to its parent', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTreeShape.chain((shape) =>
          fc.record({
            shape: fc.constant(shape),
            fileCounts: arbFileCountsForTree(shape.length),
            // Pick which group to delete (any index in the tree)
            deleteIdx: fc.integer({ min: 0, max: shape.length - 1 }),
          })
        ),
        async ({ shape, fileCounts, deleteIdx }) => {
          // Clean DB for this run
          await db.groups.clear()
          await db.files.clear()

          // Create groups in order, tracking real IDs
          const groupIds: number[] = []
          for (let i = 0; i < shape.length; i++) {
            const parentId =
              shape[i] === null ? null : groupIds[shape[i] as number]
            const id = await createChildGroup(`G${i}`, parentId)
            groupIds.push(id)
          }

          // Create files assigned to groups
          for (let i = 0; i < shape.length; i++) {
            for (let f = 0; f < fileCounts[i]; f++) {
              await db.files.add({
                name: `file-${i}-${f}.md`,
                currentVersionId: 0,
                updatedAt: Date.now(),
                groupId: groupIds[i],
                groupPlacement: 'manual',
              })
            }
          }

          // Identify the group to delete and its state
          const targetGroupId = groupIds[deleteIdx]
          const targetGroup = await db.groups.get(targetGroupId)
          const parentId = targetGroup!.parentId // P (may be null)

          // Record direct children and files before deletion
          const directChildrenBefore = await db.groups
            .filter((g) => g.parentId === targetGroupId)
            .toArray()
          const filesBefore = await db.files
            .filter((f) => f.groupId === targetGroupId)
            .toArray()

          // Perform deletion
          await deleteGroupWithPromotion(targetGroupId)

          // Assert: group is deleted
          const deletedGroup = await db.groups.get(targetGroupId)
          expect(deletedGroup).toBeUndefined()

          // Assert: all former direct children now have parentId = P
          for (const child of directChildrenBefore) {
            const updated = await db.groups.get(child.id!)
            expect(updated).toBeDefined()
            expect(updated!.parentId).toBe(parentId)
          }

          // Assert: all former files now have groupId = P (or null if P was null)
          for (const file of filesBefore) {
            const updated = await db.files.get(file.id!)
            expect(updated).toBeDefined()
            expect(updated!.groupId).toBe(parentId ?? null)
          }
        }
      ),
      { numRuns: 50 }
    )
  })
})
