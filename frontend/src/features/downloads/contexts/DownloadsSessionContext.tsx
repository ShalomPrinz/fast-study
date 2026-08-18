import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { t } from '@lingui/core/macro'
import type { ReactNode } from 'react'
import type { Course, Kind } from '@/types'
import type { Item, ResolvedMedia } from '../services/autoDownloader'
import { isReconnectError, listRecordings } from '../services/autoDownloader'
import type { RowEdit, RowEditsDispatch } from './RowEditsContext'
import type { ResolveMedia } from './ResolvedMediaContext'

export interface ExpandState {
  expanded: boolean
  children: Item[] | null
  expanding: boolean
  error: string | null
}

export const IDLE_EXPAND: ExpandState = {
  expanded: false,
  children: null,
  expanding: false,
  error: null,
}

interface DownloadsSessionState {
  selected: string | null
  items: Item[]
  loading: boolean
  error: string | null
  edits: Record<string, RowEdit>
  expansions: Record<string, ExpandState>
  reconnectKey: number
}

interface DownloadsSessionActions {
  discover: (course: Course) => Promise<void>
  close: () => void
  reconnectHint: () => void
  resolveMedia: ResolveMedia
  rowEdits: RowEditsDispatch
  patchExpansion: (ref: string, next: Partial<ExpandState>) => void
}

// The whole Downloads page session, mounted in `Layout` so it outlives the route: discovery, row
// edits and playlist expansions survive a trip to a lecture and back. The bulk runs themselves are
// the server's (`SectionRunsContext`), so they outlive the tab too.
const DownloadsSessionStateContext = createContext<DownloadsSessionState | null>(null)
// Split out and identity-stable: the memoized rows' bail-out depends on these setters never changing.
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
  // Keyed by item ref and living above the media toggle, so a typed name, a kind toggle and a
  // playlist's cached children all survive a segment switch.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [expansions, setExpansions] = useState<Record<string, ExpandState>>({})

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

  const reconnectHint = useCallback(() => {
    sendUpdateRef.current?.('error', t`BIU session expired. Reconnect your account.`)
    setReconnectKey((k) => k + 1)
  }, [])

  // Everything keyed by ref goes together: refs from two courses must never collide. The runs are
  // not here — they are the server's, and their section ids are course-qualified anyway.
  const clear = useCallback(() => {
    setItems([])
    setEdits({})
    setExpansions({})
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
    () => ({ discover, close, reconnectHint, resolveMedia, rowEdits, patchExpansion }),
    [discover, close, reconnectHint, resolveMedia, rowEdits, patchExpansion],
  )
  const state = useMemo(
    () => ({ selected, items, loading, error, edits, expansions, reconnectKey }),
    [selected, items, loading, error, edits, expansions, reconnectKey],
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
