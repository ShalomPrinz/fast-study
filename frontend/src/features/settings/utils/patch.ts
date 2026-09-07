import {
  toAutoRun,
  toNightlyHour,
  type AutoRun,
  type Settings,
  type SettingsPatch,
} from '@/services/settings'

export interface SettingsForm {
  geminiApiKey: string
  groqApiKey: string
  dataRoot: string
  driveEnabled: boolean
  gdriveRootFolder: string
  geminiModel: string
  autoRun: AutoRun
  nightlyRun: boolean
  nightlyHour: number
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
  if (form.autoRun !== toAutoRun(stored.autoRun)) patch.autoRun = form.autoRun
  // Unset means on: the cron ran before it was a setting, and the backend defaults the same way.
  if (form.nightlyRun !== (stored.nightlyRun ?? true)) patch.nightlyRun = form.nightlyRun
  if (form.nightlyHour !== toNightlyHour(stored.nightlyHour)) patch.nightlyHour = form.nightlyHour
  return patch
}
