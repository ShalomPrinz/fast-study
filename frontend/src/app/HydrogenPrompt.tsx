import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { saveSettings, type Settings } from '@/services/settings'
import { toastFailure } from '@/shared/utils/failure'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useSettingsContext } from '@/shared/contexts/SettingsContext'
import '@/styles/modal.css'

export const HYDROGEN_MODEL = 'gemini-4-hydrogen'

/** A stored non-hydrogen model and no answer yet; an unset model already runs hydrogen. */
export function offersHydrogen(settings: Settings | null): boolean {
  return (
    !!settings &&
    !settings.hydrogenPrompted &&
    settings.geminiModel !== null &&
    settings.geminiModel !== HYDROGEN_MODEL
  )
}

// One-time offer to move existing users to the new default model; temporary, see "Gemini hydrogen prompt" in docs/MIGRATIONS.md.
export default function HydrogenPrompt() {
  const { t } = useLingui()
  const { settings, setSettings } = useSettingsContext()
  // Hides at once and for the session even if the save fails, which is toasted; the next launch asks again.
  const [answered, setAnswered] = useState(false)

  async function answer(switchModel: boolean) {
    setAnswered(true)
    try {
      const { errorReportsRestartNeeded: _, ...saved } = await saveSettings(
        switchModel
          ? { geminiModel: HYDROGEN_MODEL, hydrogenPrompted: true }
          : { hydrogenPrompted: true },
      )
      setSettings(saved)
    } catch (err) {
      toastFailure(err)
    }
  }

  if (answered || !offersHydrogen(settings)) return null

  return (
    <ConfirmModal
      message={t`Switch to the new Gemini model?`}
      detail={
        <p className="modal-message modal-note">
          <Trans>
            gemini-4-hydrogen is now the default model. You can change the model any time in
            Settings.
          </Trans>
        </p>
      }
      onConfirm={() => void answer(true)}
      onCancel={() => void answer(false)}
    />
  )
}
