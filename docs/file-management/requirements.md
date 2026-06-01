# File Management — Requirements

> Status: Accepted
> Accepted by: retroactive documentation
> Accepted on: 2026-06-01

## Glossary

| Term | Definition |
|------|-----------|
| Drop | Dragging a file from the OS file system onto the application |
| File record | Logical entity in IndexedDB representing a named document |
| Version | Immutable snapshot of file content at a point in time |
| Group | Named organizational container for files and other groups in the library sidebar |
| Sub-group | A group whose `parentId` references another group |
| Root group | A group with no parent (`parentId` is null) — displayed at the top level of the sidebar |
| Ancestor | Any group in the chain from a given group up to the root |
| Descendant | Any group reachable by following child relationships downward from a given group |
| Depth | Number of ancestor groups between a group and root level (root groups have depth 0) |
| Reparent | Moving a group from its current parent (or root) to a different parent (or root) |
| Subtree | A group together with all its descendant groups and the files contained in each |
| Library | Sidebar UI listing all persisted files organized by group |
| Merge | Combining versions from two file records with the same name into one |
| Detach | Splitting a single version out of a file into its own new file record |

## Requirements

### Requirement 1: File Drop Acceptance

**User Story:** As a user, I want to drag-and-drop markdown or text files onto the app, so that their content renders immediately.

#### Acceptance Criteria

1. WHEN one or more files are dropped on the main content area, THE system SHALL accept files with extensions `.md`, `.markdown`, `.txt` or MIME types `text/markdown`, `text/plain`.
2. WHEN files are dropped, THE system SHALL read each file's UTF-8 text content and render the last file in the main pane.
3. THE system SHALL ignore internal library drag operations (file, group, or version drags) on the drop zone.
4. WHEN a file is dropped, THE system SHALL create a new file record in the "Dropped" group with a single version.

### Requirement 2: IndexedDB Persistence

**User Story:** As a user, I want dropped files persisted in browser storage, so that I can reopen them offline later.

#### Acceptance Criteria

1. THE system SHALL store file records and version records in IndexedDB via Dexie.
2. Each file record SHALL contain: `id`, `name`, `currentVersionId`, `updatedAt`, `groupId` (nullable), `groupPlacement`.
3. Each version record SHALL contain: `id`, `fileId`, `content`, `createdAt`, `source` (one of: `drop`, `restore`, `library`, `split`).
4. IF IndexedDB is unavailable or write fails, THE system SHALL still render the dropped content and display a non-blocking warning.

### Requirement 3: File Library Sidebar

**User Story:** As a user, I want a sidebar listing all saved files organized by group, so that I can browse and reopen previous documents.

#### Acceptance Criteria

1. THE system SHALL display a sidebar with title "Saved" listing up to 200 files ordered by most recently updated.
2. Files SHALL be organized into sections: "Ungrouped" (files with no group) and named groups sorted by `sortOrder`.
3. WHEN a file row is clicked, THE system SHALL load and render its current (latest) version.
4. Each file row SHALL display the file name and last-updated timestamp.
5. Each section SHALL be collapsible via a chevron toggle.

### Requirement 4: Version History

**User Story:** As a user, I want to view and navigate version history for each file, so that I can access previous content snapshots.

#### Acceptance Criteria

1. WHEN the history toggle (▾) on a file row is clicked, THE system SHALL expand a panel showing all versions for that file, newest first.
2. Each version row SHALL display: ordinal label (v1, v2, ...), creation timestamp, and source type.
3. WHEN a version row is clicked, THE system SHALL render that version's content in the main pane.
4. THE active file and version SHALL be visually highlighted in the library.

### Requirement 5: Version Comparison (Diff)

**User Story:** As a user, I want to compare two versions of a file, so that I can see what changed between drops.

#### Acceptance Criteria

1. WHEN a file has 2+ versions and history is expanded, THE system SHALL display a "Compare" UI with two version selectors and a "Show diff" button.
2. WHEN "Show diff" is clicked, THE system SHALL open a modal displaying a unified diff (using the `diff` library).
3. THE diff modal SHALL syntax-highlight additions (green), deletions (red), hunks, and context lines.
4. IF combined content exceeds 400,000 characters, THE system SHALL truncate and display a warning.
5. THE diff modal SHALL close on Escape, Close button, or backdrop click.

### Requirement 6: Groups

**User Story:** As a user, I want to organize files into named groups that support nesting, so that I can categorize documents in a hierarchical folder structure.

#### Acceptance Criteria

1. THE system SHALL support creating named groups via a "+ Group" button (prompts for name).
2. THE system SHALL support renaming groups via double-click or a rename (✎) button.
3. THE system SHALL support deleting groups via a bin icon button on the group header (with confirmation); child groups are promoted to the deleted group's parent and files move to the parent group or Ungrouped.
4. Groups SHALL be reorderable via drag-and-drop of the grip handle (⠿) among siblings sharing the same `parentId`.
5. New OS drops SHALL always land in a group named "Dropped" (auto-created on first use).
6. THE Group_Table SHALL include a `parentId` field (nullable foreign key referencing another group's `id`). If `parentId` is null, the group is a root group displayed at the top level.
7. THE system SHALL support nesting to a maximum depth of 3 levels (root = depth 0, child = depth 1, grandchild = depth 2).
8. THE system SHALL maintain a `sortOrder` field scoped to siblings (groups sharing the same `parentId`).
9. THE system SHALL prevent circular references by rejecting any `parentId` assignment that would create a cycle.
10. IF `parentId` references a group `id` that does not exist, THE system SHALL treat the group as a root group.

### Requirement 7: Drag-and-Drop File Organization

**User Story:** As a user, I want to drag files between groups and reparent groups in the library, so that I can reorganize my documents and hierarchy freely.

#### Acceptance Criteria

1. WHEN a file row is dragged onto a group section, THE system SHALL move that file to the target group.
2. IF the target group already contains a file with the same name, THE system SHALL merge all versions into the existing file (append versions, keep newest as current, delete source file record).
3. WHEN a version row is dragged onto a group section or Ungrouped, THE system SHALL detach that version into a new file record in the target location.
4. IF detaching the last version from a file, THE system SHALL delete the now-empty source file record.
5. WHEN a group is dragged onto another group's drop section, THE system SHALL reparent the dragged group (and its entire subtree) as a child of the target group.
6. WHEN a group is dragged onto the root-level drop zone, THE system SHALL set the dragged group's `parentId` to null (making it a root group).
7. IF a group is dragged onto itself or any of its transitive descendants, THE system SHALL ignore the drop (no-op, prevents circular reference).
8. IF reparenting a group would result in any group in its subtree exceeding depth 2, THE system SHALL ignore the drop (no-op).
9. THE system SHALL treat a drop where source and destination share the same `parentId` as a reorder; a drop where the destination has a different `parentId` as a reparent.

### Requirement 8: File and Version Deletion

**User Story:** As a user, I want to delete files or individual versions, so that I can clean up my library.

#### Acceptance Criteria

1. THE system SHALL provide a hold-to-delete button (700ms hold) on each file row and version row.
2. WHEN a file is deleted, THE system SHALL remove the file record and all its versions from IndexedDB.
3. WHEN a version is deleted and it is the last version, THE system SHALL also delete the parent file record.
4. WHEN a version is deleted and other versions remain, THE system SHALL update `currentVersionId` to the newest remaining version.
5. IF the deleted file/version is currently displayed, THE system SHALL clear the main pane or switch to the file's new current version.

### Requirement 9: Active Document Display

**User Story:** As a user, I want the header to show which file and version I'm viewing, so that I have context.

#### Acceptance Criteria

1. WHEN a document is active, THE header SHALL display `{filename} · {version ordinal}` (e.g. "notes.md · v2").
2. WHEN no document is active, THE header SHALL display drop instructions.
3. IF a persistence error occurred, THE header SHALL display a non-blocking warning message.

### Requirement 10: Nested Group Rendering

**User Story:** As a user, I want to see sub-groups visually nested inside their parent groups, so that the hierarchy is clear.

#### Acceptance Criteria

1. THE Library_Sidebar SHALL render sub-groups indented within their parent group section, with each nesting level offset by 16 pixels of left padding relative to its parent.
2. WHEN a parent group is collapsed, THE Library_Sidebar SHALL hide all descendant groups and files of that parent.
3. WHEN a parent group is expanded, THE Library_Sidebar SHALL display its direct child groups and files.
4. Each nested group section SHALL be independently collapsible via a chevron toggle, defaulting to expanded on initial render.
5. THE Library_Sidebar SHALL display a vertical indentation guide line for each nesting level between depth 1 and the current group's depth.

### Requirement 11: Subtree Integrity on Group Move

**User Story:** As a user, I want all files and sub-groups inside a group to stay with it when I move the group, so that my organization is preserved.

#### Acceptance Criteria

1. WHEN a group is reparented, THE system SHALL update only the moved group's `parentId`; all descendant groups' `parentId` values remain unchanged.
2. WHEN a group is reparented, THE system SHALL preserve all files' `groupId` references within the subtree unchanged.
3. THE system SHALL execute reparent operations atomically so that either the move completes fully or no change is persisted.

### Requirement 12: Group Reorder Within Same Level

**User Story:** As a user, I want to reorder groups among their siblings via drag-and-drop, so that I can control display order at each level.

#### Acceptance Criteria

1. WHEN a group is dropped to a new position among its siblings (same `parentId`), THE system SHALL reassign contiguous integer `sortOrder` values (starting at 0) to all siblings sharing that `parentId`, reflecting the new sequence.
2. WHEN reordering, THE system SHALL persist all updated `sortOrder` values within a single database transaction.
3. IF a group is dropped onto its current position (no change), THE system SHALL leave all `sortOrder` values unchanged.

### Requirement 13: Circular Reference Prevention

**User Story:** As a developer, I want the system to prevent circular group references, so that the hierarchy remains a valid tree.

#### Acceptance Criteria

1. WHEN a reparent operation is initiated, THE system SHALL verify that the target group is not a descendant of the group being moved by traversing `parentId` references from the target up to root.
2. IF the reparent would create a circular reference, THE system SHALL reject the operation and leave the group unchanged.
3. IF a group is moved to itself, THE system SHALL reject the operation.

### Requirement 14: Group Creation in Nested Context

**User Story:** As a user, I want to create sub-groups inside an existing group, so that I can build hierarchy incrementally.

#### Acceptance Criteria

1. WHEN the "+ Group" button in the sidebar toolbar is activated, THE system SHALL prompt for a name and create the new group with `parentId` null and `sortOrder` one greater than the highest among existing root groups (or 0 if none exist).
2. THE system SHALL NOT present an inline "create child group" action on individual group headers; all group creation uses the global "+ Group" button.
3. IF the user provides a group name that is empty or contains only whitespace, THE system SHALL not create the group.

### Requirement 15: Group Deletion in Nested Context

**User Story:** As a user, I want deleting a group to handle its children predictably, so that I don't lose nested content.

#### Acceptance Criteria

1. WHEN a group with sub-groups is deleted, THE system SHALL reparent all direct child groups to the deleted group's parent, preserving their relative order.
2. WHEN a group with files is deleted, THE system SHALL move those files to the deleted group's parent group (or Ungrouped if the deleted group has no parent).
3. THE system SHALL perform deletion, file reassignment, and child-group reparenting atomically in a single transaction.
4. WHEN the user initiates deletion of a group that contains sub-groups or files, THE system SHALL display a confirmation dialog stating the count of child groups and files that will be relocated.
5. IF the user cancels the deletion confirmation, THE system SHALL leave the group and all its contents unchanged.

### Requirement 16: Schema Migration

**User Story:** As a developer, I want a non-destructive migration that adds nesting support to existing flat groups, so that current data is preserved.

#### Acceptance Criteria

1. THE migration declares Dexie version 5 schema for the groups table including `parentId` as an indexed column while retaining all existing indexed fields.
2. WHEN the migration runs on existing data, it sets `parentId` to null for all existing group rows, preserving them as root groups.
3. THE migration does not alter existing column values (`id`, `name`, `sortOrder`) on any group row.
4. IF the groups table is empty when the migration runs, it completes successfully without error.
