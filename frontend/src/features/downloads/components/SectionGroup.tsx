import { useCallback, useMemo, useRef, useState } from 'react'
import type { Kind } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import type { Item, PasscodeError } from '@/features/downloads/services/autoDownloader'
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
import type { JobProgress } from '@/features/downloads/contexts/DownloadJobsContext'
import {
  jobsForRef,
  rowStatus,
  useJobsByRef,
} from '@/features/downloads/contexts/DownloadJobsContext'
import type { RowEdit } from '@/features/downloads/contexts/RowEditsContext'
import {
  RowEditsDispatchContext,
  RowEditsStateContext,
  resolveRow,
} from '@/features/downloads/contexts/RowEditsContext'
import { hasResource } from '@/features/downloads/utils/existingItems'

interface Props {
  title: string
  items: Item[]
  course: string
  onReconnect: () => void
}

interface ExpandState {
  expanded: boolean
  children: Item[] | null
  expanding: boolean
  error: string | null
}

// `started` holds refs, not a count: a queued download's real outcome lives in its jobs, so the
// summary is derived from them rather than tallied at queue time.
interface Tally {
  started: string[]
  failed: number
  skipped: number
}

// A paused run: the passcode prompt is open; the queue resumes from `index` on submit.
interface Paused {
  queue: Item[]
  index: number
  tally: Tally
  reason: PasscodeError['reason']
  name: string
}

const IDLE: ExpandState = { expanded: false, children: null, expanding: false, error: null }

// A started row counts as failed if any of its jobs failed. `started` is one job list per queued ref.
function summarize(tally: Tally, started: readonly (readonly JobProgress[])[]): string {
  const status = started.map(rowStatus)
  const failed = tally.failed + status.filter((s) => s === 'error').length
  const parts = [`${status.filter((s) => s === 'done').length} downloaded`]
  if (failed) parts.push(`${failed} failed`)
  if (tally.skipped) parts.push(`${tally.skipped} already there`)
  return parts.join(', ')
}

// One Moodle section + a sequential "Download all" over it. Owns the expand/children cache
// (rows only render it) because the bulk queue needs resolved children. See docs/downloads.md.
export default function SectionGroup({ title, items, course, onReconnect }: Props) {
  const { courses } = useCourseTreeContext()
  const jobsByRef = useJobsByRef()
  const [expansions, setExpansions] = useState<Record<string, ExpandState>>({})
  // Keyed by ref and never cleared: an edit outlives an SSE refresh, a re-expand, and a bulk run.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ at: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<Tally | null>(null)
  const [paused, setPaused] = useState<Paused | null>(null)
  const [saving, setSaving] = useState(false)

  // Read through refs so the queue sees a mid-run SSE refresh and a name typed mid-run,
  // rather than the snapshot it started with.
  const coursesRef = useRef(courses)
  coursesRef.current = courses
  const editsRef = useRef(edits)
  editsRef.current = edits

  // Structural sharing is load-bearing: replacing only the edited ref's slice leaves every other
  // slice identical, which is what lets the memoized sibling rows bail out of a keystroke render.
  const setName = useCallback((ref: string, name: string) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], name } }))
  }, [])
  const setKind = useCallback((ref: string, kind: Kind) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], kind } }))
  }, [])
  const dispatch = useMemo(() => ({ setName, setKind }), [setName, setKind])

  function stateOf(ref: string): ExpandState {
    return expansions[ref] ?? IDLE
  }

  function patch(ref: string, next: Partial<ExpandState>) {
    setExpansions((prev) => ({ ...prev, [ref]: { ...(prev[ref] ?? IDLE), ...next } }))
  }

  // Cached on first expand, so collapse/re-expand never refetches.
  async function toggleExpand(item: Item) {
    const current = stateOf(item.ref)
    if (current.children) {
      patch(item.ref, { expanded: !current.expanded })
      return
    }
    patch(item.ref, { expanding: true, error: null })
    try {
      const children = await expandItem(item.ref)
      patch(item.ref, { children, expanded: true, expanding: false })
    } catch (err) {
      if (isReconnectError(err)) onReconnect()
      const message = isUnsupportedError(err) ? err.message : "Couldn't load entries. Try again."
      patch(item.ref, { expanding: false, error: isReconnectError(err) ? null : message })
    }
  }

  const expandables = items.filter((i) => i.expandable)
  const allExpanded = expandables.every((i) => stateOf(i.ref).children !== null)

  // A playlist contributes its children, never its own ref — the backend rejects that.
  function buildQueue(): Item[] {
    return items.flatMap((item) => (item.expandable ? (stateOf(item.ref).children ?? []) : [item]))
  }

  function finish(tally: Tally) {
    setRunning(false)
    setProgress(null)
    setOutcome({ ...tally, started: [...tally.started] })
  }

  // Triggering is sequential by design (the downloader drives one shared browser session), but the
  // downloads themselves run on — so several rows are in flight by the end of the queue.
  async function runQueue(queue: Item[], from: number, tally: Tally) {
    setRunning(true)
    setOutcome(null)
    for (let i = from; i < queue.length; i++) {
      const item = queue[i]
      setProgress({ at: i + 1, total: queue.length })
      // Exactly what the row shows, so the skip rule and the green row can't disagree.
      const { name, kind } = resolveRow(
        item,
        editsRef.current[item.ref],
        coursesRef.current,
        course,
      )
      if (hasResource(item, name, kind, coursesRef.current, course)) {
        tally.skipped++
        continue
      }
      try {
        await downloadItem({ ref: item.ref, course, name, kind })
        tally.started.push(item.ref)
      } catch (err) {
        if (isReconnectError(err)) {
          onReconnect()
          setRunning(false)
          setProgress(null)
          setOutcome(null)
          return
        }
        if (isPasscodeError(err)) {
          // Hold here; submitting the passcode retries this same item.
          setPaused({ queue, index: i, tally, reason: err.reason, name })
          setRunning(false)
          return
        }
        tally.failed++
      }
    }
    finish(tally)
  }

  async function submitPasscode(passcode: string, scope: 'course' | 'lecture') {
    if (!paused || !passcode) return
    setSaving(true)
    try {
      await saveZoomPasscode({ course, name: paused.name, passcode, scope })
    } catch {
      setSaving(false)
      paused.tally.failed++
      const resume = paused
      setPaused(null)
      void runQueue(resume.queue, resume.index + 1, resume.tally)
      return
    }
    setSaving(false)
    const resume = paused
    setPaused(null)
    void runQueue(resume.queue, resume.index, resume.tally)
  }

  // Cancelling abandons the rest of the queue, not just the gated item.
  function cancelPasscode() {
    if (paused) {
      paused.tally.failed++
      finish(paused.tally)
    }
    setPaused(null)
  }

  // The run's real result: queueing ends long before the downloads do, so the tally is folded with
  // the live jobs of every row it started, looked up by `ref`. `active` counts running jobs (per
  // atom), so the header keeps ticking until the last clip of a zoom pair lands.
  const started = outcome ? outcome.started.map((ref) => jobsForRef(jobsByRef, ref)) : []
  const active = started.flat().filter((j) => j.status === 'running').length
  const summary = outcome && !active ? summarize(outcome, started) : null
  const busy = running || paused !== null || active > 0

  return (
    <div className="recordings-section">
      <div className="recordings-section-header">
        <span className="recordings-section-title" dir="auto">
          {title}
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
          onClick={() => runQueue(buildQueue(), 0, { started: [], failed: 0, skipped: 0 })}
          disabled={busy || !allExpanded}
          title={allExpanded ? undefined : 'Expand every playlist in this section first'}
        >
          {busy ? 'Downloading…' : '⭳ Download all'}
        </button>
      </div>

      <RowEditsDispatchContext.Provider value={dispatch}>
        <RowEditsStateContext.Provider value={edits}>
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
        </RowEditsStateContext.Provider>
      </RowEditsDispatchContext.Provider>

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
