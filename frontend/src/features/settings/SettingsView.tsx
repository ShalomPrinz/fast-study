import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  fetchConfigOptions,
  fetchSettings,
  saveSettings,
  type AutoRun,
  type ConfigOptions,
  type Settings,
  type SettingsPatch,
} from '@/services/settings'
import { isConnectionError } from '@/services/http'
import { canSetErrorReports, canStoreApiKeys } from '@/services/runtime'
import { toast } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useSettingsContext } from '@/shared/contexts/SettingsContext'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import PageHeader from '@/shared/components/PageHeader'
import ConfirmModal from '@/shared/components/ConfirmModal'
import ApiKeyField from './components/ApiKeyField'
import BrowserPrereqField from './components/BrowserPrereqField'
import { useBrowserPrereq } from './hooks/useBrowserPrereq'
import DataRootField from './components/DataRootField'
import DriveFields from './components/DriveFields'
import ErrorReportsField from './components/ErrorReportsField'
import LanguageField from './components/LanguageField'
import MoodleAccountField from './components/MoodleAccountField'
import MoodleSiteField from './components/MoodleSiteField'
import SecureStorageNotice from './components/SecureStorageNotice'
import { buildPatch, formFromStore, type SettingsForm } from './utils/patch'
import { missingEntries } from './utils/required'
import { runsAtRisk } from './utils/dataRootGuard'
import { privacyAnswer, restartNotice } from './utils/privacy'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/modal.css'
import '@/styles/settings-form.css'
import './SettingsView.css'

// The hours the nightly pass can be set to. The value stays a number all the way to the wire — the
// store rejects a JSON string — while the label is a clock time, which reads the same in every locale.
const NIGHTLY_HOURS = Array.from({ length: 24 }, (_, hour) => hour)

// A save held back by an advisory guard: a site switch that drops the connected account, or a data
// root change that would split the runs in flight.
type Pending =
  | { guard: 'site'; patch: SettingsPatch }
  | { guard: 'dataRoot'; patch: SettingsPatch; runs: string[] }

// Every setting the app has, in one place. See docs/SETTINGS.md.
export default function SettingsView() {
  const { t } = useLingui()
  const { status } = useRunnerStatus()
  const { setSettings } = useSettingsContext()
  const { status: account, refresh: refreshAccount } = useAuthStatus()
  const browser = useBrowserPrereq()
  const [stored, setStored] = useState<Settings | null>(null)
  const [options, setOptions] = useState<ConfigOptions | null>(null)
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [siteChecking, setSiteChecking] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  // The switch state some part of the app takes only after a restart, from the last save.
  const [reportsRestart, setReportsRestart] = useState<'on' | 'off' | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [next, opts] = await Promise.all([fetchSettings(), fetchConfigOptions()])
        setStored(next)
        setOptions(opts)
        setForm(formFromStore(next, opts))
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
  const currentOptions = options
  const patch = () => buildPatch(current, stored)

  const missing = missingEntries({
    geminiKey: form.geminiApiKey,
    geminiKeyStored: stored.geminiApiKeySet,
    groqKey: form.groqApiKey,
    groqKeyStored: stored.groqApiKeySet,
    dataRoot: form.dataRoot,
    // Confirming a prefilled root belongs to the init wall; here the field is simply edited.
    dataRootUnusable: false,
    driveEnabled: form.driveEnabled,
    gdriveRootFolder: form.gdriveRootFolder,
    canStoreApiKeys,
  })

  async function commit(next: SettingsPatch) {
    setSaving(true)
    setPending(null)
    try {
      const saved = await saveSettings(next)
      // Only a save of the switch answers about it; any other save leaves the notice standing.
      if (next.errorReports !== undefined) setReportsRestart(restartNotice(saved))
      setStored(saved)
      setSettings(saved)
      // The whole form takes the store's answer: keys return to their placeholder, the data root to its
      // normalized spelling, and a field another writer changed since load stops reading as an edit.
      setForm(formFromStore(saved, currentOptions))
      // The auto-downloader dropped the old site's account, so every chip needs a fresh answer.
      if (next.moodleSite !== undefined) void refreshAccount()
      toast('info', t`Settings saved`)
    } catch (err) {
      // The http client already toasts a connection error, but that toast is deduped per service and
      // reads as ambient noise — a save that went nowhere still owes its own verdict.
      if (isConnectionError(err)) {
        toast('error', t`Couldn't save all settings. Restart the app and try again.`)
      } else {
        toastFailure(err)
      }
    } finally {
      setSaving(false)
    }
  }

  function save() {
    const next = patch()
    if (next.moodleSite !== undefined && account?.connected && !account.expired) {
      setPending({ guard: 'site', patch: next })
    } else guardDataRoot(next)
  }

  function guardDataRoot(next: SettingsPatch) {
    const runs = runsAtRisk(next, status)
    if (runs) setPending({ guard: 'dataRoot', patch: next, runs })
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
            disabled={saving || siteChecking || missing.length > 0}
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
            {/* The note stands in for the whole section: with no key to store, neither a key
                field nor the model that would consume one has anything to offer. */}
            <SecureStorageNotice />
            {canStoreApiKeys && (
              <>
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
              </>
            )}
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
              <Trans>Downloading recordings</Trans>
            </h2>
            <BrowserPrereqField state={browser.state} onRecheck={() => void browser.check()} />
            <MoodleSiteField
              value={form.moodleSite}
              // Functional: the probe answers after other fields may have changed.
              onChange={(v) => setForm((f) => f && { ...f, moodleSite: v })}
              onChecking={setSiteChecking}
            />
            <MoodleAccountField
              site={stored.moodleSite}
              switching={form.moodleSite !== null && form.moodleSite !== (stored.moodleSite ?? '')}
            />
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Appearance and behaviour</Trans>
            </h2>
            <LanguageField />
            <div className="settings-field">
              <div className="settings-label">
                <label htmlFor="auto-run">
                  <Trans>When a new video arrives</Trans>
                </label>
              </div>
              <select
                id="auto-run"
                className="settings-select"
                value={form.autoRun}
                onChange={(e) => setForm({ ...form, autoRun: e.target.value as AutoRun })}
              >
                <option value="full">{t`Run the whole pipeline`}</option>
                <option value="audio">{t`Extract the audio only`}</option>
                <option value="off">{t`Do nothing — I'll start runs myself`}</option>
              </select>
              <span className="settings-hint">
                <Trans>
                  This applies only to work that starts on its own: a video you drop in, a video
                  that finishes downloading, and the daily run. Runs you start yourself are not
                  affected.
                </Trans>
              </span>
            </div>
            <div className="settings-field">
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={form.nightlyRun}
                  onChange={(e) => setForm({ ...form, nightlyRun: e.target.checked })}
                />
                <span className="settings-check-text">
                  <span>
                    <Trans>Run unfinished lectures daily</Trans>
                  </span>
                </span>
              </label>
              <div className="settings-label">
                <label htmlFor="nightly-hour">
                  <Trans>Daily run time</Trans>
                </label>
              </div>
              <select
                id="nightly-hour"
                className="settings-select"
                value={form.nightlyHour}
                disabled={!form.nightlyRun}
                onChange={(e) => setForm({ ...form, nightlyHour: Number(e.target.value) })}
              >
                {NIGHTLY_HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {`${String(hour).padStart(2, '0')}:00`}
                  </option>
                ))}
              </select>
              <span className="settings-hint">
                <Trans>
                  The daily run also follows the setting above: if it's set to do nothing, the daily
                  run does nothing either.
                </Trans>
              </span>
            </div>
          </section>

          {canSetErrorReports && (
            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Error reports</Trans>
              </h2>
              <ErrorReportsField
                value={form.errorReports}
                confirmed={form.privacyConfirmed}
                onChange={(v) => setForm({ ...form, errorReports: v })}
                onAnswer={(confirmed) => setForm({ ...form, ...privacyAnswer(confirmed) })}
                notice={
                  reportsRestart && (
                    <p
                      className="settings-note settings-note--warn"
                      data-reports-restart={reportsRestart}
                    >
                      {reportsRestart === 'on' ? (
                        <Trans>
                          Error reports are now on. Some parts of FastStudy will start sending them
                          only after you restart the app.
                        </Trans>
                      ) : (
                        <Trans>
                          Error reports are now off. Some parts of FastStudy will stop sending them
                          only after you restart the app.
                        </Trans>
                      )}
                    </p>
                  )
                }
              />
            </section>
          )}
        </div>
      </div>

      {pending?.guard === 'site' && (
        <ConfirmModal
          // A blank site is "no university": it drops the account just the same, with nothing to connect to.
          message={
            pending.patch.moodleSite ? t`Switch to another university?` : t`Remove your university?`
          }
          warning={
            pending.patch.moodleSite
              ? t`This disconnects your current account. Connecting to the new site needs a full login in a browser window.`
              : t`This disconnects your current account, and recordings can no longer be found on its Moodle site.`
          }
          onConfirm={() => {
            setPending(null)
            guardDataRoot(pending.patch)
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.guard === 'dataRoot' && (
        <ConfirmModal
          message={t`Change the data folder while lectures are being processed?`}
          warning={t`A lecture running now would save some files in the old folder and the rest in the new one.`}
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
