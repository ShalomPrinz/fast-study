/// <reference types="vite/client" />

// The Lingui Vite plugin compiles `.po` catalogs into JS modules at build time; TS needs their shape.
declare module '*.po' {
  import type { Messages } from '@lingui/core'
  export const messages: Messages
}

// Dev-only service URL overrides, read by `services/runtime.ts` when there is no preload bridge.
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string
  readonly VITE_DATABASE_URL?: string
  readonly VITE_DOWNLOAD_SERVER_URL?: string
  readonly VITE_AUTO_DOWNLOADER_URL?: string
}
