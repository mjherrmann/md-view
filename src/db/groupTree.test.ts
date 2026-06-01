import { describe, it, expect } from 'vitest'
import type { GroupRecord } from './schema'
import { buildGroupMaps, computeDepth, getAncestorIds, getDescendantIds, validateReparent } from './groupTree'

describe('buildGroupMaps', () => {
  it('returns empty maps for empty input', () => {
    const { byId, childrenByParent } = buildGroupMaps([])
    expect(byId.size).toBe(0)
    expect(childrenByParent.size).toBe(0)
  })

  it('builds byId map from groups with ids', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'A', sortOrder: 0, parentId: null },
      { id: 2, name: 'B', sortOrder: 1, parentId: null },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(byId.get(1)).toBe(groups[0])
    expect(byId.get(2)).toBe(groups[1])
  })

  it('skips groups without id', () => {
    const groups: GroupRecord[] = [
      { name: 'NoId', sortOrder: 0, parentId: null },
      { id: 1, name: 'HasId', sortOrder: 1, parentId: null },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    expect(byId.size).toBe(1)
    expect(byId.has(1)).toBe(true)
    // Only the group with id appears in children
    expect(childrenByParent.get(null)?.length).toBe(1)
  })

  it('groups children by parentId', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'Child2', sortOrder: 1, parentId: 1 },
      { id: 4, name: 'Root2', sortOrder: 1, parentId: null },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    expect(childrenByParent.get(null)?.map((g) => g.id)).toEqual([1, 4])
    expect(childrenByParent.get(1)?.map((g) => g.id)).toEqual([2, 3])
  })

  it('sorts children by sortOrder ascending', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'C', sortOrder: 2, parentId: 1 },
      { id: 3, name: 'A', sortOrder: 0, parentId: 1 },
      { id: 4, name: 'B', sortOrder: 1, parentId: 1 },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    const children = childrenByParent.get(1)!
    expect(children.map((g) => g.id)).toEqual([3, 4, 2])
  })
})


describe('computeDepth', () => {
  it('returns 0 for root groups (parentId null)', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(computeDepth(1, byId)).toBe(0)
  })

  it('returns 1 for direct child of root', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child', sortOrder: 0, parentId: 1 },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(computeDepth(2, byId)).toBe(1)
  })

  it('returns correct depth for deeply nested group', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'L1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'L2', sortOrder: 0, parentId: 2 },
      { id: 4, name: 'L3', sortOrder: 0, parentId: 3 },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(computeDepth(3, byId)).toBe(2)
    expect(computeDepth(4, byId)).toBe(3)
  })

  it('returns 0 for non-existent groupId', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(computeDepth(999, byId)).toBe(0)
  })

  it('treats orphan parentId as root (depth 0)', () => {
    const groups: GroupRecord[] = [
      { id: 2, name: 'Orphan', sortOrder: 0, parentId: 99 },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(computeDepth(2, byId)).toBe(0)
  })

  it('handles cycle without infinite loop', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'A', sortOrder: 0, parentId: 2 },
      { id: 2, name: 'B', sortOrder: 0, parentId: 1 },
    ]
    const { byId } = buildGroupMaps(groups)
    // Should terminate; exact depth depends on traversal start
    const depth = computeDepth(1, byId)
    expect(depth).toBeGreaterThanOrEqual(0)
    expect(depth).toBeLessThanOrEqual(2)
  })
})

describe('getAncestorIds', () => {
  it('returns empty array for root groups', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(getAncestorIds(1, byId)).toEqual([])
  })

  it('returns [parent] for direct child of root', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child', sortOrder: 0, parentId: 1 },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(getAncestorIds(2, byId)).toEqual([1])
  })

  it('returns ancestors ordered from immediate parent to root', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'L1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'L2', sortOrder: 0, parentId: 2 },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(getAncestorIds(3, byId)).toEqual([2, 1])
  })

  it('returns empty array for non-existent groupId', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
    ]
    const { byId } = buildGroupMaps(groups)
    expect(getAncestorIds(999, byId)).toEqual([])
  })

  it('stops at orphan parentId', () => {
    const groups: GroupRecord[] = [
      { id: 2, name: 'Child', sortOrder: 0, parentId: 99 },
    ]
    const { byId } = buildGroupMaps(groups)
    // parentId 99 doesn't exist → treated as root, no ancestors collected
    expect(getAncestorIds(2, byId)).toEqual([])
  })

  it('handles cycle without infinite loop', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'A', sortOrder: 0, parentId: 2 },
      { id: 2, name: 'B', sortOrder: 0, parentId: 1 },
    ]
    const { byId } = buildGroupMaps(groups)
    const ancestors = getAncestorIds(1, byId)
    // Should terminate; contains at most the other node
    expect(ancestors.length).toBeLessThanOrEqual(1)
  })
})

describe('getDescendantIds', () => {
  it('returns empty array when group has no children', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    expect(getDescendantIds(1, childrenByParent)).toEqual([])
  })

  it('returns direct children', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'Child2', sortOrder: 1, parentId: 1 },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    expect(getDescendantIds(1, childrenByParent)).toEqual([2, 3])
  })

  it('returns transitive descendants across multiple levels', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'Grandchild', sortOrder: 0, parentId: 2 },
      { id: 4, name: 'GreatGrandchild', sortOrder: 0, parentId: 3 },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    expect(getDescendantIds(1, childrenByParent)).toEqual([2, 3, 4])
  })

  it('does not include the groupId itself', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child', sortOrder: 0, parentId: 1 },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    const result = getDescendantIds(1, childrenByParent)
    expect(result).not.toContain(1)
  })

  it('returns empty array when groupId is not in the map', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    expect(getDescendantIds(999, childrenByParent)).toEqual([])
  })

  it('collects descendants from branching tree', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'A', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'B', sortOrder: 1, parentId: 1 },
      { id: 4, name: 'A1', sortOrder: 0, parentId: 2 },
      { id: 5, name: 'B1', sortOrder: 0, parentId: 3 },
    ]
    const { childrenByParent } = buildGroupMaps(groups)
    const result = getDescendantIds(1, childrenByParent)
    expect(result).toContain(2)
    expect(result).toContain(3)
    expect(result).toContain(4)
    expect(result).toContain(5)
    expect(result).toHaveLength(4)
  })
})


describe('validateReparent', () => {
  it('returns null when moving to root (targetParentId === null) with no subtree', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'A', sortOrder: 0, parentId: null },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    expect(validateReparent(1, null, byId, childrenByParent)).toBeNull()
  })

  it('returns null when moving to root with subtree that fits (subtreeMaxDepth ≤ 2)', () => {
    // Group 1 has child 2, grandchild 3 → subtreeMaxDepth = 2
    // Moving to root: targetDepth = -1, so -1 + 1 + 2 = 2 ≤ 3 → valid
    const groups: GroupRecord[] = [
      { id: 1, name: 'A', sortOrder: 0, parentId: null },
      { id: 2, name: 'B', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'C', sortOrder: 0, parentId: 2 },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    expect(validateReparent(1, null, byId, childrenByParent)).toBeNull()
  })

  it('returns error when moving to root with subtree too deep (subtreeMaxDepth > 3)', () => {
    // Group 1 has child 2, grandchild 3, great-grandchild 4 → subtreeMaxDepth = 3
    // Moving to root: -1 + 1 + 3 = 3 ≤ 3 → valid actually
    // Need subtreeMaxDepth = 4 to fail: add one more level
    const groups: GroupRecord[] = [
      { id: 1, name: 'A', sortOrder: 0, parentId: null },
      { id: 2, name: 'B', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'C', sortOrder: 0, parentId: 2 },
      { id: 4, name: 'D', sortOrder: 0, parentId: 3 },
      { id: 5, name: 'E', sortOrder: 0, parentId: 4 },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // subtreeMaxDepth of group 1 = 4, targetDepth = -1 → -1+1+4 = 4 > 3
    const result = validateReparent(1, null, byId, childrenByParent)
    expect(result).not.toBeNull()
    expect(result).toContain('exceed maximum nesting depth')
  })

  it('returns error for self-reference (targetParentId === groupId)', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'A', sortOrder: 0, parentId: null },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    const result = validateReparent(1, 1, byId, childrenByParent)
    expect(result).not.toBeNull()
    expect(result).toContain('itself')
  })

  it('returns error when target is a descendant of group (cycle)', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'Grandchild', sortOrder: 0, parentId: 2 },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // Try to move group 1 into group 3 (its grandchild)
    const result = validateReparent(1, 3, byId, childrenByParent)
    expect(result).not.toBeNull()
    expect(result).toContain('descendant')
  })

  it('returns error when target is a direct child of group (cycle)', () => {
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'Child', sortOrder: 0, parentId: 1 },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // Try to move group 1 into group 2 (its child)
    const result = validateReparent(1, 2, byId, childrenByParent)
    expect(result).not.toBeNull()
    expect(result).toContain('descendant')
  })

  it('returns error for depth overflow (targetDepth + 1 + subtreeMaxDepth > 3)', () => {
    // Target at depth 2, group has subtreeMaxDepth 1 → 2+1+1 = 4 > 3
    const groups: GroupRecord[] = [
      { id: 10, name: 'Root', sortOrder: 0, parentId: null },
      { id: 11, name: 'L1', sortOrder: 0, parentId: 10 },
      { id: 12, name: 'L2', sortOrder: 0, parentId: 11 },
      // Group to move: has one child
      { id: 20, name: 'Mover', sortOrder: 1, parentId: null },
      { id: 21, name: 'MoverChild', sortOrder: 0, parentId: 20 },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // Move group 20 (subtreeMaxDepth=1) into group 12 (depth=2)
    // 2 + 1 + 1 = 4 > 3 → invalid
    const result = validateReparent(20, 12, byId, childrenByParent)
    expect(result).not.toBeNull()
    expect(result).toContain('exceed maximum nesting depth')
  })

  it('returns null for valid reparent within depth limits', () => {
    // Target at depth 1, group has subtreeMaxDepth 0 → 1+1+0 = 2 ≤ 3
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'L1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'Mover', sortOrder: 1, parentId: null },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // Move group 3 (no children) into group 2 (depth 1) → 1+1+0 = 2 ≤ 3
    expect(validateReparent(3, 2, byId, childrenByParent)).toBeNull()
  })

  it('returns null at exact max depth boundary (targetDepth + 1 + subtreeMaxDepth === 3)', () => {
    // Target at depth 1, group has subtreeMaxDepth 1 → 1+1+1 = 3 ≤ 3 → valid
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'L1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'Mover', sortOrder: 1, parentId: null },
      { id: 4, name: 'MoverChild', sortOrder: 0, parentId: 3 },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // Move group 3 (subtreeMaxDepth=1) into group 2 (depth=1) → 1+1+1 = 3 ≤ 3
    expect(validateReparent(3, 2, byId, childrenByParent)).toBeNull()
  })

  it('returns error one past max depth boundary (targetDepth + 1 + subtreeMaxDepth === 4)', () => {
    // Target at depth 1, group has subtreeMaxDepth 2 → 1+1+2 = 4 > 3
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'L1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'Mover', sortOrder: 1, parentId: null },
      { id: 4, name: 'MoverChild', sortOrder: 0, parentId: 3 },
      { id: 5, name: 'MoverGrandchild', sortOrder: 0, parentId: 4 },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // Move group 3 (subtreeMaxDepth=2) into group 2 (depth=1) → 1+1+2 = 4 > 3
    const result = validateReparent(3, 2, byId, childrenByParent)
    expect(result).not.toBeNull()
    expect(result).toContain('exceed maximum nesting depth')
  })

  it('allows moving leaf group to depth-3 target (max allowed position)', () => {
    // Target at depth 2, group has subtreeMaxDepth 0 → 2+1+0 = 3 ≤ 3 → valid
    const groups: GroupRecord[] = [
      { id: 1, name: 'Root', sortOrder: 0, parentId: null },
      { id: 2, name: 'L1', sortOrder: 0, parentId: 1 },
      { id: 3, name: 'L2', sortOrder: 0, parentId: 2 },
      { id: 4, name: 'Mover', sortOrder: 1, parentId: null },
    ]
    const { byId, childrenByParent } = buildGroupMaps(groups)
    // Move group 4 (leaf) into group 3 (depth=2) → 2+1+0 = 3 ≤ 3
    expect(validateReparent(4, 3, byId, childrenByParent)).toBeNull()
  })
})
