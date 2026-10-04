import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AuthStatusProvider } from '@/features/downloads/contexts/AuthStatusContext'
import { failureNode } from '@/shared/utils/failure'
import { canStoreApiKeys } from '@/services/runtime'
import {
  toAutoRun,
  toNightlyHour,
  fetchConfigOptions,
  saveSettings,
  type ConfigOptions,
  type Provider,
  type Settings,
} from '@/services/settings'
import ApiKeyField from './components/ApiKeyField'
import BrowserPrereqField from './components/BrowserPrereqField'
import { useBrowserPrereq } from './hooks/useBrowserPrereq'
import DataRootField from './components/DataRootField'
import DriveFields from './components/DriveFields'
import LanguageField from './components/LanguageField'
import MoodleAccountField from './components/MoodleAccountField'
import MoodleSiteField from './components/MoodleSiteField'
import SecureStorageNotice from './components/SecureStorageNotice'
import { buildPatch, type SettingsForm } from './utils/patch'
import { missingEntries, sectionMark } from './utils/required'
import '@/styles/button.css'
import '@/styles/chip.css'
import '@/styles/spinner.css'
import '@/styles/settings-form.css'
import './InitWall.css'

interface Props {
  stored: Settings
  // Handed the saved settings, not just a signal: they are what the app behind the wall runs on.
  onDone: (saved: Settings) => void
}

type FormState = SettingsForm

type Mark = 'required' | 'done' | 'optional'

// A section heading with its mark at the row's inline end: red until a required section is complete,
// green once it is, gray for one that never blocks.
function SectionTitle({ mark, children }: { mark?: Mark; children: ReactNode }) {
  return (
    <div className="init-wall-section-head">
      <h2 className="settings-section-title">{children}</h2>
      {mark === 'required' && (
        <span className="chip chip--danger init-wall-mark" data-mark="required">
          <Trans context="section mark">Required</Trans>
        </span>
      )}
      {mark === 'done' && (
        <span className="chip chip--ok init-wall-mark" data-mark="done">
          <Trans context="section mark">Done</Trans>
        </span>
      )}
      {mark === 'optional' && (
        <span className="chip chip--neutral init-wall-mark" data-mark="optional">
          <Trans context="section mark">Optional</Trans>
        </span>
      )}
    </div>
  )
}

// The wall in front of the app: until the required entries are filled there is no sidebar, no route
// and no way past. See docs/SETTINGS.md.
export default function InitWall({ stored: initial, onDone }: Props) {
  const { t } = useLingui()
  // The store as this wall last wrote it: a confirmed site is saved ahead of the rest of the form.
  const [stored, setStored] = useState(initial)
  const siteSaves = useRef(Promise.resolve())
  const [options, setOptions] = useState<ConfigOptions | null>(null)
  const [form, setForm] = useState<FormState>({
    geminiApiKey: '',
    groqApiKey: '',
    // In browser dev the prefill is whatever the store already holds.
    dataRoot: stored.dataRoot ?? '',
    driveEnabled: stored.driveEnabled ?? false,
    gdriveRootFolder: stored.gdriveRootFolder ?? '',
    geminiModel: stored.geminiModel ?? '',
    // Not asked about here — carried through so the wall's save leaves the defaults alone. A first
    // install has nothing to catch up on, so the cron's switch and hour belong on `/settings` only.
    autoRun: toAutoRun(stored.autoRun),
    nightlyRun: stored.nightlyRun ?? true,
    nightlyHour: toNightlyHour(stored.nightlyHour),
    moodleSite: stored.moodleSite ?? '',
  })
  const [dataRootUnusable, setDataRootUnusable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [siteChecking, setSiteChecking] = useState(false)
  const [failure, setFailure] = useState<ReactNode>(null)
  const browser = useBrowserPrereq()

  useEffect(() => {
    async function load() {
      try {
        const opts = await fetchConfigOptions()
        setOptions(opts)
        setForm((f) => ({ ...f, geminiModel: f.geminiModel || (opts.geminiModels[0] ?? '') }))
      } catch {
        // A downed service is already toasted centrally by the http client.
      }
    }
    void load()
  }, [])

  const missing = missingEntries({
    geminiKey: form.geminiApiKey,
    geminiKeyStored: stored.geminiApiKeySet,
    groqKey: form.groqApiKey,
    groqKeyStored: stored.groqApiKeySet,
    dataRoot: form.dataRoot,
    dataRootUnusable,
    driveEnabled: form.driveEnabled,
    gdriveRootFolder: form.gdriveRootFolder,
    canStoreApiKeys,
  })

  async function finish() {
    setSaving(true)
    setFailure(null)
    try {
      // A site save still in flight lands first; resending the same site is a no-op for its owner.
      await siteSaves.current
      onDone(await saveSettings(buildPatch(form, stored)))
    } catch (err) {
      // Shown in place, not toasted: a rejected data folder is the one thing standing in the way.
      setFailure(failureNode(err))
    } finally {
      setSaving(false)
    }
  }

  // A site the probe confirms is written at once, so the account can be connected on the wall. Saves
  // are chained, so a quick second pick can never land before the first and leave it stored.
  function saveSite(site: string) {
    siteSaves.current = siteSaves.current.then(async () => {
      try {
        setStored(await saveSettings({ moodleSite: site }))
      } catch (err) {
        setFailure(failureNode(err))
      }
    })
  }

  function keyField(provider: Provider | undefined, field: 'geminiApiKey' | 'groqApiKey') {
    if (!provider) return null
    return (
      <ApiKeyField
        provider={provider}
        value={form[field]}
        onChange={(v) => setForm({ ...form, [field]: v })}
        storedKeyExists={field === 'geminiApiKey' ? stored.geminiApiKeySet : stored.groqApiKeySet}
      />
    )
  }

  return (
    <div className="init-wall" data-testid="init-wall">
      <div className="init-wall-card">
        <header className="init-wall-header">
          {/* The product name is a brand, not copy — it reads the same in every locale. */}
          <p className="init-wall-brand">Fast Study</p>
          <h1 className="init-wall-title">
            <Trans>Let's set things up</Trans>
          </h1>
          <p className="init-wall-lede">
            <Trans>This only needs to be done once.</Trans>
          </p>
        </header>

        <section className="settings-section">
          <LanguageField />
        </section>

        {!options ? (
          <div className="init-wall-loading">
            <div className="spinner" />
          </div>
        ) : (
          <>
            <section className="settings-section">
              {/* Keys the machine cannot store are never required, and an optional mark would invite
                  filling a section that has no fields. */}
              <SectionTitle
                mark={
                  canStoreApiKeys ? sectionMark(missing, ['geminiApiKey', 'groqApiKey']) : undefined
                }
              >
                <Trans>Your two API keys</Trans>
              </SectionTitle>
              {/* The note stands in for the whole section body: on a first-run gate a field that
                  cannot be filled is noise, so only the heading survives beside it. */}
              <SecureStorageNotice />
              {canStoreApiKeys && (
                <>
                  <p className="settings-hint">
                    <Trans>
                      Fast Study uses two free services: one turns the recording into text, the
                      other writes the summary. Both need a key of your own, and both are free to
                      create.
                    </Trans>
                  </p>
                  <p className="settings-note">
                    <Trans>
                      Your keys are kept only on this computer, encrypted by Windows. Fast Study has
                      no servers of its own — each key is sent only to the service it belongs to.
                    </Trans>
                  </p>
                  {keyField(
                    options.providers.find((p) => p.id === 'gemini'),
                    'geminiApiKey',
                  )}
                  {keyField(
                    options.providers.find((p) => p.id === 'groq'),
                    'groqApiKey',
                  )}
                </>
              )}
            </section>

            <section className="settings-section">
              <SectionTitle mark={sectionMark(missing, ['dataRoot'])}>
                <Trans>Where to keep everything</Trans>
              </SectionTitle>
              <DataRootField
                value={form.dataRoot}
                onChange={(v) => setForm({ ...form, dataRoot: v })}
                onUnusableChange={setDataRootUnusable}
              />
            </section>

            <section className="settings-section">
              <SectionTitle mark="optional">
                <Trans>Your university</Trans>
              </SectionTitle>
              <MoodleSiteField
                value={form.moodleSite}
                // Functional: the probe answers after other fields may have changed.
                onChange={(v) => setForm((f) => ({ ...f, moodleSite: v }))}
                onSupported={saveSite}
                onChecking={setSiteChecking}
              />
              {/* The wall renders outside `Layout`, so it brings its own provider — the account
                  chip is the only consumer that gets this far. */}
              <AuthStatusProvider>
                <MoodleAccountField
                  site={stored.moodleSite}
                  switching={!!form.moodleSite && form.moodleSite !== (stored.moodleSite ?? '')}
                />
              </AuthStatusProvider>
            </section>

            <section className="settings-section">
              {/* Optional even with Drive on and no folder: that gap is the field's own error. */}
              <SectionTitle mark="optional">
                <Trans>Google Drive</Trans>
              </SectionTitle>
              <DriveFields
                value={{ enabled: form.driveEnabled, folder: form.gdriveRootFolder }}
                onChange={(v) =>
                  setForm({ ...form, driveEnabled: v.enabled, gdriveRootFolder: v.folder })
                }
                folderMissing={missing.includes('gdriveRootFolder')}
              />
            </section>

            {/* A first run has nothing to say about a browser that is there: the section appears only
                once a check finds none, and then stays so a re-check can answer in place. */}
            {browser.missingSeen && (
              <section className="settings-section">
                <SectionTitle mark="optional">
                  <Trans>Downloading recordings</Trans>
                </SectionTitle>
                <BrowserPrereqField state={browser.state} onRecheck={() => void browser.check()} />
              </section>
            )}
          </>
        )}

        <footer className="init-wall-footer">
          {failure && <p className="settings-status settings-status--danger">{failure}</p>}
          {missing.length > 0 && (
            <p className="settings-status">
              <Trans>Fill in the fields above to continue.</Trans>
            </p>
          )}
          <button
            className="btn btn--primary"
            data-testid="init-wall-submit"
            disabled={saving || siteChecking || !options || missing.length > 0}
            onClick={() => void finish()}
          >
            {saving ? t`Saving…` : t`Start using Fast Study`}
          </button>
        </footer>
      </div>
    </div>
  )
}
