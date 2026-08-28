import type { Locale } from '@/services/i18n'
import { LOCALES } from '@/services/i18n'
import { createClient } from './http'

// This file is the boundary for the settings concern, which spans both services by design: a
// setting's owner is a property of the setting, not of the screen editing it.
const backend = createClient(
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  'backend service',
)
const database = createClient(
  import.meta.env.VITE_DATABASE_URL ?? 'http://localhost:8001',
  'database service',
)

// The store's read view. `null` is "nothing stored", which has to stay distinguishable from a
// stored value: the client, not the store, owns every default.
export interface Settings {
  dataRoot: string | null
  geminiApiKeySet: boolean
  groqApiKeySet: boolean
  geminiModel: string | null
  driveEnabled: boolean | null
  gdriveRootFolder: string | null
  uiLanguage: Locale | null
  autoRunOnBoot: boolean | null
  runnerControlsVisible: boolean | null
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
  uiLanguage?: Locale
  autoRunOnBoot?: boolean
  runnerControlsVisible?: boolean
}

export type SettingsField = keyof SettingsPatch

const WIRE: Record<SettingsField, string> = {
  dataRoot: 'data_root',
  geminiApiKey: 'gemini_api_key',
  groqApiKey: 'groq_api_key',
  geminiModel: 'gemini_model',
  driveEnabled: 'drive_enabled',
  gdriveRootFolder: 'gdrive_root_folder',
  uiLanguage: 'ui_language',
  autoRunOnBoot: 'auto_run_on_boot',
  runnerControlsVisible: 'runner_controls_visible',
}

// Each setting is owned by exactly one running service, so a save reaches one config endpoint and
// never both. The three fields named in neither list are the frontend's own — store-only.
const BACKEND_FIELDS: SettingsField[] = [
  'geminiApiKey',
  'groqApiKey',
  'geminiModel',
  'driveEnabled',
  'gdriveRootFolder',
]
const DATABASE_FIELDS: SettingsField[] = ['dataRoot']

interface RawSettings {
  data_root: string | null
  gemini_api_key_set: boolean | null
  groq_api_key_set: boolean | null
  gemini_model: string | null
  drive_enabled: boolean | null
  gdrive_root_folder: string | null
  ui_language: string | null
  auto_run_on_boot: boolean | null
  runner_controls_visible: boolean | null
}

function asLocale(value: string | null): Locale | null {
  return (LOCALES as readonly string[]).includes(value ?? '') ? (value as Locale) : null
}

function normalize(raw: RawSettings): Settings {
  return {
    dataRoot: raw.data_root,
    geminiApiKeySet: raw.gemini_api_key_set ?? false,
    groqApiKeySet: raw.groq_api_key_set ?? false,
    geminiModel: raw.gemini_model,
    driveEnabled: raw.drive_enabled,
    gdriveRootFolder: raw.gdrive_root_folder,
    uiLanguage: asLocale(raw.ui_language),
    autoRunOnBoot: raw.auto_run_on_boot,
    runnerControlsVisible: raw.runner_controls_visible,
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
} {
  const pick = (fields: SettingsField[]) => {
    const body: Record<string, unknown> = {}
    for (const field of fields) {
      const value = patch[field]
      if (value !== undefined) body[WIRE[field]] = value
    }
    return Object.keys(body).length ? body : null
  }
  return { backend: pick(BACKEND_FIELDS), database: pick(DATABASE_FIELDS) }
}

/** Reads and writes the settings store. Two backings are permanent, neither is scaffolding: the
 *  Electron preload bridge in the packaged app, the database service in browser dev. */
export interface SettingsBacking {
  read(): Promise<Settings>
  write(patch: SettingsPatch): Promise<Settings>
}

const browserBacking: SettingsBacking = {
  read: async () => normalize(await database.get<RawSettings>('/settings')),
  write: async (patch) =>
    normalize(await database.put<RawSettings>('/settings', { json: storeBody(patch) })),
}

declare global {
  interface Window {
    faststudy?: { settings?: SettingsBacking }
  }
}

/** The single place the two backings are chosen between: the preload bridge exposes this exact
 *  interface, so a packaged app needs no adapter and browser dev keeps working unchanged. */
export function pickBacking(): SettingsBacking {
  const bridge = typeof window === 'undefined' ? undefined : window.faststudy?.settings
  return bridge ?? browserBacking
}

export async function fetchSettings(): Promise<Settings> {
  return pickBacking().read()
}

/** Saves in two phases: the store first, since it is what a fresh boot reads back, then each
 *  changed field to its one owner's running process — so nothing ever needs a restart. */
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  const stored = await pickBacking().write(patch)
  const owners = ownerBodies(patch)
  if (owners.backend) await backend.post('/config', { json: owners.backend })
  if (owners.database) await database.post('/config', { json: owners.database })
  return stored
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
