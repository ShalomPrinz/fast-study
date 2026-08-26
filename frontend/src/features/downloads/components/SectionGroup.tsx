import { useCallback, useEffect, useRef, useState } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import type { Item } from '@/features/downloads/services/autoDownloader'
import {
  expandItem,
  isReconnectError,
  isUnsupportedError,
  saveZoomPasscode,
} from '@/features/downloads/services/autoDownloader'
import type { RunTarget } from '@/features/downloads/services/downloadServer'
import { cancelRun, resumeRun, startSectionRun } from '@/features/downloads/services/downloadServer'
import PasscodePrompt from './PasscodePrompt'
import RecordingRow from './RecordingRow'
import { useJobsByRef } from '@/features/downloads/contexts/DownloadJobsContext'
import {
  resolveRow,
  useRowEdits,
  useRowEditsDispatch,
} from '@/features/downloads/contexts/RowEditsContext'
import type { ExpandState } from '@/features/downloads/contexts/RowExpansionsContext'
import {
  IDLE_EXPAND,
  expansionOf,
  patchExpansion,
  useAllExpansions,
} from '@/features/downloads/contexts/RowExpansionsContext'
import { useSectionRun } from '@/features/downloads/contexts/SectionRunsContext'
import { hasResource } from '@/features/downloads/utils/existingItems'
import {
  notStartedCount,
  runningCount,
  summarize,
  unverifiedCount,
} from '@/features/downloads/utils/runStatus'
import { toastDownloadError } from '@/features/downloads/utils/downloadErrors'
import { applyRenames } from '@/features/downloads/utils/renames'
import { sectionTitle } from '@/features/downloads/utils/sections'
import { useResolveMedia } from '@/features/downloads/contexts/ResolvedMediaContext'
import '@/styles/source-row.css'
import '@/styles/button.css'
import './SectionGroup.css'

interface Props {
  // `id` is the section's page-wide identity (`${course}:${media}:${title}`), which keys its run —
  // null for the synthetic `Other links` pile, which has no run and no bulk button.
  // `synthetic` marks that pile, whose title is ours rather than Moodle's.
  section: { id: string | null; title: string; synthetic: boolean }
  items: Item[]
  course: string
  onReconnect: () => void
}

const NO_TARGETS: readonly RunTarget[] = Object.freeze([])

// One Moodle section. It starts the bulk run with one POST and then only reflects it, so a segment
// switch or a reload lands mid-run and shows it. Drives the expand/children cache (rows only render
// it) because the queue it submits needs the resolved children. See docs/DOWNLOADS.md.
export default function SectionGroup({ section, items, course, onReconnect }: Props) {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const jobsByRef = useJobsByRef()
  const resolveMedia = useResolveMedia()
  const edits = useRowEdits()
  // The server's canonical spelling replaces each renamed row's name, so the skip rule and the run's
  // landed check compare against disk.
  const { setName } = useRowEditsDispatch()
  // The whole map: the bulk queue needs every playlist's children, and "Download all" needs to know
  // they are all expanded. The rows themselves subscribe per ref.
  const expansions = useAllExpansions()
  const id = section.id
  // The synthetic bucket's title is a label we mint, so it is translated here; a Moodle heading
  // spelled the same is a real section and passes through untouched. Media-neutral wording: the
  // bucket holds stray videos on one segment and stray unknown links on another.
  const label = section.synthetic ? t`Other links` : sectionTitle(section.title)
  const run = useSectionRun(id)
  // The passcode save's own in-flight state — the only thing about a run this component still owns.
  // A double submit is the server's to reject (409 on a run that is no longer parked).
  const [saving, setSaving] = useState(false)
  // Refs whose resolved type has already been reported upward (below).
  const reported = useRef<Set<string>>(new Set())

  const targets = run?.targets ?? NO_TARGETS
  const paused = run?.status === 'paused' ? run.paused : null

  function stateOf(ref: string): ExpandState {
    return expansions[ref] ?? IDLE_EXPAND
  }

  // Cached on first expand, so collapse/re-expand never refetches. Stable across renders — it reads
  // the current state through the store rather than closing over `expansions`, because a changing
  // identity here would re-render every memoized playlist row on every keystroke and every job ping.
  const toggleExpand = useCallback(
    async (item: Item) => {
      const current = expansionOf(item.ref)
      if (current.children) {
        patchExpansion(item.ref, { expanded: !current.expanded })
        return
      }
      patchExpansion(item.ref, { expanding: true, error: null })
      try {
        const children = await expandItem(item.ref)
        patchExpansion(item.ref, { children, expanded: true, expanding: false })
      } catch (err) {
        if (isReconnectError(err)) onReconnect()
        const message = isUnsupportedError(err) ? err.message : t`Couldn't load entries. Try again.`
        patchExpansion(item.ref, {
          expanding: false,
          error: isReconnectError(err) ? null : message,
        })
      }
    },
    [onReconnect, t],
  )

  const expandables = items.filter((i) => i.expandable)
  const allExpanded = expandables.every((i) => stateOf(i.ref).children !== null)

  // A playlist contributes its children, never its own ref — the backend rejects that.
  function buildQueue(): Item[] {
    return items.flatMap((item) => (item.expandable ? (stateOf(item.ref).children ?? []) : [item]))
  }

  // The whole queue, resolved once at submit: the name and kind the row shows, and the two verdicts
  // this page owns because they read the live course tree — already on disk, and already known
  // unsupported (a permanent verdict, and each retry would burn another Drive probe).
  function buildTargets(): RunTarget[] {
    return buildQueue().map((item) => {
      const { name, kind } = resolveRow(item, edits[item.ref], courses, course)
      const media = item.resolvedMedia ?? item.media
      const target = { ref: item.ref, name, kind, media }
      if (item.resolvedMedia === 'unsupported') return { ...target, disposition: 'unsupported' }
      if (hasResource(item, name, kind, courses, course))
        return { ...target, disposition: 'skipped' }
      return { ...target, disposition: 'pending' }
    })
  }

  async function startAll() {
    if (!id) return
    const targets = buildTargets()
    if (!targets.length) return
    try {
      const renames = await startSectionRun({ sectionId: id, course, targets })
      applyRenames(renames, targets, setName)
    } catch (err) {
      toastDownloadError(label, err)
    }
  }

  // The run's verdict on a row it triggered is what an 'unknown' row learns its type from, exactly as
  // a single-row download's answer is — reported up here so the answer outlives the run. Reported
  // once per ref: every ping re-reads the same targets, and each report re-renders the whole list.
  useEffect(() => {
    for (const t of targets) {
      if (t.media === 'unknown' || reported.current.has(t.ref)) continue
      if (t.disposition !== 'queued' && t.disposition !== 'unsupported') continue
      reported.current.add(t.ref)
      resolveMedia(t.ref, t.media)
    }
  }, [targets, resolveMedia])

  // Save the passcode through auto (the passcode store stays there), then let the server resume the
  // same row. A failed save gives up on that one row and continues from the next.
  async function submitPasscode(passcode: string, scope: 'course' | 'lecture') {
    if (!run || !paused || !passcode || saving) return
    setSaving(true)
    let failed = false
    try {
      await saveZoomPasscode({ course, name: paused.name, passcode, scope })
    } catch {
      failed = true
    }
    try {
      await resumeRun(run.id, failed)
    } catch {
      // A resume the server refused (409: no longer parked) needs nothing from here — the next
      // `run:change` says what the run actually did.
    }
    setSaving(false)
  }

  // Cancelling abandons the rest of the queue, not just the gated item.
  async function cancelPasscode() {
    if (!run) return
    try {
      await cancelRun(run.id)
    } catch (err) {
      toastDownloadError(label, err)
    }
  }

  // Queueing ends long before the downloads do, so the header keeps ticking on the rows whose jobs
  // are still running. A running job is the whole signal, exactly as it is for a single row's own
  // button: it cannot outlive the work, so the section always frees itself.
  const active = runningCount(targets, jobsByRef)
  // The queue is the server's, so `busy` is its status — still OR'd with the live jobs, which
  // outlive the queue itself.
  const queueing = run?.status === 'running' || run?.status === 'paused'
  const busy = queueing || active > 0
  // Rows a stopped run can no longer account for. They no longer hold the section busy, but the
  // summary would silently omit them, so the section says how many and why.
  const stalled = queueing ? 0 : unverifiedCount(targets, courses, course, jobsByRef)
  // Rows the run stopped short of. The summary omits them too, so a run halted at row 3 of 20 would
  // read exactly like a finished one — and unlike the unverified rows, this one has an action.
  const notStarted = queueing ? 0 : notStartedCount(targets)
  const stoppedBecause =
    run?.status === 'reconnect'
      ? t`the BIU session expired. Reconnect, then run the section again.`
      : run?.status === 'cancelled'
        ? t`the run was cancelled. Run the section again to pick them up.`
        : t`the run stopped early. Run the section again to pick them up.`

  return (
    <div className="recordings-section">
      <div className="recordings-section-header">
        <span className="recordings-section-title" dir="auto">
          {label}
        </span>
        {queueing && run && (
          <span className="recordings-section-progress">
            <Trans>
              Downloading {run.at}/{run.total}…
            </Trans>
          </span>
        )}
        {!queueing && active > 0 && (
          <span className="recordings-section-progress">
            <Trans>Downloading {active} more…</Trans>
          </span>
        )}
        {!queueing && active === 0 && targets.length > 0 && (
          <span className="recordings-section-progress">
            {summarize(targets, courses, course, jobsByRef)}
          </span>
        )}
        {id !== null && (
          <button
            className="btn btn--ghost"
            onClick={() => void startAll()}
            disabled={busy || !allExpanded}
            title={allExpanded ? undefined : t`Expand every playlist in this section first`}
          >
            {busy ? t`Downloading…` : t`⭳ Download all`}
          </button>
        )}
      </div>

      {notStarted > 0 && (
        <div className="recordings-section-stalled">
          {plural(notStarted, {
            one: `# row never started — ${stoppedBecause}`,
            other: `# rows never started — ${stoppedBecause}`,
          })}
        </div>
      )}

      {stalled > 0 && (
        <div className="recordings-section-stalled">
          <Plural
            value={stalled}
            one="Couldn't confirm # download — the lecture may have been deleted or renamed since, or the file saved under a different name."
            other="Couldn't confirm # downloads — the lecture may have been deleted or renamed since, or the file saved under a different name."
          />
        </div>
      )}

      {items.map((item) => (
        <RecordingRow
          key={item.ref}
          item={item}
          edit={edits[item.ref]}
          course={course}
          onReconnect={onReconnect}
          onToggle={toggleExpand}
        />
      ))}

      {paused && (
        <PasscodePrompt
          reason={paused.reason}
          busy={saving}
          onSubmit={submitPasscode}
          onCancel={() => void cancelPasscode()}
        />
      )}
    </div>
  )
}
