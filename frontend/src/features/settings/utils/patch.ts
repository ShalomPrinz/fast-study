import {
  toAutoRun,
  toNightlyHour,
  type AutoRun,
  type ConfigOptions,
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
  // `''` while no savable site is chosen; never sent, since a site is cleared by nothing.
  moodleSite: string
}

/** The form as the store answers it, used on load and after every save so a later save diffs only
 *  what this page edited. A model the options no longer list reads as the first one, so Save sends it. */
export function formFromStore(stored: Settings, options: ConfigOptions): SettingsForm {
  const models = options.geminiModels
  const model = stored.geminiModel
  return {
    geminiApiKey: '',
    groqApiKey: '',
    dataRoot: stored.dataRoot ?? '',
    driveEnabled: stored.driveEnabled ?? false,
    gdriveRootFolder: stored.gdriveRootFolder ?? '',
    geminiModel: model !== null && models.includes(model) ? model : (models[0] ?? ''),
    autoRun: toAutoRun(stored.autoRun),
    // Unset means on: the cron ran before it was a setting, and the backend defaults the same way.
    nightlyRun: stored.nightlyRun ?? true,
    nightlyHour: toNightlyHour(stored.nightlyHour),
    moodleSite: stored.moodleSite ?? '',
  }
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
  if (form.moodleSite && form.moodleSite !== (stored.moodleSite ?? '')) {
    patch.moodleSite = form.moodleSite
  }
  return patch
}
