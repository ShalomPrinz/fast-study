// Type-only so the mutual import with `settings.ts` is erased at compile time — no runtime cycle.
import type { SettingsBacking } from './settings'
import type { Kind } from '@/types'

/** What the two `open` calls answer; `error` is English prose from the OS or the database service. */
export type OpenResult = { ok: boolean; error: string | null }

/** What `report.mail` answers: `path` is the report file main wrote, for the user to attach. It is
 *  null when the write failed, which never stops the mail from opening. */
export type ReportResult = OpenResult & { path: string | null }

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
      // Not optional: `services/open.ts` treats the whole bridge's absence as the browser-dev test,
      // so a present bridge always carries these. Identifiers only — `database/` resolves the path,
      // and a `target` without `lecture` addresses a course-level `overview/` file.
      open: {
        file: (target: {
          course: string
          lecture?: string
          name: string
          kind?: Kind
        }) => Promise<OpenResult>
        external: (url: string | undefined) => Promise<OpenResult>
      }
      // Fields, never a URL: main writes the report file and composes the `mailto:` itself.
      report: {
        mail: (fields: {
          details: string
          error: string
          route: string
        }) => Promise<ReportResult>
      }
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

// Whether this machine can keep the API keys safely. Missing bridge means browser dev, which has no
// Electron store at all — keys go to `database/`'s `.env` and secure storage never enters into it —
// so the absence of an answer is a working machine, never an unsupported one.
export const canStoreApiKeys = runtimeBridge()?.checks?.secureStorage ?? true

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
