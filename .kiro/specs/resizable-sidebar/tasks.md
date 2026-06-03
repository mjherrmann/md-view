# Implementation Plan: Resizable Sidebar

> Status: Draft

## Overview

Implement a draggable resize handle between the FileLibrary sidebar and the main content pane. The work is split into: pure utility functions, the `useResizable` hook (state machine + keyboard), the `ResizeHandle` component, CSS styling, and App integration wiring.

## Tasks

- [x] 1. Implement pure width utilities and constants
  - [x] 1.1 Create `src/components/resize/constants.ts` with DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH_RATIO, KEYBOARD_STEP, KEYBOARD_STEP_LARGE, MOBILE_BREAKPOINT
    - Export all constants as named exports
    - _Requirements: 4.1, 4.2, 5.1, 7.3, 7.4, 6.1_

  - [x] 1.2 Create `src/components/resize/clampWidth.ts` with `clampWidth` and `computeWidth` pure functions
    - `clampWidth(raw, min, max)` → `Math.min(max, Math.max(min, raw))`
    - `computeWidth(pointerX, dragStartOffset, minWidth, maxWidth)` → `clampWidth(pointerX - dragStartOffset, minWidth, maxWidth)`
    - _Requirements: 3.1, 4.1, 4.2, 4.3, 4.4_

  - [x] 1.3 Write property tests for `clampWidth` and `computeWidth`
    - **Property 1: Width calculation tracks pointer with offset**
    - **Validates: Requirements 3.1**
    - Create `src/components/resize/__tests__/clampWidth.property.test.ts`
    - Use fast-check to verify `computeWidth(pointerX, offset, min, max) === clamp(pointerX - offset, min, max)` for arbitrary numeric inputs

  - [x] 1.4 Write property test for width bounds invariant
    - **Property 2: Width bounds invariant**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 7.3, 7.4**
    - Create `src/components/resize/__tests__/widthBounds.property.test.ts`
    - For any raw value, `clampWidth` result is always within `[min, max]`

  - [x] 1.5 Write property test for keyboard resize delta correctness
    - **Property 3: Keyboard resize delta correctness**
    - **Validates: Requirements 7.3, 7.4**
    - Create `src/components/resize/__tests__/keyboardDelta.property.test.ts`
    - For any valid width w and step s (10 or 50), increase produces `clamp(w + s, min, max)` and decrease produces `clamp(w - s, min, max)`

- [x] 2. Implement the `useResizable` hook
  - [x] 2.1 Create `src/components/resize/useResizable.ts` with the state machine (idle → dragging → idle)
    - Track `width` state, `isDragging` state, `dragStartOffset` ref
    - On `pointerdown`: compute offset, set pointer capture, attach document-level `pointermove`/`pointerup`/`pointercancel` listeners, set `document.body.style.cursor = 'col-resize'` and `document.body.style.userSelect = 'none'`
    - On `pointermove`: compute new width via `computeWidth`, update state
    - On `pointerup`/`pointercancel`: release capture, remove listeners, revert body styles, set `isDragging = false`
    - Return `{ width, isDragging, handleProps }` with ARIA attributes (role=separator, aria-orientation=vertical, aria-valuemin, aria-valuemax, aria-valuenow, aria-label="Resize sidebar", tabIndex=0)
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1_

  - [x] 2.2 Add keyboard resize support to `useResizable`
    - On `ArrowLeft`/`ArrowRight`: adjust width by KEYBOARD_STEP (10px), clamped
    - On `Shift+ArrowLeft`/`Shift+ArrowRight`: adjust width by KEYBOARD_STEP_LARGE (50px), clamped
    - _Requirements: 7.3, 7.4_

  - [x] 2.3 Add mobile breakpoint listener to `useResizable`
    - Use `window.matchMedia('(max-width: 768px)')` to detect narrow viewport
    - If match triggers during drag: cancel drag, revert body styles, remove listeners
    - Expose `isMobile` boolean so ResizeHandle can conditionally render
    - _Requirements: 6.1, 6.3_

  - [x] 2.4 Write unit tests for `useResizable` hook
    - Test default width is 272px
    - Test drag start sets body cursor + user-select; drag end reverts
    - Test pointerup/pointercancel ends drag
    - Test keyboard ArrowRight increases by 10px, Shift+ArrowLeft decreases by 50px
    - Test mobile breakpoint cancels active drag
    - _Requirements: 2.2, 2.3, 3.3, 3.4, 5.1, 6.3, 7.3, 7.4_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the `ResizeHandle` component and styles
  - [x] 4.1 Create `src/components/resize/ResizeHandle.tsx`
    - Render a `<div>` with class `resize-handle` and spread `handleProps`
    - Add modifier class `resize-handle--active` when `isDragging` is true
    - Return `null` when `isMobile` is true (handle not in DOM on narrow viewports)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 7.1, 7.2_

  - [x] 4.2 Add resize handle CSS to `src/App.css`
    - `.resize-handle`: width 2px visible + padding to 8px hit area, full height, background contrasting with sidebar/content, cursor `col-resize`
    - `.resize-handle:hover`, `.resize-handle--active`: highlight background colour
    - `@media (max-width: 768px)`: hide handle (not needed since component returns null, but defensive)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1_

  - [x] 4.3 Write unit tests for ResizeHandle component
    - Test handle renders with correct ARIA attributes (role=separator, aria-orientation, aria-valuemin, aria-valuemax, aria-valuenow, aria-label)
    - Test handle returns null at viewport ≤ 768px
    - Test hover shows col-resize cursor (CSS class)
    - _Requirements: 1.1, 1.4, 6.1, 7.1, 7.2_

- [x] 5. Wire everything together in App.tsx
  - [x] 5.1 Integrate `useResizable` and `ResizeHandle` in App.tsx
    - Call `useResizable({ defaultWidth: 272, minWidth: 120, maxWidthRatio: 0.5 })`
    - Pass `style={{ width }}` to `FileLibrary` (add `style` prop to FileLibrary's Props type)
    - Render `<ResizeHandle>` between FileLibrary and DropZone inside `.app__body`
    - _Requirements: 1.1, 5.1_

  - [x] 5.2 Update FileLibrary to accept and apply inline `style` prop
    - Add optional `style?: React.CSSProperties` to Props
    - Spread onto the `<aside>` element
    - Remove or relax the fixed `width: 17rem` in CSS (use as fallback via custom property)
    - _Requirements: 5.1, 6.2_

  - [x] 5.3 Update `.app__body` and `.file-library` CSS for dynamic width
    - Ensure `.app__body` flex layout respects inline width on sidebar
    - Content pane takes remaining space (`flex: 1`)
    - Preserve existing mobile stacked layout at ≤ 768px (sidebar full width, max-height 8rem, bottom border)
    - _Requirements: 5.1, 6.2_

  - [x] 5.4 Write integration tests for full resize flow
    - Render App, simulate drag on handle, verify sidebar width changes
    - Verify mobile breakpoint: no handle rendered, column layout preserved
    - _Requirements: 1.1, 3.1, 6.1, 6.2_

- [x] 6. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all tasks produce `.ts` / `.tsx` files

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1", "5.2", "5.3"] },
    { "id": 5, "tasks": ["5.4"] }
  ]
}
```
