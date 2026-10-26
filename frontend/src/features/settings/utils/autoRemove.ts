import { t } from '@lingui/core/macro'
import {
  AUTO_REMOVE_AFTER,
  type AutoRemoveAfter,
  type Settings,
  type SettingsPatch,
} from '@/services/settings'

export type RemoveWhat = 'video' | 'audio'

// The section's edit: `on` is the checkbox, and `after` stays `null` until the user picks a timing.
export interface AutoRemoveForm {
  on: boolean
  what: RemoveWhat
  after: AutoRemoveAfter | null
}

// Checking the box always starts here: video only, and no timing until the user chooses one.
export const AUTO_REMOVE_CHECKED: AutoRemoveForm = { on: true, what: 'video', after: null }

const OFF: AutoRemoveForm = { on: false, what: 'video', after: null }

function toWhat(stored: string | null): RemoveWhat | null {
  return stored === 'video' || stored === 'audio' ? stored : null
}

function toAfter(stored: string | null): AutoRemoveAfter | null {
  return (AUTO_REMOVE_AFTER as readonly string[]).includes(stored ?? '')
    ? (stored as AutoRemoveAfter)
    : null
}

/** The section as the store holds it; anything but `video`/`audio` reads as unchecked. */
export function autoRemoveFromStore(stored: Settings): AutoRemoveForm {
  const what = toWhat(stored.autoRemove)
  return what ? { on: true, what, after: toAfter(stored.autoRemoveAfter) } : OFF
}

/** Whether the section differs from the store; two unchecked forms are equal whatever they hide. */
export function autoRemoveDirty(form: AutoRemoveForm, stored: Settings): boolean {
  const saved = autoRemoveFromStore(stored)
  if (!form.on || !saved.on) return form.on !== saved.on
  return form.what !== saved.what || form.after !== saved.after
}

/** Whether the section can be saved: unchecked, or both values chosen, with Drive on for `drive`. */
export function autoRemoveComplete(form: AutoRemoveForm, driveEnabled: boolean): boolean {
  if (!form.on) return true
  return form.after !== null && (form.after !== 'drive' || driveEnabled)
}

/** The section's share of a save: nothing while unchanged or incomplete, `off` once unchecked. */
export function autoRemovePatch(
  form: AutoRemoveForm,
  stored: Settings,
  driveEnabled: boolean,
): SettingsPatch {
  if (!autoRemoveDirty(form, stored) || !autoRemoveComplete(form, driveEnabled)) return {}
  if (!form.on) return { autoRemove: 'off' }
  return { autoRemove: form.what, autoRemoveAfter: form.after! }
}

/** Whether saving deletes files the stored rule would keep: off becoming on, more files (video to
 *  video + audio) or an earlier timing (Drive to PDF). That save confirms first, then sweeps. */
export function autoRemoveWidens(form: AutoRemoveForm, stored: Settings): boolean {
  if (!form.on || form.after === null) return false
  const saved = autoRemoveFromStore(stored)
  if (!saved.on || saved.after === null) return true
  return (
    (form.what === 'audio' && saved.what === 'video') ||
    (form.after === 'pdf' && saved.after === 'drive')
  )
}

// What the section's Apply does now: save the edit, re-run the sweep for the stored rule (a retry after
// a locked file or a failure, no confirm since the rule was confirmed), wait for the page's Save, nothing
// to apply (`unchanged`), or `null` for an incomplete edit (and, from the page, while it is busy).
export type AutoRemoveApply = 'save' | 'sweep' | 'needs-page-save' | 'unchanged' | null

/** Apply's action. "After Drive" with the Drive toggle unsaved needs the page's Save, which stores both:
 *  saving the rule alone would confirm deletions the backend skips while the stored Drive is off. */
export function autoRemoveApply(
  form: AutoRemoveForm,
  stored: Settings,
  driveEnabled: boolean,
): AutoRemoveApply {
  if (!autoRemoveDirty(form, stored)) {
    const saved = autoRemoveFromStore(stored)
    return saved.on && saved.after !== null ? 'sweep' : 'unchanged'
  }
  if (!autoRemoveComplete(form, driveEnabled)) return null
  if (form.on && form.after === 'drive' && driveEnabled !== (stored.driveEnabled ?? false)) {
    return 'needs-page-save'
  }
  return 'save'
}

// Why an incomplete section cannot be saved: no timing yet, or "after Drive" with Drive off (per mode).
export type AutoRemoveBlock = 'choose-when' | 'drive-off-video' | 'drive-off-audio'

/** The reason an on section is incomplete, `null` when it is complete or unchecked. */
export function autoRemoveBlock(
  form: AutoRemoveForm,
  driveEnabled: boolean,
): AutoRemoveBlock | null {
  if (!form.on || autoRemoveComplete(form, driveEnabled)) return null
  if (form.after === null) return 'choose-when'
  return form.what === 'video' ? 'drive-off-video' : 'drive-off-audio'
}

/** The tooltip for a blocked Apply or Save; whole messages, since Hebrew needs each full sentence. */
export function autoRemoveBlockText(block: AutoRemoveBlock): string {
  if (block === 'drive-off-video') return t`Choose when to remove the video`
  if (block === 'drive-off-audio') return t`Choose when to remove the video and audio`
  return t`Choose when to remove the files first`
}
