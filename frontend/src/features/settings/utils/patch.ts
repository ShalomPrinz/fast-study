import type { Locale } from '@/services/i18n'
import type { Settings, SettingsPatch } from '@/services/settings'

export interface SettingsForm {
  geminiApiKey: string
  groqApiKey: string
  dataRoot: string
  driveEnabled: boolean
  gdriveRootFolder: string
  geminiModel: string
  uiLanguage: Locale
  // Absent on the init wall, which does not ask about the two UI preferences at all.
  autoRunOnBoot?: boolean
  runnerControlsVisible?: boolean
}

/** The save patch: only the fields that actually changed. A key field is write-only and therefore
 *  renders blank, so leaving it alone must never reach the store — an empty value there clears it. */
export function buildPatch(form: SettingsForm, stored: Settings): SettingsPatch {
  const patch: SettingsPatch = {}
  if (form.geminiApiKey.trim()) patch.geminiApiKey = form.geminiApiKey.trim()
  if (form.groqApiKey.trim()) patch.groqApiKey = form.groqApiKey.trim()
  if (form.dataRoot.trim() !== (stored.dataRoot ?? '')) patch.dataRoot = form.dataRoot.trim()
  if (form.geminiModel !== (stored.geminiModel ?? '')) patch.geminiModel = form.geminiModel
  if (form.driveEnabled !== (stored.driveEnabled ?? false)) patch.driveEnabled = form.driveEnabled
  if (form.gdriveRootFolder.trim() !== (stored.gdriveRootFolder ?? '')) {
    patch.gdriveRootFolder = form.gdriveRootFolder.trim()
  }
  if (form.uiLanguage !== stored.uiLanguage) patch.uiLanguage = form.uiLanguage
  if (form.autoRunOnBoot !== undefined && form.autoRunOnBoot !== stored.autoRunOnBoot) {
    patch.autoRunOnBoot = form.autoRunOnBoot
  }
  if (
    form.runnerControlsVisible !== undefined &&
    form.runnerControlsVisible !== stored.runnerControlsVisible
  ) {
    patch.runnerControlsVisible = form.runnerControlsVisible
  }
  return patch
}
