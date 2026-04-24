/** Custom DataTransfer types for in-app drags (avoid OS file drop handling). */
export const DND_FILE_MIME = 'application/x-mdviewer-file-id'
export const DND_GROUP_MIME = 'application/x-mdviewer-group-id'

export function isInternalFileDrag(t: DataTransfer) {
  return t.types.includes(DND_FILE_MIME)
}

export function isInternalGroupDrag(t: DataTransfer) {
  return t.types.includes(DND_GROUP_MIME)
}

export function isInternalLibraryDrag(t: DataTransfer) {
  return isInternalFileDrag(t) || isInternalGroupDrag(t)
}
