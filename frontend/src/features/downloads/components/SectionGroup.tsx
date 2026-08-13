import { useRef } from 'react'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import type { Item } from '@/features/downloads/services/autoDownloader'
import {
  downloadItem,
  expandItem,
  isPasscodeError,
  isReconnectError,
  isUnsupportedError,
  saveZoomPasscode,
} from '@/features/downloads/services/autoDownloader'
import PasscodePrompt from './PasscodePrompt'
import RecordingRow from './RecordingRow'
import type { ExpandControl } from './RecordingRow'
import { jobsForRef, useJobsByRef } from '@/features/downloads/contexts/DownloadJobsContext'
import { resolveRow, useRowEdits } from '@/features/downloads/contexts/RowEditsContext'
import type { ExpandState } from '@/features/downloads/contexts/DownloadsSessionContext'
import type { Tally } from '@/features/downloads/utils/runSummary'
import {
  IDLE_EXPAND,
  IDLE_RUN,
  useDownloadsActions,
  useDownloadsSession,
} from '@/features/downloads/contexts/DownloadsSessionContext'
import { hasResource } from '@/features/downloads/utils/existingItems'
import { useResolveMedia } from '@/features/downloads/contexts/ResolvedMediaContext'

interface Props {
  // `id` is the section's page-wide identity (`${course}:${media}:${title}`), which keys its run.
  section: { id: string; title: string }
  items: Item[]
  course: string
  onReconnect: () => void
}

// One Moodle section + a sequential "Download all" over it. Drives the expand/children cache
// (rows only render it) because the bulk queue needs resolved children. See docs/downloads.md.
export default function SectionGroup({ section, items, course, onReconnect }: Props) {
  const { courses } = useCourseTreeContext()
  const jobsByRef = useJobsByRef()
  const resolveMedia = useResolveMedia()
  const edits = useRowEdits()
  const { expansions, runs } = useDownloadsSession()
  const { patchExpansion, setRun } = useDownloadsActions()
  const id = section.id
  // Read, never seed: a remount lands mid-run and must show that run, not start one.
  const { running, progress, outcome, summary, paused, saving } = runs[id] ?? IDLE_RUN

  // Refreshed on render only: while mounted the queue sees an SSE tree refresh and a name typed
  // mid-run, and on unmount they freeze, so a background run finishes against what it last saw.
  const coursesRef = useRef(courses)
  coursesRef.current = courses
  const editsRef = useRef(edits)
  editsRef.current = edits

  function stateOf(ref: string): ExpandState {
    return expansions[ref] ?? IDLE_EXPAND
  }

  // Cached on first expand, so collapse/re-expand never refetches.
  async function toggleExpand(item: Item) {
    const current = stateOf(item.ref)
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
      const message = isUnsupportedError(err) ? err.message : "Couldn't load entries. Try again."
      patchExpansion(item.ref, { expanding: false, error: isReconnectError(err) ? null : message })
    }
  }

  const expandables = items.filter((i) => i.expandable)
  const allExpanded = expandables.every((i) => stateOf(i.ref).children !== null)

  // A playlist contributes its children, never its own ref — the backend rejects that.
  function buildQueue(): Item[] {
    return items.flatMap((item) => (item.expandable ? (stateOf(item.ref).children ?? []) : [item]))
  }

  // `summary` stays null: the provider fills it once every started row's jobs are terminal.
  function finish(tally: Tally) {
    setRun(id, {
      running: false,
      progress: null,
      outcome: { ...tally, started: [...tally.started] },
      summary: null,
    })
  }

  // Triggering is sequential by design (the downloader drives one shared browser session), but the
  // downloads themselves run on — so several rows are in flight by the end of the queue.
  async function runQueue(queue: Item[], from: number, tally: Tally) {
    setRun(id, { running: true, outcome: null, summary: null })
    for (let i = from; i < queue.length; i++) {
      const item = queue[i]
      setRun(id, { progress: { at: i + 1, total: queue.length } })
      // Exactly what the row shows, so the skip rule and the green row can't disagree.
      const { name, kind } = resolveRow(
        item,
        editsRef.current[item.ref],
        coursesRef.current,
        course,
      )
      // A known-unsupported row can only fail again, and each attempt burns a Drive probe
      // round-trip — so a verdict from any earlier download takes it out of the queue for good.
      if (item.resolvedMedia === 'unsupported') {
        tally.unsupported++
        continue
      }
      if (hasResource(item, name, kind, coursesRef.current, course)) {
        tally.skipped++
        continue
      }
      try {
        const { media } = await downloadItem({ ref: item.ref, course, name, kind })
        resolveMedia(item.ref, media)
        tally.started.push(item.ref)
      } catch (err) {
        if (isReconnectError(err)) {
          onReconnect()
          setRun(id, { running: false, progress: null, outcome: null, summary: null })
          return
        }
        if (isPasscodeError(err)) {
          // Hold here; submitting the passcode retries this same item. The prompt lives in page
          // state, so a run paused while the user is elsewhere still asks when the section returns.
          setRun(id, {
            paused: { queue, index: i, tally, reason: err.reason, name },
            running: false,
          })
          return
        }
        // The probe's verdict on the file, exactly as in a single-row download — the bulk run
        // reports one summary and never toasts, so recording it is the only thing that carries
        // "this is a .zip" out of the run.
        if (isUnsupportedError(err)) {
          resolveMedia(item.ref, 'unsupported')
          tally.unsupported++
        } else tally.failed++
      }
    }
    finish(tally)
  }

  // `saving` is page state, not component state: a remount while the save is in flight must show the
  // prompt busy, or a second submit would run the rest of the queue a second time, in parallel.
  async function submitPasscode(passcode: string, scope: 'course' | 'lecture') {
    if (!paused || !passcode || saving) return
    setRun(id, { saving: true })
    let failed = false
    try {
      await saveZoomPasscode({ course, name: paused.name, passcode, scope })
    } catch {
      failed = true
      paused.tally.failed++
    }
    setRun(id, { saving: false, paused: null })
    // A failed save skips the item it gated; a saved passcode retries that same item.
    void runQueue(paused.queue, failed ? paused.index + 1 : paused.index, paused.tally)
  }

  // Cancelling abandons the rest of the queue, not just the gated item.
  function cancelPasscode() {
    if (paused) {
      paused.tally.failed++
      finish(paused.tally)
    }
    setRun(id, { paused: null })
  }

  // Queueing ends long before the downloads do, so the header keeps ticking on the live jobs of
  // every row the run started (per atom, so a zoom pair's second clip still counts) until the
  // provider freezes the summary.
  const active = outcome
    ? outcome.started
        .flatMap((ref) => jobsForRef(jobsByRef, ref))
        .filter((j) => j.status === 'running').length
    : 0
  const busy = running || paused !== null || active > 0

  return (
    <div className="recordings-section">
      <div className="recordings-section-header">
        <span className="recordings-section-title" dir="auto">
          {section.title}
        </span>
        {progress && (
          <span className="recordings-section-progress">
            Downloading {progress.at}/{progress.total}…
          </span>
        )}
        {!progress && active > 0 && (
          <span className="recordings-section-progress">Downloading {active} more…</span>
        )}
        {!progress && summary && <span className="recordings-section-progress">{summary}</span>}
        <button
          className="source-row-btn recordings-download-all"
          onClick={() =>
            runQueue(buildQueue(), 0, { started: [], failed: 0, skipped: 0, unsupported: 0 })
          }
          disabled={busy || !allExpanded}
          title={allExpanded ? undefined : 'Expand every playlist in this section first'}
        >
          {busy ? 'Downloading…' : '⭳ Download all'}
        </button>
      </div>

      {items.map((item) => {
        const expand: ExpandControl | undefined = item.expandable
          ? { ...stateOf(item.ref), onToggle: () => toggleExpand(item) }
          : undefined
        return (
          <RecordingRow
            key={item.ref}
            item={item}
            edit={edits[item.ref]}
            course={course}
            onReconnect={onReconnect}
            expand={expand}
          />
        )
      })}

      {paused && (
        <PasscodePrompt
          reason={paused.reason}
          busy={saving}
          onSubmit={submitPasscode}
          onCancel={cancelPasscode}
        />
      )}
    </div>
  )
}
