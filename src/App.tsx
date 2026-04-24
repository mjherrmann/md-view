import matter from 'gray-matter'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { DropZone } from './components/DropZone'
import { FileLibrary } from './components/FileLibrary'
import { MarkdownPane } from './components/MarkdownPane'
import {
  type FileRecord,
  type VersionRecord,
  getOrCreateFileByName,
} from './db/schema'

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
    (raw: string, name: string, fileId: number | null) => {
      const { data, content } = parseMarkdownFile(raw)
      setMarkdown(content.trim() ? content : raw)
      setFileName(name)
      setActiveFileId(fileId)
      const keys = Object.keys(data)
      setFrontMatter(keys.length > 0 ? (data as Record<string, unknown>) : null)
    },
    []
  )

  const onFileDropped = useCallback(
    async (file: File) => {
      const text = await file.text()
      setPersistError(null)
      try {
        const { file: rec } = await getOrCreateFileByName(
          file.name,
          text,
          'drop'
        )
        applyRawDocument(text, file.name, rec.id ?? null)
        setLibKey((k) => k + 1)
      } catch (e) {
        applyRawDocument(text, file.name, null)
        setPersistError(
          e instanceof Error
            ? e.message
            : 'Could not save to browser storage (IndexedDB).'
        )
      }
    },
    [applyRawDocument]
  )

  const onOpenVersion = useCallback(
    (file: FileRecord, version: VersionRecord) => {
      applyRawDocument(version.content, file.name, file.id ?? null)
    },
    [applyRawDocument]
  )

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Markdown viewer</h1>
        {fileName ? (
          <p className="app__file">{fileName}</p>
        ) : (
          <p className="app__hint">Drop a .md or .txt file to render</p>
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
          onOpenVersion={onOpenVersion}
          refreshKey={libKey}
        />
        <DropZone className="app__main" onFile={onFileDropped}>
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
              <div className="app__empty">Drop a document here to replace this area.</div>
            )}
          </div>
        </DropZone>
      </div>
    </div>
  )
}
