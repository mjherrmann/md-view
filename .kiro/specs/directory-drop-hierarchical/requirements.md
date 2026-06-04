# Requirements Document

> Status: Draft

## Introduction

Replaces the flat directory-drop import (Requirement 7 in `.kiro/specs/directory-drop-import/requirements.md`) with a hierarchical import that mirrors a dropped directory's folder structure as nested groups. Also raises the system-wide maximum nesting depth from 3 to 6 (superseding Requirement 1.4 in `.kiro/specs/nested-groups/requirements.md`). Re-dropping the same directory recursively merges with the existing group tree rather than duplicating.

Affected current-state: `docs/file-management/`, nested-groups spec (depth limit), directory-drop-import spec (flat import behaviour).

## Glossary

| Term | Definition |
|------|-----------|
| Hierarchical_Import | A directory drop operation that mirrors the source folder's subdirectory structure as nested groups in the library |
| MAX_DEPTH | The system-wide maximum nesting depth for groups, measured from root (depth 0) to the deepest allowed level |
| Recursive_Merge | Re-importing a directory tree into an existing group hierarchy by reusing groups with matching names at each level rather than creating duplicates |
| Same_Name_Reuse | Finding an existing child group with the same name (case-sensitive, post-trim) under the same parent and returning it instead of creating a new group |
| Flatten_Point | The deepest allowed group (at MAX_DEPTH − 1); files from source directories beyond this level are placed into this group |
| Import_Summary_Toast | A brief, non-blocking notification shown after import completion reporting counts of groups and files created |
| File_Cap | The maximum number of file records that a single directory import operation creates (200) |

## Requirements

### Requirement 1: Increased Maximum Nesting Depth

**User Story:** As a user, I want deeper nesting (up to 6 levels), so that hierarchical directory imports can represent realistically deep folder structures.

#### Acceptance Criteria

1. THE System SHALL support group nesting to a maximum depth of 6 levels (root = depth 0 through depth 5).
2. WHEN `createChildGroup` is called with a parent at depth 5, THE System SHALL reject the operation with a descriptive error stating that maximum depth would be exceeded.
3. WHEN `validateReparent` checks depth overflow, THE System SHALL use 6 as the maximum depth constant instead of 3.
4. THE Library_Sidebar SHALL present the "create child group" action only on groups at depth less than 5.
5. THE System SHALL enforce the depth limit of 6 consistently across all code paths: `createChildGroup`, `validateReparent`, `buildGroupMaps` depth calculations, and UI depth checks.

### Requirement 2: Hierarchical Directory Structure Mirroring

**User Story:** As a user, I want a dropped directory's folder hierarchy to appear as nested groups in my library, so that my on-disk organization is preserved after import.

#### Acceptance Criteria

1. WHEN a directory is dropped, THE System SHALL create nested groups mirroring the source directory's subdirectory structure, with each subdirectory becoming a child group of its parent directory's group.
2. WHEN the source directory tree has depth D (where D ≤ 6 counting the root directory as level 1), THE System SHALL create groups for each level up to group depth 5 (root directory group at depth 0, its subdirectories at depth 1, and so on).
3. WHEN a source subdirectory maps to a group that would exceed depth 5, THE System SHALL place files from that subdirectory into the deepest allowed ancestor group (at depth 5) instead of creating a new group.
4. WHEN readable files exist at a given directory level, THE System SHALL assign those files to the group corresponding to that directory level.
5. THE System SHALL use the subdirectory's folder name (trimmed, capped at 255 characters) as the group name for each created child group.

### Requirement 3: Same-Name Group Reuse

**User Story:** As a user, I want re-dropping a directory or dropping directories with overlapping names to reuse existing groups, so that I don't get duplicate groups cluttering my library.

#### Acceptance Criteria

1. WHEN creating a group for a directory and a child group with the same name (case-sensitive, post-trim) already exists under the same parent, THE System SHALL reuse that existing group and SHALL NOT create a duplicate.
2. THE System SHALL apply same-name reuse at every level of the hierarchy, not only at the root level.
3. WHEN an existing group is reused, THE System SHALL leave its `sortOrder` and other properties unchanged.
4. WHEN no matching child group exists under the target parent, THE System SHALL create a new child group with `sortOrder` one greater than the current maximum among the parent's children (or 0 if the parent has no children).

### Requirement 4: Recursive Merge on Re-Drop

**User Story:** As a user, I want re-dropping the same directory to merge new content into my existing group hierarchy, so that I can incrementally update my library without manual reorganization.

#### Acceptance Criteria

1. WHEN a directory is dropped and a root-level group with the same name already exists, THE System SHALL traverse the existing group hierarchy alongside the source directory tree, reusing matching groups at each level via same-name matching (Requirement 3).
2. WHEN new subdirectories appear in the re-dropped tree that have no matching existing child group, THE System SHALL create new child groups for those subdirectories.
3. WHEN a file with the same name (case-sensitive) already exists in the target group, THE System SHALL add a new version to that existing file record with `source = 'drop'` and update `currentVersionId` and `updatedAt` accordingly, rather than creating a duplicate file record.
4. WHEN a file has no same-name match in the target group, THE System SHALL create a new file record with an initial version as before.
5. THE System SHALL NOT delete existing files or groups during a recursive merge operation.

### Requirement 5: File Cap Across Import Tree

**User Story:** As a user, I want a predictable upper bound on how many files a single directory drop can import, so that my browser storage is not overwhelmed.

#### Acceptance Criteria

1. WHEN a directory import encounters more than 200 readable files across the entire source tree, THE System SHALL import only the first 200 files encountered during traversal and discard the rest.
2. THE System SHALL count files across all levels of the directory tree toward a single shared cap of 200 per import operation.
3. WHEN the file cap is reached, THE System SHALL still create all groups corresponding to directories traversed up to that point (groups are not subject to the file cap).

### Requirement 6: Import Summary Toast

**User Story:** As a user, I want brief feedback after a directory import completes, so that I know what was imported without interrupting my workflow.

#### Acceptance Criteria

1. WHEN a directory import operation completes, THE System SHALL display a non-blocking toast notification summarizing the result.
2. THE Import_Summary_Toast SHALL include the count of groups created or reused and the count of files imported (e.g. "Imported 3 groups, 12 files").
3. THE Import_Summary_Toast SHALL disappear automatically without requiring user interaction.
4. IF the file cap (200) was reached during import, THEN THE Import_Summary_Toast SHALL indicate that the cap was hit (e.g. "Imported 5 groups, 200 files (cap reached)").

### Requirement 7: Supersession of Flat Import Behaviour

**User Story:** As a developer, I want the hierarchical import to fully replace the flat import, so that there is one consistent directory import behaviour.

#### Acceptance Criteria

1. WHEN a directory is dropped, THE System SHALL perform hierarchical import (mirroring directory structure as nested groups) instead of flat import (all files into a single root group).
2. THE System SHALL NOT create a flat single-group import when a directory contains subdirectories.
3. THE System SHALL continue to import files from the root directory level into the root-level group (a directory with no subdirectories produces the same result as the previous flat import).

### Requirement 8: Traversal and Readability Rules

**User Story:** As a user, I want the same file filtering and traversal rules as before, so that only supported files are imported regardless of depth.

#### Acceptance Criteria

1. THE System SHALL recursively traverse all entries within the dropped directory and its subdirectories, creating groups as needed up to the depth limit.
2. THE System SHALL import only files matching the existing readability filter: extensions `.md`, `.markdown`, `.txt`, or MIME types `text/markdown`, `text/plain`.
3. THE System SHALL skip entries that are not readable files (binary files, unsupported extensions).
4. IF reading a specific file fails (permission error, encoding error), THE System SHALL skip that file and continue importing the remaining files.
5. THE System SHALL set `groupPlacement` to `auto` on all file records created during directory import.
6. THE System SHALL use the file's basename (final path component) as the `name` field of each created file record.

### Requirement 9: Error Handling

**User Story:** As a user, I want import errors to be handled gracefully without losing successfully imported content.

#### Acceptance Criteria

1. IF IndexedDB is unavailable or a write fails during import, THE System SHALL render the last readable file's content in memory and display a non-blocking warning.
2. IF all files within the directory fail to read, THE System SHALL still create the group hierarchy (empty groups) and display the import summary toast with 0 files.
3. IF the directory name (after trimming) is empty or whitespace-only, THEN THE System SHALL not create any groups and SHALL not import any files from that directory.
