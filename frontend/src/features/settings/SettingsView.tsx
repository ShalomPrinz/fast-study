import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { Locale } from '@/services/i18n'
import {
  fetchConfigOptions,
  fetchSettings,
  saveSettings,
  type ConfigOptions,
  type Settings,
  type SettingsPatch,
} from '@/services/settings'
import { isConnectionError } from '@/services/http'
import { toast } from '@/services/toaster'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useSettingsContext } from '@/shared/contexts/SettingsContext'
import PageHeader from '@/shared/components/PageHeader'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { writePreference, readPreference } from '@/shared/utils/uiPreferences'
import ApiKeyField from './components/ApiKeyField'
import DataRootField from './components/DataRootField'
import DriveFields from './components/DriveFields'
import LanguageField from './components/LanguageField'
import { buildPatch, type SettingsForm } from './utils/patch'
import { missingEntries } from './utils/required'
import { runsAtRisk } from './utils/dataRootGuard'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/modal.css'
import '@/styles/settings-form.css'
import './SettingsView.css'

// The language applies the moment it is picked, so it is read off the active locale at save time
// rather than mirrored into the form.
type FormState = Omit<SettingsForm, 'uiLanguage'> & { runnerControlsVisible: boolean }

function initialForm(stored: Settings, options: ConfigOptions): FormState {
  return {
    geminiApiKey: '',
    groqApiKey: '',
    dataRoot: stored.dataRoot ?? '',
    driveEnabled: stored.driveEnabled ?? false,
    gdriveRootFolder: stored.gdriveRootFolder ?? '',
    geminiModel: stored.geminiModel ?? options.geminiModels[0] ?? '',
    runnerControlsVisible: readPreference('runnerControlsVisible'),
  }
}

// Every setting the app has, in one place. See docs/SETTINGS.md.
export default function SettingsView() {
  const { t, i18n } = useLingui()
  const { status } = useRunnerStatus()
  const { setSettings } = useSettingsContext()
  const [stored, setStored] = useState<Settings | null>(null)
  const [options, setOptions] = useState<ConfigOptions | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  // A save held back by the advisory data-root guard, with the runs it would split.
  const [pending, setPending] = useState<{ patch: SettingsPatch; runs: string[] } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [next, opts] = await Promise.all([fetchSettings(), fetchConfigOptions()])
        setStored(next)
        setOptions(opts)
        setForm(initialForm(next, opts))
      } catch {
        // A downed service is already toasted centrally by the http client.
      }
    }
    void load()
  }, [])

  if (!stored || !options || !form) {
    return (
      <main className="main-view main-view--page">
        <PageHeader title={t`Settings`} />
      </main>
    )
  }

  // Aliased so the async save below keeps the non-null narrowing the early return established.
  const current = form
  const patch = () => buildPatch({ ...current, uiLanguage: i18n.locale as Locale }, stored)

  const missing = missingEntries({
    geminiKey: form.geminiApiKey,
    geminiKeyStored: stored.geminiApiKeySet,
    groqKey: form.groqApiKey,
    groqKeyStored: stored.groqApiKeySet,
    dataRoot: form.dataRoot,
    // Confirming a prefilled root belongs to the init wall; here the field is simply edited.
    dataRootConfirmed: true,
    driveEnabled: form.driveEnabled,
    gdriveRootFolder: form.gdriveRootFolder,
  })

  async function commit(next: SettingsPatch) {
    setSaving(true)
    setPending(null)
    // Unconditional and ahead of the network: this one is localStorage-only, so a downed service
    // must not cost the user a toggle that never needed a request in the first place.
    writePreference('runnerControlsVisible', current.runnerControlsVisible)
    try {
      const saved = await saveSettings(next)
      setStored(saved)
      setSettings(saved)
      // The key fields are write-only, so they go back to their "a key is saved" placeholder.
      setForm({ ...current, geminiApiKey: '', groqApiKey: '' })
      toast('info', t`Settings saved`)
    } catch (err) {
      // The http client already toasts a connection error, but that toast is deduped per service and
      // reads as ambient noise — a save that went nowhere still owes its own verdict.
      toast(
        'error',
        isConnectionError(err)
          ? t`Couldn't save all settings — check the services are running and try again.`
          : `${(err as Error).message}`,
      )
    } finally {
      setSaving(false)
    }
  }

  function save() {
    const next = patch()
    const runs = runsAtRisk(next, status)
    if (runs) setPending({ patch: next, runs })
    else void commit(next)
  }

  const provider = (id: string) => options.providers.find((p) => p.id === id)
  const gemini = provider('gemini')
  const groq = provider('groq')

  return (
    <main className="main-view main-view--page">
      <PageHeader
        title={t`Settings`}
        actions={
          <button
            className="btn btn--primary"
            disabled={saving || missing.length > 0}
            onClick={save}
          >
            <Trans>Save</Trans>
          </button>
        }
      />
      <div className="page-body">
        <div className="page-column settings-page">
          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>API keys</Trans>
            </h2>
            {gemini && (
              <ApiKeyField
                provider={gemini}
                value={form.geminiApiKey}
                onChange={(v) => setForm({ ...form, geminiApiKey: v })}
                storedKeyExists={stored.geminiApiKeySet}
              />
            )}
            {groq && (
              <ApiKeyField
                provider={groq}
                value={form.groqApiKey}
                onChange={(v) => setForm({ ...form, groqApiKey: v })}
                storedKeyExists={stored.groqApiKeySet}
              />
            )}
            <div className="settings-field">
              <div className="settings-label">
                <label htmlFor="gemini-model">
                  <Trans>Summary model</Trans>
                </label>
              </div>
              <select
                id="gemini-model"
                className="settings-select"
                value={form.geminiModel}
                onChange={(e) => setForm({ ...form, geminiModel: e.target.value })}
              >
                {options.geminiModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Storage</Trans>
            </h2>
            <DataRootField
              value={form.dataRoot}
              onChange={(v) => setForm({ ...form, dataRoot: v })}
            />
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Google Drive</Trans>
            </h2>
            <DriveFields
              value={{ enabled: form.driveEnabled, folder: form.gdriveRootFolder }}
              onChange={(v) =>
                setForm({ ...form, driveEnabled: v.enabled, gdriveRootFolder: v.folder })
              }
              folderMissing={missing.includes('gdriveRootFolder')}
            />
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Appearance and behaviour</Trans>
            </h2>
            <LanguageField />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.runnerControlsVisible}
                onChange={(e) => setForm({ ...form, runnerControlsVisible: e.target.checked })}
              />
              <span className="settings-check-text">
                <span>
                  <Trans>Show the run controls in the sidebar</Trans>
                </span>
                <span className="settings-hint">
                  <Trans>
                    The "Run incomplete pipelines" button and the list of lectures being worked on.
                  </Trans>
                </span>
              </span>
            </label>
          </section>
        </div>
      </div>

      {pending && (
        <ConfirmModal
          message={t`Change the data folder while lectures are being processed?`}
          warning={t`A lecture running now would have its earlier files in the old folder and the rest in the new one.`}
          detail={
            pending.runs.length > 0 ? (
              <ul className="settings-run-list">
                {pending.runs.map((run) => (
                  <li key={run} dir="auto">
                    {run}
                  </li>
                ))}
              </ul>
            ) : undefined
          }
          onConfirm={() => void commit(pending.patch)}
          onCancel={() => setPending(null)}
        />
      )}
    </main>
  )
}
