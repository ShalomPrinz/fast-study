// Type-only so the mutual import with `settings.ts` is erased at compile time — no runtime cycle.
import type { SettingsBacking } from './settings'
import type { Kind } from '@/types'

/** What the two `open` calls answer; `error` is English prose from the OS or the database service. */
export type OpenResult = { ok: boolean; error: string | null }

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
      secret?: string
      checks?: { secureStorage: boolean }
      // The installed app version and the OS language, straight from `app.getVersion()`/`getLocale()`.
      version?: string
      locale?: string
      // The packaged data folder the init wall starts from (`%LOCALAPPDATA%\FastStudy\data`).
      defaultDataRoot?: string
      // Whether error reporting is on for this launch; a change in Settings waits for the next one.
      errorReports?: boolean
      // The native folder dialog, opened at `defaultPath`; `null` on cancel. Absent on older launchers.
      pickFolder?: (defaultPath?: string) => Promise<string | null>
      // Not optional: the bridge's absence is the browser-dev test. Identifiers only — `database/`
      // resolves the path; a `target` without `lecture` is a course-level `overview/` file.
      open: {
        file: (target: {
          course: string
          lecture?: string
          name: string
          kind?: Kind
        }) => Promise<OpenResult>
        external: (url: string | undefined) => Promise<OpenResult>
      }
    }
  }
}

/** The preload bridge, or `undefined` outside Electron. The `window` guard is load-bearing: vitest
 *  runs in the `node` environment, where the global genuinely does not exist. */
export function runtimeBridge(): Window['faststudy'] {
  return typeof window === 'undefined' ? undefined : window.faststudy
}

// Resolved synchronously at import, since every client is built at module scope and the preload runs
// before the bundle; then `VITE_*_URL` (a harness running parallel stacks), then the dev ports.
const urls = runtimeBridge()?.urls

export const BACKEND_URL =
  urls?.backend ?? import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'
export const DATABASE_URL =
  urls?.database ?? import.meta.env.VITE_DATABASE_URL ?? 'http://localhost:8001'
export const DOWNLOAD_SERVER_URL =
  urls?.downloadServer ?? import.meta.env.VITE_DOWNLOAD_SERVER_URL ?? 'http://localhost:3052'
export const AUTO_DOWNLOADER_URL =
  urls?.autoDownloader ?? import.meta.env.VITE_AUTO_DOWNLOADER_URL ?? 'http://localhost:3053'

// Whether this machine can keep the API keys. No bridge is browser dev, where keys go to `.env`, so
// a missing answer means a working machine — see docs/SETTINGS.md.
export const canStoreApiKeys = runtimeBridge()?.checks?.secureStorage ?? true

// Whether the launcher can switch error reporting. No field is browser dev, where nothing reports
// and the store has no such setting, so the switch is hidden there.
export const canSetErrorReports = typeof runtimeBridge()?.errorReports === 'boolean'

// The native folder dialog, or `undefined` in browser dev and on a launcher that predates it — then
// the data folder stays a typed path.
export const pickFolder = runtimeBridge()?.pickFolder

// The launch secret the services check on every request. Undefined in browser dev, where the
// services see no `FASTSTUDY_SECRET` and install no check at all — the supported dev state.
const SECRET = runtimeBridge()?.secret

/** Spreadable into any `headers` object; empty when there is no secret to send. */
export function secretHeaders(): Record<string, string> {
  return SECRET ? { 'X-FastStudy-Secret': SECRET } : {}
}

/** Native `EventSource` cannot set a header, so the two SSE routes — and only they — take the
 *  secret as a query parameter, which also survives EventSource's own reconnects. */
export function withSecretParam(url: string): string {
  return SECRET ? `${url}?secret=${encodeURIComponent(SECRET)}` : url
}
