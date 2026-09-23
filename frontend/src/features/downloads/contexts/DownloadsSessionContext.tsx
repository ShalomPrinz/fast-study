import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { t } from '@lingui/core/macro'
import type { ReactNode } from 'react'
import type { Course, Kind } from '@/types'
import { isConnectionError } from '@/services/http'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import { failureOf } from '@/shared/utils/failure'
import type { Item, ResolvedMedia } from '../services/autoDownloader'
import { isBlockedError, isReconnectError, listRecordings } from '../services/autoDownloader'
import { blockedMessage } from '../utils/downloadErrors'
import { clearExpansions } from './RowExpansionsContext'
import { clearSectionCollapse } from './SectionCollapseContext'
import type { RowEdit, RowEditsDispatch } from './RowEditsContext'
import type { ResolveMedia } from './ResolvedMediaContext'

interface DownloadsSessionState {
  // The course whose items are on the page, and the one a discovery is currently fetching. They are
  // separate so a failed discovery changes nothing: nothing paints until the items are in hand.
  selected: string | null
  pending: string | null
  items: Item[]
  edits: Record<string, RowEdit>
  reconnectKey: number
}

interface DownloadsSessionActions {
  discover: (course: Course) => Promise<void>
  close: () => void
  reconnectHint: () => void
  resolveMedia: ResolveMedia
  rowEdits: RowEditsDispatch
}

// The Downloads page session, mounted in `Layout` so discovery, edits and expansions outlive the
// route. See docs/DOWNLOADS.md.
const DownloadsSessionStateContext = createContext<DownloadsSessionState | null>(null)
// Split out and identity-stable: the memoized rows' bail-out depends on these setters never changing.
const DownloadsSessionActionsContext = createContext<DownloadsSessionActions | null>(null)

type UpdateKind = 'info' | 'warning' | 'error'

interface ProviderProps {
  sendUpdate?: (kind: UpdateKind, message: ReactNode) => void
  children: ReactNode
}

export function DownloadsSessionProvider({ sendUpdate, children }: ProviderProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [reconnectKey, setReconnectKey] = useState(0)
  // Keyed by item ref and living above the media toggle, so a typed name, a kind toggle and a
  // playlist's cached children all survive a segment switch.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})

  const sendUpdateRef = useRef(sendUpdate)
  sendUpdateRef.current = sendUpdate

  // Only the newest discovery's ticket may write; `close` bumps it too, so an answer the user walked
  // away from cannot reopen the panel.
  const discoveryId = useRef(0)

  // Structural sharing is load-bearing: replacing only the edited ref's slice leaves every other
  // slice identical, which is what lets the memoized sibling rows bail out of a keystroke render.
  const setName = useCallback((ref: string, name: string) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], name } }))
  }, [])
  const setKind = useCallback((ref: string, kind: Kind) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], kind } }))
  }, [])
  const rowEdits = useMemo(() => ({ setName, setKind }), [setName, setKind])

  // Stamps a probe verdict onto the item, changing only its identity. An unknown ref (a playlist
  // child, held in the expansions store) is a no-op — those are never 'unknown' rows.
  const resolveMedia = useCallback((ref: string, media: ResolvedMedia) => {
    setItems((prev) => prev.map((i) => (i.ref === ref ? { ...i, resolvedMedia: media } : i)))
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
    clearExpansions()
    clearSectionCollapse()
  }, [])

  // Promoted to `selected` only with items in hand, so every failure leaves the page as it was and
  // says so in a toast.
  const discover = useCallback(
    async (course: Course) => {
      if (!course.source_url) return
      const id = ++discoveryId.current
      setPending(course.name)
      try {
        const found = await listRecordings(course.source_url)
        if (id !== discoveryId.current) return
        clear()
        setItems(found)
        setSelected(course.name)
      } catch (err) {
        // The expired session is true whichever discovery learned it, so the hint fires even for a
        // superseded one: it moves the account chip, never the page.
        if (isReconnectError(err)) {
          reconnectHint()
          return
        }
        if (id !== discoveryId.current) return
        // The client already toasted an unreachable service; a second toast would restate it.
        if (isConnectionError(err)) return
        // Bot protection is the site's, not the account's: no chip moves, and unlike the reconnect
        // hint it stays behind the ticket guard.
        if (isBlockedError(err)) {
          sendUpdateRef.current?.('error', blockedMessage())
          return
        }
        // A coded refusal says why in the service's words, led by the course name so it never reads
        // as the open course failing; only a codeless one gets the generic line.
        const name = course.name
        const failure = failureOf(err)
        sendUpdateRef.current?.(
          'error',
          failure.code
            ? serviceErrorNode(failure, name)
            : t`Couldn't load recordings for "${name}". Try again.`,
        )
      } finally {
        if (id === discoveryId.current) setPending(null)
      }
    },
    [clear, reconnectHint],
  )

  const close = useCallback(() => {
    discoveryId.current++
    setSelected(null)
    setPending(null)
    clear()
  }, [clear])

  const actions = useMemo(
    () => ({ discover, close, reconnectHint, resolveMedia, rowEdits }),
    [discover, close, reconnectHint, resolveMedia, rowEdits],
  )
  const state = useMemo(
    () => ({ selected, pending, items, edits, reconnectKey }),
    [selected, pending, items, edits, reconnectKey],
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
