# Resizable Sidebar — Requirements

> Status: Accepted
> Accepted by: implementation complete
> Accepted on: 2026-06-03

## Introduction

The file library sidebar supports user-controlled resizing via a draggable separator between the sidebar and the main content pane. The separator provides a visual cursor affordance indicating that resizing is available.

## Glossary

| Term | Definition |
|------|-----------|
| Sidebar | The left-hand file library panel (`.file-library`) displaying saved files organized by group |
| Content_Pane | The main area to the right of the sidebar where markdown content is rendered |
| Resize_Handle | A narrow interactive element between the Sidebar and the Content_Pane that the user drags to change the sidebar width |
| Drag_Operation | A pointer-down followed by pointer-move interaction on the Resize_Handle that adjusts the sidebar width in real time |

## Requirements

### Requirement 1: Resize Handle Rendering

**User Story:** As a user, I want a visible separator between the sidebar and content pane, so that I can identify where to drag for resizing.

#### Acceptance Criteria

1. THE Resize_Handle renders as a vertical element between the Sidebar and the Content_Pane, spanning the full height of the panel area.
2. THE Resize_Handle has a minimum hit area of 8 CSS pixels wide to support comfortable pointer targeting.
3. THE Resize_Handle displays a visible border or background color that contrasts with the adjacent Sidebar and Content_Pane backgrounds in its resting state.
4. WHEN the pointer hovers over the Resize_Handle, THE Resize_Handle changes its cursor to a horizontal-resize cursor (col-resize) and applies a visual style change distinguishable from the resting state.

### Requirement 2: Cursor Affordance

**User Story:** As a user, I want the cursor to change when I hover over the separator, so that I know I can resize.

#### Acceptance Criteria

1. WHEN the pointer hovers over the Resize_Handle (an interactive hit zone of 8 pixels centered on the separator edge), THE Resize_Handle displays a `col-resize` cursor.
2. WHILE a Drag_Operation is active, THE document body displays a `col-resize` cursor regardless of pointer position.
3. WHEN the Drag_Operation ends, THE document body reverts the cursor style to `auto`.

### Requirement 3: Drag-to-Resize Interaction

**User Story:** As a user, I want to drag the separator left or right to change the sidebar width, so that I can allocate screen space as needed.

#### Acceptance Criteria

1. WHEN the user initiates a primary-button pointer-down on the Resize_Handle followed by pointer-move, THE Sidebar sets its width so that the right edge tracks the horizontal pointer position relative to the application body, preserving the initial offset between the pointer and the Sidebar edge at drag start.
2. WHILE a Drag_Operation is active, THE Sidebar width updates on every pointer-move event using inline style such that no frame exceeds 16 ms of layout work.
3. WHEN the pointer is released (pointer-up) or the pointer leaves the window (pointer-cancel), THE Drag_Operation ends and the Sidebar width remains at its last set value.
4. WHILE a Drag_Operation is active, THE system prevents text selection on the page.

### Requirement 4: Width Constraints

**User Story:** As a user, I want the sidebar to have sensible minimum and maximum widths, so that neither panel becomes unusably small.

#### Acceptance Criteria

1. WHILE a Drag_Operation is active, THE Sidebar does not shrink below 120 CSS pixels.
2. WHILE a Drag_Operation is active, THE Sidebar does not expand beyond 50% of the current application body width.
3. IF the pointer moves below the minimum bound during a Drag_Operation, THEN THE Sidebar width clamps to 120 CSS pixels.
4. IF the pointer moves above the maximum bound during a Drag_Operation, THEN THE Sidebar width clamps to 50% of the current application body width.

### Requirement 5: Default Width

**User Story:** As a user, I want the sidebar to start at a reasonable default width, so that it is usable without manual adjustment.

#### Acceptance Criteria

1. WHEN no previous width has been set by the user, THE Sidebar renders at a default width of 272 CSS pixels (equivalent to `17rem` at the browser-default `16px` root font size).

### Requirement 6: Responsive Behaviour

**User Story:** As a user on a narrow viewport, I want the resize handle hidden on mobile layout, so that I am not confused by an inactive control.

#### Acceptance Criteria

1. WHEN the viewport width is at or below 768 CSS pixels, THE Resize_Handle is not rendered in the DOM.
2. WHEN the viewport width is at or below 768 CSS pixels, THE Sidebar occupies the full available width, enforces a maximum height of 8 rem, replaces the right border with a bottom border, and stacks above the content pane in a column layout.
3. IF the viewport width transitions from above 768 CSS pixels to at or below 768 CSS pixels while a drag-resize is in progress, THEN THE System cancels the drag-resize operation and removes the Resize_Handle without persisting the in-progress width.

### Requirement 7: Accessibility

**User Story:** As a keyboard or assistive-technology user, I want the resize handle to be accessible, so that I can understand its purpose.

#### Acceptance Criteria

1. THE Resize_Handle is focusable via sequential keyboard navigation (tabindex="0") and has an ARIA role of `separator` with `aria-orientation="vertical"`, `aria-valuemin` corresponding to the minimum sidebar width, `aria-valuemax` corresponding to the maximum sidebar width, and `aria-valuenow` reflecting the current sidebar width in CSS pixels.
2. THE Resize_Handle has an `aria-label` attribute describing its function ("Resize sidebar").
3. WHILE the Resize_Handle has focus, WHEN the user presses the Left or Right arrow key, THE Sidebar width decreases or increases by 10 CSS pixels per keypress, clamped to the minimum and maximum width constraints.
4. WHILE the Resize_Handle has focus, WHEN the user presses Shift+Left or Shift+Right arrow key, THE Sidebar width decreases or increases by 50 CSS pixels per keypress, clamped to the minimum and maximum width constraints.
