/// <reference types="vite/client" />

// The Lingui Vite plugin compiles `.po` catalogs into JS modules at build time; TS needs their shape.
declare module '*.po' {
  import type { Messages } from '@lingui/core'
  export const messages: Messages
}

// The dev-only service URL overrides `services/runtime.ts` reads when there is no preload bridge,
// and the Sentry DSN.
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string
  readonly VITE_DATABASE_URL?: string
  readonly VITE_DOWNLOAD_SERVER_URL?: string
  readonly VITE_AUTO_DOWNLOADER_URL?: string
  // Baked at build time; unset means the renderer never inits Sentry.
  readonly VITE_SENTRY_DSN?: string
}
