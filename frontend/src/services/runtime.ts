// Type-only so the mutual import with `settings.ts` is erased at compile time — no runtime cycle.
import type { SettingsBacking } from './settings'

// The one place `window.faststudy` is declared: two `declare global` blocks for the same property
// do not compile, so every consumer of the Electron preload bridge reads it from here.
declare global {
  interface Window {
    faststudy?: {
      urls?: {
        backend: string
        database: string
        downloadServer: string
        autoDownloader: string
      }
      settings?: SettingsBacking
    }
  }
}

/** The preload bridge, or `undefined` outside Electron. The `window` guard is load-bearing: vitest
 *  runs in the `node` environment, where the global genuinely does not exist. */
export function runtimeBridge(): Window['faststudy'] {
  return typeof window === 'undefined' ? undefined : window.faststudy
}

// Resolved once, synchronously: every service builds its client at module scope, and `contextBridge`
// has the bridge on `window` before the bundle evaluates. The fallbacks are the dev ports each
// service listens on when the app is run outside the packaged build.
const urls = runtimeBridge()?.urls

export const BACKEND_URL = urls?.backend ?? 'http://localhost:8000'
export const DATABASE_URL = urls?.database ?? 'http://localhost:8001'
export const DOWNLOAD_SERVER_URL = urls?.downloadServer ?? 'http://localhost:3052'
export const AUTO_DOWNLOADER_URL = urls?.autoDownloader ?? 'http://localhost:3053'
