import { createContext, useContext } from 'react'
import type { OverviewExtractor } from '@/types'

// One extractor row's shared concern: the extractor it renders + its expand/regenerate
// controls. Lets the header / steps reach the extractor without prop-drilling it.
export interface ExtractorValue {
  extractor: OverviewExtractor
  expanded: boolean
  toggleExpanded: () => void
  confirmRegenerate: () => void
}

export const ExtractorContext = createContext<ExtractorValue | null>(null)

export function useExtractor(): ExtractorValue {
  const ctx = useContext(ExtractorContext)
  if (!ctx) throw new Error('useExtractor must be used within an <ExtractorRow>')
  return ctx
}
