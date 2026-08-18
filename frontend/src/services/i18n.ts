import { i18n } from '@lingui/core'
import type { Messages } from '@lingui/core'

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

// A stored choice wins; otherwise anything the browser reports that isn't English means Hebrew,
// since every non-English reader of this app is a Hebrew speaker.
export function resolveLocale(stored: string | null, browserLanguage?: string): Locale {
  if (isLocale(stored)) return stored
  if (browserLanguage?.toLowerCase().startsWith('en')) return 'en'
  return 'he'
}

export function initialLocale(): Locale {
  return resolveLocale(localStorage.getItem(STORAGE_KEY), navigator.language)
}

// Loads the catalog, activates it, remembers the choice, and points the document at the new
// language — `dir` here is what flips the whole UI between LTR and RTL.
export async function activateLocale(locale: Locale): Promise<void> {
  const { messages } = await CATALOGS[locale]()
  i18n.loadAndActivate({ locale, messages })
  localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale
  document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr'
}
