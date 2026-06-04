# Implementation Plan: Directory Drop — Hierarchical Import

> Status: Draft

## Overview

Replace the flat directory-drop import with a hierarchical import that mirrors folder structure as nested groups. Raise MAX_DEPTH from 3 → 6, add `findOrCreateChildGroup`, build a tree-returning traversal, an import orchestrator, and a summary toast. Update existing tests affected by the depth constant change.

## Tasks

- [x] 1. Extract MAX_DEPTH constant and update depth references
  - [x] 1.1 Export `MAX_DEPTH = 6` from `src/db/groupTree.ts` and replace hardcoded `3` in `validateReparent`
    - Add `export const MAX_DEPTH = 6` near the top of the file
    - In `validateReparent`, replace the two occurrences of literal `3` with `MAX_DEPTH`
    - _Requirements: 1.1, 1.3, 1.5_
  - [x] 1.2 Update `createChildGroup` in `src/db/schema.ts` to use `MAX_DEPTH`
    - Import `MAX_DEPTH` from `./groupTree`
    - Replace `parentDepth >= 3` with `parentDepth >= MAX_DEPTH - 1`
    - Update the error message to reference `MAX_DEPTH` value
    - _Requirements: 1.2, 1.5_
  - [x] 1.3 Update existing depth invariant property test to assert MAX_DEPTH = 6
    - In `src/db/__tests__/depthInvariant.property.test.ts`, import `MAX_DEPTH` from `../groupTree`
    - Replace all hardcoded `3` references with `MAX_DEPTH`
    - Ensure the test generates trees respecting depth ≤ MAX_DEPTH and validates no group exceeds MAX_DEPTH
    - _Requirements: 1.1, 1.5_

- [x] 2. Implement `findOrCreateChildGroup` in `src/db/schema.ts`
  - [x] 2.1 Add `findOrCreateChildGroup(dirName, parentId)` function
    - Trim name, reject empty/whitespace (return null)
    - Cap at 255 chars after trim
    - Query groups where `name === capped && parentId === parentId`
    - If found, return `{ id, created: false }`
    - Otherwise compute `sortOrder = max(sibling sortOrders) + 1`, insert, return `{ id, created: true }`
    - Wrap in `db.transaction('rw', [db.groups], ...)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 2.2 Refactor `findOrCreateDirectoryGroup` to delegate to `findOrCreateChildGroup`
    - Body becomes: `const result = await findOrCreateChildGroup(dirName, null); return result?.id ?? null;`
    - Verify existing tests still pass (no behavioral change for root-level usage)
    - _Requirements: 7.3_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create `src/lib/directoryTraversal.ts` with tree-returning traversal
  - [x] 4.1 Define `DirectoryNode` and `TraversalResult` interfaces, implement `traverseDirectoryTree`
    - Export `DirectoryNode { name, files: CollectedFile[], children: DirectoryNode[] }`
    - Export `TraversalResult { root, totalFilesFound, capReached }`
    - BFS/DFS building a tree of DirectoryNode
    - Reuse `isReadableEntry`, `isReadableFile`, `readAllEntries`, `fileEntryToFile` from `directoryImport.ts` (re-export or import)
    - Enforce global file cap (default 200) across all levels
    - Safety max traversal depth of 20
    - Skip files that fail to read
    - _Requirements: 2.1, 5.1, 5.2, 8.1, 8.2, 8.3, 8.4_
  - [x] 4.2 Write property test: file cap enforcement (Property 7)
    - Create `src/lib/__tests__/directoryTraversal.property.test.ts`
    - **Property 7: File cap enforcement**
    - Generate mock directory trees with N > 200 readable files
    - Assert exactly 200 files collected, groups still traversed
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 5. Create `src/lib/importOrchestrator.ts`
  - [x] 5.1 Implement `importDirectoryTree(tree, options?)` returning `ImportSummary`
    - Export `ImportSummary { groupsCreated, groupsReused, filesImported, capReached }`
    - Recursive walk of `DirectoryNode` tree
    - At each node: call `findOrCreateChildGroup(node.name, parentId)` → track created/reused
    - Import files via `createFilesInGroup(groupId, node.files)`
    - When `currentDepth + 1 >= MAX_DEPTH`: flatten child files into current group via `collectAllFilesDeep`
    - Helper `collectAllFilesDeep(node)` gathers all files from subtree recursively
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 4.1, 4.2, 5.3_
  - [x] 5.2 Write property test: depth invariant under hierarchical import (Property 1)
    - In `src/db/__tests__/hierarchicalImport.property.test.ts`
    - **Property 1: Depth invariant under hierarchical import**
    - Generate arbitrary DirectoryNode trees of various depths
    - Import via `importDirectoryTree`, verify no group exceeds depth MAX_DEPTH - 1
    - **Validates: Requirements 1.1, 1.5, 2.2, 2.3**
  - [ ] 5.3 Write property test: structure mirroring (Property 2)
    - **Property 2: Structure mirroring**
    - Generate trees within depth limit, verify 1:1 correspondence between source dirs and groups
    - Group names match folder names (trimmed, capped 255)
    - **Validates: Requirements 2.1, 2.5, 7.1, 7.2, 7.3**
  - [ ] 5.4 Write property test: file assignment correctness (Property 3)
    - **Property 3: File assignment correctness**
    - For files at level L ≤ MAX_DEPTH - 1, verify `groupId` points to group at depth L, `groupPlacement = 'auto'`, `name = basename`
    - **Validates: Requirements 2.4, 8.5, 8.6**
  - [x] 5.5 Write property test: flatten-point assignment (Property 4)
    - **Property 4: Flatten-point assignment**
    - Generate trees with files beyond MAX_DEPTH - 1, verify files land in deepest allowed group
    - **Validates: Requirements 2.3, 5.3**
  - [x] 5.6 Write property test: same-name reuse idempotence (Property 5)
    - **Property 5: Same-name reuse idempotence**
    - Import same tree twice, verify zero new groups on second pass, no existing files deleted, same-name files get new version instead of duplicate record
    - **Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.3, 4.4, 4.5**
  - [x] 5.7 Write property test: import summary accuracy (Property 6)
    - **Property 6: Import summary accuracy**
    - Verify `groupsCreated + groupsReused` equals total `findOrCreateChildGroup` calls, `filesImported` equals DB file count delta
    - **Validates: Requirements 6.2, 6.4**
  - [x] 5.8 Write property test: whitespace directory name rejection (Property 8)
    - **Property 8: Whitespace directory name rejection**
    - Generate whitespace-only strings as root name, verify zero groups and zero files created
    - **Validates: Requirements 9.3**
  - [x] 5.9 Update `createFilesInGroup` with upsert semantics (version-update-on-re-drop)
    - For each file, query existing file record with same `name` AND same `groupId`
    - If found: add new version to existing file (`source = 'drop'`), update `currentVersionId` and `updatedAt`
    - If not found: create new file record + initial version (existing behavior)
    - Add `filesUpdated` counter to `ImportSummary`
    - Update `importDirectoryTree` to track `filesUpdated` from `createFilesInGroup` results
    - _Requirements: 4.3, 4.4_
    - _Depends on: 5.1_
  - [x] 5.10 Write property test: file version update on re-drop (Property 9)
    - **Property 9: File version update on re-drop**
    - Import tree, then re-import same tree with different file content
    - Verify: file record count unchanged (no duplicates), version count per file increases by 1
    - Verify: `currentVersionId` points to latest version, `updatedAt` updated
    - Verify: new version has `source = 'drop'` and new content
    - **Validates: Requirements 4.3, 4.4**
    - _Depends on: 5.9_

- [x] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Create `src/components/ImportSummaryToast.tsx`
  - [x] 7.1 Implement toast component with auto-dismiss
    - Define `ToastData { id, groupsCreated, groupsReused, filesImported, capReached }`
    - Props: `toasts: ToastData[], onDismiss: (id) => void`
    - Render message: "Imported {N} groups, {M} files" (N = groupsCreated + groupsReused)
    - Append "(cap reached)" if `capReached` is true
    - Auto-dismiss after 4 seconds via `useEffect` + `setTimeout`
    - Click to dismiss early
    - Position fixed bottom-right, stack multiple toasts
    - CSS transition for fade-out
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 8. Rewrite `onDirectoriesDropped` in `src/App.tsx`
  - [x] 8.1 Wire traversal + orchestrator + toast into App
    - Import `traverseDirectoryTree` from `./lib/directoryTraversal`
    - Import `importDirectoryTree` from `./lib/importOrchestrator`
    - Import `ImportSummaryToast` component
    - Add `toasts` state array and `addToast` / `dismissToast` helpers
    - Rewrite `onDirectoriesDropped`: for each entry, skip empty trimmed name, call `traverseDirectoryTree`, then `importDirectoryTree`, then `addToast` with summary, then render last imported file
    - Render `<ImportSummaryToast>` in App JSX
    - Handle IndexedDB failure: render last readable file in-memory + `setPersistError`
    - _Requirements: 2.1, 4.1, 6.1, 7.1, 9.1, 9.2, 9.3_

- [x] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout (project is Vite + React + TypeScript)
- `fake-indexeddb` and `fast-check` are already in devDependencies
- Existing `collectFilesFromDirectory` in `directoryImport.ts` is retained for backward compat but no longer called from App

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9"] },
    { "id": 7, "tasks": ["5.10", "7.1"] },
    { "id": 8, "tasks": ["8.1"] }
  ]
}
```
