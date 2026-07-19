import { createContext, useContext, type ReactNode } from 'react'
import type { Kind } from '@/types'

// Which list (lecture vs recitation) the subtree belongs to.
const LectureListContext = createContext<Kind | null>(null)

export function LectureListProvider({ kind, children }: { kind: Kind; children: ReactNode }) {
  return <LectureListContext.Provider value={kind}>{children}</LectureListContext.Provider>
}

export function useLectureListKind(): Kind {
  const kind = useContext(LectureListContext)
  if (kind === null) throw new Error('useLectureListKind must be used within a <LectureListProvider>')
  return kind
}
