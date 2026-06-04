import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import { db, findOrCreateDirectoryGroup } from '../schema'

/**
 * Property tests for findOrCreateDirectoryGroup.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */
describe('Feature: directory-drop-import, Property 2: Group name derivation', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
  })

  it('result group name equals trimmed + truncated input, parentId = null', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 500, unit: 'grapheme' }).filter(
          (s) => s.trim().length > 0
        ),
        async (dirName) => {
          await db.groups.clear()

          const id = await findOrCreateDirectoryGroup(dirName)
          expect(id).not.toBeNull()

          const group = await db.groups.get(id!)
          expect(group).toBeDefined()

          const expectedName = dirName.trim().slice(0, 255)
          expect(group!.name).toBe(expectedName)
          expect(group!.parentId).toBeNull()
        }
      ),
      { numRuns: 50 }
    )
  })
})

describe('Feature: directory-drop-import, Property 3: Group reuse idempotence', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
  })

  it('matching name returns same ID, sortOrder unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }).filter(
          (s) => s.trim().length > 0
        ),
        fc.integer({ min: 1, max: 5 }),
        async (dirName, repeatCount) => {
          await db.groups.clear()

          const firstId = await findOrCreateDirectoryGroup(dirName)
          expect(firstId).not.toBeNull()

          const firstGroup = await db.groups.get(firstId!)
          const originalSortOrder = firstGroup!.sortOrder

          for (let i = 0; i < repeatCount; i++) {
            const id = await findOrCreateDirectoryGroup(dirName)
            expect(id).toBe(firstId)

            const group = await db.groups.get(id!)
            expect(group!.sortOrder).toBe(originalSortOrder)
          }

          // Verify only one group exists with this name
          const allGroups = await db.groups
            .filter((g) => g.name === dirName.trim().slice(0, 255) && g.parentId === null)
            .toArray()
          expect(allGroups).toHaveLength(1)
        }
      ),
      { numRuns: 50 }
    )
  })
})

describe('Feature: directory-drop-import, Property 4: Group sort order assignment', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
  })

  it('new group gets max(existing root sortOrders) + 1, or 0 if none', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 50, unit: 'grapheme' }).filter(
            (s) => s.trim().length > 0
          ),
          { minLength: 1, maxLength: 8 }
        ).filter((names) => {
          // Ensure unique trimmed+capped names so each creates a new group
          const trimmed = names.map((n) => n.trim().slice(0, 255))
          return new Set(trimmed).size === trimmed.length
        }),
        async (dirNames) => {
          await db.groups.clear()

          for (let i = 0; i < dirNames.length; i++) {
            const rootGroupsBefore = await db.groups
              .filter((g) => g.parentId === null)
              .toArray()
            const maxOrderBefore =
              rootGroupsBefore.length > 0
                ? Math.max(...rootGroupsBefore.map((g) => g.sortOrder))
                : -1
            const expectedOrder = maxOrderBefore + 1

            const id = await findOrCreateDirectoryGroup(dirNames[i]!)
            expect(id).not.toBeNull()

            const group = await db.groups.get(id!)
            expect(group!.sortOrder).toBe(expectedOrder)
          }
        }
      ),
      { numRuns: 50 }
    )
  })
})

describe('Feature: directory-drop-import, Property 5: Whitespace directory names rejected', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
  })

  it('returns null for whitespace-only or empty strings', async () => {
    const whitespaceChars = [' ', '\t', '\n', '\r']
    const arbWhitespace = fc
      .array(fc.constantFrom(...whitespaceChars), { minLength: 0, maxLength: 20 })
      .map((chars) => chars.join(''))

    await fc.assert(
      fc.asyncProperty(
        arbWhitespace,
        async (whitespace) => {
          await db.groups.clear()

          const id = await findOrCreateDirectoryGroup(whitespace)
          expect(id).toBeNull()

          // No groups created
          const allGroups = await db.groups.toArray()
          expect(allGroups).toHaveLength(0)
        }
      ),
      { numRuns: 50 }
    )
  })
})
