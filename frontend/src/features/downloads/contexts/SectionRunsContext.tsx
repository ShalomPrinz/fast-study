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

// Module store of `GET /runs` by section id with per-section subscriptions; it outlives the provider,
// which clears it on unmount.
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
  // Same parked ids keep the previous array, or every ping would re-render the banner. Keyed by id
  // alone: a consumer reading a mutable field must widen this comparison first.
  if (paused.length !== pausedRuns.length || paused.some((run, i) => run.id !== pausedRuns[i].id))
    pausedRuns = paused
  for (const listener of listeners) listener()
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

// Reflects the downloader server's section runs, as `RunnerStatusContext` does the pipeline runner.
// See docs/BULK.md.
export function SectionRunsProvider({ children }: { children: ReactNode }) {
  const { reconnectHint } = useDownloadsActions()
  // Fires the reconnect hint once per run id; `primed` seeds the first snapshot, since a run aborted
  // before load is history.
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
