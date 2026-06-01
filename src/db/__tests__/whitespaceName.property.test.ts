import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import { db, createChildGroup } from '../schema'

/**
 * Property 6: Whitespace group name rejection
 *
 * For any string composed entirely of whitespace characters (including empty
 * string), attempting to create a group with that name SHALL be rejected and
 * the group list SHALL remain unchanged.
 *
 * Validates: Requirements 7.4
 */
describe('Feature: nested-groups, Property 6: Whitespace group name rejection', () => {
  beforeEach(async () => {
    await db.groups.clear()
    await db.files.clear()
  })

  /**
   * Arbitrary that produces strings composed entirely of whitespace characters:
   * empty string, spaces, tabs, newlines, carriage returns, and mixed.
   */
  const arbWhitespaceString = fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), {
      minLength: 0,
      maxLength: 20,
    })
    .map((chars) => chars.join(''))

  it('rejects whitespace-only names and leaves group list unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(arbWhitespaceString, async (name) => {
        // Snapshot group count before
        const countBefore = await db.groups.count()

        // Attempt to create a child group with whitespace-only name
        await expect(createChildGroup(name, null)).rejects.toThrow()

        // Group list must remain unchanged
        const countAfter = await db.groups.count()
        expect(countAfter).toBe(countBefore)
      }),
      { numRuns: 100 }
    )
  })
})
