import { useCallback, useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { connectDrive, fetchDriveStatus } from '@/services/drive'
import { toast } from '@/services/toaster'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useDriveEnabled } from '@/shared/contexts/SettingsContext'
import { useNotify } from '@/shared/hooks/useNotify'
import '@/styles/modal.css'

// The lazy half of Drive consent: a run wanted a token and had none, so the ask follows the user
// wherever they are rather than waiting on the settings screen. See docs/SETTINGS.md.
export default function DriveConsentPrompt() {
  const { t } = useLingui()
  const driveEnabled = useDriveEnabled()
  const [needed, setNeeded] = useState(false)
  // Asked once per flag, whichever way it is answered: the flag stays true until a token lands, so
  // re-rendering the modal on the next notify would trap a user who said no.
  const [answered, setAnswered] = useState(false)

  const refresh = useCallback(async () => {
    // Nothing to consent to with Drive off — and the flag can outlive the toggle being turned off.
    if (!driveEnabled) return
    try {
      const status = await fetchDriveStatus()
      setNeeded(status.consentNeeded)
      if (!status.consentNeeded) setAnswered(false)
    } catch {
      // A downed backend is toasted centrally, and it could not start a consent flow anyway.
    }
  }, [driveEnabled])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useNotify(refresh)

  async function accept() {
    setAnswered(true)
    try {
      await connectDrive()
      toast('info', t`Finish signing in to Google in the browser tab that opened.`)
    } catch (err) {
      toast('error', (err as Error).message)
    }
  }

  if (!driveEnabled || !needed || answered) return null

  return (
    <ConfirmModal
      message={t`Connect Google Drive now?`}
      detail={
        <p className="modal-message modal-note drive-consent-detail">
          <Trans>
            A finished summary is waiting to upload, and Fast Study has no permission to use your
            Drive yet. Saying yes opens a Google sign-in page in your browser; either way every
            summary is kept on this computer.
          </Trans>
        </p>
      }
      onConfirm={() => void accept()}
      onCancel={() => setAnswered(true)}
    />
  )
}
