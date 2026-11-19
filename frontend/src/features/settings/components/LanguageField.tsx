import { Trans, useLingui } from '@lingui/react/macro'
import { LOCALES, chooseLocale, type Locale } from '@/services/i18n'
import Select from '@/shared/components/Select'
import '@/styles/settings-form.css'

// Endonyms: a language is always offered in its own script, never translated into the active locale.
const LABELS: Record<Locale, string> = { he: 'עברית', en: 'English' }
const OPTIONS = LOCALES.map((locale) => ({ value: locale, label: LABELS[locale], lang: locale }))

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
      <Select
        id="ui-language"
        value={i18n.locale}
        options={OPTIONS}
        onChange={(locale) => void chooseLocale(locale as Locale)}
      />
    </div>
  )
}
