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
