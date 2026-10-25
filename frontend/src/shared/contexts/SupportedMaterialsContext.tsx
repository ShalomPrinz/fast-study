import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { SupportedExtensions } from '@/features/lectures/utils/materials'

const SupportedMaterialsContext = createContext<SupportedExtensions>(null)

// The extensions Gemini reads, held where every lecture surface can read them; null until the boot read answers.
export function SupportedMaterialsProvider({
  supported,
  children,
}: {
  supported: SupportedExtensions
  children: ReactNode
}) {
  return (
    <SupportedMaterialsContext.Provider value={supported}>
      {children}
    </SupportedMaterialsContext.Provider>
  )
}

export function useSupportedMaterials(): SupportedExtensions {
  return useContext(SupportedMaterialsContext)
}
