import { useLingui } from '@lingui/react'
import { LOCALES, activateLocale } from '@/services/i18n'
import type { Locale } from '@/services/i18n'
import '@/styles/segmented.css'
import './LanguageSwitcher.css'

// Endonyms: a language is always offered in its own script, never translated into the active locale.
const LABELS: Record<Locale, string> = { he: 'עברית', en: 'English' }

export default function LanguageSwitcher() {
  const { i18n } = useLingui()

  return (
    <div className="mode-toggle language-switcher">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          lang={locale}
          className={`mode-toggle-btn${i18n.locale === locale ? ' active' : ''}`}
          onClick={() => void activateLocale(locale)}
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  )
}
