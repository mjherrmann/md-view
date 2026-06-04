import jsYaml from 'js-yaml'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { DropZone } from './components/DropZone'
import { FileLibrary } from './components/FileLibrary'
import { ImportSummaryToast, type ToastData } from './components/ImportSummaryToast'
import { MarkdownPane } from './components/MarkdownPane'
import { ResizeHandle } from './components/resize/ResizeHandle'
import { useResizable } from './components/resize/useResizable'
import {
  type FileRecord,
  type VersionRecord,
  createNewFileFromBrowserDrop,
  db,
  getFileById,
  getVersion,
  listVersionsForFile,
  loadFileCurrent,
  versionOrdinalLabel,
} from './db/schema'
import { traverseDirectoryTree, type DirectoryNode } from './lib/directoryTraversal'
import { importDirectoryTree } from './lib/importOrchestrator'

/** Flatten all files from a DirectoryNode tree (used for in-memory fallback on DB failure). */
function collectAllTreeFiles(node: DirectoryNode): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [...node.files]
  for (const child of node.children) {
    files.push(...collectAllTreeFiles(child))
  }
  return files
}

function parseMarkdownFile(raw: string) {
  try {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!match) return { data: {}, content: raw }
    const data = jsYaml.load(match[1]!) ?? {}
    const content = match[2] ?? ''
    return { data: typeof data === 'object' ? data : {}, content }
  } catch {
    return { data: {}, content: raw }
  }
}

export default function App() {
  const { width, isDragging, isMobile, handleProps } = useResizable({
    defaultWidth: 272,
    minWidth: 120,
    maxWidthRatio: 0.5,
  })

  const [markdown, setMarkdown] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [frontMatter, setFrontMatter] = useState<Record<string, unknown> | null>(
    null
  )
  const [activeFileId, setActiveFileId] = useState<number | null>(null)
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null)
  const [activeVersionOrdinal, setActiveVersionOrdinal] = useState<string | null>(
    null
  )
  const [libKey, setLibKey] = useState(0)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [useDark, setUseDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [toasts, setToasts] = useState<ToastData[]>([])

  const addToast = useCallback(
    (data: Omit<ToastData, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setToasts((prev) => [...prev, { ...data, id }])
    },
    []
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = () => setUseDark(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])

  const applyRawDocument = useCallback(
    (
      raw: string,
      name: string,
      fileId: number | null,
      versionId: number | null = null,
      versionOrdinal: string | null = null
    ) => {
      const { data, content } = parseMarkdownFile(raw)
      setMarkdown(content.trim() ? content : raw)
      setFileName(name)
      setActiveFileId(fileId)
      setActiveVersionId(versionId)
      setActiveVersionOrdinal(versionOrdinal)
      const keys = Object.keys(data)
      setFrontMatter(keys.length > 0 ? (data as Record<string, unknown>) : null)
    },
    []
  )

  const bumpLibrary = useCallback(() => {
    setLibKey((k) => k + 1)
  }, [])

  const onFilesDropped = useCallback(
    async (files: File[]) => {
      setPersistError(null)
      let lastError: string | null = null
      for (const file of files) {
        const text = await file.text()
        const displayName = file.name
        try {
          const { file: rec, version, versionOrdinal } =
            await createNewFileFromBrowserDrop(displayName, text)
          applyRawDocument(
            text,
            displayName,
            rec.id ?? null,
            version.id ?? null,
            versionOrdinal
          )
        } catch (e) {
          applyRawDocument(text, displayName, null, null, null)
          lastError =
            e instanceof Error
              ? e.message
              : 'Could not save to browser storage (IndexedDB).'
        }
      }
      if (lastError) {
        setPersistError(lastError)
      }
      setLibKey((k) => k + 1)
    },
    [applyRawDocument]
  )

  const onDirectoriesDropped = useCallback(
    async (entries: FileSystemDirectoryEntry[]) => {
      setPersistError(null)
      for (const dirEntry of entries) {
        const dirName = dirEntry.name.trim()
        if (!dirName) continue

        const { root, capReached } = await traverseDirectoryTree(dirEntry)
        try {
          const summary = await importDirectoryTree(root)

          addToast({
            groupsCreated: summary.groupsCreated,
            groupsReused: summary.groupsReused,
            filesImported: summary.filesImported,
            filesUpdated: summary.filesUpdated,
            capReached: summary.capReached || capReached,
          })

          // Render last imported file in pane
          if (summary.filesImported > 0) {
            const lastFile = await db.files.orderBy('id').last()
            if (lastFile) {
              const ver = await loadFileCurrent(lastFile)
              if (ver) {
                applyRawDocument(ver.content, lastFile.name, lastFile.id!, ver.id!, 'v1')
              }
            }
          }
        } catch (e) {
          // IndexedDB failure: render last readable file in-memory
          const allFiles = collectAllTreeFiles(root)
          if (allFiles.length > 0) {
            const last = allFiles[allFiles.length - 1]!
            applyRawDocument(last.content, last.name, null, null, null)
          }
          setPersistError(
            e instanceof Error ? e.message : 'Could not save to browser storage (IndexedDB).'
          )
        }
        bumpLibrary()
      }
    },
    [applyRawDocument, bumpLibrary, addToast]
  )

  const onOpenVersion = useCallback(
    (file: FileRecord, version: VersionRecord, versionOrdinal: string) => {
      applyRawDocument(
        version.content,
        file.name,
        file.id ?? null,
        version.id ?? null,
        versionOrdinal
      )
    },
    [applyRawDocument]
  )

  const onFileDeletedFromLibrary = useCallback((deletedFileId: number) => {
    if (activeFileId === deletedFileId) {
      setMarkdown('')
      setFileName(null)
      setActiveFileId(null)
      setActiveVersionId(null)
      setActiveVersionOrdinal(null)
      setFrontMatter(null)
    }
  }, [activeFileId])

  const onVersionDeletedFromLibrary = useCallback(
    async (fileId: number, deletedVersionId: number) => {
      if (activeFileId !== fileId || activeVersionId !== deletedVersionId) {
        return
      }
      const file = await getFileById(fileId)
      if (!file) {
        return
      }
      const current = await loadFileCurrent(file)
      if (!current) {
        return
      }
      const all = await listVersionsForFile(fileId)
      const ord = versionOrdinalLabel(current.id!, all) ?? 'v1'
      applyRawDocument(
        current.content,
        file.name,
        fileId,
        current.id ?? null,
        ord
      )
    },
    [activeFileId, activeVersionId, applyRawDocument]
  )

  const onFileMergedFromLibrary = useCallback(
    async (fromFileId: number, toFileId: number) => {
      if (activeFileId !== fromFileId) {
        return
      }
      const file = await getFileById(toFileId)
      if (!file) {
        return
      }
      const ver =
        activeVersionId != null
          ? await getVersion(toFileId, activeVersionId)
          : undefined
      const openVer = ver ?? (await loadFileCurrent(file))
      if (!openVer) {
        return
      }
      const all = await listVersionsForFile(toFileId)
      const ord = versionOrdinalLabel(openVer.id!, all) ?? 'v1'
      applyRawDocument(
        openVer.content,
        file.name,
        toFileId,
        openVer.id ?? null,
        ord
      )
    },
    [activeFileId, activeVersionId, applyRawDocument]
  )

  const onVersionDetachedFromLibrary = useCallback(
    async (_sourceFileId: number, versionId: number, newFileId: number) => {
      if (activeVersionId !== versionId) {
        return
      }
      const file = await getFileById(newFileId)
      if (!file) {
        return
      }
      const ver = await getVersion(newFileId, versionId)
      if (!ver) {
        return
      }
      const all = await listVersionsForFile(newFileId)
      const ord = versionOrdinalLabel(ver.id!, all) ?? 'v1'
      applyRawDocument(
        ver.content,
        file.name,
        newFileId,
        ver.id ?? null,
        ord
      )
    },
    [activeVersionId, applyRawDocument]
  )

  const fileLine =
    fileName &&
    (activeVersionOrdinal
      ? `${fileName} · ${activeVersionOrdinal}`
      : fileName)

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Markdown viewer</h1>
        {fileName ? (
          <p className="app__file">{fileLine}</p>
        ) : (
          <>
            <p className="app__hint">Drop one or more .md / .txt files to render</p>
            <p className="app__hint app__hint--sub">
              Drops become new entries in the “Dropped” group. Drag a file onto another
              group: if the same filename exists there, versions merge. Drag a version row
              to Ungrouped or a group to split it into its own file.
            </p>
          </>
        )}
        {persistError && (
          <p className="app__warn" role="status">
            {persistError} — viewing still works.
          </p>
        )}
      </header>

      <div className="app__body">
        <FileLibrary
          style={{ width }}
          activeFileId={activeFileId}
          activeVersionId={activeVersionId}
          onOpenVersion={onOpenVersion}
          refreshKey={libKey}
          onLibraryChange={bumpLibrary}
          onFileDeleted={onFileDeletedFromLibrary}
          onVersionDeleted={onVersionDeletedFromLibrary}
          onFileMerged={onFileMergedFromLibrary}
          onVersionDetached={onVersionDetachedFromLibrary}
        />
        <ResizeHandle isDragging={isDragging} isMobile={isMobile} handleProps={handleProps} />
        <DropZone className="app__main" onFiles={onFilesDropped} onDirectories={onDirectoriesDropped}>
          {frontMatter && (
            <details className="app__meta">
              <summary>Front matter (YAML)</summary>
              <pre className="app__meta-pre">
                {JSON.stringify(frontMatter, null, 2)}
              </pre>
            </details>
          )}
          <div className="app__scroll">
            {markdown ? (
              <MarkdownPane markdown={markdown} useDarkShiki={useDark} />
            ) : (
              <div className="app__empty">
                Drop one or more documents here to replace this area.
              </div>
            )}
          </div>
        </DropZone>
      </div>

      <ImportSummaryToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
