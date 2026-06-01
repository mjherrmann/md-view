import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  DND_FILE_MIME,
  DND_GROUP_MIME,
  DND_VERSION_MIME,
} from '../dnd'
import {
  type FileRecord,
  type GroupRecord,
  type VersionRecord,
  createGroup,
  deleteFileAndVersions,
  deleteGroupWithPromotion,
  deleteVersionForFile,
  detachVersionToNewFile,
  getFileById,
  listFilesForLibrary,
  listGroups,
  listVersionsForFile,
  loadFileCurrent,
  moveFileToGroup,
  renameGroup,
  reorderSiblings,
  reparentGroup,
  versionOrdinalLabel,
} from '../db/schema'
import { buildGroupMaps, validateReparent } from '../db/groupTree'
import { VersionDiffModal } from './VersionDiffModal'
import { GroupNode } from './GroupNode'

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
  onFileDeleted?: (fileId: number) => void
  /** Called when a version was removed but the file still exists (e.g. refresh active doc). */
  onVersionDeleted?: (fileId: number, versionId: number) => void
  /** Source file id removed after merging into target (same name in destination group). */
  onFileMerged?: (fromFileId: number, toFileId: number) => void
  /** A version was split out into its own file row. */
  onVersionDetached?: (
    sourceFileId: number,
    versionId: number,
    newFileId: number
  ) => void
}

const HOLD_DELETE_MS = 700

function FileDeleteHold({
  label,
  onHoldComplete,
  compact,
  title: holdTitle,
}: {
  label: string
  onHoldComplete: () => void | Promise<void>
  compact?: boolean
  title?: string
}) {
  const [progress, setProgress] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const doneRef = useRef(false)
  const holdingRef = useRef(false)

  const stopTracking = useCallback(() => {
    holdingRef.current = false
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setProgress(0)
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (e.button !== 0) {
      return
    }
    doneRef.current = false
    holdingRef.current = true
    startRef.current = performance.now()
    const step = () => {
      if (!holdingRef.current) {
        return
      }
      const elapsed = performance.now() - startRef.current
      const p = Math.min(1, elapsed / HOLD_DELETE_MS)
      setProgress(p)
      if (p < 1 && holdingRef.current) {
        rafRef.current = requestAnimationFrame(step)
      }
    }
    rafRef.current = requestAnimationFrame(step)
    timerRef.current = setTimeout(() => {
      if (doneRef.current) {
        return
      }
      doneRef.current = true
      stopTracking()
      void Promise.resolve(onHoldComplete()).catch(() => {
        /* ignore */
      })
    }, HOLD_DELETE_MS)
  }

  const endHold = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!doneRef.current) {
      stopTracking()
    }
  }

  useEffect(() => () => stopTracking(), [stopTracking])

  return (
    <button
      type="button"
      className={
        'file-library__delete-hold' +
        (compact ? ' file-library__delete-hold--compact' : '')
      }
      title={holdTitle ?? 'Hold to remove from library'}
      aria-label={
        compact ? `Hold to delete version ${label}` : `Hold to delete ${label}`
      }
      draggable={false}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onPointerDown={onPointerDown}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onPointerLeave={endHold}
    >
      <span
        className="file-library__delete-hold__fill"
        style={
          {
            '--hold-p': String(progress),
          } as CSSProperties
        }
      />
      <span className="file-library__delete-hold__icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4v2H5V4h3.5l1-1h5l1 1H19z" />
        </svg>
      </span>
    </button>
  )
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
  onDeleteFile: () => void | Promise<void>
  onDeleteVersion: (v: VersionRecord) => void | Promise<void>
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
  onDeleteFile,
  onDeleteVersion,
}: FileRowProps) {
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
        <FileDeleteHold label={f.name} onHoldComplete={onDeleteFile} />
      </div>
      {expanded && versions.length > 0 && (
        <div className="file-library__history-panel">
          <ul className="file-library__versions">
            {versions.map((v) => {
              const ord =
                versionOrdinalLabel(v.id!, versions) ??
                `v${versions.length}`
              return (
                <li
                  key={v.id}
                  className="file-library__version-row"
                  title="Drag to Ungrouped or a group to split this version into its own file"
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation()
                    e.dataTransfer.setData(
                      DND_VERSION_MIME,
                      `${f.id}:${v.id}`
                    )
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                >
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
                  <FileDeleteHold
                    compact
                    label={`${ord} of ${f.name}`}
                    title="Hold to delete this version"
                    onHoldComplete={() => onDeleteVersion(v)}
                  />
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
  onFileDeleted,
  onVersionDeleted,
  onFileMerged,
  onVersionDetached,
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

  const { childrenByParent } = buildGroupMaps(groups)
  const rootGroups = childrenByParent.get(null) ?? []

  const ungroupedFiles = files.filter((f) => isUngrouped(f))
  const byGroup = (groupId: number) =>
    files.filter((f) => f.groupId === groupId)

  const handleItemDropOnSection = async (
    e: DragEvent,
    targetGroupId: number | null
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDropBand(null)

    const verPayload = e.dataTransfer.getData(DND_VERSION_MIME)
    if (verPayload) {
      const seg = verPayload.split(':')
      const sfid = Number(seg[0])
      const vid = Number(seg[1])
      if (!sfid || !vid) {
        return
      }
      try {
        const { newFileId } = await detachVersionToNewFile(
          sfid,
          vid,
          targetGroupId
        )
        setDiffModal(null)
        if (expandedId === sfid) {
          const src = await getFileById(sfid)
          if (!src) {
            setExpandedId(null)
            setVersions([])
            setCompareAId(null)
            setCompareBId(null)
          } else {
            const list = await listVersionsForFile(sfid)
            setVersions(list)
            if (list.length >= 2) {
              setCompareAId(list[list.length - 1]!.id!)
              setCompareBId(list[0]!.id!)
            } else {
              setCompareAId(null)
              setCompareBId(null)
            }
          }
        }
        onVersionDetached?.(sfid, vid, newFileId)
        reload()
      } catch {
        // ignore
      }
      return
    }

    const idStr = e.dataTransfer.getData(DND_FILE_MIME)
    if (!idStr) {
      return
    }
    const fileId = Number(idStr)
    if (!fileId) {
      return
    }
    try {
      const result = await moveFileToGroup(fileId, targetGroupId)
      setDiffModal(null)
      if (result.merged) {
        const surv = result.survivingFileId
        if (expandedId === fileId) {
          setExpandedId(surv)
        }
        if (expandedId === fileId || expandedId === surv) {
          const list = await listVersionsForFile(surv)
          setVersions(list)
          if (list.length >= 2) {
            setCompareAId(list[list.length - 1]!.id!)
            setCompareBId(list[0]!.id!)
          } else {
            setCompareAId(null)
            setCompareBId(null)
          }
        }
        onFileMerged?.(fileId, surv)
      }
      reload()
    } catch {
      // ignore
    }
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

    // Determine target parentId: dropping onto a group section means
    // the target parent is that group; 'ungrouped' means root (null)
    const targetParentId = before === 'ungrouped' ? null : before

    // Look up the dragged group's current parentId
    const { byId, childrenByParent: maps } = buildGroupMaps(groups)
    const sourceGroup = byId.get(sourceId)
    if (!sourceGroup) {
      return
    }
    const sourceParentId = sourceGroup.parentId

    if (sourceParentId === targetParentId) {
      // Same parent → reorder among siblings
      const siblings = (maps.get(targetParentId) ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => g.id!)
      const next = computeOrderAfterGroupDrop(siblings, sourceId, before)
      await reorderSiblings(targetParentId, next)
    } else {
      // Different parent → reparent operation
      // Validate client-side first for fast no-op on self-drop, descendant-drop, depth overflow
      const error = validateReparent(sourceId, targetParentId, byId, maps)
      if (error) {
        return // invalid drop — silently ignore (no state change)
      }
      try {
        await reparentGroup(sourceId, targetParentId)
      } catch {
        // reparentGroup validates again with fresh DB state and throws on
        // self-drop, descendant-drop, or depth overflow — silently ignore
        return
      }
    }
    reload()
  }

  const onGroupSectionDrop = (e: DragEvent, before: 'ungrouped' | number) => {
    const targetGroupId = before === 'ungrouped' ? null : before
    if (
      e.dataTransfer.getData(DND_VERSION_MIME) ||
      e.dataTransfer.getData(DND_FILE_MIME)
    ) {
      void handleItemDropOnSection(e, targetGroupId)
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
    const childGroups = groups.filter((c) => c.parentId === g.id)
    const groupFiles = files.filter((f) => f.groupId === g.id)
    const parentName = g.parentId != null
      ? groups.find((p) => p.id === g.parentId)?.name ?? 'parent group'
      : 'Ungrouped'

    const message =
      `Delete group “${g.name}”?\n\n` +
      `${childGroups.length} child group(s) and ${groupFiles.length} file(s) ` +
      `will be moved to ${parentName}.`

    if (!window.confirm(message)) {
      return
    }
    void (async () => {
      await deleteGroupWithPromotion(g.id!)
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

  const removeFile = async (f: FileRecord) => {
    if (expandedId === f.id) {
      setExpandedId(null)
      setVersions([])
      setCompareAId(null)
      setCompareBId(null)
    }
    setDiffModal(null)
    await deleteFileAndVersions(f.id!)
    onFileDeleted?.(f.id!)
    reload()
  }

  const removeVersion = async (f: FileRecord, v: VersionRecord) => {
    try {
      const { fileRemoved } = await deleteVersionForFile(f.id!, v.id!)
      setDiffModal(null)
      if (fileRemoved) {
        if (expandedId === f.id) {
          setExpandedId(null)
          setVersions([])
          setCompareAId(null)
          setCompareBId(null)
        }
        onFileDeleted?.(f.id!)
      } else {
        if (expandedId === f.id) {
          const list = await listVersionsForFile(f.id!)
          setVersions(list)
          if (list.length >= 2) {
            setCompareAId(list[list.length - 1]!.id!)
            setCompareBId(list[0]!.id!)
          } else {
            setCompareAId(null)
            setCompareBId(null)
          }
        }
        onVersionDeleted?.(f.id!, v.id!)
      }
      reload()
    } catch {
      // ignore
    }
  }

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
      onDeleteFile={() => removeFile(f)}
      onDeleteVersion={(v) => removeVersion(f, v)}
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

          {rootGroups.map((g) => (
            <GroupNode
              key={g.id}
              group={g}
              depth={0}
              childrenByParent={childrenByParent}
              filesByGroup={byGroup}
              renderFileRow={renderFileRow}
              dropBand={dropBand}
              setDropBand={setDropBand}
              isSectionCollapsed={isSectionCollapsed}
              toggleSectionCollapse={toggleSectionCollapse}
              editingGroupId={editingGroupId}
              editName={editName}
              setEditName={setEditName}
              startRename={startRename}
              commitRename={commitRename}
              setEditingGroupId={setEditingGroupId}
              onDeleteGroup={onDeleteGroup}
              onGroupSectionDrop={onGroupSectionDrop}
            />
          ))}
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
