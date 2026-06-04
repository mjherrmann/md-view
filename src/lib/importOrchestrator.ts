import { findOrCreateChildGroup, createFilesInGroup } from '../db/schema'
import { buildGroupMaps, computeDepth, MAX_DEPTH } from '../db/groupTree'
import { db } from '../db/schema'
import type { DirectoryNode } from './directoryTraversal'
import type { CollectedFile } from './directoryImport'

/** Counts returned after import for toast display. */
export interface ImportSummary {
  groupsCreated: number
  groupsReused: number
  filesImported: number
  filesUpdated: number
  capReached: boolean
}

/**
 * Gather all files from a DirectoryNode subtree recursively.
 * Used to flatten files beyond MAX_DEPTH into the deepest allowed group.
 */
export function collectAllFilesDeep(node: DirectoryNode): CollectedFile[] {
  const files: CollectedFile[] = [...node.files]
  for (const child of node.children) {
    files.push(...collectAllFilesDeep(child))
  }
  return files
}

/**
 * Import a DirectoryNode tree into the database as nested groups.
 * - Creates/reuses groups recursively via same-name matching.
 * - Flattens files beyond MAX_DEPTH into the deepest allowed group.
 * - Returns summary counts for toast.
 */
export async function importDirectoryTree(
  tree: DirectoryNode,
  options?: { parentId?: number | null }
): Promise<ImportSummary> {
  const parentId = options?.parentId ?? null

  const summary: ImportSummary = {
    groupsCreated: 0,
    groupsReused: 0,
    filesImported: 0,
    filesUpdated: 0,
    capReached: false,
  }

  async function importNode(
    node: DirectoryNode,
    nodeParentId: number | null,
    currentDepth: number
  ): Promise<void> {
    const result = await findOrCreateChildGroup(node.name, nodeParentId)
    if (result == null) return // whitespace-only name

    if (result.created) {
      summary.groupsCreated++
    } else {
      summary.groupsReused++
    }

    const groupId = result.id

    if (node.files.length > 0) {
      const result = await createFilesInGroup(groupId, node.files)
      summary.filesImported += result.createdCount
      summary.filesUpdated += result.updatedCount
    }

    for (const child of node.children) {
      if (currentDepth + 1 >= MAX_DEPTH) {
        const flatFiles = collectAllFilesDeep(child)
        if (flatFiles.length > 0) {
          const result = await createFilesInGroup(groupId, flatFiles)
          summary.filesImported += result.createdCount
          summary.filesUpdated += result.updatedCount
        }
      } else {
        await importNode(child, groupId, currentDepth + 1)
      }
    }
  }

  const startDepth = await resolveStartDepth(parentId)
  await importNode(tree, parentId, startDepth)
  return summary
}

/**
 * Determine starting depth for the import.
 * If parentId is null, root node sits at depth 0.
 * Otherwise, compute the parent's depth + 1.
 */
async function resolveStartDepth(parentId: number | null): Promise<number> {
  if (parentId === null) return 0

  const allGroups = await db.groups.toArray()
  const { byId } = buildGroupMaps(allGroups)
  return computeDepth(parentId, byId) + 1
}
