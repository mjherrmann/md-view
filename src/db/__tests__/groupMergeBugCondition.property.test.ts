// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import { db, reparentGroup, mergeGroupInto } from '../schema'
import type { GroupRecord, FileRecord, VersionRecord } from '../schema'
import { buildGroupMaps } from '../groupTree'

/**
 * Property 1: Bug Condition — Same-Name Group Drop Causes Reparent Instead of Merge
 *
 * For any group drop where a sibling with the same name (case-sensitive, post-trim)
 * exists at the target parentId, the system SHALL recursively merge the source group's
 * contents into the existing same-name group:
 * - Files merged by name (version merge) or moved
 * - Child groups recursively merged (same-name collision) or reparented (no collision)
 * - Source group deleted after merge
 * - No file or version records lost
 *
 * This test is EXPECTED TO FAIL on unfixed code — failure confirms the bug exists.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */
describe('Bug Condition: Same-Name Group Drop Causes Reparent Instead of Merge', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
    await db.versions.clear()
  })

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function createGroup(
    name: string,
    parentId: number | null,
    sortOrder: number
  ): Promise<number> {
    return (await db.groups.add({ name, parentId, sortOrder })) as number
  }

  async function createFileWithVersion(
    name: string,
    groupId: number,
    content: string
  ): Promise<{ fileId: number; versionId: number }> {
    const fileId = (await db.files.add({
      name,
      currentVersionId: 0,
      updatedAt: Date.now(),
      groupId,
      groupPlacement: 'manual',
    })) as number
    const versionId = (await db.versions.add({
      fileId,
      content,
      createdAt: Date.now(),
      source: 'drop',
    })) as number
    await db.files.update(fileId, { currentVersionId: versionId })
    return { fileId, versionId }
  }

  /**
   * Simulates what handleGroupDrop now does for a same-name collision drop:
   * detect same-name sibling at target, merge into it; otherwise reparent.
   */
  async function simulateHandleGroupDrop(
    sourceGroupId: number,
    targetParentId: number | null
  ): Promise<void> {
    const allGroups = await db.groups.toArray()
    const { childrenByParent } = buildGroupMaps(allGroups)
    const sourceGroup = await db.groups.get(sourceGroupId)
    const siblings = childrenByParent.get(targetParentId) ?? []
    const sameNameSibling = siblings.find(
      (s) => s.name === sourceGroup!.name && s.id !== sourceGroupId
    )
    if (sameNameSibling) {
      await mergeGroupInto(sourceGroupId, sameNameSibling.id!)
    } else {
      await reparentGroup(sourceGroupId, targetParentId)
    }
  }

  // ─── Generators ─────────────────────────────────────────────────────────────

  /** Generate a non-empty trimmed group name */
  const arbGroupName = fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim())

  /** Generate file content */
  const arbContent = fc.string({ minLength: 1, maxLength: 100 })

  /**
   * Generate a scenario with same-name collision at the target level.
   * Structure:
   * - parentId (null = root)
   * - Two groups with same name under parentId (source + target)
   * - Each group has 0-3 files
   * - Each group has 0-2 child groups (some with colliding names)
   */
  interface MergeScenario {
    parentId: number | null
    groupName: string
    sourceFiles: Array<{ name: string; content: string }>
    targetFiles: Array<{ name: string; content: string }>
    sourceChildren: Array<{ name: string }>
    targetChildren: Array<{ name: string }>
  }

  const arbMergeScenario: fc.Arbitrary<MergeScenario> = fc.record({
    parentId: fc.constant(null), // root-level for simplicity
    groupName: arbGroupName,
    sourceFiles: fc.array(
      fc.record({ name: arbGroupName, content: arbContent }),
      { minLength: 1, maxLength: 3 }
    ),
    targetFiles: fc.array(
      fc.record({ name: arbGroupName, content: arbContent }),
      { minLength: 0, maxLength: 3 }
    ),
    sourceChildren: fc.array(fc.record({ name: arbGroupName }), {
      minLength: 0,
      maxLength: 2,
    }),
    targetChildren: fc.array(fc.record({ name: arbGroupName }), {
      minLength: 0,
      maxLength: 2,
    }),
  })

  // ─── Property Test ──────────────────────────────────────────────────────────

  it('source group files are merged into same-name target (not reparented)', async () => {
    await fc.assert(
      fc.asyncProperty(arbMergeScenario, async (scenario) => {
        // Clean slate
        await db.groups.clear()
        await db.files.clear()
        await db.versions.clear()

        const { groupName, sourceFiles, targetFiles } = scenario

        // Create a parent group to hold both same-name groups (avoids root conflicts)
        const parentId = await createGroup('Parent', null, 0)

        // Create target group (the one that should survive the merge)
        const targetGroupId = await createGroup(groupName, parentId, 0)

        // Create source group (the one being dragged — same name, same parent)
        const sourceGroupId = await createGroup(groupName, parentId, 1)

        // Add files to target group
        for (const f of targetFiles) {
          await createFileWithVersion(f.name, targetGroupId, f.content)
        }

        // Add files to source group
        const sourceFileIds: number[] = []
        const sourceVersionIds: number[] = []
        for (const f of sourceFiles) {
          const { fileId, versionId } = await createFileWithVersion(
            f.name,
            sourceGroupId,
            f.content
          )
          sourceFileIds.push(fileId)
          sourceVersionIds.push(versionId)
        }

        // Add child groups to target
        for (let i = 0; i < scenario.targetChildren.length; i++) {
          await createGroup(scenario.targetChildren[i]!.name, targetGroupId, i)
        }

        // Add child groups to source
        const sourceChildIds: number[] = []
        for (let i = 0; i < scenario.sourceChildren.length; i++) {
          const childId = await createGroup(
            scenario.sourceChildren[i]!.name,
            sourceGroupId,
            i
          )
          sourceChildIds.push(childId)
        }

        // Count total versions before operation (none should be lost)
        const totalVersionsBefore = await db.versions.count()

        // --- Perform the drop (buggy: reparents instead of merging) ---
        // The source group is being moved to the same parentId where target lives.
        // Since they share a name, the CORRECT behavior is merge.
        // The BUGGY behavior is reparent (source becomes child of parentId alongside target).
        await simulateHandleGroupDrop(sourceGroupId, parentId)

        // --- Assertions: Expected MERGE behavior ---

        // 1. Source group should be DELETED after merge
        const sourceGroupAfter = await db.groups.get(sourceGroupId)
        expect(sourceGroupAfter).toBeUndefined()

        // 2. All source files should now be in the target group
        for (const fileId of sourceFileIds) {
          const file = await db.files.get(fileId)
          if (file) {
            // If file still exists (wasn't merged by name), its groupId should be targetGroupId
            expect(file.groupId).toBe(targetGroupId)
          }
          // If file was merged (same name existed in target), it's deleted but versions moved
        }

        // 3. No versions should be lost
        const totalVersionsAfter = await db.versions.count()
        expect(totalVersionsAfter).toBe(totalVersionsBefore)

        // 4. Source child groups should be reparented to target or recursively merged
        for (const childId of sourceChildIds) {
          const child = await db.groups.get(childId)
          if (child) {
            // If child still exists (not merged), it should be under targetGroupId
            expect(child.parentId).toBe(targetGroupId)
          }
        }
      }),
      { numRuns: 50 }
    )
  })

  it('source group is deleted after same-name collision drop', async () => {
    await fc.assert(
      fc.asyncProperty(arbGroupName, arbContent, async (groupName, content) => {
        await db.groups.clear()
        await db.files.clear()
        await db.versions.clear()

        // Two same-name groups at root
        const targetGroupId = await createGroup(groupName, null, 0)
        const sourceGroupId = await createGroup(groupName, null, 1)

        // Add a file to source so it's not empty
        await createFileWithVersion('test.md', sourceGroupId, content)

        // Simulate the drop: source dropped among root siblings where target exists
        await simulateHandleGroupDrop(sourceGroupId, null)

        // After merge, source should be deleted
        const sourceAfter = await db.groups.get(sourceGroupId)
        expect(sourceAfter).toBeUndefined()
      }),
      { numRuns: 50 }
    )
  })

  it('no file or version records are lost during same-name collision merge', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbGroupName,
        fc.array(
          fc.record({ name: arbGroupName, content: arbContent }),
          { minLength: 1, maxLength: 5 }
        ),
        fc.array(
          fc.record({ name: arbGroupName, content: arbContent }),
          { minLength: 1, maxLength: 5 }
        ),
        async (groupName, sourceFiles, targetFiles) => {
          await db.groups.clear()
          await db.files.clear()
          await db.versions.clear()

          // Create same-name groups at root
          const targetGroupId = await createGroup(groupName, null, 0)
          const sourceGroupId = await createGroup(groupName, null, 1)

          // Add files
          for (const f of targetFiles) {
            await createFileWithVersion(f.name, targetGroupId, f.content)
          }
          for (const f of sourceFiles) {
            await createFileWithVersion(f.name, sourceGroupId, f.content)
          }

          const totalVersionsBefore = await db.versions.count()

          // Simulate drop
          await simulateHandleGroupDrop(sourceGroupId, null)

          // No versions should be lost
          const totalVersionsAfter = await db.versions.count()
          expect(totalVersionsAfter).toBe(totalVersionsBefore)
        }
      ),
      { numRuns: 50 }
    )
  })
})
