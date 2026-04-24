import { useEffect, useState } from 'react'
import {
  type FileRecord,
  type VersionRecord,
  listRecentFiles,
  listVersionsForFile,
  loadFileCurrent,
} from '../db/schema'

type Props = {
  activeFileId: number | null
  onOpenVersion: (file: FileRecord, version: VersionRecord) => void
  refreshKey: number
}

export function FileLibrary({
  activeFileId,
  onOpenVersion,
  refreshKey,
}: Props) {
  const [files, setFiles] = useState<FileRecord[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [versions, setVersions] = useState<VersionRecord[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await listRecentFiles(100)
      if (!cancelled) {
        setFiles(next)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      setVersions([])
      return
    }
    setExpandedId(id)
    setVersions(await listVersionsForFile(id))
  }

  return (
    <aside className="file-library">
      <h2 className="file-library__title">Saved</h2>
      {files.length === 0 ? (
        <p className="file-library__empty">No files stored yet.</p>
      ) : (
        <ul className="file-library__list">
          {files.map((f) => (
            <li key={f.id} className="file-library__item">
              <div
                className={
                  'file-library__row' +
                  (f.id === activeFileId ? ' file-library__row--active' : '')
                }
              >
                <button
                  type="button"
                  className="file-library__file"
                  onClick={async () => {
                    const v = await loadFileCurrent(f)
                    if (v) {
                      onOpenVersion(f, v)
                    }
                  }}
                >
                  <span className="file-library__name">{f.name}</span>
                  <span className="file-library__date">
                    {new Date(f.updatedAt).toLocaleString()}
                  </span>
                </button>
                <button
                  type="button"
                  className="file-library__history"
                  title="Version history"
                  onClick={() => {
                    void toggleExpand(f.id!)
                  }}
                >
                  ▾
                </button>
              </div>
              {expandedId === f.id && versions.length > 0 && (
                <ul className="file-library__versions">
                  {versions.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        className="file-library__version"
                        onClick={() => onOpenVersion(f, v)}
                      >
                        {new Date(v.createdAt).toLocaleString()} · {v.source}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
