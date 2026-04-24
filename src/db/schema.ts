import Dexie, { type Table } from 'dexie'

export interface FileRecord {
  id?: number
  name: string
  currentVersionId: number
  updatedAt: number
  groupId?: number | null
}

export type VersionSource = 'drop' | 'restore' | 'library'

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
  }
}

export const db = new MdDatabase()

export async function getOrCreateFileByName(
  name: string,
  content: string,
  source: VersionSource
): Promise<{ file: FileRecord; version: VersionRecord }> {
  return await db.transaction('rw', [db.files, db.versions], async () => {
    let file = await db.files.where('name').equals(name).first()
    if (!file) {
      const fileId = await db.files.add({
        name,
        currentVersionId: 0,
        updatedAt: Date.now(),
        groupId: null,
      })
      file = (await db.files.get(fileId))!
    }

    const versionId = await db.versions.add({
      fileId: file.id!,
      content,
      createdAt: Date.now(),
      source,
    })
    const version = (await db.versions.get(versionId))!
    await db.files.update(file.id!, {
      currentVersionId: versionId as number,
      updatedAt: Date.now(),
    })
    return { file: (await db.files.get(file.id!))!, version }
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
  await db.files.update(fileId, { groupId: groupId == null ? null : groupId })
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
