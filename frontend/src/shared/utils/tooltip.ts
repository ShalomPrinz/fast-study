import type { ReactNode } from 'react'

export type TooltipPlacement = 'top' | 'bottom' | 'inline-start' | 'inline-end'

// Call sites pass a hint conditionally, so an absent or blank one means no tooltip at all.
export function hasTooltipContent(content: ReactNode): boolean {
  if (content == null || typeof content === 'boolean') return false
  if (typeof content === 'string') return content.trim() !== ''
  return true
}

// Floating UI places by physical side; the logical sides flip under an RTL document.
export function physicalPlacement(
  placement: TooltipPlacement,
  rtl: boolean,
): 'top' | 'bottom' | 'left' | 'right' {
  if (placement === 'inline-start') return rtl ? 'right' : 'left'
  if (placement === 'inline-end') return rtl ? 'left' : 'right'
  return placement
}

// A popover's outside-press check: a hint is portaled to <body>, so pressing in one (to select its
// text) would otherwise read as outside the menu its anchor sits in.
export function isOutsidePress(container: Element | null, target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return true
  if (container?.contains(target)) return false
  const el = target instanceof Element ? target : target.parentElement
  return !el?.closest('.tooltip')
}

// Where a drag-select that started in a hint ends while the pointer is outside the hint's text box:
// above it the text's start, below it the end, beside it the same line clamped into the box.
export function clampedSelectPoint(
  box: { left: number; top: number; right: number; bottom: number },
  x: number,
  y: number,
): 'start' | 'end' | { x: number; y: number } | null {
  if (y < box.top) return 'start'
  if (y > box.bottom) return 'end'
  if (x >= box.left && x <= box.right) return null
  return { x: Math.min(Math.max(x, box.left + 1), box.right - 1), y }
}
