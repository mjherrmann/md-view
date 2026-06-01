import { useRef, type DragEvent, type JSX } from 'react'
import {
  DND_GROUP_MIME,
} from '../dnd'
import type { FileRecord, GroupRecord } from '../db/schema'

type CollapseKey = `g${number}` | 'u'

function collapseKeyForGroup(gid: number): CollapseKey {
  return `g${gid}` as CollapseKey
}

function allowDrop(e: DragEvent) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
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

export type GroupNodeProps = {
  group: GroupRecord
  depth: number
  childrenByParent: Map<number | null, GroupRecord[]>
  filesByGroup: (groupId: number) => FileRecord[]
  renderFileRow: (f: FileRecord) => JSX.Element
  /** Currently highlighted drop band key */
  dropBand: string | null
  setDropBand: (band: string | null) => void
  /** Collapse state */
  isSectionCollapsed: (key: CollapseKey) => boolean
  toggleSectionCollapse: (key: CollapseKey) => void
  /** Rename state */
  editingGroupId: number | null
  editName: string
  setEditName: (name: string) => void
  startRename: (g: GroupRecord) => void
  commitRename: (g: GroupRecord) => void
  setEditingGroupId: (id: number | null) => void
  /** Group actions */
  onDeleteGroup: (g: GroupRecord) => void
  onCreateChildGroup: (parentId: number) => void
  /** Drop handler for file/version/group drops on a section */
  onGroupSectionDrop: (e: DragEvent, target: 'ungrouped' | number) => void
}

export function GroupNode({
  group,
  depth,
  childrenByParent,
  filesByGroup,
  renderFileRow,
  dropBand,
  setDropBand,
  isSectionCollapsed,
  toggleSectionCollapse,
  editingGroupId,
  editName,
  setEditName,
  startRename,
  commitRename,
  setEditingGroupId,
  onDeleteGroup,
  onCreateChildGroup,
  onGroupSectionDrop,
}: GroupNodeProps): JSX.Element {
  const editInputRef = useRef<HTMLInputElement>(null)
  const gid = group.id!
  const band = `g-${gid}`
  const collapseKey = collapseKeyForGroup(gid)
  const sectionCollapsed = isSectionCollapsed(collapseKey)
  const inGroup = filesByGroup(gid)
  const children = childrenByParent.get(gid) ?? []

  return (
    <section
      className={
        'file-library__section' +
        (dropBand === band ? ' file-library__section--drop' : '')
      }
      data-depth={depth}
      style={{ paddingLeft: `${depth * 16}px` }}
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
              ? `Expand group ${group.name}`
              : `Collapse group ${group.name}`
          }
        />
        <span
          className="file-library__grip"
          title="Drag to reorder"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_GROUP_MIME, String(gid))
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
            autoFocus
            onChange={(e) => {
              setEditName(e.target.value)
            }}
            onBlur={() => {
              commitRename(group)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitRename(group)
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
              startRename(group)
            }}
          >
            {group.name}
          </span>
        )}
        <button
          type="button"
          className="file-library__group-rename-btn"
          title="Rename group"
          aria-label={`Rename group ${group.name}`}
          onClick={(e) => {
            e.stopPropagation()
            startRename(group)
          }}
        >
          ✎
        </button>
        {depth < 3 && (
          <button
            type="button"
            className="file-library__group-add-child"
            title="Create child group"
            aria-label={`Create child group in ${group.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onCreateChildGroup(gid)
            }}
          >
            +
          </button>
        )}
        <button
          type="button"
          className="file-library__group-del"
          title="Delete group"
          onClick={() => {
            onDeleteGroup(group)
          }}
        >
          ×
        </button>
      </div>
      {!sectionCollapsed && (
        <>
          {inGroup.length > 0 && (
            <ul className="file-library__file-list">
              {inGroup.map(renderFileRow)}
            </ul>
          )}
          {children.map((child) => (
            <GroupNode
              key={child.id}
              group={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              filesByGroup={filesByGroup}
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
              onCreateChildGroup={onCreateChildGroup}
              onGroupSectionDrop={onGroupSectionDrop}
            />
          ))}
        </>
      )}
    </section>
  )
}
