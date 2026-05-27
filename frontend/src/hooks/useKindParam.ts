import { useSearchParams } from 'react-router-dom'
import type { Kind } from '@/types'

export function useKindParam(): Kind {
  const [searchParams] = useSearchParams()
  return searchParams.get('kind') === 'recitation' ? 'recitation' : 'lecture'
}
