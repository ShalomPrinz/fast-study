import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import {
  fetchConfigOptions,
  fetchSettings,
  type AutoRemoveAfter,
  type AutoRun,
  toCourseStructure,
  type ConfigOptions,
  type Settings,
  type SettingsPatch,
} from '@/services/settings'
import { isConnectionError } from '@/services/http'
import { applyAutoRemove } from '@/services/backend'
import { canSetErrorReports, canStoreApiKeys } from '@/services/runtime'
import { toast } from '@/services/toaster'
import { failureNode, toastFailure } from '@/shared/utils/failure'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { useSettingsContext } from '@/shared/contexts/SettingsContext'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { AI_PROVIDER_IDS, AI_PROVIDERS, type AiProvider } from '@/features/lectures/utils/aiChat'
import { useNotify } from '@/shared/hooks/useNotify'
import PageHeader from '@/shared/components/PageHeader'
import ConfirmModal from '@/shared/components/ConfirmModal'
import ApiKeyField from './components/ApiKeyField'
import BrowserPrereqField from './components/BrowserPrereqField'
import { useBrowserPrereq } from './hooks/useBrowserPrereq'
import { useSiteSave } from './hooks/useSiteSave'
import DataRootField from './components/DataRootField'
import DriveFields from './components/DriveFields'
import ErrorReportsField from './components/ErrorReportsField'
import LanguageField from './components/LanguageField'
import MoodleAccountField from './components/MoodleAccountField'
import MoodleSiteField from './components/MoodleSiteField'
import AutoRemoveField from './components/AutoRemoveField'
import CourseStructureField from './components/CourseStructureField'
import AutoRetryField from './components/AutoRetryField'
import AutoRemoveSummary from './components/AutoRemoveSummary'
import SecureStorageNotice from './components/SecureStorageNotice'
import {
  buildPatch,
  formFromStore,
  withOptions,
  withSavedAutoRemove,
  withSavedSite,
  type SettingsForm,
} from './utils/patch'
import {
  autoRemoveApply,
  autoRemoveBlock,
  autoRemoveBlockText,
  autoRemoveComplete,
  autoRemoveDirty,
  autoRemovePatch,
  autoRemoveWidens,
  type RemoveWhat,
} from './utils/autoRemove'
import { missingEntries } from './utils/required'
import { runsAtRisk } from './utils/dataRootGuard'
import { privacyAnswer, restartNotice } from './utils/privacy'
import { useTour } from '@/shared/contexts/TourContext'
import { TOUR_ENABLED } from '@/features/tour/tourEnabled'
import Tooltip from '@/shared/components/Tooltip'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/modal.css'
import '@/styles/settings-form.css'
import './SettingsView.css'

// A save held back by the advisory guard: a data root change that would split the runs in flight.
interface Pending {
  patch: SettingsPatch
  runs: string[]
  sweep: boolean
}

// A save that widens auto-remove, held for its confirm: the section's Apply, or the page's whole Save.
interface PendingRemoval {
  patch: SettingsPatch
  what: RemoveWhat
  after: AutoRemoveAfter
  whole: boolean
}

// The confirm's warning, one whole sentence per rule: what goes, from which lectures.
const REMOVAL_WARNING: Record<RemoveWhat, Record<AutoRemoveAfter, MessageDescriptor>> = {
  video: {
    pdf: msg`The video of every lecture that already has a PDF will be deleted from this computer. It cannot be recovered.`,
    drive: msg`The video of every lecture already uploaded to Drive will be deleted from this computer. It cannot be recovered.`,
  },
  audio: {
    pdf: msg`The video and audio of every lecture that already has a PDF will be deleted from this computer. They cannot be recovered.`,
    drive: msg`The video and audio of every lecture already uploaded to Drive will be deleted from this computer. They cannot be recovered.`,
  },
}

// Every setting the app has, in one place. See docs/SETTINGS.md.
export default function SettingsView() {
  const { t } = useLingui()
  const { status } = useRunnerStatus()
  const { setSettings } = useSettingsContext()
  const { refresh: refreshAccount } = useAuthStatus()
  const tour = useTour()
  const browser = useBrowserPrereq()
  const [stored, setStored] = useState<Settings | null>(null)
  const [options, setOptions] = useState<ConfigOptions | null>(null)
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [siteChecking, setSiteChecking] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)
  // The switch state some part of the app takes only after a restart, from the last save.
  const [reportsRestart, setReportsRestart] = useState<'on' | 'off' | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const site = useSiteSave({
    storedSite: stored?.moodleSite ?? '',
    // Only the site: the rest of the form keeps its unsaved edits.
    onSaved: (saved) => {
      setStored(saved)
      setSettings(saved)
      setForm((f) => f && withSavedSite(f, saved))
      void refreshAccount()
      toast('info', t`University saved`)
    },
    onFailed: (err) => saveFailed(err),
  })

  // The http client already toasts a connection error, but that toast is deduped per service and
  // reads as ambient noise — a save that went nowhere still owes its own verdict.
  function saveFailed(err: unknown) {
    if (isConnectionError(err)) {
      toast('error', t`Couldn't save all settings. Restart the app and try again.`)
    } else {
      toastFailure(err)
    }
  }

  // Fetches whichever of the store and the options is still missing; rerun on notify (docs/SETTINGS.md).
  async function loadMissing() {
    if (stored && options) return
    const [s, o] = await Promise.allSettled([
      stored ?? fetchSettings(),
      options ?? fetchConfigOptions(),
    ])
    const nextStored = s.status === 'fulfilled' ? s.value : null
    const nextOptions = o.status === 'fulfilled' ? o.value : null
    setLoadFailed(!nextStored)
    if (!nextStored) return
    setStored((prev) => prev ?? nextStored)
    if (nextOptions) setOptions((prev) => prev ?? nextOptions)
    // An existing form keeps its edits; only the model waits on the options.
    setForm((prev) =>
      !prev
        ? formFromStore(nextStored, nextOptions)
        : nextOptions
          ? withOptions(prev, nextStored, nextOptions)
          : prev,
    )
  }

  useEffect(() => {
    void loadMissing()
  }, [])
  useNotify(() => void loadMissing())

  if (!stored || !form) {
    return (
      <main className="main-view main-view--page">
        <PageHeader title={t`Settings`} />
        {loadFailed && (
          <div className="page-body">
            <div className="page-column settings-page">
              <div className="settings-note settings-note--warn settings-load-failed">
                <span>
                  <Trans>Couldn't load your settings. Part of FastStudy isn't responding.</Trans>
                </span>
                <button className="btn btn--ghost" onClick={() => void loadMissing()}>
                  <Trans>Retry</Trans>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    )
  }

  // Aliased so the async save below keeps the non-null narrowing the early return established.
  const current = form
  const storedNow = stored
  const currentOptions = options
  const patch = () => buildPatch(current, stored, canSetErrorReports)

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

  // Deletes the newly covered files from every existing lecture, then says what happened.
  async function sweep() {
    try {
      const counts = await applyAutoRemove()
      toast(
        counts.locked > 0 || counts.failed > 0 ? 'warning' : 'success',
        <AutoRemoveSummary counts={counts} />,
      )
    } catch (err) {
      // A connection error was toasted by the client already; the retry hint is still owed.
      const retry = (
        <p>{t`The files weren't removed. Press Apply under “Disk space” to try again.`}</p>
      )
      toast(
        'error',
        isConnectionError(err) ? (
          retry
        ) : (
          <>
            {failureNode(err)}
            {retry}
          </>
        ),
      )
    }
  }

  async function commit(next: SettingsPatch, sweepAfter: boolean) {
    setSaving(true)
    setPending(null)
    try {
      const saved = await site.save(next)
      // Only a save of the switch answers about it; any other save leaves the notice standing.
      if (next.errorReports !== undefined) setReportsRestart(restartNotice(saved))
      setStored(saved)
      setSettings(saved)
      // The whole form takes the store's answer: keys return to their placeholder, the data root to its
      // normalized spelling, and a field another writer changed since load stops reading as an edit.
      setForm(formFromStore(saved, currentOptions))
      // The chip follows auto's stream; the one-shot read re-answers what it cannot say (no site).
      if (next.moodleSite !== undefined) void refreshAccount()
      toast('info', t`Settings saved`)
      if (sweepAfter) await sweep()
    } catch (err) {
      saveFailed(err)
    } finally {
      setSaving(false)
    }
  }

  // The section's own Apply: only its two fields, every other edit on the page kept unsaved.
  async function commitAutoRemove(next: SettingsPatch, sweepAfter: boolean) {
    setSaving(true)
    try {
      const saved = await site.save(next)
      setStored(saved)
      setSettings(saved)
      setForm((f) => f && withSavedAutoRemove(f, saved))
      toast('info', t`Auto-remove saved`)
      if (sweepAfter) await sweep()
    } catch (err) {
      saveFailed(err)
    } finally {
      setSaving(false)
    }
  }

  function proceed(next: SettingsPatch, sweepAfter: boolean) {
    const runs = runsAtRisk(next, status)
    if (runs) setPending({ patch: next, runs, sweep: sweepAfter })
    else void commit(next, sweepAfter)
  }

  // Widening auto-remove deletes files now, so it confirms first; Cancel aborts the whole save.
  function save() {
    const next = patch()
    if (next.autoRemove !== undefined && autoRemoveWidens(current.autoRemove, storedNow)) {
      setPendingRemoval({ patch: next, ...widened(current), whole: true })
    } else proceed(next, false)
  }

  async function resweep() {
    setSaving(true)
    try {
      await sweep()
    } finally {
      setSaving(false)
    }
  }

  function applyAutoRemoveSection() {
    if (autoRemoveApply(current.autoRemove, storedNow, current.driveEnabled) === 'sweep') {
      void resweep()
      return
    }
    const next = autoRemovePatch(current.autoRemove, storedNow, current.driveEnabled)
    if (autoRemoveWidens(current.autoRemove, storedNow)) {
      setPendingRemoval({ patch: next, ...widened(current), whole: false })
    } else void commitAutoRemove(next, false)
  }

  // The rule a widening save stores; widening implies a chosen timing.
  function widened(f: SettingsForm): { what: RemoveWhat; after: AutoRemoveAfter } {
    return { what: f.autoRemove.what, after: f.autoRemove.after! }
  }

  function confirmRemoval(held: PendingRemoval) {
    setPendingRemoval(null)
    if (held.whole) proceed(held.patch, true)
    else void commitAutoRemove(held.patch, true)
  }

  const autoRemoveReady = autoRemoveComplete(form.autoRemove, form.driveEnabled)
  const autoRemoveChanged = autoRemoveDirty(form.autoRemove, stored)
  const saveBlocker =
    missing.length > 0
      ? t`Fill in the required fields first`
      : autoRemoveChanged && autoRemoveBlock(form.autoRemove, form.driveEnabled)
        ? autoRemoveBlockText(autoRemoveBlock(form.autoRemove, form.driveEnabled)!)
        : undefined

  const provider = (id: string) => options?.providers.find((p) => p.id === id)
  const gemini = provider('gemini')
  const groq = provider('groq')

  return (
    <main className="main-view main-view--page">
      <PageHeader
        title={t`Settings`}
        actions={
          <Tooltip content={saveBlocker}>
            <button
              className="btn btn--primary"
              // A half-chosen auto-remove holds Save the same way it holds Apply.
              disabled={
                saving ||
                siteChecking ||
                missing.length > 0 ||
                (autoRemoveChanged && !autoRemoveReady)
              }
              onClick={save}
            >
              <Trans>Save</Trans>
            </button>
          </Tooltip>
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
            {canStoreApiKeys && !options && (
              <p className="settings-note" data-settings-options="unavailable">
                <Trans>
                  The API keys and the summary model aren't available right now. They'll come back
                  here on their own.
                </Trans>
              </p>
            )}
            {canStoreApiKeys && options && (
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
                <div className="settings-field">
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={form.geminiAutoFallback}
                      onChange={(e) => setForm({ ...form, geminiAutoFallback: e.target.checked })}
                    />
                    <span className="settings-check-text">
                      <span>
                        <Trans>Auto change model when busy</Trans>
                      </span>
                    </span>
                  </label>
                  <span className="settings-hint">
                    <Trans>
                      When the summary model is under high demand, retry once on the next model.
                    </Trans>
                  </span>
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

          <section className="settings-section" data-tour="settings-drive">
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
            {/* A confirmed site, or no university, saves at once; an unverified one waits for Save. */}
            <MoodleSiteField
              value={form.moodleSite}
              // Functional: the probe answers after other fields may have changed.
              onChange={(v) => setForm((f) => f && { ...f, moodleSite: v })}
              onSupported={site.pick}
              onNoSite={() => site.pick('')}
              onChecking={setSiteChecking}
            />
            <MoodleAccountField site={stored.moodleSite} choice={form.moodleSite} />
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Courses</Trans>
            </h2>
            <CourseStructureField
              value={form.courseStructure}
              saved={toCourseStructure(stored.courseStructure)}
              onChange={(v) => setForm({ ...form, courseStructure: v })}
            />
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Automatic retry</Trans>
            </h2>
            <AutoRetryField
              value={form.autoRetry}
              onChange={(v) => setForm({ ...form, autoRetry: v })}
            />
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Appearance and behaviour</Trans>
            </h2>
            <LanguageField />
            {TOUR_ENABLED && (
              <div className="settings-field">
                <div className="settings-label">
                  <span>
                    <Trans>Tutorial</Trans>
                  </span>
                </div>
                <div>
                  <button className="btn btn--ghost settings-replay-tour" onClick={tour.start}>
                    <Trans>Replay tutorial</Trans>
                  </button>
                </div>
              </div>
            )}
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
                  This applies only to work that starts on its own: a video you drop in or a video
                  that finishes downloading. Runs you start yourself are not affected.
                </Trans>
              </span>
            </div>
            <div className="settings-field">
              <div className="settings-label">
                <label htmlFor="ai-provider">
                  <Trans>AI chat provider</Trans>
                </label>
              </div>
              <select
                id="ai-provider"
                className="settings-select"
                value={form.aiProvider}
                onChange={(e) => setForm({ ...form, aiProvider: e.target.value as AiProvider })}
              >
                {AI_PROVIDER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {AI_PROVIDERS[id].name}
                  </option>
                ))}
              </select>
              <span className="settings-hint">
                <Trans>Where "Study with AI" opens a lecture's summary.</Trans>
              </span>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">
              <Trans>Disk space</Trans>
            </h2>
            <AutoRemoveField
              value={form.autoRemove}
              onChange={(v) => setForm({ ...form, autoRemove: v })}
              driveEnabled={form.driveEnabled}
              apply={
                saving || siteChecking
                  ? null
                  : autoRemoveApply(form.autoRemove, stored, form.driveEnabled)
              }
              onApply={applyAutoRemoveSection}
            />
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

      {pending && (
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
          onConfirm={() => void commit(pending.patch, pending.sweep)}
          onCancel={() => setPending(null)}
        />
      )}

      {pendingRemoval && (
        <ConfirmModal
          message={t`Remove files from every existing lecture?`}
          warning={t(REMOVAL_WARNING[pendingRemoval.what][pendingRemoval.after])}
          postMessage={t`From now on, each lecture's files are removed the same way once it reaches that point.`}
          onConfirm={() => confirmRemoval(pendingRemoval)}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
    </main>
  )
}
