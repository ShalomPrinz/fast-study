import { useLocation, useNavigate } from 'react-router-dom'
import type { Kind } from '@/types'
import { useKindParam } from '@/shared/hooks/useKindParam'
import { lectureRoute } from '@/shared/utils/url'
import { lectureToRemember } from '@/features/lectures/utils/lastLecture'

// The open lecture, derived from the route + ?kind, plus a navigate helper; an overview page selects none.
export function useSelection() {
  const navigate = useNavigate()
  const kind = useKindParam()
  const { pathname } = useLocation()
  const selected = lectureToRemember(pathname, kind)

  // `replace` swaps the current entry, for a rename whose old URL no longer exists.
  function onSelect(course: string, lecture: string, k: Kind, opts?: { replace?: boolean }) {
    navigate(lectureRoute(course, lecture, k), opts)
  }

  return { selected, onSelect }
}
