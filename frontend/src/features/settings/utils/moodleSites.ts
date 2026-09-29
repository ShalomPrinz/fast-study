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
  { id: 'tau', name: msg`Tel Aviv University`, url: 'https://moodle.tau.ac.il' }, // unverified
  { id: 'huji', name: msg`Hebrew University`, url: 'https://moodle4.cs.huji.ac.il' }, // unverified
  { id: 'technion', name: msg`Technion`, url: 'https://moodle24.technion.ac.il' }, // unverified
  { id: 'bgu', name: msg`Ben-Gurion University`, url: 'https://moodle.bgu.ac.il' }, // unverified
  { id: 'haifa', name: msg`University of Haifa`, url: 'https://moodle.haifa.ac.il' }, // unverified
  { id: 'ariel', name: msg`Ariel University`, url: 'https://moodle.ariel.ac.il' }, // unverified
]

export const OTHER_SITE = 'other'

/** The `<select>` value a stored site opens on: its preset, "Other…" for any other root, or the
 *  empty placeholder when nothing is stored — the wall preselects no university. */
export function choiceForSite(site: string | null): string {
  if (!site) return ''
  const bare = site.replace(/\/+$/, '')
  return MOODLE_SITE_PRESETS.find((p) => p.url === bare)?.id ?? OTHER_SITE
}
