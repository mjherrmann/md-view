/**
 * Clamp a raw width value to within [min, max].
 */
export function clampWidth(raw: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, raw));
}

/**
 * Compute the sidebar width from pointer position and drag start offset,
 * clamped to the allowed range.
 */
export function computeWidth(
  pointerX: number,
  dragStartOffset: number,
  minWidth: number,
  maxWidth: number,
): number {
  return clampWidth(pointerX - dragStartOffset, minWidth, maxWidth);
}
