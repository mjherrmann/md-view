import Dexie, { type Table } from 'dexie'

export interface FileRecord {
  id?: number
  name: string
  currentVersionId: number
  updatedAt: number
}

export type VersionSource = 'drop' | 'restore' | 'library'

export interface VersionRecord {
  id?: number
  fileId: number
  content: string
  createdAt: number
  source: VersionSource
}

export class MdDatabase extends Dexie {
  files!: Table<FileRecord, number>
  versions!: Table<VersionRecord, number>

  constructor() {
    super('md-viewer')
    this.version(1).stores({
      files: '++id, name, updatedAt, currentVersionId',
      versions: '++id, fileId, createdAt',
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

export async function listRecentFiles(limit = 50): Promise<FileRecord[]> {
  return await db.files.orderBy('updatedAt').reverse().limit(limit).toArray()
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
