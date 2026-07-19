import { useMatch, useNavigate } from 'react-router-dom'
import type { Selected, Kind } from '@/types'
import { useKindParam } from '@/shared/hooks/useKindParam'
import { lectureRoute } from '@/shared/utils/url'

// The open lecture, derived from the route + ?kind, plus a navigate helper.
export function useSelection() {
  const navigate = useNavigate()
  const kind = useKindParam()
  const match = useMatch('/:course/:lecture/*')
  const selected: Selected | null = match?.params.course && match?.params.lecture
    ? { course: match.params.course, lecture: match.params.lecture, kind }
    : null

  function onSelect(course: string, lecture: string, k: Kind) {
    navigate(lectureRoute(course, lecture, k))
  }

  return { selected, onSelect }
}
