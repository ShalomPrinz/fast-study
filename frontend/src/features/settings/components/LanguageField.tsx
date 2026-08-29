import { Trans, useLingui } from '@lingui/react/macro'
import { LOCALES, chooseLocale, type Locale } from '@/services/i18n'
import '@/styles/settings-form.css'

// Endonyms: a language is always offered in its own script, never translated into the active locale.
const LABELS: Record<Locale, string> = { he: 'עברית', en: 'English' }

// Applies the moment it is picked, so the rest of the screen reads in the chosen language at once;
// the save that follows only records the choice in the store.
export default function LanguageField() {
  const { i18n } = useLingui()

  return (
    <div className="settings-field">
      <div className="settings-label">
        <label htmlFor="ui-language">
          <Trans>Language</Trans>
        </label>
      </div>
      <select
        id="ui-language"
        className="settings-select"
        value={i18n.locale}
        onChange={(e) => void chooseLocale(e.target.value as Locale)}
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LABELS[locale]}
          </option>
        ))}
      </select>
    </div>
  )
}
