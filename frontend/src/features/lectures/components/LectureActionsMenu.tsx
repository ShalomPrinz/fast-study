import OverflowMenu from '@/shared/components/OverflowMenu'
import type { OverflowAction } from '@/shared/components/OverflowMenu'

export type LectureAction = OverflowAction

// The narrow-window shape of the header's secondary actions: the per-file actions that get a row of
// their own above the breakpoint. Renders nothing when the lecture offers none of them yet.
export default function LectureActionsMenu({ actions }: { actions: LectureAction[] }) {
  return <OverflowMenu actions={actions} testId="lecture-actions-menu" />
}
