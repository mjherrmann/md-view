# Implementation Plan: Nested Groups

> Status: Accepted
> Accepted by: Michael Herrmann
> Accepted on: 2025-07-14

## Overview

Implements hierarchical group nesting (max depth 3) by adding `parentId` to the groups table, building pure tree utilities, updating DB operations for reparent/reorder/delete-with-promotion, and refactoring the FileLibrary sidebar to render nested groups with indentation, guide lines, and updated drag-and-drop.

## Tasks

- [x] 1. Set up test infrastructure and schema migration
  - [x] 1.1 Install Vitest, fast-check, and fake-indexeddb
    - Add `vitest`, `@vitest/coverage-v8`, `fast-check`, and `fake-indexeddb` as dev dependencies
    - Create `vitest.config.ts` with jsdom environment and setup file that imports `fake-indexeddb/auto`
    - Add `"test": "vitest --run"` script to package.json
    - _Requirements: 9.1_

  - [x] 1.2 Add Dexie v5 schema migration with `parentId`
    - Add `parentId: number | null` to `GroupRecord` interface
    - Declare `version(5)` with groups store `'++id, name, sortOrder, parentId'`
    - Write upgrade function that sets `parentId = null` on all existing rows where `parentId === undefined`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 1.3 Write property test for migration preserving existing data
    - **Property 8: Migration preserves existing data**
    - Generate arbitrary `GroupRecord[]` arrays (without parentId), run upgrade logic, assert all rows gain `parentId === null` with unchanged `id`, `name`, `sortOrder`
    - **Validates: Requirements 9.2, 9.3**

- [x] 2. Implement group tree utilities
  - [x] 2.1 Create `src/db/groupTree.ts` with `buildGroupMaps`
    - Implement `buildGroupMaps(groups: GroupRecord[]): { byId, childrenByParent }` building both lookup maps from flat array
    - Sort children arrays by `sortOrder`
    - _Requirements: 1.1, 1.5_

  - [x] 2.2 Implement `computeDepth` and `getAncestorIds`
    - `computeDepth` walks `parentId` chain counting hops; returns 0 for root groups
    - `getAncestorIds` returns ordered array from immediate parent up to root
    - Guard against orphan parentId (treat as root)
    - _Requirements: 1.2, 1.3, 1.7_

  - [x] 2.3 Implement `getDescendantIds`
    - BFS/DFS over `childrenByParent` map collecting all transitive child IDs
    - _Requirements: 4.1, 4.2_

  - [x] 2.4 Implement `validateReparent`
    - Return `null` if valid, descriptive error string if invalid
    - Check: self-reference, cycle (target is descendant of group), depth overflow (targetDepth + 1 + subtreeMaxDepth > 3)
    - Moving to root (targetParentId === null) always passes cycle check
    - _Requirements: 1.4, 1.6, 3.3, 3.4, 3.5, 6.1, 6.2, 6.3_

  - [x] 2.5 Write property test for depth invariant
    - **Property 1: Depth invariant**
    - Generate arbitrary valid trees, apply sequences of createChild and reparent operations, assert no group exceeds depth 3
    - **Validates: Requirements 1.4, 3.5**

  - [x] 2.6 Write property test for circular reference prevention
    - **Property 2: Circular reference prevention**
    - Generate trees and arbitrary reparent attempts (including invalid ones targeting self/descendants), assert invalid attempts are rejected and tree unchanged
    - **Validates: Requirements 1.6, 3.3, 3.4, 6.1, 6.2, 6.3**

  - [x] 2.7 Write property test for subtree integrity on reparent
    - **Property 3: Subtree integrity on reparent**
    - After valid reparent, assert only moved group's `parentId` changed; all descendant `parentId` values and file `groupId` values unchanged
    - **Validates: Requirements 4.1, 4.2**

- [x] 3. Implement database operations for nested groups
  - [x] 3.1 Implement `createChildGroup`
    - Accept `name` and `parentId`; validate name not empty/whitespace; validate depth < 3 for parent
    - Assign `sortOrder` = max among siblings + 1 (or 0 if first child)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 3.2 Implement `reparentGroup`
    - Wrap in Dexie transaction; call `validateReparent` first; update only the moved group's `parentId`; assign `sortOrder` at end of new siblings
    - _Requirements: 3.1, 3.6, 3.7, 4.1, 4.4_

  - [x] 3.3 Implement `reorderSiblings`
    - Accept `parentId` and `orderedIds[]`; assign contiguous `sortOrder` 0..N-1 in transaction
    - No-op if order unchanged
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 3.4 Implement `deleteGroupWithPromotion`
    - In single transaction: promote direct child groups to deleted group's parent, move files to parent (or null), delete group, recompute sibling sortOrder
    - Return `{ promotedGroupIds, promotedFileIds }` for confirmation UI
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 3.5 Write property test for contiguous sibling sortOrder
    - **Property 4: Contiguous sibling sortOrder**
    - After any mutation sequence (create, reparent, reorder, delete), assert siblings sharing each parentId have sortOrder 0..N-1 with no gaps/duplicates
    - **Validates: Requirements 1.5, 5.1**

  - [x] 3.6 Write property test for whitespace group name rejection
    - **Property 6: Whitespace group name rejection**
    - Generate whitespace-only strings, assert `createChildGroup` rejects them and group list unchanged
    - **Validates: Requirements 7.4**

  - [x] 3.7 Write property test for deletion promotes children and files
    - **Property 7: Deletion promotes children and files**
    - Delete arbitrary group G with parent P; assert all G's children have parentId = P and all G's files have groupId = P
    - **Validates: Requirements 8.1, 8.2**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Refactor FileLibrary for recursive nested rendering
  - [x] 5.1 Create `GroupNode` recursive component
    - Extract group section rendering into `GroupNode` component accepting `group`, `depth`, `childrenByParent`, `filesByGroup` props
    - Recursively render child groups; apply 16px left padding per depth level
    - Hide "create child group" action when depth >= 3
    - _Requirements: 2.1, 2.3, 2.4, 7.3_

  - [x] 5.2 Add indentation guide lines via CSS
    - Add `::before` pseudo-element on nested group sections for vertical guide lines
    - One guide line per nesting level between depth 1 and current depth
    - _Requirements: 2.5_

  - [x] 5.3 Implement collapse/expand for nested groups
    - Reuse existing `collapsedSections` set keyed by group ID
    - When parent collapsed, hide all descendant groups and files
    - Default to expanded state
    - _Requirements: 2.2, 2.4_

  - [x] 5.4 Add "Create child group" context action
    - Show button/action on group headers at depth < 3
    - Prompt for name, call `createChildGroup` with parent's ID
    - _Requirements: 7.2, 7.3, 7.4_

- [x] 6. Update drag-and-drop for reparent detection
  - [x] 6.1 Implement reparent vs reorder classification in drop handler
    - Compare dragged group's current `parentId` with target section's `parentId`
    - Same parentId → reorder; different → reparent via `validateReparent` + `reparentGroup`
    - _Requirements: 5.2, 3.1, 3.2_

  - [x] 6.2 Handle invalid drops gracefully
    - If `validateReparent` returns error, silently ignore drop (no-op)
    - Self-drop and descendant-drop produce no state change
    - _Requirements: 3.3, 3.4, 3.5, 6.2, 6.3_

  - [x] 6.3 Write property test for reorder vs reparent classification
    - **Property 5: Reorder vs reparent classification**
    - Generate drop scenarios; assert same-parentId → reorder, different-parentId → reparent
    - **Validates: Requirements 5.2**

- [x] 7. Implement deletion confirmation dialog
  - [x] 7.1 Create confirmation dialog for nested group deletion
    - Show count of direct child groups and files that will be relocated
    - On confirm → call `deleteGroupWithPromotion`; on cancel → no-op
    - Replace existing `window.confirm` with richer dialog
    - _Requirements: 8.4, 8.5_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- The project currently has no test framework; task 1.1 bootstraps Vitest + fast-check
- All DB operations use Dexie transactions for atomicity
- Tree utilities are pure functions (no DB access) for easy testing

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4"] },
    { "id": 5, "tasks": ["2.5", "2.6", "2.7", "3.1"] },
    { "id": 6, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 7, "tasks": ["3.5", "3.6", "3.7"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 10, "tasks": ["6.1", "6.2"] },
    { "id": 11, "tasks": ["6.3", "7.1"] }
  ]
}
```
