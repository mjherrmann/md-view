/** Normalize relative paths from drops (forward slashes, trim). */
export function normalizeEntryPath(path: string): string {
  return path.replace(/\\/g, '/').trim().replace(/^\/+/, '')
}

/** Stable identity for IndexedDB: folder-relative path or basename-only. */
export function entryPathFromFile(file: File): string {
  const rel = file.webkitRelativePath?.trim()
  if (rel) {
    return normalizeEntryPath(rel)
  }
  return normalizeEntryPath(file.name)
}

export function displayNameFromEntryPath(entryPath: string): string {
  const n = normalizeEntryPath(entryPath)
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

/** Parent directory path, or empty when the file sits at the selection root. */
export function parentDirFromEntryPath(entryPath: string): string {
  const n = normalizeEntryPath(entryPath)
  const i = n.lastIndexOf('/')
  if (i <= 0) {
    return ''
  }
  return n.slice(0, i)
}
