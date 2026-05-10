import Dexie, { type Table } from 'dexie'

export type GroupPlacement = 'auto' | 'manual'

export interface FileRecord {
  id?: number
  name: string
  currentVersionId: number
  updatedAt: number
  groupId?: number | null
  groupPlacement: GroupPlacement
}

export type VersionSource = 'drop' | 'restore' | 'library' | 'split'

export interface VersionRecord {
  id?: number
  fileId: number
  content: string
  createdAt: number
  source: VersionSource
}

export interface GroupRecord {
  id?: number
  name: string
  sortOrder: number
}

/** New OS drops land in this group (created on first use). */
export const DEFAULT_DROP_GROUP_NAME = 'Dropped'

export class MdDatabase extends Dexie {
  files!: Table<FileRecord, number>
  versions!: Table<VersionRecord, number>
  groups!: Table<GroupRecord, number>

  constructor() {
    super('md-viewer')
    this.version(1).stores({
      files: '++id, name, updatedAt, currentVersionId',
      versions: '++id, fileId, createdAt',
    })
    this.version(2).stores({
      files: '++id, name, updatedAt, currentVersionId, groupId',
      versions: '++id, fileId, createdAt',
      groups: '++id, name, sortOrder',
    })
    this.version(3)
      .stores({
        files:
          '++id, entryPath, name, updatedAt, currentVersionId, groupId, groupPlacement',
        versions: '++id, fileId, createdAt',
        groups: '++id, name, sortOrder',
      })
      .upgrade(async (tx) => {
        const t = tx.table('files')
        await t.toCollection().modify((row: Record<string, unknown>) => {
          if (row.entryPath == null || row.entryPath === '') {
            row.entryPath = row.name
          }
          if (row.groupPlacement == null) {
            row.groupPlacement = 'manual'
          }
        })
      })
    this.version(4)
      .stores({
        files:
          '++id, name, updatedAt, currentVersionId, groupId, groupPlacement',
        versions: '++id, fileId, createdAt',
        groups: '++id, name, sortOrder',
      })
      .upgrade(async (tx) => {
        const t = tx.table('files')
        await t.toCollection().modify((row: Record<string, unknown>) => {
          delete row.entryPath
        })
      })
  }
}

export const db = new MdDatabase()

async function findOrCreateGroupIdByName(name: string): Promise<number> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Group name is empty.')
  }
  const existing = await db.groups.where('name').equals(trimmed).first()
  if (existing?.id != null) {
    return existing.id
  }
  const all = await db.groups.toArray()
  const maxOrder =
    all.length > 0 ? Math.max(...all.map((g) => g.sortOrder), -1) : -1
  return (await db.groups.add({
    name: trimmed,
    sortOrder: maxOrder + 1,
  })) as number
}

/**
 * Each browser drop creates a **new** file with a single version in {@link DEFAULT_DROP_GROUP_NAME}.
 * Versions are **not** appended on repeated drops (use library merge instead).
 */
export async function createNewFileFromBrowserDrop(
  displayName: string,
  content: string
): Promise<{ file: FileRecord; version: VersionRecord; versionOrdinal: string }> {
  return await db.transaction('rw', [db.files, db.versions, db.groups], async () => {
    const groupId = await findOrCreateGroupIdByName(DEFAULT_DROP_GROUP_NAME)
    const fileId = await db.files.add({
      name: displayName,
      currentVersionId: 0,
      updatedAt: Date.now(),
      groupId,
      groupPlacement: 'auto',
    })
    let file = (await db.files.get(fileId))!

    const versionId = await db.versions.add({
      fileId: file.id!,
      content,
      createdAt: Date.now(),
      source: 'drop',
    })
    const version = (await db.versions.get(versionId))!
    await db.files.update(file.id!, {
      currentVersionId: versionId as number,
      updatedAt: Date.now(),
    })
    file = (await db.files.get(file.id!))!
    return {
      file,
      version,
      versionOrdinal: 'v1',
    }
  })
}

/**
 * Move a library file into a group (or ungrouped). If another file with the **same name**
 * already exists there, merges all versions into that file and removes the dragged file.
 */
export async function moveFileToGroup(
  movingFileId: number,
  targetGroupId: number | null
): Promise<{ merged: boolean; survivingFileId: number }> {
  return await db.transaction('rw', [db.files, db.versions], async () => {
    const moving = await db.files.get(movingFileId)
    if (!moving) {
      throw new Error('File not found.')
    }

    const others = await db.files
      .filter(
        (f) =>
          f.id !== movingFileId &&
          f.name === moving.name &&
          (targetGroupId == null ? f.groupId == null : f.groupId === targetGroupId)
      )
      .toArray()

    const target = others.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0]
    if (!target?.id) {
      await db.files.update(movingFileId, {
        groupId: targetGroupId,
        groupPlacement: 'manual',
        updatedAt: Date.now(),
      })
      return { merged: false, survivingFileId: movingFileId }
    }

    const sourceVersions = await db.versions
      .where('fileId')
      .equals(movingFileId)
      .toArray()
    for (const ver of sourceVersions) {
      await db.versions.update(ver.id!, { fileId: target.id })
    }

    await db.files.delete(movingFileId)

    const allTargetVers = await db.versions.where('fileId').equals(target.id).toArray()
    const newest = allTargetVers.sort((a, b) => a.createdAt - b.createdAt).at(-1)!
    await db.files.update(target.id, {
      currentVersionId: newest.id!,
      updatedAt: Date.now(),
      groupPlacement: 'manual',
    })

    return { merged: true, survivingFileId: target.id }
  })
}

/**
 * Move one version out into its own file row at the target group (or ungrouped).
 */
export async function detachVersionToNewFile(
  sourceFileId: number,
  versionId: number,
  targetGroupId: number | null
): Promise<{ newFileId: number }> {
  return await db.transaction('rw', [db.files, db.versions], async () => {
    const src = await db.files.get(sourceFileId)
    const ver = await db.versions.get(versionId)
    if (!src || !ver || ver.fileId !== sourceFileId) {
      throw new Error('Version not found.')
    }

    const newFileId = (await db.files.add({
      name: src.name,
      currentVersionId: 0,
      updatedAt: Date.now(),
      groupId: targetGroupId,
      groupPlacement: 'manual',
    })) as number

    await db.versions.update(versionId, {
      fileId: newFileId,
      source: 'split',
    })

    await db.files.update(newFileId, {
      currentVersionId: versionId,
    })

    const remaining = await db.versions.where('fileId').equals(sourceFileId).toArray()
    if (remaining.length === 0) {
      await db.files.delete(sourceFileId)
    } else {
      const newest = remaining.sort((a, b) => a.createdAt - b.createdAt).at(-1)!
      const patch: Partial<FileRecord> = { updatedAt: Date.now() }
      if (src.currentVersionId === versionId) {
        patch.currentVersionId = newest.id!
      }
      await db.files.update(sourceFileId, patch)
    }

    return { newFileId }
  })
}

export async function listGroups(): Promise<GroupRecord[]> {
  return await db.groups.orderBy('sortOrder').toArray()
}

export async function listRecentFiles(limit = 50): Promise<FileRecord[]> {
  return await db.files.orderBy('updatedAt').reverse().limit(limit).toArray()
}

export async function listFilesForLibrary(limit = 200): Promise<FileRecord[]> {
  return await db.files.orderBy('updatedAt').reverse().limit(limit).toArray()
}

export async function setFileGroup(
  fileId: number,
  groupId: number | null
): Promise<void> {
  await db.files.update(fileId, {
    groupId: groupId == null ? null : groupId,
    groupPlacement: 'manual',
  })
}

export async function deleteFileAndVersions(fileId: number): Promise<void> {
  await db.transaction('rw', [db.files, db.versions], async () => {
    await db.versions.where('fileId').equals(fileId).delete()
    await db.files.delete(fileId)
  })
}

export async function getFileById(id: number): Promise<FileRecord | undefined> {
  return db.files.get(id)
}

export async function deleteVersionForFile(
  fileId: number,
  versionId: number
): Promise<{ fileRemoved: boolean }> {
  return await db.transaction('rw', [db.files, db.versions], async () => {
    const file = await db.files.get(fileId)
    if (!file) {
      throw new Error('File not found.')
    }
    const version = await db.versions.get(versionId)
    if (!version || version.fileId !== fileId) {
      throw new Error('Version not found.')
    }

    const all = await db.versions.where('fileId').equals(fileId).toArray()
    if (all.length <= 1) {
      await db.versions.where('fileId').equals(fileId).delete()
      await db.files.delete(fileId)
      return { fileRemoved: true }
    }

    await db.versions.delete(versionId)

    const remaining = await db.versions.where('fileId').equals(fileId).toArray()
    const newest = remaining.sort((a, b) => a.createdAt - b.createdAt).at(-1)!

    const patch: Partial<FileRecord> = { updatedAt: Date.now() }
    if (file.currentVersionId === versionId) {
      patch.currentVersionId = newest.id!
    }
    await db.files.update(fileId, patch)

    return { fileRemoved: false }
  })
}

export async function createGroup(name: string): Promise<number> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Group name is empty.')
  }
  const all = await db.groups.toArray()
  const maxOrder =
    all.length > 0 ? Math.max(...all.map((g) => g.sortOrder), -1) : -1
  return (await db.groups.add({
    name: trimmed,
    sortOrder: maxOrder + 1,
  })) as number
}

export async function renameGroup(id: number, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) {
    return
  }
  await db.groups.update(id, { name: trimmed })
}

export async function deleteGroup(id: number): Promise<void> {
  await db.transaction('rw', [db.files, db.groups], async () => {
    await db.files
      .filter((f) => f.groupId === id)
      .modify({ groupId: null })
    await db.groups.delete(id)
  })
}

export async function reorderGroups(orderedIds: number[]): Promise<void> {
  await db.transaction('rw', [db.groups], async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]!
      await db.groups.update(id, { sortOrder: i })
    }
  })
}

export async function listVersionsForFile(fileId: number): Promise<VersionRecord[]> {
  const v = await db.versions.where('fileId').equals(fileId).sortBy('createdAt')
  return v.slice().reverse()
}

export async function getVersion(
  fileId: number,
  versionId: number
): Promise<VersionRecord | undefined> {
  const v = await db.versions.get(versionId)
  if (v && v.fileId === fileId) {
    return v
  }
  return undefined
}

export async function loadFileCurrent(
  file: FileRecord
): Promise<VersionRecord | undefined> {
  const v = await db.versions.get(file.currentVersionId)
  if (v) {
    return v
  }
  const all = await db.versions.where('fileId').equals(file.id!).toArray()
  if (all.length === 0) {
    return undefined
  }
  return all.sort((a, b) => a.createdAt - b.createdAt).at(-1)
}

export function versionOrdinalLabel(
  versionId: number,
  orderedNewestFirst: VersionRecord[]
): string | null {
  const chronological = orderedNewestFirst.slice().reverse()
  const idx = chronological.findIndex((v) => v.id === versionId)
  if (idx < 0) {
    return null
  }
  return `v${idx + 1}`
}
