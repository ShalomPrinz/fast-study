import { useLingui } from '@lingui/react/macro'
import { LOCALES, chooseLocale } from '@/services/i18n'
import type { Locale } from '@/services/i18n'
import Tooltip from '@/shared/components/Tooltip'
import { useLocaleHeld } from '@/shared/hooks/useLocaleHold'
import '@/styles/segmented.css'
import './LanguageSwitcher.css'

// Endonyms: a language is always offered in its own script, never translated into the active locale.
const LABELS: Record<Locale, string> = { he: 'עברית', en: 'English' }

// Disabled while the course picker holds the locale. The hint sits on the group, since a disabled
// button gets no hover; its buttons pass the pointer through (`--held`).
export default function LanguageSwitcher() {
  const { t, i18n } = useLingui()
  const held = useLocaleHeld()

  return (
    <Tooltip content={held ? t`Close the course list to change the language` : null}>
      <div
        className={`mode-toggle language-switcher${held ? ' language-switcher--held' : ''}`}
        role="group"
        aria-label={t`Language`}
      >
        {LOCALES.map((locale) => (
          <button
            key={locale}
            lang={locale}
            className={`mode-toggle-btn${i18n.locale === locale ? ' active' : ''}`}
            disabled={held}
            onClick={() => void chooseLocale(locale)}
          >
            {LABELS[locale]}
          </button>
        ))}
      </div>
    </Tooltip>
  )
}
