/// <reference types="vite/client" />

// The Lingui Vite plugin compiles `.po` catalogs into JS modules at build time; TS needs their shape.
declare module '*.po' {
  import type { Messages } from '@lingui/core'
  export const messages: Messages
}
