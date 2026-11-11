import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { RetryInfo } from '@/types'
import OverflowMenu from '@/shared/components/OverflowMenu'
import Icon from '@/shared/components/Icon'
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

// "retrying in m:ss (attempt n/N)", the whole line a button opening a menu (Run now, Cancel retry). The countdown runs
// locally from `retry.at`; the line disappears when the pushed status drops `retry`.
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

  // stopPropagation: the line sits inside rows and cards whose own click must not fire.
  return (
    <div
      className="retry-line"
      data-retry-attempt={attempt}
      data-retry-of={of}
      onClick={(e) => e.stopPropagation()}
    >
      <OverflowMenu
        className="retry-line-menu"
        trigger={
          <>
            <span className="retry-line-text">{t`Retrying in ${time} (attempt ${attempt}/${of})`}</span>
            <Icon icon="chevron-down" />
          </>
        }
        actions={[
          { label: t`Run now`, className: 'retry-line-run-now', onClick: () => void run(onRunNow) },
          {
            label: t`Cancel retry`,
            className: 'retry-line-cancel',
            danger: true,
            onClick: () => void run(onCancel),
          },
        ]}
      />
    </div>
  )
}
