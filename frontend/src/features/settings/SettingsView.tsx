import { useEffect, useRef, useState } from 'react'
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
import Select from '@/shared/components/Select'
import ApiKeyField from './components/ApiKeyField'
import SummaryModelsField from './components/SummaryModelsField'
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
import SettingsSearchBar from './components/SettingsSearchBar'
import ApproveRow from './components/ApproveRow'
import SaveStatus from './components/SaveStatus'
import { useSettingsSearch } from './hooks/useSettingsSearch'
import {
  formFromStore,
  withOptions,
  withSavedAutoRemove,
  withSavedSite,
  type SettingsForm,
} from './utils/patch'
import {
  autoRemoveApply,
  autoRemovePatch,
  autoRemoveWidens,
  type RemoveWhat,
} from './utils/autoRemove'
import { missingEntries } from './utils/required'
import { runsAtRisk } from './utils/dataRootGuard'
import {
  approvePatch,
  approveVisible,
  autoPatch,
  mergeApproved,
  type ApproveId,
} from './utils/autosave'
import { privacyAnswer, restartNotice } from './utils/privacy'
import { useTour } from '@/shared/contexts/TourContext'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/modal.css'
import '@/styles/settings-form.css'
import './SettingsView.css'

// A data folder approve held back by the advisory guard: the change would split the runs in flight.
interface Pending {
  patch: SettingsPatch
  runs: string[]
}

// An auto-remove Apply that widens the rule, held for its confirm.
interface PendingRemoval {
  patch: SettingsPatch
  what: RemoveWhat
  after: AutoRemoveAfter
}

// How long the header's "Saved" stays up.
const SAVED_MARK_MS = 2500

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
  const columns = useRef<HTMLDivElement>(null)
  const search = useSettingsSearch(columns)
  const [stored, setStored] = useState<Settings | null>(null)
  const [options, setOptions] = useState<ConfigOptions | null>(null)
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [busy, setBusy] = useState(0)
  // Bumped on every landed save: it replays the "Saved" shine, and 0 means none to show.
  const [savedTick, setSavedTick] = useState(0)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The latest form, store and options, read when a change saves: every save runs in the order the
  // changes were made, and a landed save never writes the form back, so a later edit is never reverted.
  const formRef = useRef<SettingsForm | null>(null)
  const storedRef = useRef<Settings | null>(null)
  const optionsRef = useRef<ConfigOptions | null>(null)
  const saving = busy > 0
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
      landStore(saved)
      edit((f) => withSavedSite(f, saved), false)
      void refreshAccount()
      flash()
    },
    onFailed: (err) => saveFailed(err),
    onBusy: (delta) => setBusy((n) => n + delta),
  })

  // The http client already toasts a connection error, but that toast is deduped per service and
  // reads as ambient noise — a save that went nowhere still owes its own verdict.
  function saveFailed(err: unknown) {
    clearTimeout(savedTimer.current)
    setSavedTick(0)
    if (isConnectionError(err)) {
      toast('error', t`Couldn't save all settings. Restart the app and try again.`)
    } else {
      toastFailure(err)
    }
  }

  function landStore(saved: Settings) {
    storedRef.current = saved
    setStored(saved)
    setSettings(saved)
  }

  function flash() {
    setSavedTick((n) => n + 1)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSavedTick(0), SAVED_MARK_MS)
  }

  // Runs one save on the page's chain and shows "Saved" in the header; a failure toasts, clears it and
  // answers null, leaving the fields unsaved so the next change retries them.
  // A function source builds its patch when the save runs, so it diffs against the store as it is then.
  async function persist(source: SettingsPatch | (() => SettingsPatch)): Promise<Settings | null> {
    setBusy((n) => n + 1)
    let next: SettingsPatch = {}
    try {
      const saved =
        typeof source === 'function'
          ? await site.save(() => (next = source()))
          : await site.save((next = source))
      if (!saved) return null
      landStore(saved)
      // Only a save of the switch answers about it; any other save leaves the notice standing.
      if (next.errorReports !== undefined) setReportsRestart(restartNotice(saved))
      // The chip follows auto's stream; the one-shot read re-answers what it cannot say (no site).
      if (next.moodleSite !== undefined) void refreshAccount()
      flash()
      return saved
    } catch (err) {
      saveFailed(err)
      return null
    } finally {
      setBusy((n) => n - 1)
    }
  }

  // Applies a form edit; an auto edit saves what changed at once, a held one waits for its Approve.
  function edit(change: (f: SettingsForm) => SettingsForm, auto = true) {
    const prev = formRef.current
    if (!prev) return
    const next = change(prev)
    formRef.current = next
    setForm(next)
    if (!auto || !storedRef.current) return
    void persist(() => {
      const form = formRef.current
      const store = storedRef.current
      return form && store ? autoPatch(form, store, canSetErrorReports, optionsRef.current) : {}
    })
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
    storedRef.current ??= nextStored
    if (nextOptions) setOptions((prev) => prev ?? nextOptions)
    optionsRef.current ??= nextOptions
    // An existing form keeps its edits; only the model waits on the options.
    const prev = formRef.current
    const next = !prev
      ? formFromStore(nextStored, nextOptions)
      : nextOptions
        ? withOptions(prev, storedRef.current, nextOptions)
        : prev
    formRef.current = next
    setForm(next)
  }

  useEffect(() => {
    void loadMissing()
    return () => clearTimeout(savedTimer.current)
  }, [])
  useNotify(() => void loadMissing(), ['settings'])

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

  // An approved entry: stored alone, then only that entry takes the store's answer.
  async function commitApprove(patch: SettingsPatch) {
    setPending(null)
    const saved = await persist(patch)
    if (saved) edit((f) => mergeApproved(f, saved, patch), false)
    if (saved && patch.moodleSite !== undefined) edit((f) => withSavedSite(f, saved), false)
  }

  function approve(id: ApproveId) {
    const next = approvePatch(id, formRef.current ?? current, storedRef.current ?? storedNow)
    if (!Object.keys(next).length) return
    const runs = id === 'dataRoot' ? runsAtRisk(next, status) : null
    if (runs) setPending({ patch: next, runs })
    else void commitApprove(next)
  }

  // The section's own Apply: only its two fields, every other edit on the page kept.
  async function commitAutoRemove(next: SettingsPatch, sweepAfter: boolean) {
    const saved = await persist(next)
    if (!saved) return
    edit((f) => withSavedAutoRemove(f, saved), false)
    if (sweepAfter) await sweep()
  }

  async function resweep() {
    setBusy((n) => n + 1)
    try {
      await sweep()
    } finally {
      setBusy((n) => n - 1)
    }
  }

  function applyAutoRemoveSection() {
    if (autoRemoveApply(current.autoRemove, storedNow, current.driveEnabled) === 'sweep') {
      void resweep()
      return
    }
    const next = autoRemovePatch(current.autoRemove, storedNow, current.driveEnabled)
    if (autoRemoveWidens(current.autoRemove, storedNow)) {
      const what = current.autoRemove.what
      setPendingRemoval({ patch: next, what, after: current.autoRemove.after! })
    } else void commitAutoRemove(next, false)
  }

  function confirmRemoval(held: PendingRemoval) {
    setPendingRemoval(null)
    void commitAutoRemove(held.patch, true)
  }

  const view = (id: ApproveId) => approveVisible(id, form, stored)
  const ready = (id: ApproveId) => Object.keys(approvePatch(id, form, stored)).length > 0

  const provider = (id: string) => options?.providers.find((p) => p.id === id)
  const gemini = provider('gemini')
  const groq = provider('groq')

  return (
    <main className="main-view main-view--page">
      <PageHeader title={t`Settings`} actions={<SaveStatus savedTick={savedTick} />} />
      <SettingsSearchBar
        query={search.query}
        onQuery={search.setQuery}
        current={search.current}
        count={search.count}
        onStep={search.step}
      />
      <div className="page-body">
        <div className="page-column settings-page" ref={columns}>
          <div className="settings-column">
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
                    <ApproveRow
                      id="geminiKey"
                      visible={view('geminiKey')}
                      disabled={!ready('geminiKey')}
                      onApprove={() => approve('geminiKey')}
                    >
                      <ApiKeyField
                        provider={gemini}
                        value={form.geminiApiKey}
                        onChange={(v) => edit((f) => ({ ...f, geminiApiKey: v }), false)}
                        storedKeyExists={stored.geminiApiKeySet}
                      />
                    </ApproveRow>
                  )}
                  {groq && (
                    <ApproveRow
                      id="groqKey"
                      visible={view('groqKey')}
                      disabled={!ready('groqKey')}
                      onApprove={() => approve('groqKey')}
                    >
                      <ApiKeyField
                        provider={groq}
                        value={form.groqApiKey}
                        onChange={(v) => edit((f) => ({ ...f, groqApiKey: v }), false)}
                        storedKeyExists={stored.groqApiKeySet}
                      />
                    </ApproveRow>
                  )}
                  <SummaryModelsField
                    models={options.geminiModels}
                    order={[form.geminiModel, ...(form.geminiFallbackModels ?? [])]}
                    onChange={([model, ...rest]) =>
                      edit((f) => ({ ...f, geminiModel: model, geminiFallbackModels: rest }))
                    }
                  />
                  <div className="settings-field">
                    <label className="settings-check">
                      <input
                        type="checkbox"
                        checked={form.summaryFigures}
                        onChange={(e) => edit((f) => ({ ...f, summaryFigures: e.target.checked }))}
                      />
                      <span className="settings-check-text">
                        <span>
                          <Trans>Add figures to the summary</Trans>
                        </span>
                      </span>
                    </label>
                    <span className="settings-hint">
                      <Trans>
                        Crops the graphs from the slide PDFs and PPTXs attached to a lecture. Graphs
                        drawn with PowerPoint shapes need the deck saved as PDF.
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
              <ApproveRow
                id="dataRoot"
                visible={view('dataRoot')}
                disabled={!ready('dataRoot')}
                onApprove={() => approve('dataRoot')}
              >
                <DataRootField
                  value={form.dataRoot}
                  onChange={(v) => edit((f) => ({ ...f, dataRoot: v }), false)}
                />
              </ApproveRow>
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Google Drive</Trans>
              </h2>
              <ApproveRow
                id="drive"
                visible={view('drive')}
                disabled={!ready('drive')}
                onApprove={() => approve('drive')}
              >
                <DriveFields
                  value={{ enabled: form.driveEnabled, folder: form.gdriveRootFolder }}
                  // The toggle saves at once; the folder waits for Approve, and turning Drive on
                  // with no stored folder waits with it.
                  onChange={(v) =>
                    edit(
                      (f) => ({ ...f, driveEnabled: v.enabled, gdriveRootFolder: v.folder }),
                      v.enabled !== form.driveEnabled,
                    )
                  }
                  folderMissing={missing.includes('gdriveRootFolder')}
                />
              </ApproveRow>
            </section>
          </div>

          <div className="settings-column">
            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Downloading recordings</Trans>
              </h2>
              <BrowserPrereqField state={browser.state} onRecheck={() => void browser.check()} />
              {/* A confirmed site, or no university, saves at once; an unverified one waits for Approve. */}
              <ApproveRow
                id="site"
                visible={view('site')}
                disabled={!ready('site')}
                onApprove={() => approve('site')}
              >
                <MoodleSiteField
                  value={form.moodleSite}
                  // Functional: the probe answers after other fields may have changed.
                  onChange={(v) => edit((f) => ({ ...f, moodleSite: v }), false)}
                  onSupported={site.pick}
                  onNoSite={() => site.pick('')}
                  onChecking={setSiteChecking}
                />
              </ApproveRow>
              <MoodleAccountField site={stored.moodleSite} choice={form.moodleSite} />
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Courses</Trans>
              </h2>
              <CourseStructureField
                value={form.courseStructure}
                saved={toCourseStructure(stored.courseStructure)}
                onChange={(v) => edit((f) => ({ ...f, courseStructure: v }))}
              />
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Automatic retry</Trans>
              </h2>
              <ApproveRow
                id="retry"
                visible={view('retry')}
                disabled={!ready('retry')}
                onApprove={() => approve('retry')}
              >
                {/* The switch saves at once; the two numbers wait for Approve. */}
                <AutoRetryField
                  value={form.autoRetry}
                  onChange={(v) =>
                    edit((f) => ({ ...f, autoRetry: v }), v.on !== form.autoRetry.on)
                  }
                />
              </ApproveRow>
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Appearance and behaviour</Trans>
              </h2>
              <LanguageField />
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
              <div className="settings-field">
                <div className="settings-label">
                  <label htmlFor="auto-run">
                    <Trans>When a new video arrives</Trans>
                  </label>
                </div>
                <Select
                  id="auto-run"
                  value={form.autoRun}
                  onChange={(v) => edit((f) => ({ ...f, autoRun: v as AutoRun }))}
                  options={[
                    { value: 'full', label: t`Run the whole pipeline` },
                    { value: 'audio', label: t`Extract the audio only` },
                    { value: 'off', label: t`Do nothing — I'll start runs myself` },
                  ]}
                />
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
                <Select
                  id="ai-provider"
                  value={form.aiProvider}
                  onChange={(v) => edit((f) => ({ ...f, aiProvider: v as AiProvider }))}
                  options={AI_PROVIDER_IDS.map((id) => ({
                    value: id,
                    label: AI_PROVIDERS[id].name,
                  }))}
                />
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
                onChange={(v) => edit((f) => ({ ...f, autoRemove: v }), false)}
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
                  onChange={(v) => edit((f) => ({ ...f, errorReports: v }))}
                  onAnswer={(confirmed) => edit((f) => ({ ...f, ...privacyAnswer(confirmed) }))}
                  notice={
                    reportsRestart && (
                      <p
                        className="settings-note settings-note--warn"
                        data-reports-restart={reportsRestart}
                      >
                        {reportsRestart === 'on' ? (
                          <Trans>
                            Error reports are now on. Some parts of FastStudy will start sending
                            them only after you restart the app.
                          </Trans>
                        ) : (
                          <Trans>
                            Error reports are now off. Some parts of FastStudy will stop sending
                            them only after you restart the app.
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
          onConfirm={() => void commitApprove(pending.patch)}
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
