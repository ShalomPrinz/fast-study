import { useState, useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { TimingStats } from '@/types'
import { formatDuration } from '@/shared/utils/format'
import { etaProgress } from '@/shared/utils/eta'
import './ProgressBar.css'

interface Props {
  stats: TimingStats | null | undefined
  startedAt: number
  // How much of the estimate was already done before `startedAt`.
  completedFraction?: number
  className?: string
}

// ETA bar: elapsed time against a given estimate, ticking client-side.
export default function ProgressBar({ stats, startedAt, completedFraction = 0, className }: Props) {
  const { t } = useLingui()
  // The tick stores the clock, not the elapsed time, so a changed `startedAt` (a queued job's 0
  // becoming its real start) is measured at once instead of showing the old start until the next tick.
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const extra = className ? ` ${className}` : ''

  if (stats === null || stats === undefined) {
    return <p className={`progress-label progress-label--muted${extra}`}>{t`Estimating…`}</p>
  }

  if ('message' in stats) {
    return (
      <p
        className={`progress-label progress-label--muted${extra}`}
      >{t`Not enough data to estimate`}</p>
    )
  }

  const { longest } = stats
  const { elapsed, fillPct, remaining, overflowing } = etaProgress(
    stats.estimated,
    startedAt,
    now,
    completedFraction,
  )

  return (
    <div className={`progress-wrap${extra}`}>
      <div className="progress-track">
        <div
          className={`progress-fill${overflowing ? ' progress-fill--overflow' : ''}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <p className={`progress-label${overflowing ? ' progress-label--overflow' : ''}`}>
        {overflowing
          ? t`Taking longer than expected · ${formatDuration(elapsed)} · longest recorded: ${formatDuration(longest)}`
          : t`${formatDuration(remaining)} remaining`}
      </p>
    </div>
  )
}
