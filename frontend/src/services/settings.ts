import { createClient, isMoodleBusyError } from './http'
import { AUTO_DOWNLOADER_URL, BACKEND_URL, DATABASE_URL, runtimeBridge } from './runtime'
import { applyErrorReports } from './sentry'
import type { ErrorParams, ServiceFailure } from '@/shared/i18n/serviceErrors'
import type { AiProvider } from '@/features/lectures/utils/aiChat'

// The settings concern, spanning three services by design: a setting's owner is a property of the
// setting, not of the screen editing it — see docs/SETTINGS.md.
const backend = createClient(BACKEND_URL, 'backend service')
const database = createClient(DATABASE_URL, 'database service')
const autoDownloader = createClient(AUTO_DOWNLOADER_URL, 'auto-downloader service')

// How much of the pipeline an automatic trigger may run. The backend applies the same fallback to
// an unset or unrecognised value, so both ends agree that a fresh install runs everything.
export const AUTO_RUN_MODES = ['full', 'audio', 'off'] as const
export type AutoRun = (typeof AUTO_RUN_MODES)[number]

export function toAutoRun(stored: string | null): AutoRun {
  return (AUTO_RUN_MODES as readonly string[]).includes(stored ?? '') ? (stored as AutoRun) : 'full'
}

// Auto-remove: which intermediates go (`audio` is cumulative, video too) and once which output exists.
// The backend reads anything unset or unrecognised as removing nothing.
export const AUTO_REMOVE_MODES = ['off', 'video', 'audio'] as const
export type AutoRemove = (typeof AUTO_REMOVE_MODES)[number]
export const AUTO_REMOVE_AFTER = ['pdf', 'drive'] as const
export type AutoRemoveAfter = (typeof AUTO_REMOVE_AFTER)[number]

// How a course lists its recitations: apart (`split`), among its lectures in every course, or only
// in the courses picked. Unset reads as `split`, as the database reads it.
export const COURSE_STRUCTURES = ['split', 'lectures_all', 'lectures_some'] as const
export type CourseStructure = (typeof COURSE_STRUCTURES)[number]

export function toCourseStructure(stored: string | null): CourseStructure {
  return (COURSE_STRUCTURES as readonly string[]).includes(stored ?? '')
    ? (stored as CourseStructure)
    : 'split'
}

// The hour the nightly catch-up pass fires. The backend clamps an unset or out-of-range value to
// the same 3, so a store holding anything else still shows the hour that will actually run.
export const DEFAULT_NIGHTLY_HOUR = 3

export function toNightlyHour(stored: number | null): number {
  if (stored === null || !Number.isInteger(stored)) return DEFAULT_NIGHTLY_HOUR
  return stored >= 0 && stored <= 23 ? stored : DEFAULT_NIGHTLY_HOUR
}

// The store's read view. `null` is "nothing stored", which has to stay distinguishable from a
// stored value: the client, not the store, owns every default.
export interface Settings {
  dataRoot: string | null
  geminiApiKeySet: boolean
  groqApiKeySet: boolean
  geminiModel: string | null
  driveEnabled: boolean | null
  gdriveRootFolder: string | null
  autoRun: string | null
  nightlyRun: boolean | null
  nightlyHour: number | null
  autoRemove: string | null
  autoRemoveAfter: string | null
  // The university's Moodle root, always the canonical `wwwroot` the site probe answered.
  moodleSite: string | null
  courseStructure: string | null
  // Launcher-only, like `privacyConfirmed`. Unset means off: nothing is sent before an explicit yes.
  errorReports: boolean | null
  // Whether the user answered the privacy policy, either way.
  privacyConfirmed: boolean
  // Launcher-only too: the "Study with AI" chat. The launcher reads an unknown value as null.
  aiProvider: string | null
}

// A write's answer: the read view, plus whether some service missed the error-reports switch and
// takes it only after a restart. Browser dev has no switch, so it is always false there.
export interface SavedSettings extends Settings {
  errorReportsRestartNeeded: boolean
}

// A partial save; omitted fields are left alone. The two keys are write-only — they go out here
// and never come back through `Settings`.
export interface SettingsPatch {
  dataRoot?: string
  geminiApiKey?: string
  groqApiKey?: string
  geminiModel?: string
  driveEnabled?: boolean
  gdriveRootFolder?: string
  autoRun?: AutoRun
  nightlyRun?: boolean
  // A number, never the raw string a `<select>` hands back: the store rejects a JSON string.
  nightlyHour?: number
  autoRemove?: AutoRemove
  autoRemoveAfter?: AutoRemoveAfter
  moodleSite?: string
  courseStructure?: CourseStructure
  errorReports?: boolean
  privacyConfirmed?: boolean
  aiProvider?: AiProvider
}

export type SettingsField = keyof SettingsPatch

const WIRE: Record<SettingsField, string> = {
  dataRoot: 'data_root',
  geminiApiKey: 'gemini_api_key',
  groqApiKey: 'groq_api_key',
  geminiModel: 'gemini_model',
  driveEnabled: 'drive_enabled',
  gdriveRootFolder: 'gdrive_root_folder',
  autoRun: 'auto_run',
  nightlyRun: 'nightly_run',
  nightlyHour: 'nightly_hour',
  autoRemove: 'auto_remove',
  autoRemoveAfter: 'auto_remove_after',
  moodleSite: 'moodle_site',
  courseStructure: 'course_structure',
  errorReports: 'error_reports',
  privacyConfirmed: 'privacy_confirmed',
  aiProvider: 'ai_provider',
}

// Each setting is owned by exactly one running service, so a save reaches one config endpoint and
// never another. Every field the store holds is named in one of them, bar three no service owns:
// `errorReports`, which the launcher itself pushes to every service, and the renderer-only
// `privacyConfirmed` and `aiProvider`.
const BACKEND_FIELDS: SettingsField[] = [
  'geminiApiKey',
  'groqApiKey',
  'geminiModel',
  'driveEnabled',
  'gdriveRootFolder',
  'autoRun',
  'nightlyRun',
  'nightlyHour',
  'autoRemove',
  'autoRemoveAfter',
]
const DATABASE_FIELDS: SettingsField[] = ['dataRoot', 'courseStructure']
const AUTO_FIELDS: SettingsField[] = ['moodleSite']

interface RawSettings {
  data_root: string | null
  gemini_api_key_set: boolean | null
  groq_api_key_set: boolean | null
  gemini_model: string | null
  drive_enabled: boolean | null
  gdrive_root_folder: string | null
  auto_run: string | null
  nightly_run: boolean | null
  nightly_hour: number | null
  auto_remove: string | null
  auto_remove_after: string | null
  moodle_site: string | null
  course_structure: string | null
  ai_provider: string | null
}

function normalize(raw: RawSettings): Settings {
  return {
    dataRoot: raw.data_root,
    geminiApiKeySet: raw.gemini_api_key_set ?? false,
    groqApiKeySet: raw.groq_api_key_set ?? false,
    geminiModel: raw.gemini_model,
    driveEnabled: raw.drive_enabled,
    gdriveRootFolder: raw.gdrive_root_folder,
    autoRun: raw.auto_run,
    nightlyRun: raw.nightly_run,
    nightlyHour: raw.nightly_hour,
    autoRemove: raw.auto_remove ?? null,
    autoRemoveAfter: raw.auto_remove_after ?? null,
    moodleSite: raw.moodle_site ?? null,
    courseStructure: raw.course_structure ?? null,
    aiProvider: raw.ai_provider ?? null,
    // The browser-dev store has neither; the switch and its privacy answer are Electron-only.
    errorReports: null,
    privacyConfirmed: false,
  }
}

/** The `PUT /settings` body for a patch: every named field, renamed to the store's wire keys. */
export function storeBody(patch: SettingsPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) body[WIRE[field as SettingsField]] = value
  }
  return body
}

/** The per-owner `POST /config` bodies for a patch; an owner with nothing to apply gets `null`. */
export function ownerBodies(patch: SettingsPatch): {
  backend: Record<string, unknown> | null
  database: Record<string, unknown> | null
  auto: Record<string, unknown> | null
} {
  const pick = (fields: SettingsField[]) => {
    const body: Record<string, unknown> = {}
    for (const field of fields) {
      const value = patch[field]
      if (value !== undefined) body[WIRE[field]] = value
    }
    return Object.keys(body).length ? body : null
  }
  return {
    backend: pick(BACKEND_FIELDS),
    database: pick(DATABASE_FIELDS),
    auto: pick(AUTO_FIELDS),
  }
}

/** Reads and writes the settings store. Two backings are permanent, neither is scaffolding: the
 *  Electron preload bridge in the packaged app, the database service in browser dev. */
export interface SettingsBacking {
  read(): Promise<Settings>
  write(patch: SettingsPatch): Promise<Settings & { errorReportsRestartNeeded?: boolean }>
}

const browserBacking: SettingsBacking = {
  read: async () => normalize(await database.get<RawSettings>('/settings')),
  write: async (patch) =>
    normalize(await database.put<RawSettings>('/settings', { json: storeBody(patch) })),
}

/** The single place the two backings are chosen between: the preload bridge exposes this exact
 *  interface, so a packaged app needs no adapter and browser dev keeps working unchanged. */
export function pickBacking(): SettingsBacking {
  return runtimeBridge()?.settings ?? browserBacking
}

export async function fetchSettings(): Promise<Settings> {
  return pickBacking().read()
}

/** Saves in two phases: the store first, since it is what a fresh boot reads back, then each
 *  changed field to its one owner's running process — so nothing ever needs a restart. */
export async function saveSettings(patch: SettingsPatch): Promise<SavedSettings> {
  const { errorReportsRestartNeeded, ...stored } = await pickBacking().write(patch)
  // The renderer's own reports follow the stored switch at once, whichever field was saved.
  applyErrorReports(stored.errorReports)
  const owners = ownerBodies(patch)
  if (owners.backend) await backend.post('/config', { json: owners.backend })
  if (owners.database) await database.post('/config', { json: owners.database })
  if (owners.auto) await autoDownloader.post('/config', { json: owners.auto })
  return { ...stored, errorReportsRestartNeeded: errorReportsRestartNeeded === true }
}

// The first-run wall's read-only check of a candidate data folder; `unknown` is anything short of a
// verdict, which never blocks — the save validates the folder again.
export type DataRootProbe =
  { kind: 'usable' } | { kind: 'unusable'; failure: ServiceFailure } | { kind: 'unknown' }

/** Asks the database whether `path` can hold the data. It answers 200 both ways, so only a request
 *  that never got a verdict lands in the catch. */
export async function probeDataRoot(path: string): Promise<DataRootProbe> {
  try {
    const raw = await database.post<{
      ok?: boolean
      error?: string
      code?: string
      params?: ErrorParams
    }>('/settings/data-root/probe', { json: { data_root: path } })
    if (raw.ok) return { kind: 'usable' }
    if (!raw.code) return { kind: 'unknown' }
    return {
      kind: 'unusable',
      failure: {
        message: raw.error ?? 'This folder cannot hold the data.',
        code: raw.code,
        params: raw.params ?? null,
      },
    }
  } catch {
    return { kind: 'unknown' }
  }
}

export interface Provider {
  id: string
  displayName: string
  keyPrefix: string
  consoleUrl: string
}

export interface ConfigOptions {
  providers: Provider[]
  geminiModels: string[]
}

interface RawOptions {
  providers: { id: string; display_name: string; key_prefix: string; console_url: string }[]
  gemini_models: string[]
}

export async function fetchConfigOptions(): Promise<ConfigOptions> {
  const raw = await backend.get<RawOptions>('/config/options')
  return {
    providers: raw.providers.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      keyPrefix: p.key_prefix,
      consoleUrl: p.console_url,
    })),
    geminiModels: raw.gemini_models,
  }
}

export type ProbeResult = 'valid' | 'rejected' | 'unverified'

/** Asks the backend to authenticate one key against its provider. Anything short of a verdict is
 *  `unverified` — an unreachable provider must never report a good key as bad. */
export async function probeKey(provider: string, key: string): Promise<ProbeResult> {
  try {
    const raw = await backend.post<{ result?: ProbeResult }>('/config/probe-key', {
      json: { provider, key },
    })
    return raw.result ?? 'unverified'
  } catch {
    return 'unverified'
  }
}

// The browser prerequisite: it gates downloads and none of the pipeline, so a missing browser is a
// degraded install, never a blocked one — `missingEntries` does not count it.
export interface BrowserPrereq {
  available: boolean
  // The resolved Playwright channel and its display name; both null when the chain came up empty.
  channel: string | null
  browser: string | null
  // One English diagnostic line, present either way — on a failure it names every channel tried.
  detail: string
}

/** Answers 200 both ways: "no browser" is an answer, not a failure. Only a success is cached
 *  server-side, so re-checking after the user installs one genuinely re-probes. */
export async function fetchBrowserPrereq(): Promise<BrowserPrereq> {
  return autoDownloader.get<BrowserPrereq>('/prereqs/browser')
}

// The pre-login check of a pasted address: `supported` carries the canonical root to store,
// `unsupported` a coded reason, `unverified` anything short of a verdict (network, bot wall).
// `captcha`: the bot wall opened a challenge window on screen waiting to be solved.
export interface SiteProbe {
  status: 'supported' | 'unsupported' | 'unverified'
  site: string | null
  failure: ServiceFailure | null
  captcha: boolean
}

/** Asks the auto-downloader whether `url` is a Moodle site FastStudy can use. A failed request is
 *  `unverified`, never `unsupported` — only the site itself may say it can't work. */
export async function probeMoodleSite(url: string): Promise<SiteProbe> {
  try {
    const raw = await autoDownloader.post<{
      status?: SiteProbe['status']
      site?: string | null
      message?: string
      code?: string
      params?: ErrorParams
    }>('/site/probe', { json: { url } })
    const status = raw.status ?? 'unverified'
    return {
      status,
      site: raw.site || null,
      failure: raw.code
        ? {
            message: raw.message ?? 'This Moodle site cannot be used.',
            code: raw.code,
            params: raw.params ?? null,
          }
        : null,
      captcha: raw.params?.challengeWindow === 'captcha',
    }
  } catch (err) {
    // A busy Moodle lock is no answer about the site; the caller waits it out and asks again.
    if (isMoodleBusyError(err)) throw err
    return { status: 'unverified', site: null, failure: null, captcha: false }
  }
}
