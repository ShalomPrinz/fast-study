import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AuthStatusProvider } from '@/features/downloads/contexts/AuthStatusContext'
import { failureNode } from '@/shared/utils/failure'
import { canSetErrorReports, canStoreApiKeys, runtimeBridge } from '@/services/runtime'
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
import ErrorReportsField from './components/ErrorReportsField'
import PrivacyPolicyModal from './components/PrivacyPolicyModal'
import LanguageField from './components/LanguageField'
import MoodleAccountField from './components/MoodleAccountField'
import MoodleSiteField from './components/MoodleSiteField'
import { buildPatch, type SettingsForm } from './utils/patch'
import { privacyAnswer, wallMustAskPrivacy } from './utils/privacy'
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
  // The site the store holds once every queued site save has landed, so a repeat is never resent.
  const savedSite = useRef(initial.moodleSite ?? '')
  const [options, setOptions] = useState<ConfigOptions | null>(null)
  const [form, setForm] = useState<FormState>({
    geminiApiKey: '',
    groqApiKey: '',
    // Packaged, the launcher's default fills the field; browser dev has none, so it starts empty.
    dataRoot: stored.dataRoot ?? runtimeBridge()?.defaultDataRoot ?? '',
    driveEnabled: stored.driveEnabled ?? false,
    // The brand, not copy: the folder lands in the user's Drive under the same name in every locale.
    gdriveRootFolder: stored.gdriveRootFolder ?? 'FastStudy',
    geminiModel: stored.geminiModel ?? '',
    // Not asked about here — carried through so the wall's save leaves the defaults alone. A first
    // install has nothing to catch up on, so the cron's switch and hour belong on `/settings` only.
    autoRun: toAutoRun(stored.autoRun),
    nightlyRun: stored.nightlyRun ?? true,
    nightlyHour: toNightlyHour(stored.nightlyHour),
    moodleSite: stored.moodleSite ?? '',
    // Starts checked for a first answer, though unset means off until the wall's save stores it.
    errorReports: stored.errorReports ?? true,
    privacyConfirmed: stored.privacyConfirmed,
  })
  const [dataRootUnusable, setDataRootUnusable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [siteChecking, setSiteChecking] = useState(false)
  const [failure, setFailure] = useState<ReactNode>(null)
  // Save was pressed with the policy unanswered: its answer saves at once, so Start is never pressed twice.
  const [askingPrivacy, setAskingPrivacy] = useState(false)
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

  function start() {
    if (wallMustAskPrivacy(form.privacyConfirmed, canSetErrorReports)) setAskingPrivacy(true)
    else void finish(form)
  }

  async function finish(answered: FormState) {
    setSaving(true)
    setFailure(null)
    try {
      // A site save still in flight lands first; resending the same site is a no-op for its owner.
      await siteSaves.current
      const patch = buildPatch(answered, stored)
      // Always explicit here, so the checked default is stored as the user's own yes or no.
      if (canSetErrorReports) patch.errorReports = answered.errorReports
      onDone(await saveSettings(patch))
    } catch (err) {
      // Shown in place, not toasted: a rejected data folder is the one thing standing in the way.
      setFailure(failureNode(err))
    } finally {
      setSaving(false)
    }
  }

  // A site the probe confirms, or `''` for no university, is written at once, so the account can be
  // connected on the wall and never outlives its site. Saves are chained, so a quick second pick can
  // never land before the first and leave it stored.
  function saveSite(site: string) {
    siteSaves.current = siteSaves.current.then(async () => {
      if (site === savedSite.current) return
      try {
        const saved = await saveSettings({ moodleSite: site })
        savedSite.current = saved.moodleSite ?? ''
        setStored(saved)
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
          <p className="init-wall-brand">FastStudy</p>
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
            {/* A machine that cannot store keys gets no keys section at all: on a first-run gate a
                field that can never be filled is noise, and the keys stop counting toward the gate. */}
            {canStoreApiKeys && (
              <section className="settings-section">
                <SectionTitle mark={sectionMark(missing, ['geminiApiKey', 'groqApiKey'])}>
                  <Trans>Your two API keys</Trans>
                </SectionTitle>
                <p className="settings-hint">
                  <Trans>
                    FastStudy uses two free services: one turns the recording into text, the other
                    writes the summary. Both need a key of your own, and both are free to create.
                  </Trans>
                </p>
                <p className="settings-note">
                  <Trans>
                    Your keys are kept only on this computer, encrypted by Windows. FastStudy has no
                    servers of its own — each key is sent only to the service it belongs to.
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
              </section>
            )}

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
                onChange={(v) => {
                  setForm((f) => ({ ...f, moodleSite: v }))
                  if (v === '') saveSite('')
                }}
                onSupported={saveSite}
                onChecking={setSiteChecking}
              />
              {/* The wall renders outside `Layout`, so it brings its own provider — the account
                  chip is the only consumer that gets this far. */}
              <AuthStatusProvider>
                <MoodleAccountField
                  site={stored.moodleSite}
                  switching={
                    form.moodleSite !== null && form.moodleSite !== (stored.moodleSite ?? '')
                  }
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

            {canSetErrorReports && (
              <section className="settings-section">
                <SectionTitle mark="optional">
                  <Trans>Error reports</Trans>
                </SectionTitle>
                <ErrorReportsField
                  value={form.errorReports}
                  confirmed={form.privacyConfirmed}
                  onChange={(v) => setForm({ ...form, errorReports: v })}
                  onAnswer={(confirmed) => setForm({ ...form, ...privacyAnswer(confirmed) })}
                  notice={
                    !form.privacyConfirmed && (
                      <p className="settings-note" data-privacy-required>
                        <Trans>You must read the privacy policy before you continue.</Trans>
                      </p>
                    )
                  }
                />
              </section>
            )}

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
            onClick={start}
          >
            {saving ? t`Saving…` : t`Start using FastStudy`}
          </button>
          {askingPrivacy && (
            <PrivacyPolicyModal
              onAnswer={(confirmed) => {
                const answered = { ...form, ...privacyAnswer(confirmed) }
                setAskingPrivacy(false)
                setForm(answered)
                void finish(answered)
              }}
              onClose={() => setAskingPrivacy(false)}
            />
          )}
        </footer>
      </div>
    </div>
  )
}
