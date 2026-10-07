import { Trans } from '@lingui/react/macro'
import { failureNode } from '@/shared/utils/failure'
import type { CreateAttempt } from '@/features/lectures/hooks/useCreateAttempt'
import './CreateStatus.css'

// "Creating…" while a create runs, its error once refused, nothing otherwise.
export default function CreateStatus({
  attempt,
}: {
  attempt: Pick<CreateAttempt, 'pending' | 'error'>
}) {
  if (attempt.pending) {
    return (
      <div className="create-status" role="status">
        <Trans>Creating…</Trans>
      </div>
    )
  }
  if (attempt.error) {
    return (
      <div className="create-status create-status-error" role="alert">
        {failureNode(attempt.error)}
      </div>
    )
  }
  return null
}
