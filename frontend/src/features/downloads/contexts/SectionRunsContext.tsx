import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { SectionRun } from '../services/downloadServer'
import { fetchRuns, subscribeRuns } from '../services/downloadServer'
import { sequencedRefresh } from '../utils/sequencedRefresh'
import { createCaptchaCatches } from '../utils/zoomCaptcha'
import { useDownloadsActions } from './DownloadsSessionContext'

// Module store of `GET /runs` by section id with per-section subscriptions; it outlives the provider,
// which clears it on unmount.
let runsBySection: ReadonlyMap<string, SectionRun> = new Map()
let pausedRuns: readonly SectionRun[] = []
let activeCourses: ReadonlySet<string> = new Set()
// Paused run ids whose passcode prompt the user closed without cancelling; the banner reopens it.
let dismissedRuns: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Courses a section run is still walking — resolving a target before its job exists, or parked at a
// passcode gate, both of which no job reflects yet.
export function coursesWithActiveRuns(snapshot: readonly SectionRun[]): ReadonlySet<string> {
  return new Set(
    snapshot.filter((r) => r.status === 'running' || r.status === 'paused').map((r) => r.course),
  )
}

function publish(snapshot: SectionRun[]) {
  runsBySection = new Map(snapshot.map((run) => [run.sectionId, run]))
  activeCourses = coursesWithActiveRuns(snapshot)
  const paused = snapshot.filter((run) => run.status === 'paused')
  // Same parked ids keep the previous array, or every ping would re-render the banner. Keyed by id
  // alone: a consumer reading a mutable field must widen this comparison first.
  if (paused.length !== pausedRuns.length || paused.some((run, i) => run.id !== pausedRuns[i].id))
    pausedRuns = paused
  // A run that left its gate forgets the dismissal, so its next gate prompts again.
  if ([...dismissedRuns].some((id) => !paused.some((run) => run.id === id)))
    dismissedRuns = new Set([...dismissedRuns].filter((id) => paused.some((run) => run.id === id)))
  notify()
}

function notify() {
  for (const listener of listeners) listener()
}

// Closes a paused run's prompt without cancelling the run, which keeps waiting at its gate.
export function dismissPasscode(runId: string) {
  if (dismissedRuns.has(runId)) return
  dismissedRuns = new Set([...dismissedRuns, runId])
  notify()
}

export function reopenPasscode(runId: string) {
  if (!dismissedRuns.has(runId)) return
  dismissedRuns = new Set([...dismissedRuns].filter((id) => id !== runId))
  notify()
}

// Guard only — the runs themselves come from the module store, not from the context value.
const SectionRunsContext = createContext(false)

// One section's run, or null — always for the id-less synthetic bucket. A stable `null` lets a
// section with no run bail out of every ping.
export function useSectionRun(sectionId: string | null): SectionRun | null {
  if (!useContext(SectionRunsContext))
    throw new Error('useSectionRun must be used inside <SectionRunsProvider>')
  return useSyncExternalStore(
    subscribe,
    useCallback(
      () => (sectionId === null ? null : (runsBySection.get(sectionId) ?? null)),
      [sectionId],
    ),
  )
}

// Every run parked at a passcode gate, whichever course or segment it belongs to — a paused run is
// the one status waiting on the user, and its own `SectionGroup` may be off-screen or undiscovered.
export function usePausedRuns(): readonly SectionRun[] {
  if (!useContext(SectionRunsContext))
    throw new Error('usePausedRuns must be used inside <SectionRunsProvider>')
  return useSyncExternalStore(subscribe, () => pausedRuns)
}

// Whether the user closed this run's passcode prompt; false for no run.
export function usePasscodeDismissed(runId: string | null): boolean {
  if (!useContext(SectionRunsContext))
    throw new Error('usePasscodeDismissed must be used inside <SectionRunsProvider>')
  return useSyncExternalStore(subscribe, () => runId !== null && dismissedRuns.has(runId))
}

// Whether a section run is still walking this course; read through `useCourseDownloading`, the one
// "something is downloading into this course" answer.
export function useCourseRunActive(course: string): boolean {
  if (!useContext(SectionRunsContext))
    throw new Error('useCourseRunActive must be used inside <SectionRunsProvider>')
  return useSyncExternalStore(subscribe, () => activeCourses.has(course))
}

// Reflects the downloader server's section runs, as `RunnerStatusContext` does the pipeline runner.
// See docs/BULK.md.
// `onCaptchaSolved` fires once per snapshot in which any target newly caught its zoom player past a
// captcha, never once per target.
export function SectionRunsProvider({
  children,
  onCaptchaSolved,
}: {
  children: ReactNode
  onCaptchaSolved?: () => void
}) {
  const { reconnectHint } = useDownloadsActions()
  // Fires the reconnect hint once per run id; `primed` seeds the first snapshot, since a run aborted
  // before load is history.
  const reported = useRef<Set<string>>(new Set())
  const primed = useRef(false)
  const onCaught = useRef(onCaptchaSolved)
  onCaught.current = onCaptchaSolved

  useEffect(() => {
    let cancelled = false
    // Per mount, so a remount seeds afresh instead of replaying catches that already happened.
    const caught = createCaptchaCatches()
    const handleSnapshot = (snapshot: SectionRun[]) => {
      if (cancelled) return
      for (const run of snapshot) {
        if (run.status !== 'reconnect' || reported.current.has(run.id)) continue
        if (primed.current) reconnectHint()
        reported.current.add(run.id)
      }
      primed.current = true
      if (caught(snapshot) > 0) onCaught.current?.()
      publish(snapshot)
    }
    // Sequenced because `done` is the last frame a run emits: an older `/runs` reply landing after it
    // would strand the section on "Downloading…" with nothing left to ping a correction.
    const onRunsChanged = sequencedRefresh(fetchRuns, handleSnapshot)
    const close = subscribeRuns(onRunsChanged)
    return () => {
      cancelled = true
      close()
      dismissedRuns = new Set()
      publish([])
      primed.current = false
      reported.current.clear()
    }
  }, [reconnectHint])

  return <SectionRunsContext.Provider value={true}>{children}</SectionRunsContext.Provider>
}
