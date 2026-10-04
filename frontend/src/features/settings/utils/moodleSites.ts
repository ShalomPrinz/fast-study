import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'

export interface MoodleSitePreset {
  id: string
  name: MessageDescriptor
  url: string
}

// The universities the site field offers by name; anything else goes through "Other…". Each URL is
// only a starting point — the probe answers the canonical root, and that is what gets stored.
export const MOODLE_SITE_PRESETS: MoodleSitePreset[] = [
  { id: 'biu', name: msg`Bar-Ilan University`, url: 'https://lemida.biu.ac.il' },
  // HUJI and the Technion put the academic year in the URL (path, host), so these go stale yearly.
  { id: 'huji', name: msg`Hebrew University`, url: 'https://moodle.huji.ac.il/2026-27' },
  { id: 'technion', name: msg`Technion`, url: 'https://moodle26.technion.ac.il' },
  // The bare host answers 404; Moodle lives under /moodle.
  { id: 'bgu', name: msg`Ben-Gurion University`, url: 'https://moodle.bgu.ac.il/moodle' },
]

export const OTHER_SITE = 'other'

/** The `<select>` value a stored site opens on: its preset, "Other…" for any other root, or the
 *  empty "no university" entry when nothing is stored — the wall preselects no university. */
export function choiceForSite(site: string | null): string {
  if (!site) return ''
  const bare = site.replace(/\/+$/, '')
  return MOODLE_SITE_PRESETS.find((p) => p.url === bare)?.id ?? OTHER_SITE
}

/** Whether the picker means "no university": its placeholder, or "Other…" with no address typed. */
export function choosesNoSite(choice: string, typed: string): boolean {
  return choice === '' || (choice === OTHER_SITE && !typed.trim())
}
