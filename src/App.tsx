import matter from 'gray-matter'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { DropZone } from './components/DropZone'
import { FileLibrary } from './components/FileLibrary'
import { MarkdownPane } from './components/MarkdownPane'
import {
  type FileRecord,
  type VersionRecord,
  getOrCreateFileByEntryPath,
} from './db/schema'
import { displayNameFromEntryPath, entryPathFromFile } from './lib/entryPath'

function parseMarkdownFile(raw: string) {
  try {
    return matter(raw)
  } catch {
    return { data: {}, content: raw }
  }
}

export default function App() {
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
        const entryPath = entryPathFromFile(file)
        const displayName = displayNameFromEntryPath(entryPath)
        try {
          const { file: rec, version, versionOrdinal } =
            await getOrCreateFileByEntryPath(entryPath, displayName, text, 'drop')
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
              Choose a folder (or drop a folder) so files with the same name in
              different paths stay separate; single-file drops only see the file name.
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
          activeFileId={activeFileId}
          activeVersionId={activeVersionId}
          onOpenVersion={onOpenVersion}
          refreshKey={libKey}
          onLibraryChange={bumpLibrary}
        />
        <DropZone className="app__main" onFiles={onFilesDropped}>
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
    </div>
  )
}
