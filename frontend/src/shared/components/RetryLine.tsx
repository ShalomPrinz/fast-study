import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { RetryInfo } from '@/types'
import { toastFailure } from '@/shared/utils/failure'
import { formatCountdown, secondsUntil } from '@/shared/utils/retry'
import '@/styles/button.css'
import './RetryLine.css'

interface Props {
  retry: RetryInfo
  // Cancels the waiting retry; the refreshed status removes the line, so nothing is returned.
  onCancel: () => Promise<unknown>
}

// "retrying in m:ss (attempt n/N)" with a cancel button. The countdown runs locally from `retry.at`;
// the line itself disappears when the pushed status drops `retry`.
export default function RetryLine({ retry, onCancel }: Props) {
  const { t } = useLingui()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = formatCountdown(secondsUntil(retry.at, now))
  const { attempt, of } = retry

  async function cancel() {
    try {
      await onCancel()
    } catch (e) {
      toastFailure(e)
    }
  }

  return (
    <div className="retry-line" data-retry-attempt={attempt} data-retry-of={of}>
      <span className="retry-line-text">{t`Retrying in ${time} (attempt ${attempt}/${of})`}</span>
      <button
        type="button"
        className="btn btn--ghost retry-line-cancel"
        onClick={() => void cancel()}
      >
        {t`Cancel retry`}
      </button>
    </div>
  )
}
