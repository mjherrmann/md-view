import type { UseResizableReturn } from './useResizable'

interface ResizeHandleProps {
  isDragging: boolean
  isMobile: boolean
  handleProps: UseResizableReturn['handleProps']
}

export function ResizeHandle({ isDragging, isMobile, handleProps }: ResizeHandleProps): JSX.Element | null {
  if (isMobile) return null

  const className = isDragging
    ? 'resize-handle resize-handle--active'
    : 'resize-handle'

  return <div className={className} {...handleProps} />
}
