import type { Settings, SettingsPatch } from '@/services/settings'
import { autoRetryFromStore, autoRetryPatch } from './autoRetry'
import { buildPatch, type SettingsForm } from './patch'
import type { ConfigOptions } from '@/services/settings'

// A typed or sensitive entry that saves only when its section's Approve is pressed.
export type ApproveId = 'geminiKey' | 'groqKey' | 'dataRoot' | 'drive' | 'site' | 'retry'

// A section of the page that shows "Saved" after one of its fields lands.
export type SectionId =
  | 'keys'
  | 'storage'
  | 'drive'
  | 'downloading'
  | 'courses'
  | 'retry'
  | 'appearance'
  | 'disk'
  | 'reports'

// Fields that never save with a change: the approved entries and auto-remove (its own Apply).
// The retry switch saves at once; only its two numbers wait.
const HELD_KEYS = [
  'geminiApiKey',
  'groqApiKey',
  'dataRoot',
  'gdriveRootFolder',
  'moodleSite',
  'autoRemove',
  'autoRemoveAfter',
  'autoRetryCount',
  'autoRetryMinutes',
] as const

/** What a change saves at once: every changed field except the approved entries and auto-remove.
 *  Drive turned on with no stored folder waits, so Approve on the folder stores both together. */
export function autoPatch(
  form: SettingsForm,
  stored: Settings,
  canSetErrorReports: boolean,
  options: ConfigOptions | null,
): SettingsPatch {
  const patch = buildPatch(form, stored, canSetErrorReports, options)
  for (const key of HELD_KEYS) delete patch[key]
  if (patch.driveEnabled === true && !(stored.gdriveRootFolder ?? '').trim()) {
    delete patch.driveEnabled
  }
  return patch
}

/** What an Approve stores: empty while its entry is blank, invalid or unchanged. */
export function approvePatch(id: ApproveId, form: SettingsForm, stored: Settings): SettingsPatch {
  switch (id) {
    case 'geminiKey':
      return form.geminiApiKey.trim() ? { geminiApiKey: form.geminiApiKey.trim() } : {}
    case 'groqKey':
      return form.groqApiKey.trim() ? { groqApiKey: form.groqApiKey.trim() } : {}
    case 'dataRoot': {
      const root = form.dataRoot.trim()
      return root && root !== (stored.dataRoot ?? '') ? { dataRoot: root } : {}
    }
    case 'drive': {
      const folder = form.gdriveRootFolder.trim()
      if (!form.driveEnabled || !folder) return {}
      const patch: SettingsPatch = {}
      if (folder !== (stored.gdriveRootFolder ?? '')) patch.gdriveRootFolder = folder
      if (!(stored.driveEnabled ?? false)) patch.driveEnabled = true
      return patch
    }
    case 'site':
      return form.moodleSite && form.moodleSite !== (stored.moodleSite ?? '')
        ? { moodleSite: form.moodleSite }
        : {}
    case 'retry': {
      const { count, minutes } = form.autoRetry
      if (Number.isNaN(count) || Number.isNaN(minutes)) return {}
      const { autoRetryCount, autoRetryMinutes } = autoRetryPatch(
        { ...form.autoRetry, on: autoRetryFromStore(stored).on },
        stored,
      )
      return {
        ...(autoRetryCount !== undefined && { autoRetryCount }),
        ...(autoRetryMinutes !== undefined && { autoRetryMinutes }),
      }
    }
  }
}

/** Whether the Approve button shows: its entry holds an unsaved edit, valid or not. */
export function approveVisible(id: ApproveId, form: SettingsForm, stored: Settings): boolean {
  switch (id) {
    case 'geminiKey':
      return !!form.geminiApiKey.trim()
    case 'groqKey':
      return !!form.groqApiKey.trim()
    case 'dataRoot':
      return form.dataRoot.trim() !== (stored.dataRoot ?? '')
    case 'drive':
      return (
        form.driveEnabled &&
        (form.gdriveRootFolder.trim() !== (stored.gdriveRootFolder ?? '') ||
          !(stored.driveEnabled ?? false))
      )
    case 'site':
      return !!form.moodleSite && form.moodleSite !== (stored.moodleSite ?? '')
    case 'retry': {
      const was = autoRetryFromStore(stored)
      return form.autoRetry.count !== was.count || form.autoRetry.minutes !== was.minutes
    }
  }
}

/** The form once an entry landed: only that entry takes the store's answer, so a newer edit of any
 *  other field (or of this one, typed since) is never reverted. */
export function mergeApproved(
  form: SettingsForm,
  saved: Settings,
  patch: SettingsPatch,
): SettingsForm {
  const next = { ...form }
  if (patch.geminiApiKey !== undefined && form.geminiApiKey.trim() === patch.geminiApiKey)
    next.geminiApiKey = ''
  if (patch.groqApiKey !== undefined && form.groqApiKey.trim() === patch.groqApiKey)
    next.groqApiKey = ''
  if (patch.dataRoot !== undefined && form.dataRoot.trim() === patch.dataRoot)
    next.dataRoot = saved.dataRoot ?? ''
  if (
    patch.gdriveRootFolder !== undefined &&
    form.gdriveRootFolder.trim() === patch.gdriveRootFolder
  )
    next.gdriveRootFolder = saved.gdriveRootFolder ?? ''
  return next
}

const SECTION_OF: Record<string, SectionId> = {
  geminiApiKey: 'keys',
  groqApiKey: 'keys',
  geminiModel: 'keys',
  geminiFallbackModels: 'keys',
  summaryFigures: 'keys',
  dataRoot: 'storage',
  driveEnabled: 'drive',
  gdriveRootFolder: 'drive',
  moodleSite: 'downloading',
  courseStructure: 'courses',
  autoRetry: 'retry',
  autoRetryCount: 'retry',
  autoRetryMinutes: 'retry',
  autoRun: 'appearance',
  aiProvider: 'appearance',
  autoRemove: 'disk',
  autoRemoveAfter: 'disk',
  errorReports: 'reports',
  privacyConfirmed: 'reports',
}

/** The sections a landed patch touched, each once. */
export function sectionsOf(patch: SettingsPatch): SectionId[] {
  const ids = new Set<SectionId>()
  for (const key of Object.keys(patch)) {
    const id = SECTION_OF[key]
    if (id) ids.add(id)
  }
  return [...ids]
}
