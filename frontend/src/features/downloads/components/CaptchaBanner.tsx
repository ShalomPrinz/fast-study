import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { showWindow } from '@/features/downloads/services/autoDownloader'
import { captchaWait } from '@/features/downloads/utils/captchaBanner'
import { toastFailure } from '@/shared/utils/failure'
import './CaptchaBanner.css'
import '@/styles/button.css'

// Route-independent: while a FastStudy-opened Chrome window waits on a captcha, a strip atop the content
// says so and offers to raise that window, which the OS may have left behind the user's work.
export default function CaptchaBanner() {
  const { status } = useAuthStatus()
  const [busy, setBusy] = useState(false)
  const wait = captchaWait(status)
  if (!wait) return null

  async function handleShow() {
    setBusy(true)
    try {
      await showWindow()
    } catch (err) {
      // A 409 raced the frame that hides this banner; it still says so.
      toastFailure(err)
    }
    setBusy(false)
  }

  return (
    <div className={`captcha-banner captcha-banner--${wait}`} role="status">
      <span className="captcha-banner-dot" aria-hidden="true" />
      <span className="captcha-banner-text">
        {wait === 'zoom' ? (
          <Trans>
            Zoom is asking for a captcha in a Chrome window. The download continues once you solve
            it.
          </Trans>
        ) : (
          <Trans>
            The university site is asking for a captcha in a Chrome window. Solve it there to
            continue.
          </Trans>
        )}
      </span>
      <button
        type="button"
        className="btn btn--primary captcha-banner-show"
        disabled={busy}
        onClick={handleShow}
      >
        <Trans>Show captcha window</Trans>
      </button>
    </div>
  )
}
