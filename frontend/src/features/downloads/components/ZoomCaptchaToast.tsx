import { useEffect, useRef } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { dismissToast, toastHeld } from '@/services/toaster'
import {
  ZOOM_CAPTCHA_TOAST_ID as TOAST_ID,
  zoomCaptchaToastChange,
} from '@/features/downloads/utils/zoomCaptcha'

// Route-independent: a zoom download's captcha wait holds a toast up for as long as `/auth/events` says it
// lasts, whichever page the user is on. Renders nothing itself.
export default function ZoomCaptchaToast() {
  const { t } = useLingui()
  const { status } = useAuthStatus()
  const active = status?.zoomCaptcha ?? false
  const shown = useRef(false)

  useEffect(() => {
    const change = zoomCaptchaToastChange(shown.current, active)
    shown.current = active
    if (change === 'show') {
      toastHeld(
        TOAST_ID,
        t`Zoom is asking for a captcha. Solve it in the Chrome window that just opened, and the download will continue.`,
      )
    } else if (change === 'dismiss') dismissToast(TOAST_ID)
  }, [active, t])

  // Reset with the dismiss, so a remount (StrictMode's included) shows a still-active wait again.
  useEffect(
    () => () => {
      shown.current = false
      dismissToast(TOAST_ID)
    },
    [],
  )
  return null
}
