import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
// Self-hosted faces, so the app renders correctly with no network. Fontsource's extensionless
// subpaths resolve to the same per-weight stylesheets and keep tokens.css the only `.css` import here.
import '@fontsource/heebo/400'
import '@fontsource/heebo/500'
import '@fontsource/heebo/600'
import '@fontsource/heebo/700'
import '@fontsource/jetbrains-mono/400'
import '@fontsource/jetbrains-mono/500'
import './styles/tokens.css'
import App from './App'
import ErrorBoundary from '@/app/ErrorBoundary'
import { activateLocale, initialLocale } from '@/services/i18n'

// Activation is awaited before the first render so no frame paints untranslated. A failure here
// would leave `render` unreached and the page blank, so English is the last resort — the crash
// panel is only reachable once something is mounted.
try {
  await activateLocale(initialLocale())
} catch {
  await activateLocale('en').catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
