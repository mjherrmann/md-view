import { describe, it, expect, afterEach } from 'vitest'
import fc from 'fast-check'
import Dexie from 'dexie'

/**
 * Property 8: Migration preserves existing data
 *
 * For any set of existing group records (id, name, sortOrder — no parentId),
 * after the v5 migration runs, each group SHALL have parentId === null and its
 * id, name, and sortOrder values SHALL be identical to their pre-migration values.
 *
 * Validates: Requirements 9.2, 9.3
 */
describe('Feature: nested-groups, Property 8: Migration preserves existing data', () => {
  const DB_NAME = 'md-viewer-migration-test'

  afterEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  /** Arbitrary group record without parentId (pre-v5 shape). */
  const arbGroupRecord = fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    sortOrder: fc.integer({ min: 0, max: 1000 }),
  })

  it('all existing groups gain parentId === null with unchanged id, name, sortOrder', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbGroupRecord, { minLength: 1, maxLength: 20 }),
        async (groups) => {
          // Clean slate
          await Dexie.delete(DB_NAME)

          // 1. Open at v4 schema (no parentId index) and populate
          const dbV4 = new Dexie(DB_NAME)
          dbV4.version(1).stores({
            files: '++id, name, updatedAt, currentVersionId',
            versions: '++id, fileId, createdAt',
          })
          dbV4.version(2).stores({
            files: '++id, name, updatedAt, currentVersionId, groupId',
            versions: '++id, fileId, createdAt',
            groups: '++id, name, sortOrder',
          })
          dbV4.version(3).stores({
            files: '++id, entryPath, name, updatedAt, currentVersionId, groupId, groupPlacement',
            versions: '++id, fileId, createdAt',
            groups: '++id, name, sortOrder',
          })
          dbV4.version(4).stores({
            files: '++id, name, updatedAt, currentVersionId, groupId, groupPlacement',
            versions: '++id, fileId, createdAt',
            groups: '++id, name, sortOrder',
          })

          await dbV4.open()
          const table = dbV4.table('groups')
          const insertedIds: number[] = []
          for (const g of groups) {
            const id = await table.add({ name: g.name, sortOrder: g.sortOrder })
            insertedIds.push(id as number)
          }
          dbV4.close()

          // 2. Open at v5 schema (with parentId + upgrade logic)
          const dbV5 = new Dexie(DB_NAME)
          dbV5.version(1).stores({
            files: '++id, name, updatedAt, currentVersionId',
            versions: '++id, fileId, createdAt',
          })
          dbV5.version(2).stores({
            files: '++id, name, updatedAt, currentVersionId, groupId',
            versions: '++id, fileId, createdAt',
            groups: '++id, name, sortOrder',
          })
          dbV5.version(3).stores({
            files: '++id, entryPath, name, updatedAt, currentVersionId, groupId, groupPlacement',
            versions: '++id, fileId, createdAt',
            groups: '++id, name, sortOrder',
          })
          dbV5.version(4).stores({
            files: '++id, name, updatedAt, currentVersionId, groupId, groupPlacement',
            versions: '++id, fileId, createdAt',
            groups: '++id, name, sortOrder',
          })
          dbV5.version(5)
            .stores({
              files: '++id, name, updatedAt, currentVersionId, groupId, groupPlacement',
              versions: '++id, fileId, createdAt',
              groups: '++id, name, sortOrder, parentId',
            })
            .upgrade(async (tx) => {
              const t = tx.table('groups')
              await t.toCollection().modify((row: Record<string, unknown>) => {
                if (row.parentId === undefined) {
                  row.parentId = null
                }
              })
            })

          await dbV5.open()
          const migrated = await dbV5.table('groups').toArray()
          dbV5.close()

          // 3. Assert: same count, each row has parentId === null, fields unchanged
          expect(migrated.length).toBe(groups.length)

          for (let i = 0; i < groups.length; i++) {
            const original = groups[i]
            const row = migrated.find((r) => r.id === insertedIds[i])
            expect(row).toBeDefined()
            expect(row!.parentId).toBe(null)
            expect(row!.name).toBe(original.name)
            expect(row!.sortOrder).toBe(original.sortOrder)
          }
        }
      ),
      { numRuns: 100 }
    )
  })
})
