import type { GroupRecord } from './schema'

/**
 * Compute depth of a group by traversing its parentId chain.
 * Root groups (parentId === null) have depth 0.
 * Orphan parentId (references non-existent group) treated as root (stops traversal).
 * Cycle-safe via visited set.
 */
export function computeDepth(
  groupId: number,
  groupsById: Map<number, GroupRecord>
): number {
  const group = groupsById.get(groupId)
  if (!group) return 0

  let depth = 0
  let currentId = group.parentId
  const visited = new Set<number>([groupId])

  while (currentId != null) {
    if (visited.has(currentId)) break // cycle guard
    const parent = groupsById.get(currentId)
    if (!parent) break // orphan guard — treat as root
    depth++
    visited.add(currentId)
    currentId = parent.parentId
  }

  return depth
}

/**
 * Get all ancestor IDs from a group up to root (exclusive of groupId itself).
 * Ordered from immediate parent to root.
 * Orphan parentId (references non-existent group) stops traversal.
 * Cycle-safe via visited set.
 */
export function getAncestorIds(
  groupId: number,
  groupsById: Map<number, GroupRecord>
): number[] {
  const group = groupsById.get(groupId)
  if (!group) return []

  const ancestors: number[] = []
  let currentId = group.parentId
  const visited = new Set<number>([groupId])

  while (currentId != null) {
    if (visited.has(currentId)) break // cycle guard
    const parent = groupsById.get(currentId)
    if (!parent) break // orphan guard
    ancestors.push(currentId)
    visited.add(currentId)
    currentId = parent.parentId
  }

  return ancestors
}

/**
 * Get all descendant IDs (transitive children) via BFS.
 * Does not include groupId itself. Returns empty array if groupId has no children.
 */
export function getDescendantIds(
  groupId: number,
  childrenByParent: Map<number | null, GroupRecord[]>
): number[] {
  const result: number[] = []
  const queue: number[] = [groupId]

  while (queue.length > 0) {
    const current = queue.shift()!
    const children = childrenByParent.get(current)
    if (!children) continue
    for (const child of children) {
      if (child.id == null) continue
      result.push(child.id)
      queue.push(child.id)
    }
  }

  return result
}

/**
 * Validate a reparent operation.
 * Returns null if valid, descriptive error string if invalid.
 */
export function validateReparent(
  groupId: number,
  targetParentId: number | null,
  groupsById: Map<number, GroupRecord>,
  childrenByParent: Map<number | null, GroupRecord[]>
): string | null {
  // Moving to root always passes cycle check but still needs depth check
  if (targetParentId !== null) {
    // Self-reference check
    if (targetParentId === groupId) {
      return `Cannot reparent group ${groupId} to itself`
    }

    // Cycle check: walk from target up to root; if we hit groupId, target is a descendant
    let walk: number | null = targetParentId
    const visited = new Set<number>()
    while (walk !== null) {
      if (walk === groupId) {
        return `Cannot reparent group ${groupId} into its own descendant (group ${targetParentId})`
      }
      if (visited.has(walk)) break // safety: cycle in existing data
      visited.add(walk)
      const parent = groupsById.get(walk)
      if (!parent) break // orphan — treat as root
      walk = parent.parentId
    }
  }

  // Depth overflow check:
  // targetDepth = depth of the target parent (0 if moving to root, since root children sit at depth 1)
  // The moved group will sit at targetDepth + 1 (or depth 0 if moving to root)
  // Its deepest descendant will sit at targetDepth + 1 + subtreeMaxDepth
  // Must not exceed max depth of 3
  const targetDepth =
    targetParentId === null ? -1 : computeDepth(targetParentId, groupsById)
  const subtreeMaxDepth = maxDescendantDepth(groupId, childrenByParent)

  if (targetDepth + 1 + subtreeMaxDepth > 3) {
    return `Reparenting group ${groupId} would exceed maximum nesting depth (resulting depth: ${targetDepth + 1 + subtreeMaxDepth}, max: 3)`
  }

  return null
}

/**
 * Compute the maximum depth of any descendant relative to the given group.
 * Returns 0 if the group has no children, 1 if it has children but no grandchildren, etc.
 */
function maxDescendantDepth(
  groupId: number,
  childrenByParent: Map<number | null, GroupRecord[]>
): number {
  const children = childrenByParent.get(groupId)
  if (!children || children.length === 0) return 0

  let max = 0
  for (const child of children) {
    if (child.id == null) continue
    const childDepth = 1 + maxDescendantDepth(child.id, childrenByParent)
    if (childDepth > max) max = childDepth
  }
  return max
}

/** Build lookup maps from a flat group array. */
export function buildGroupMaps(groups: GroupRecord[]): {
  byId: Map<number, GroupRecord>
  childrenByParent: Map<number | null, GroupRecord[]>
} {
  const byId = new Map<number, GroupRecord>()
  const childrenByParent = new Map<number | null, GroupRecord[]>()

  for (const group of groups) {
    if (group.id == null) continue
    byId.set(group.id, group)

    const parentKey = group.parentId
    const siblings = childrenByParent.get(parentKey)
    if (siblings) {
      siblings.push(group)
    } else {
      childrenByParent.set(parentKey, [group])
    }
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  return { byId, childrenByParent }
}
