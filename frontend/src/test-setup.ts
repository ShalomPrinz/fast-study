// Every test runs with a locale active, exactly as the app does: `main.tsx` awaits `activateLocale`
// before the first render, so a translation call with no active catalog never happens in practice —
// and Lingui throws on one. English is the source locale, so messages read as they do in the code.
import { i18n } from '@lingui/core'
import { messages } from '@/locales/en/messages.po'

i18n.loadAndActivate({ locale: 'en', messages })
