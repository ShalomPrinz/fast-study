import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Course, Kind } from '@/types'
import type { Item, PasscodeError, ResolvedMedia } from '../services/autoDownloader'
import { isReconnectError, listRecordings } from '../services/autoDownloader'
import type { Tally } from '../utils/runSummary'
import { runSettled, summarize } from '../utils/runSummary'
import { jobsForRef, useJobsByRef } from './DownloadJobsContext'
import type { RowEdit, RowEditsDispatch } from './RowEditsContext'
import type { ResolveMedia } from './ResolvedMediaContext'

export interface ExpandState {
  expanded: boolean
  children: Item[] | null
  expanding: boolean
  error: string | null
}

// A paused run: the passcode prompt is open; the queue resumes from `index` on submit.
export interface Paused {
  queue: Item[]
  index: number
  tally: Tally
  reason: PasscodeError['reason']
  name: string
}

// One section's bulk run, keyed by `${course}:${media}:${title}` — the identity the section renders
// under. `summary` is frozen once the run's downloads end, since the jobs it folds are evicted later.
export interface SectionRun {
  running: boolean
  progress: { at: number; total: number } | null
  outcome: Tally | null
  summary: string | null
  paused: Paused | null
  saving: boolean
}

export const IDLE_EXPAND: ExpandState = {
  expanded: false,
  children: null,
  expanding: false,
  error: null,
}

export const IDLE_RUN: SectionRun = {
  running: false,
  progress: null,
  outcome: null,
  summary: null,
  paused: null,
  saving: false,
}

interface DownloadsSessionState {
  selected: string | null
  items: Item[]
  loading: boolean
  error: string | null
  edits: Record<string, RowEdit>
  expansions: Record<string, ExpandState>
  runs: Record<string, SectionRun>
  reconnectKey: number
}

interface DownloadsSessionActions {
  discover: (course: Course) => Promise<void>
  close: () => void
  reconnectHint: () => void
  resolveMedia: ResolveMedia
  rowEdits: RowEditsDispatch
  patchExpansion: (ref: string, next: Partial<ExpandState>) => void
  setRun: (id: string, next: Partial<SectionRun>) => void
}

// The whole Downloads page session, mounted in `Layout` so it outlives the route: discovery, row
// edits, playlist expansions and every section's bulk run survive a trip to a lecture and back.
const DownloadsSessionStateContext = createContext<DownloadsSessionState | null>(null)
// Split out and identity-stable: the bulk queue keeps calling `setRun` long after its SectionGroup
// unmounted, and the memoized rows' bail-out depends on these setters never changing.
const DownloadsSessionActionsContext = createContext<DownloadsSessionActions | null>(null)

type UpdateKind = 'info' | 'warning' | 'error'

interface ProviderProps {
  sendUpdate?: (kind: UpdateKind, message: string) => void
  children: ReactNode
}

export function DownloadsSessionProvider({ sendUpdate, children }: ProviderProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)
  // Keyed by item ref / section id and living above the media toggle, so a typed name, a kind
  // toggle, a playlist's cached children and a run in flight all survive a segment switch.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [expansions, setExpansions] = useState<Record<string, ExpandState>>({})
  const [runs, setRuns] = useState<Record<string, SectionRun>>({})

  const sendUpdateRef = useRef(sendUpdate)
  sendUpdateRef.current = sendUpdate

  // Structural sharing is load-bearing: replacing only the edited ref's slice leaves every other
  // slice identical, which is what lets the memoized sibling rows bail out of a keystroke render.
  const setName = useCallback((ref: string, name: string) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], name } }))
  }, [])
  const setKind = useCallback((ref: string, kind: Kind) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], kind } }))
  }, [])
  const rowEdits = useMemo(() => ({ setName, setKind }), [setName, setKind])

  // A probe verdict is stamped onto the item itself, so it outlives the row and a segment switch —
  // and a later /list simply restates it from auto's own cache. Only the resolved item's identity
  // changes, leaving the memoized sibling rows alone. A ref that isn't here (an expanded playlist
  // child, whose items live in `expansions`) is a no-op — those are never 'unknown' rows.
  const resolveMedia = useCallback((ref: string, media: ResolvedMedia) => {
    setItems((prev) => prev.map((i) => (i.ref === ref ? { ...i, resolvedMedia: media } : i)))
  }, [])

  const patchExpansion = useCallback((ref: string, next: Partial<ExpandState>) => {
    setExpansions((prev) => ({ ...prev, [ref]: { ...(prev[ref] ?? IDLE_EXPAND), ...next } }))
  }, [])

  const setRun = useCallback((id: string, next: Partial<SectionRun>) => {
    setRuns((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE_RUN), ...next } }))
  }, [])

  // Freezing happens here rather than in `SectionGroup`, which is exactly the component that may be
  // unmounted while the last downloads land — and the jobs behind a summary are evicted 60s later.
  const jobsByRef = useJobsByRef()
  useEffect(() => {
    setRuns((prev) => {
      let next: Record<string, SectionRun> | null = null
      for (const [id, run] of Object.entries(prev)) {
        if (!run.outcome || run.summary || !runSettled(run.outcome.started, jobsByRef)) continue
        const started = run.outcome.started.map((ref) => jobsForRef(jobsByRef, ref))
        next ??= { ...prev }
        next[id] = { ...run, summary: summarize(run.outcome, started) }
      }
      return next ?? prev
    })
    // `runs` is a trigger too, not just a read: a run can end with its jobs already terminal, and
    // then no further snapshot arrives to freeze it. Returning `prev` unchanged ends the cycle.
  }, [jobsByRef, runs])

  const reconnectHint = useCallback(() => {
    sendUpdateRef.current?.('error', 'BIU session expired. Reconnect your account.')
    setReconnectKey((k) => k + 1)
  }, [])

  // Everything keyed by ref or section id goes together: refs from two courses must never collide.
  const clear = useCallback(() => {
    setItems([])
    setEdits({})
    setExpansions({})
    setRuns({})
    setError(null)
  }, [])

  const discover = useCallback(
    async (course: Course) => {
      if (!course.source_url) return
      setSelected(course.name)
      clear()
      setLoading(true)
      try {
        setItems(await listRecordings(course.source_url))
      } catch (err) {
        if (isReconnectError(err)) {
          reconnectHint()
          setSelected(null)
        } else {
          setError('Failed to load recordings. Is the auto-downloader running?')
        }
      } finally {
        setLoading(false)
      }
    },
    [clear, reconnectHint],
  )

  const close = useCallback(() => {
    setSelected(null)
    clear()
  }, [clear])

  const actions = useMemo(
    () => ({ discover, close, reconnectHint, resolveMedia, rowEdits, patchExpansion, setRun }),
    [discover, close, reconnectHint, resolveMedia, rowEdits, patchExpansion, setRun],
  )
  const state = useMemo(
    () => ({ selected, items, loading, error, edits, expansions, runs, reconnectKey }),
    [selected, items, loading, error, edits, expansions, runs, reconnectKey],
  )

  // Rendering `{children}` and nothing else is what keeps the sidebar and the outlet out of this:
  // their elements are unchanged, so React bails out and only context consumers re-render.
  return (
    <DownloadsSessionActionsContext.Provider value={actions}>
      <DownloadsSessionStateContext.Provider value={state}>
        {children}
      </DownloadsSessionStateContext.Provider>
    </DownloadsSessionActionsContext.Provider>
  )
}

export function useDownloadsSession(): DownloadsSessionState {
  const state = useContext(DownloadsSessionStateContext)
  if (!state)
    throw new Error('useDownloadsSession must be used within a <DownloadsSessionProvider>')
  return state
}

export function useDownloadsActions(): DownloadsSessionActions {
  const actions = useContext(DownloadsSessionActionsContext)
  if (!actions)
    throw new Error('useDownloadsActions must be used within a <DownloadsSessionProvider>')
  return actions
}
