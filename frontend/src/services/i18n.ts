import { i18n } from '@lingui/core'
import type { Messages } from '@lingui/core'
import { runtimeBridge } from './runtime'

export const LOCALES = ['he', 'en'] as const
export type Locale = (typeof LOCALES)[number]

const STORAGE_KEY = 'fast-study:locale'

// Static map rather than a templated dynamic import, so the bundler can see both catalogs.
const CATALOGS: Record<Locale, () => Promise<{ messages: Messages }>> = {
  he: () => import('@/locales/he/messages.po'),
  en: () => import('@/locales/en/messages.po'),
}

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value)
}

// Storage access throws with cookies blocked or in some private modes; a lost preference must never
// cost the app a render, so both directions degrade to "no stored choice".
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // best effort
  }
}

// A stored choice wins; otherwise anything the reported language says that isn't English means
// Hebrew, since every non-English reader of this app is a Hebrew speaker.
export function resolveLocale(stored: string | null, language?: string): Locale {
  if (isLocale(stored)) return stored
  if (language?.toLowerCase().startsWith('en')) return 'en'
  return 'he'
}

// Hebrew is the only RTL locale shipped; `dir` and any direction-sensitive glyph derive from this.
export function isRtl(locale: string): boolean {
  return locale === 'he'
}

// Stored pick, then the OS locale off the bridge, then `navigator.language`. `||`, not `??`: Chromium
// answers `''` when it cannot read the OS locale, which would otherwise resolve to Hebrew.
export function initialLocale(): Locale {
  return resolveLocale(readStored(), runtimeBridge()?.locale || navigator.language)
}

// Loads and activates the catalog; the `dir` write flips the whole UI. Does not persist — only an
// explicit pick (`chooseLocale`) is stored, so a boot-time guess never outranks a later change.
export async function activateLocale(locale: Locale): Promise<void> {
  const { messages } = await CATALOGS[locale]()
  i18n.loadAndActivate({ locale, messages })
  document.documentElement.lang = locale
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr'
}

// The switcher's entry point: the same activation plus the stored choice that outranks the browser.
export async function chooseLocale(locale: Locale): Promise<void> {
  await activateLocale(locale)
  writeStored(locale)
}
