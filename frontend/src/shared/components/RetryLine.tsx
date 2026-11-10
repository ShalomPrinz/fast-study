import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { RetryInfo } from '@/types'
import OverflowMenu from '@/shared/components/OverflowMenu'
import { toastFailure } from '@/shared/utils/failure'
import { formatCountdown, secondsUntil } from '@/shared/utils/retry'
import '@/styles/button.css'
import './RetryLine.css'

interface Props {
  retry: RetryInfo
  // Cancels the waiting retry; the refreshed status removes the line, so nothing is returned.
  onCancel: () => Promise<unknown>
  // Fires the waiting retry now; the line goes while the step runs and returns as attempt n+1 only if it fails transiently again.
  onRunNow: () => Promise<unknown>
}

// "retrying in m:ss (attempt n/N)" with a ⋮ menu (Run now, Cancel retry). The countdown runs locally from `retry.at`;
// the line itself disappears when the pushed status drops `retry`.
export default function RetryLine({ retry, onCancel, onRunNow }: Props) {
  const { t } = useLingui()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = formatCountdown(secondsUntil(retry.at, now))
  const { attempt, of } = retry

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (e) {
      toastFailure(e)
    }
  }

  return (
    <div className="retry-line" data-retry-attempt={attempt} data-retry-of={of}>
      <span className="retry-line-text">{t`Retrying in ${time} (attempt ${attempt}/${of})`}</span>
      <OverflowMenu
        className="retry-line-menu"
        actions={[
          { label: t`Run now`, className: 'retry-line-run-now', onClick: () => void run(onRunNow) },
          {
            label: t`Cancel retry`,
            className: 'retry-line-cancel',
            onClick: () => void run(onCancel),
          },
        ]}
      />
    </div>
  )
}
