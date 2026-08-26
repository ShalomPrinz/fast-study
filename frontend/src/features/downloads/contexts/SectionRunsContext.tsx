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
import { useDownloadsActions } from './DownloadsSessionContext'

// Module-level store: `GET /runs` grouped by section id, with per-section subscriptions on top, so a
// `run:change` ping re-renders only the sections that have a run. It outlives the provider, so the
// provider clears it on unmount — a stale snapshot would show a run that is no longer there.
let runsBySection: ReadonlyMap<string, SectionRun> = new Map()
let pausedRuns: readonly SectionRun[] = []
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(snapshot: SectionRun[]) {
  runsBySection = new Map(snapshot.map((run) => [run.sectionId, run]))
  const paused = snapshot.filter((run) => run.status === 'paused')
  // Keep the previous array when the same runs are still parked: `useSyncExternalStore` compares
  // snapshots by identity, and every ping decodes fresh objects, so a bare filter would re-render
  // the banner on every progress frame anywhere on the page. Keyed by id alone, so it carries run
  // identity only — a consumer reading a mutable field off it must widen this comparison first.
  if (paused.length !== pausedRuns.length || paused.some((run, i) => run.id !== pausedRuns[i].id))
    pausedRuns = paused
  for (const listener of listeners) listener()
}

// Guard only — the runs themselves come from the module store, not from the context value.
const SectionRunsContext = createContext(false)

// One section's run, or null while it has never run — and always null for a section with no id, the
// synthetic bucket that starts none. `null` is a stable snapshot identity, which is what lets a
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

// Reflects the downloader server's section runs and nothing more, the way `RunnerStatusContext`
// reflects the pipeline runner: the page starts a run with one POST and then only reads it back, so
// progress, dispositions and a passcode pause survive a segment switch, a reload and a closed tab.
export function SectionRunsProvider({ children }: { children: ReactNode }) {
  const { reconnectHint } = useDownloadsActions()
  // A reflected status is re-read on every ping, so the reconnect hint needs its own memory to fire
  // once per run. `primed` seeds the first snapshot: a run that was already aborted before this page
  // loaded is history, and the auth pill probes on mount anyway.
  const reported = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  useEffect(() => {
    let cancelled = false
    const handleSnapshot = (snapshot: SectionRun[]) => {
      if (cancelled) return
      for (const run of snapshot) {
        if (run.status !== 'reconnect' || reported.current.has(run.id)) continue
        if (primed.current) reconnectHint()
        reported.current.add(run.id)
      }
      primed.current = true
      publish(snapshot)
    }
    // Sequenced because `done` is the last frame a run emits: an older `/runs` reply landing after it
    // would strand the section on "Downloading…" with nothing left to ping a correction.
    const onRunsChanged = sequencedRefresh(fetchRuns, handleSnapshot)
    const close = subscribeRuns(onRunsChanged)
    return () => {
      cancelled = true
      close()
      publish([])
      primed.current = false
      reported.current.clear()
    }
  }, [reconnectHint])

  return <SectionRunsContext.Provider value={true}>{children}</SectionRunsContext.Provider>
}
