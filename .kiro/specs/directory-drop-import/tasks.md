# Implementation Plan: Directory Drop Import

> Status: Draft

## Overview

Implement directory drop import by creating a pure traversal module, extending the DB layer with group-reuse and batch-create functions, modifying DropZone to detect directories via `webkitGetAsEntry`, and wiring the flow through App. Property tests validate correctness properties from the design.

## Tasks

- [ ] 1. Create directory traversal module
  - [ ] 1.1 Create `src/lib/directoryImport.ts` with `CollectedFile` interface, `isReadableEntry`, and `collectFilesFromDirectory`
    - Define `CollectedFile` type (`name: string`, `content: string`)
    - Implement `isReadableEntry` reusing same extension/MIME logic as DropZone's `isReadableFile`
    - Implement `collectFilesFromDirectory` with BFS queue, depth ≤ 10, maxFiles ≤ 200, repeated `readEntries` calls until empty
    - Skip files that fail to read or have empty/whitespace-only basenames
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 4.4, 6.1_

  - [ ] 1.2 Write property tests for traversal logic (`src/lib/__tests__/directoryImport.property.test.ts`)
    - **Property 7: Readability filter** — only `.md`, `.markdown`, `.txt` or matching MIME types pass
    - **Property 8: Depth-limited traversal** — entries beyond depth 10 never visited
    - **Property 9: File count cap** — output length never exceeds 200
    - **Property 10: Error resilience** — failing files skipped, rest imported
    - **Property 5: Whitespace directory names rejected** — empty/whitespace basenames skipped
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.6, 4.4, 6.1, 6.2**

- [ ] 2. Extend DB layer for directory group operations
  - [ ] 2.1 Add `findOrCreateDirectoryGroup` to `src/db/schema.ts`
    - Trim name, reject empty/whitespace (return `null`)
    - Cap at 255 characters after trim
    - Query existing root group by exact name match (case-sensitive, `parentId = null`)
    - If found, return existing ID without modifying `sortOrder`
    - If not found, create with `sortOrder = max(root sortOrders) + 1`, `parentId = null`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 2.2 Add `createFilesInGroup` to `src/db/schema.ts`
    - Accept `groupId` and array of `{ name, content }`
    - Create each file record with `groupPlacement = 'auto'`, one version with `source = 'drop'`
    - Use transaction for atomicity
    - Return created `FileRecord[]`
    - _Requirements: 3.4, 4.1, 4.2, 4.3_

  - [ ] 2.3 Write property tests for group creation/reuse (`src/db/__tests__/directoryGroup.property.test.ts`)
    - **Property 2: Group name derivation** — result equals trimmed + truncated input, parentId = null
    - **Property 3: Group reuse idempotence** — matching name returns same ID, sortOrder unchanged
    - **Property 4: Group sort order assignment** — new group gets max(existing) + 1
    - **Property 5: Whitespace directory names rejected** — returns null for whitespace-only
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

- [ ] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Modify DropZone to detect and dispatch directories
  - [ ] 4.1 Update `src/components/DropZone.tsx` to add `onDirectories` prop and directory detection
    - Add `onDirectories?: (entries: FileSystemDirectoryEntry[]) => void` to Props
    - In `onDrop`, when `webkitGetAsEntry()` is available, classify each `DataTransferItem`
    - Collect `isDirectory` entries into directory list, `isFile` entries into file list
    - Fire `onDirectories` for directories, existing `onFiles` for files
    - Fallback: if `webkitGetAsEntry` unavailable, use existing `DataTransfer.files` path
    - Continue ignoring internal library drags
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 4.2 Write unit tests for DropZone directory detection
    - Test `webkitGetAsEntry` fallback behaviour (Req 1.4)
    - Test internal drag guard still works (Req 1.3)
    - Test mixed drop dispatches both callbacks independently (Req 1.2)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 5. Wire directory import flow in App
  - [ ] 5.1 Add `onDirectoriesDropped` handler in `src/App.tsx`
    - Import `collectFilesFromDirectory` from `src/lib/directoryImport`
    - Import `findOrCreateDirectoryGroup` and `createFilesInGroup` from `src/db/schema`
    - For each directory entry: get group ID, collect files, batch-create, render last file
    - Handle empty results (bump library, leave pane unchanged)
    - Handle DB failure (render in-memory, show `persistError` warning)
    - Pass handler to `DropZone` as `onDirectories` prop
    - _Requirements: 5.1, 5.2, 5.3, 6.3_

  - [ ] 5.2 Write integration property tests (`src/db/__tests__/directoryImportIntegration.property.test.ts`)
    - **Property 1: Flat import invariant** — at most one root group created, all files share same groupId
    - **Property 6: File record shape** — name = basename, groupPlacement = 'auto', one version with source = 'drop'
    - **Property 11: Mixed drop dispatch** — files and directories processed independently
    - **Validates: Requirements 2.3, 3.4, 4.1, 4.2, 4.3, 7.1, 7.2, 1.2**

- [ ] 6. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- `fast-check` and `fake-indexeddb` already in devDependencies

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2"] }
  ]
}
```
