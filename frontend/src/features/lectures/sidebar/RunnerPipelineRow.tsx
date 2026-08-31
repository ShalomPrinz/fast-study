import { useLingui } from '@lingui/react/macro'
import { Link, useLocation } from 'react-router-dom'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import Icon from '@/shared/components/Icon'
import './RunnerPipelineRow.css'

// The head of the lectures tree, and the only route to `/running`, so it renders whether or not
// anything is going: a live count while the runner is on, a muted idle label otherwise.
export default function RunnerPipelineRow() {
  const { t } = useLingui()
  const { status } = useRunnerStatus()
  const { pathname } = useLocation()
  const running = status?.runner.running ?? false
  const active = pathname.startsWith('/running')

  // `done` counts finished lectures; display the 1-indexed current one, capped at total.
  const current = status ? Math.min(status.runner.done + 1, status.runner.total) : 0

  return (
    <Link className={`runner-line${active ? ' active' : ''}`} to="/running">
      {running ? (
        <span className="runner-line-ring" aria-hidden="true" />
      ) : (
        <span className="runner-line-dot" aria-hidden="true" />
      )}
      <span className={`runner-line-label${running ? '' : ' runner-line-label--idle'}`}>
        {running ? t`Running pipelines…` : t`Running pipelines`}
      </span>
      {running && (
        <span className="runner-line-count">
          {current}/{status!.runner.total}
        </span>
      )}
      <Icon icon="chevron-end" />
    </Link>
  )
}
