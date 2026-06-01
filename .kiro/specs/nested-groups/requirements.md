# Requirements Document

> Status: Accepted
> Accepted by: Michael Herrmann
> Accepted on: 2025-07-14

## Introduction

Extends the existing file-management system (documented in `docs/file-management/`) to support nested group hierarchies. Currently groups are flat — each group has `id`, `name`, `sortOrder` with no parent reference. This spec adds arbitrary-depth nesting: groups can contain sub-groups, groups can be reparented via drag-and-drop, and all children (files and sub-groups) travel with a moved group.

Affected current-state requirements: Requirement 6 (Groups) and Requirement 7 (Drag-and-Drop File Organization) in `docs/file-management/requirements.md`.

## Glossary

| Term | Definition |
|------|-----------|
| Group | Named organizational container for files and other groups in the library sidebar |
| Sub-group | A group whose `parentId` references another group |
| Root group | A group with no parent (`parentId` is null) — displayed at the top level of the sidebar |
| Ancestor | Any group in the chain from a given group up to the root |
| Descendant | Any group reachable by following child relationships downward from a given group |
| Depth | Number of ancestor groups between a group and root level (root groups have depth 0) |
| Reparent | Moving a group from its current parent (or root) to a different parent (or root) |
| Subtree | A group together with all its descendant groups and the files contained in each |

## Requirements

### Requirement 1: Group Hierarchy Data Model

**User Story:** As a user, I want groups to support nesting, so that I can organize documents in a hierarchical folder structure.

#### Acceptance Criteria

1. THE Group_Table SHALL include a `parentId` field (nullable foreign key referencing another group's `id`).
2. IF `parentId` is null, THEN THE System SHALL treat the group as a root group displayed at the top level of the sidebar.
3. IF `parentId` references a valid existing group, THEN THE System SHALL treat the group as a child of that parent group.
4. THE System SHALL support nesting to a maximum depth of 3 levels (root = depth 0, child = depth 1, grandchild = depth 2).
5. THE System SHALL maintain a `sortOrder` field scoped to siblings (groups sharing the same `parentId`).
6. THE System SHALL prevent circular references by rejecting any `parentId` assignment that would create a cycle (a group cannot be its own ancestor).
7. IF `parentId` references a group `id` that does not exist in the Group_Table, THEN THE System SHALL treat the group as a root group.

### Requirement 2: Nested Group Rendering

**User Story:** As a user, I want to see sub-groups visually nested inside their parent groups, so that the hierarchy is clear.

#### Acceptance Criteria

1. THE Library_Sidebar SHALL render sub-groups indented within their parent group section, with each nesting level offset by 16 pixels of left padding relative to its parent.
2. WHEN a parent group is collapsed, THE Library_Sidebar SHALL hide all descendant groups and files of that parent.
3. WHEN a parent group is expanded, THE Library_Sidebar SHALL display its direct child groups and files.
4. Each nested group section SHALL be independently collapsible via a chevron toggle, and SHALL default to the expanded state on initial render.
5. THE Library_Sidebar SHALL display a vertical indentation guide line for each nesting level between depth 1 and the current group's depth to indicate parent-child relationships.

### Requirement 3: Drag Group to Any Level (Reparent)

**User Story:** As a user, I want to drag a group into another group or back to root level, so that I can reorganize my hierarchy freely.

#### Acceptance Criteria

1. WHEN a group is dragged onto another group's drop section, THE System SHALL reparent the dragged group (and its entire subtree of descendants) as a child of the target group.
2. WHEN a group is dragged onto the root-level drop zone (Ungrouped section or top-level area), THE System SHALL set the dragged group's `parentId` to null (making it a root group).
3. IF a group is dragged onto itself, THEN THE System SHALL ignore the drop (no-op).
4. IF a group is dragged onto any of its transitive descendants (children, grandchildren, etc. at any depth), THEN THE System SHALL ignore the drop (prevent circular reference).
5. IF reparenting a group would result in any group in its subtree exceeding depth 2 (maximum 3 levels), THEN THE System SHALL ignore the drop (no-op).
6. WHEN a group is reparented, THE System SHALL assign a `sortOrder` value equal to the current maximum `sortOrder` among the target's existing children plus one, placing it at the end of the target's children list.
7. THE System SHALL persist the reparent operation atomically in a single IndexedDB transaction.

### Requirement 4: Subtree Integrity on Group Move

**User Story:** As a user, I want all files and sub-groups inside a group to stay with it when I move the group, so that my organization is preserved.

#### Acceptance Criteria

1. WHEN a group is reparented, THE System SHALL update only the moved group's `parentId` to the new target and SHALL preserve all descendant groups' `parentId` references unchanged.
2. WHEN a group is reparented, THE System SHALL preserve all files' `groupId` references within the subtree unchanged (no file is reassigned to the new parent or any other group).
3. IF reparenting a group would create a cycle (target is the group itself or one of its descendants), THEN THE System SHALL reject the operation and leave the group's `parentId` unchanged.
4. WHEN a group is reparented, THE System SHALL execute the `parentId` update atomically so that either the move completes fully or no change is persisted.

### Requirement 5: Group Reorder Within Same Level

**User Story:** As a user, I want to reorder groups among their siblings via drag-and-drop, so that I can control display order at each level.

#### Acceptance Criteria

1. WHEN a group is dragged and dropped to a new position among its siblings (same `parentId`), THE System SHALL reassign contiguous integer `sortOrder` values (starting at 0) to all siblings sharing that `parentId`, reflecting the new sequence while preserving the relative order of non-moved siblings.
2. THE System SHALL treat a drop where the source and destination share the same `parentId` as a reorder operation, and a drop where the destination has a different `parentId` as a reparent operation.
3. WHEN reordering, THE System SHALL persist all updated `sortOrder` values within a single database transaction so that either all values are written or none are.
4. IF a group is dropped onto its current position (no change in sibling order), THEN THE System SHALL leave all `sortOrder` values unchanged and not trigger a persistence write.

### Requirement 6: Circular Reference Prevention

**User Story:** As a developer, I want the system to prevent circular group references, so that the hierarchy remains a valid tree.

#### Acceptance Criteria

1. WHEN a reparent operation is initiated, THE System SHALL verify that the target group is not a descendant of the group being moved by traversing `parentId` references from the target up to the root (a group with null `parentId`).
2. IF the reparent operation would create a circular reference, THEN THE System SHALL reject the operation and leave the group in its original position.
3. IF a group is moved to itself (target equals the group being moved), THEN THE System SHALL reject the operation and leave the group in its original position.

### Requirement 7: Group Creation Within Nested Context

**User Story:** As a user, I want to create sub-groups inside an existing group, so that I can build hierarchy incrementally.

#### Acceptance Criteria

1. WHEN the "+ Group" button in the sidebar toolbar is activated and no parent group context is targeted, THE System SHALL create the new group with `parentId` set to null and `sortOrder` set to one greater than the highest `sortOrder` among existing root-level groups, or 0 if none exist.
2. WHEN a "create child group" action is activated within a specific parent group's section, THE System SHALL create the new group as a child of that parent (setting `parentId` to the parent's `id`) and assign it a `sortOrder` one greater than the highest `sortOrder` among existing children of that same parent, or 0 if the parent has no children.
3. THE System SHALL NOT present the "create child group" action on groups already at depth 2 (maximum nesting reached).
4. IF the user provides a group name that is empty or contains only whitespace, THEN THE System SHALL not create the group and SHALL leave the group list unchanged.

### Requirement 8: Group Deletion in Nested Context

**User Story:** As a user, I want deleting a group to handle its children predictably, so that I don't lose nested content.

#### Acceptance Criteria

1. WHEN a group with sub-groups is deleted, THE System SHALL reparent all direct child groups to the deleted group's parent, inserting them at the deleted group's former sort position (preserving their relative order among themselves).
2. WHEN a group with files is deleted, THE System SHALL move those files to the deleted group's parent group, or to Ungrouped if the deleted group has no parent.
3. THE System SHALL perform deletion, file reassignment, and child-group reparenting atomically in a single transaction.
4. WHEN the user initiates deletion of a group that contains sub-groups or files, THE System SHALL display a confirmation dialog stating the count of direct child groups and files that will be relocated.
5. IF the user cancels the deletion confirmation, THEN THE System SHALL leave the group and all its contents unchanged.

### Requirement 9: Schema Migration

**User Story:** As a developer, I want a non-destructive migration that adds nesting support to existing flat groups, so that current data is preserved.

#### Acceptance Criteria

1. THE Migration SHALL declare a new Dexie version (version 5) schema for the groups table that includes `parentId` as an indexed column while retaining all existing indexed fields.
2. WHEN the migration runs on existing data, THE Migration SHALL set `parentId` to null for all existing group rows, preserving them as root groups.
3. THE Migration SHALL NOT alter existing column values (`id`, `name`, `sortOrder`) on any group row.
4. IF the groups table is empty when the migration runs, THEN THE Migration SHALL complete successfully without error.
