import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import './styles/tokens.css'
import App from './App'
import ErrorBoundary from '@/app/ErrorBoundary'
import { activateLocale, initialLocale } from '@/services/i18n'

// Activation is awaited before the first render so no frame paints untranslated.
await activateLocale(initialLocale())

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
