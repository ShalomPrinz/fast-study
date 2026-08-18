import { useState, useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { TimingStats } from '@/types'
import { formatDuration } from '@/shared/utils/format'
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
  const [elapsed, setElapsed] = useState(() => (Date.now() - startedAt) / 1000)

  useEffect(() => {
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 500)
    return () => clearInterval(id)
  }, [startedAt])

  const extra = className ? ` ${className}` : ''

  if (stats === null || stats === undefined) {
    return <p className={`progress-label progress-label--muted${extra}`}>{t`Estimating…`}</p>
  }

  if ('message' in stats) {
    return (
      <p className={`progress-label progress-label--muted${extra}`}>{t`Not enough data to estimate`}</p>
    )
  }

  const { estimated, longest } = stats
  const effectiveElapsed = completedFraction * estimated + elapsed
  const fillPct = Math.min((effectiveElapsed / estimated) * 100, 100)
  const remaining = Math.max(estimated - effectiveElapsed, 0)
  const overflowing = effectiveElapsed >= estimated

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
