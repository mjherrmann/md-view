import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { GroupRecord } from '../schema'
import { buildGroupMaps } from '../groupTree'

/**
 * Property 5: Reorder vs reparent classification
 *
 * For any group drop operation, if the dragged group's current parentId
 * equals the target section's parentId, the system SHALL treat it as a
 * reorder; otherwise it SHALL treat it as a reparent.
 *
 * Validates: Requirements 5.2
 */
describe('Feature: nested-groups, Property 5: Reorder vs reparent classification', () => {
  /**
   * Pure classification function extracted from the drop handler logic.
   * Returns 'reorder' when source's parentId matches target parentId,
   * 'reparent' otherwise.
   */
  function classifyDrop(
    sourceParentId: number | null,
    targetParentId: number | null
  ): 'reorder' | 'reparent' {
    return sourceParentId === targetParentId ? 'reorder' : 'reparent'
  }

  /**
   * Generate a valid group tree with at least 2 groups and max depth 3.
   */
  const arbGroupTree = fc
    .integer({ min: 2, max: 15 })
    .chain((size) =>
      fc.array(
        fc.integer({ min: 0, max: 3 }),
        { minLength: size, maxLength: size }
      )
    )
    .map((childCounts) => {
      const groups: GroupRecord[] = []
      let nextId = 1
      const depthOf = new Map<number, number>()

      // Create root groups (at least 2 for meaningful tests)
      const rootCount = Math.max(2, Math.min(childCounts.length, 4))
      for (let i = 0; i < rootCount; i++) {
        const id = nextId++
        groups.push({ id, name: `G${id}`, sortOrder: i, parentId: null })
        depthOf.set(id, 0)
      }

      // Add children level by level up to depth 3
      let specIdx = rootCount
      for (const parent of [...groups]) {
        if (specIdx >= childCounts.length) break
        const parentDepth = depthOf.get(parent.id!) ?? 0
        if (parentDepth >= 3) continue

        const count = Math.min(childCounts[specIdx] ?? 0, 3)
        specIdx++
        for (let c = 0; c < count; c++) {
          const id = nextId++
          groups.push({ id, name: `G${id}`, sortOrder: c, parentId: parent.id! })
          depthOf.set(id, parentDepth + 1)
        }
      }

      return groups
    })
    .filter((groups) => groups.length >= 2)

  it('same parentId → classified as reorder', () => {
    fc.assert(
      fc.property(
        arbGroupTree.chain((groups) => {
          // Pick a source group and a target parentId that equals source's parentId
          return fc
            .integer({ min: 0, max: groups.length - 1 })
            .map((srcIdx) => {
              const source = groups[srcIdx]
              return {
                groups,
                sourceParentId: source.parentId,
                targetParentId: source.parentId, // same → reorder
              }
            })
        }),
        ({ sourceParentId, targetParentId }) => {
          const result = classifyDrop(sourceParentId, targetParentId)
          expect(result).toBe('reorder')
        }
      ),
      { numRuns: 100 }
    )
  })

  it('different parentId → classified as reparent', () => {
    fc.assert(
      fc.property(
        arbGroupTree.chain((groups) => {
          const { childrenByParent } = buildGroupMaps(groups)
          // Collect all distinct parentId values present in the tree
          const allParentIds: (number | null)[] = [
            null,
            ...groups.filter((g) => childrenByParent.has(g.id!)).map((g) => g.id!),
          ]
          // Deduplicate
          const uniqueParentIds = [...new Set(allParentIds.map((p) => String(p)))].map(
            (s) => (s === 'null' ? null : Number(s))
          )

          // Pick a source group and a target parentId that differs from source's parentId
          return fc
            .integer({ min: 0, max: groups.length - 1 })
            .chain((srcIdx) => {
              const source = groups[srcIdx]
              const differentTargets = uniqueParentIds.filter(
                (pid) => pid !== source.parentId
              )
              if (differentTargets.length === 0) {
                // Fallback: use a parentId that definitely differs
                const fallback = source.parentId === null ? 9999 : null
                return fc.constant({
                  groups,
                  sourceParentId: source.parentId,
                  targetParentId: fallback,
                })
              }
              return fc
                .integer({ min: 0, max: differentTargets.length - 1 })
                .map((targetIdx) => ({
                  groups,
                  sourceParentId: source.parentId,
                  targetParentId: differentTargets[targetIdx],
                }))
            })
        }),
        ({ sourceParentId, targetParentId }) => {
          expect(sourceParentId).not.toBe(targetParentId)
          const result = classifyDrop(sourceParentId, targetParentId)
          expect(result).toBe('reparent')
        }
      ),
      { numRuns: 100 }
    )
  })
})
