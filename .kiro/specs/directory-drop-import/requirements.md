# Requirements Document

> Status: Draft

## Introduction

Extends the existing DropZone to accept filesystem directories dropped from the OS. When a directory is dropped, the system creates a group named after the directory and imports all readable files found within it. This builds on the existing file drop flow (Requirement 1 in `docs/file-management/requirements.md`) and the group system (Requirement 6).

## Glossary

| Term | Definition |
|------|-----------|
| Directory_Drop | An OS drag-and-drop operation where the dragged item is a filesystem directory (folder) rather than an individual file |
| Directory_Entry | A single entry obtained from a dropped directory via the File System Access API (`DataTransferItem.webkitGetAsEntry()`) |
| Recursive_Traversal | Reading all file entries within a directory and its subdirectories |
| Drop_Group | The group created (or reused) to hold files imported from a dropped directory |

## Requirements

### Requirement 1: Directory Detection on Drop

**User Story:** As a user, I want to drop a filesystem directory onto the app, so that I can import all its files at once without dragging them individually.

#### Acceptance Criteria

1. WHEN a DataTransfer item represents a directory (detected via `webkitGetAsEntry()` returning a `FileSystemDirectoryEntry`), THE DropZone SHALL treat the drop as a directory import rather than a single-file import.
2. WHEN a drop contains a mix of files and directories, THE DropZone SHALL process each item independently: individual files follow the existing single-file drop flow, and directories follow the directory import flow.
3. THE DropZone SHALL continue to ignore internal library drag operations (file, group, or version drags) regardless of whether the drop would otherwise be treated as a directory import.
4. IF `webkitGetAsEntry()` is unavailable in the browser, THE DropZone SHALL fall back to treating the DataTransfer items via the standard `DataTransfer.files` list (directory items that cannot be read as files are silently skipped).

### Requirement 2: Group Creation from Directory Name

**User Story:** As a user, I want the imported directory to appear as a named group in my library, so that files are organized the same way they were on disk.

#### Acceptance Criteria

1. WHEN a directory is dropped, THE system SHALL create a new group whose name matches the directory's folder name (trimmed of leading/trailing whitespace) up to a maximum of 255 characters after trimming.
2. IF a group with the same name (case-sensitive exact match, post-trim) already exists at root level, THEN THE system SHALL reuse that existing group instead of creating a duplicate and SHALL leave its current `sortOrder` unchanged.
3. THE created or reused group SHALL have `parentId` set to `null` (root-level group).
4. THE created group SHALL receive a `sortOrder` value one greater than the current maximum `sortOrder` among root groups (or 0 if no root groups exist).
5. IF the directory's folder name is empty or contains only whitespace after trimming, THEN THE system SHALL not create a group and SHALL not import files from that directory.

### Requirement 3: Recursive File Import

**User Story:** As a user, I want all readable files inside the dropped directory (including subdirectories) to be imported, so that I get a complete import of my folder contents.

#### Acceptance Criteria

1. WHEN a directory is dropped, THE system SHALL recursively traverse all entries within the directory and its subdirectories up to 10 levels deep.
2. THE system SHALL import only files matching the existing readability filter: extensions `.md`, `.markdown`, `.txt`, or MIME types `text/markdown`, `text/plain`.
3. THE system SHALL skip entries that are not readable files (binary files, unsupported extensions, empty directories).
4. WHEN readable files are found, THE system SHALL read each file's UTF-8 text content and create a file record with a single version (source: `drop`) in the target group.
5. IF no readable files exist within the dropped directory, THE system SHALL still create the group but leave it empty.
6. WHEN a directory contains more than 200 readable files, THE system SHALL import only the first 200 files encountered during traversal and discard the rest.

### Requirement 4: File Naming in Imported Group

**User Story:** As a user, I want imported files to retain recognizable names, so that I can identify them in the library.

#### Acceptance Criteria

1. THE system SHALL use the file's basename (the final path component including extension, without any directory prefix) as the `name` field of the created file record.
2. IF multiple files in the directory tree share the same basename, THEN THE system SHALL create separate file records for each (no automatic merging by name during import).
3. WHEN a file is imported from the directory, THE system SHALL set `groupPlacement` to `auto` on the created file record.
4. IF a file's basename after trimming leading and trailing whitespace is empty, THEN THE system SHALL skip that file and not create a file record for it.

### Requirement 5: Rendering After Directory Import

**User Story:** As a user, I want to see the last imported file rendered in the main pane after a directory drop, so that I get immediate visual feedback.

#### Acceptance Criteria

1. WHEN a directory import completes with one or more readable files, THE system SHALL render the content of the last file processed during recursive traversal in the main pane and set it as the active document.
2. WHEN a directory import finds no readable files, THE system SHALL leave the main pane and active document state unchanged.
3. WHEN a directory import completes, THE system SHALL refresh the library sidebar to display the new group with its imported files visible.

### Requirement 6: Error Handling for Directory Import

**User Story:** As a user, I want to know if something went wrong during a directory import, so that I understand which files were imported.

#### Acceptance Criteria

1. IF reading a specific file within the directory fails (permission error, encoding error), THE system SHALL skip that file and continue importing the remaining files.
2. IF all files within the directory fail to read, THE system SHALL leave the main pane unchanged and create the group empty.
3. IF IndexedDB is unavailable or a write fails during import, THE system SHALL still render the last readable file's content in memory and display a non-blocking warning in the header.

### Requirement 7: Subdirectory Handling

**User Story:** As a user, I want subdirectories within my dropped folder to be handled predictably, so that I know where to find imported files.

#### Acceptance Criteria

1. WHEN a dropped directory contains subdirectories, THE system SHALL recursively traverse subdirectories (respecting the 10-level depth limit from Requirement 3.1) and import all readable files into the same single group as the top-level files (flat import — no nested sub-groups created from subdirectory structure).
2. THE system SHALL NOT create nested sub-groups mirroring the directory's internal folder hierarchy during a directory drop import.
