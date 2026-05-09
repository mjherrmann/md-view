import { useEffect, useRef, useState, type DragEvent } from 'react'
import { DND_FILE_MIME, DND_GROUP_MIME } from '../dnd'
import {
  type FileRecord,
  type GroupRecord,
  type VersionRecord,
  createGroup,
  deleteGroup,
  listFilesForLibrary,
  listGroups,
  listVersionsForFile,
  loadFileCurrent,
  renameGroup,
  reorderGroups,
  setFileGroup,
  versionOrdinalLabel,
} from '../db/schema'
import { VersionDiffModal } from './VersionDiffModal'

type Props = {
  activeFileId: number | null
  activeVersionId: number | null
  onOpenVersion: (
    file: FileRecord,
    version: VersionRecord,
    versionOrdinal: string
  ) => void
  refreshKey: number
  onLibraryChange: () => void
}

function isUngrouped(f: FileRecord) {
  return f.groupId == null
}

function computeOrderAfterGroupDrop(
  currentOrder: number[],
  sourceId: number,
  beforeId: 'ungrouped' | number
): number[] {
  if (typeof beforeId === 'number' && beforeId === sourceId) {
    return currentOrder
  }
  const w = currentOrder.filter((id) => id !== sourceId)
  if (beforeId === 'ungrouped') {
    return [sourceId, ...w]
  }
  const idx = w.indexOf(beforeId)
  if (idx < 0) {
    return currentOrder
  }
  return [...w.slice(0, idx), sourceId, ...w.slice(idx)]
}

type FileRowProps = {
  f: FileRecord
  active: boolean
  activeVersionId: number | null
  onOpen: () => void | Promise<void>
  onToggleHistory: () => void
  expanded: boolean
  versions: VersionRecord[]
  compareAId: number | null
  compareBId: number | null
  onCompareAChange: (id: number | null) => void
  onCompareBChange: (id: number | null) => void
  onShowDiff: () => void
  onOpenV: (v: VersionRecord, ordinal: string) => void
}

function FileRow({
  f,
  active,
  activeVersionId,
  onOpen,
  onToggleHistory,
  expanded,
  versions,
  compareAId,
  compareBId,
  onCompareAChange,
  onCompareBChange,
  onShowDiff,
  onOpenV,
}: FileRowProps) {
  const showPath = f.entryPath !== f.name

  return (
    <li className="file-library__item">
      <div
        className={
          'file-library__row' +
          (active ? ' file-library__row--active' : '')
        }
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_FILE_MIME, String(f.id!))
          e.dataTransfer.effectAllowed = 'move'
        }}
      >
        <button
          type="button"
          className="file-library__file"
          onClick={() => {
            void onOpen()
          }}
        >
          <span className="file-library__name">{f.name}</span>
          {showPath ? (
            <span className="file-library__path" title={f.entryPath}>
              {f.entryPath}
            </span>
          ) : null}
          <span className="file-library__date">
            {new Date(f.updatedAt).toLocaleString()}
          </span>
        </button>
        <button
          type="button"
          className="file-library__history"
          title="Version history"
          onClick={onToggleHistory}
        >
          ▾
        </button>
      </div>
      {expanded && versions.length > 0 && (
        <div className="file-library__history-panel">
          <ul className="file-library__versions">
            {versions.map((v) => {
              const ord =
                versionOrdinalLabel(v.id!, versions) ??
                `v${versions.length}`
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    className={
                      'file-library__version' +
                      (activeVersionId != null && v.id === activeVersionId
                        ? ' file-library__version--active'
                        : '')
                    }
                    onClick={() => onOpenV(v, ord)}
                  >
                    <span className="file-library__version-ord">{ord}</span>
                    {' · '}
                    {new Date(v.createdAt).toLocaleString()} · {v.source}
                  </button>
                </li>
              )
            })}
          </ul>
          {versions.length >= 2 && (
            <div className="file-library__compare">
              <span className="file-library__compare-label">Compare</span>
              <select
                className="file-library__compare-select"
                aria-label="Older version"
                value={compareAId ?? ''}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  onCompareAChange(Number.isFinite(n) ? n : null)
                }}
              >
                {versions.map((v) => {
                  const ord =
                    versionOrdinalLabel(v.id!, versions) ?? String(v.id)
                  return (
                    <option key={`a-${v.id}`} value={v.id}>
                      {ord}
                    </option>
                  )
                })}
              </select>
              <span className="file-library__compare-vs">to</span>
              <select
                className="file-library__compare-select"
                aria-label="Newer version"
                value={compareBId ?? ''}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  onCompareBChange(Number.isFinite(n) ? n : null)
                }}
              >
                {versions.map((v) => {
                  const ord =
                    versionOrdinalLabel(v.id!, versions) ?? String(v.id)
                  return (
                    <option key={`b-${v.id}`} value={v.id}>
                      {ord}
                    </option>
                  )
                })}
              </select>
              <button
                type="button"
                className="file-library__compare-btn"
                disabled={
                  compareAId == null ||
                  compareBId == null ||
                  compareAId === compareBId
                }
                onClick={onShowDiff}
              >
                Show diff
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function allowDrop(e: DragEvent) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}

/** 'u' = ungrouped; 'g' + id = named group (matches drop band keys) */
type CollapseKey = `g${number}` | 'u'

function collapseKeyForGroup(gid: number): CollapseKey {
  return `g${gid}` as CollapseKey
}

function SectionChevronButton({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      className={
        'file-library__collapse' +
        (expanded ? '' : ' file-library__collapse--collapsed')
      }
      title={expanded ? 'Collapse' : 'Expand'}
      aria-expanded={expanded}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span className="file-library__chevron" aria-hidden>
        ▾
      </span>
    </button>
  )
}

export function FileLibrary({
  activeFileId,
  activeVersionId,
  onOpenVersion,
  refreshKey,
  onLibraryChange,
}: Props) {
  const [files, setFiles] = useState<FileRecord[]>([])
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [compareAId, setCompareAId] = useState<number | null>(null)
  const [compareBId, setCompareBId] = useState<number | null>(null)
  const [diffModal, setDiffModal] = useState<{
    fileName: string
    leftOrdinal: string
    rightOrdinal: string
    leftContent: string
    rightContent: string
  } | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [dropBand, setDropBand] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set()
  )
  const editInputRef = useRef<HTMLInputElement>(null)

  const isSectionCollapsed = (key: CollapseKey) =>
    collapsedSections.has(key)

  const toggleSectionCollapse = (key: CollapseKey) => {
    setCollapsedSections((prev) => {
      const n = new Set(prev)
      if (n.has(key)) {
        n.delete(key)
      } else {
        n.add(key)
      }
      return n
    })
  }

  const reload = () => {
    onLibraryChange()
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [f, g] = await Promise.all([
        listFilesForLibrary(200),
        listGroups(),
      ])
      if (!cancelled) {
        setFiles(f)
        setGroups(g)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  useEffect(() => {
    if (editingGroupId != null) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingGroupId])

  const orderIds = groups
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => g.id!)

  const ungroupedFiles = files.filter((f) => isUngrouped(f))
  const byGroup = (groupId: number) =>
    files.filter((f) => f.groupId === groupId)

  const handleFileDrop = async (e: DragEvent, targetGroupId: number | null) => {
    e.preventDefault()
    e.stopPropagation()
    setDropBand(null)
    const idStr = e.dataTransfer.getData(DND_FILE_MIME)
    if (!idStr) {
      return
    }
    const fileId = Number(idStr)
    if (!fileId) {
      return
    }
    await setFileGroup(fileId, targetGroupId)
    reload()
  }

  const handleGroupDrop = async (
    e: DragEvent,
    before: 'ungrouped' | number
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDropBand(null)
    const idStr = e.dataTransfer.getData(DND_GROUP_MIME)
    if (!idStr) {
      return
    }
    const sourceId = Number(idStr)
    if (!sourceId) {
      return
    }
    const next = computeOrderAfterGroupDrop(orderIds, sourceId, before)
    await reorderGroups(next)
    reload()
  }

  const onGroupSectionDrop = (e: DragEvent, before: 'ungrouped' | number) => {
    if (e.dataTransfer.getData(DND_FILE_MIME)) {
      void (async () => {
        if (before === 'ungrouped') {
          await handleFileDrop(e, null)
        } else {
          await handleFileDrop(e, before)
        }
      })()
      return
    }
    if (e.dataTransfer.getData(DND_GROUP_MIME)) {
      void handleGroupDrop(e, before)
    }
  }

  const newGroup = () => {
    const name = window.prompt('Name for the new group')
    if (name == null) {
      return
    }
    const t = name.trim()
    if (!t) {
      return
    }
    void (async () => {
      try {
        await createGroup(t)
        reload()
      } catch {
        // ignore
      }
    })()
  }

  const startRename = (g: GroupRecord) => {
    setEditingGroupId(g.id!)
    setEditName(g.name)
  }

  const commitRename = (g: GroupRecord) => {
    const t = editName.trim()
    setEditingGroupId(null)
    if (!t || t === g.name) {
      return
    }
    void (async () => {
      await renameGroup(g.id!, t)
      reload()
    })()
  }

  const onDeleteGroup = (g: GroupRecord) => {
    if (!window.confirm(`Delete group “${g.name}”? Files will move to Ungrouped.`)) {
      return
    }
    void (async () => {
      await deleteGroup(g.id!)
      reload()
    })()
  }

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      setVersions([])
      setCompareAId(null)
      setCompareBId(null)
      return
    }
    setExpandedId(id)
    const list = await listVersionsForFile(id)
    setVersions(list)
    if (list.length >= 2) {
      const newest = list[0]!
      const oldest = list[list.length - 1]!
      setCompareAId(oldest.id!)
      setCompareBId(newest.id!)
    } else {
      setCompareAId(null)
      setCompareBId(null)
    }
  }

  const openFileCurrent = async (f: FileRecord) => {
    const v = await loadFileCurrent(f)
    if (!v) {
      return
    }
    const all = await listVersionsForFile(f.id!)
    const ord = versionOrdinalLabel(v.id!, all) ?? 'v1'
    onOpenVersion(f, v, ord)
  }

  const showSections = files.length > 0 || groups.length > 0

  const renderFileRow = (f: FileRecord) => (
    <FileRow
      key={f.id}
      f={f}
      active={f.id === activeFileId}
      activeVersionId={activeVersionId}
      onOpen={() => openFileCurrent(f)}
      onToggleHistory={() => {
        void toggleExpand(f.id!)
      }}
      expanded={expandedId === f.id}
      versions={expandedId === f.id ? versions : []}
      compareAId={expandedId === f.id ? compareAId : null}
      compareBId={expandedId === f.id ? compareBId : null}
      onCompareAChange={(id) => {
        setCompareAId(id)
      }}
      onCompareBChange={(id) => {
        setCompareBId(id)
      }}
      onShowDiff={() => {
        if (expandedId !== f.id || compareAId == null || compareBId == null) {
          return
        }
        const va = versions.find((x) => x.id === compareAId)
        const vb = versions.find((x) => x.id === compareBId)
        if (!va || !vb) {
          return
        }
        const leftOrd =
          versionOrdinalLabel(va.id!, versions) ?? String(va.id)
        const rightOrd =
          versionOrdinalLabel(vb.id!, versions) ?? String(vb.id)
        const chronological = versions.slice().reverse()
        const ta = chronological.findIndex((x) => x.id === va.id)
        const tb = chronological.findIndex((x) => x.id === vb.id)
        const leftIsOlder = ta <= tb
        setDiffModal({
          fileName: f.name,
          leftOrdinal: leftIsOlder ? leftOrd : rightOrd,
          rightOrdinal: leftIsOlder ? rightOrd : leftOrd,
          leftContent: leftIsOlder ? va.content : vb.content,
          rightContent: leftIsOlder ? vb.content : va.content,
        })
      }}
      onOpenV={(v, ord) => onOpenVersion(f, v, ord)}
    />
  )

  return (
    <aside className="file-library">
      <div className="file-library__toolbar">
        <h2 className="file-library__title">Saved</h2>
        <button
          type="button"
          className="file-library__new-group"
          onClick={newGroup}
        >
          + Group
        </button>
      </div>

      {!showSections && (
        <p className="file-library__empty">No files stored yet.</p>
      )}

      {showSections && (
        <div className="file-library__scroll">
          <section
            className={
              'file-library__section' +
              (dropBand === 'u' ? ' file-library__section--drop' : '')
            }
            onDragOver={(e) => {
              allowDrop(e)
              setDropBand('u')
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDropBand(null)
              }
            }}
            onDrop={(e) => onGroupSectionDrop(e, 'ungrouped')}
          >
            <div className="file-library__group-head file-library__group-head--fixed">
              <SectionChevronButton
                expanded={!isSectionCollapsed('u')}
                onToggle={() => {
                  toggleSectionCollapse('u')
                }}
                label={
                  isSectionCollapsed('u')
                    ? 'Expand ungrouped files'
                    : 'Collapse ungrouped files'
                }
              />
              <span className="file-library__grip file-library__grip--spacer" />
              <span className="file-library__group-title">Ungrouped</span>
            </div>
            {ungroupedFiles.length > 0 && !isSectionCollapsed('u') ? (
              <ul className="file-library__file-list">
                {ungroupedFiles.map(renderFileRow)}
              </ul>
            ) : null}
          </section>

          {groups.map((g) => {
            const gid = g.id!
            const band = `g-${gid}`
            const collapseKey = collapseKeyForGroup(gid)
            const sectionCollapsed = isSectionCollapsed(collapseKey)
            const inGroup = byGroup(gid)
            return (
              <section
                key={gid}
                className={
                  'file-library__section' +
                  (dropBand === band
                    ? ' file-library__section--drop'
                    : '')
                }
                onDragOver={(e) => {
                  allowDrop(e)
                  setDropBand(band)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDropBand(null)
                  }
                }}
                onDrop={(e) => onGroupSectionDrop(e, gid)}
              >
                <div className="file-library__group-head">
                  <SectionChevronButton
                    expanded={!sectionCollapsed}
                    onToggle={() => {
                      toggleSectionCollapse(collapseKey)
                    }}
                    label={
                      sectionCollapsed
                        ? `Expand group ${g.name}`
                        : `Collapse group ${g.name}`
                    }
                  />
                  <span
                    className="file-library__grip"
                    title="Drag to reorder"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        DND_GROUP_MIME,
                        String(gid)
                      )
                      e.dataTransfer.effectAllowed = 'move'
                      e.stopPropagation()
                    }}
                  >
                    ⠿
                  </span>
                  {editingGroupId === gid ? (
                    <input
                      ref={editInputRef}
                      className="file-library__group-rename"
                      value={editName}
                      onChange={(e) => {
                        setEditName(e.target.value)
                      }}
                      onBlur={() => {
                        commitRename(g)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitRename(g)
                        } else if (e.key === 'Escape') {
                          setEditingGroupId(null)
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="file-library__group-title file-library__group-title--pressable"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        startRename(g)
                      }}
                    >
                      {g.name}
                    </span>
                  )}
                  <button
                    type="button"
                    className="file-library__group-del"
                    title="Delete group"
                    onClick={() => {
                      onDeleteGroup(g)
                    }}
                  >
                    ×
                  </button>
                </div>
                {inGroup.length > 0 && !sectionCollapsed ? (
                  <ul className="file-library__file-list">
                    {inGroup.map(renderFileRow)}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
      )}

      <VersionDiffModal
        open={diffModal != null}
        onClose={() => setDiffModal(null)}
        fileName={diffModal?.fileName ?? ''}
        leftOrdinal={diffModal?.leftOrdinal ?? ''}
        rightOrdinal={diffModal?.rightOrdinal ?? ''}
        leftContent={diffModal?.leftContent ?? ''}
        rightContent={diffModal?.rightContent ?? ''}
      />
    </aside>
  )
}
