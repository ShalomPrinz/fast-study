import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { t } from '@lingui/core/macro'
import type { ReactNode } from 'react'
import type { Course, Kind } from '@/types'
import { isConnectionError, isMoodleBusyError } from '@/services/http'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import { failureOf } from '@/shared/utils/failure'
import type { Item, ResolvedMedia } from '../services/autoDownloader'
import { isBlockedError, isReconnectError, listRecordings } from '../services/autoDownloader'
import { blockedMessage, blockedToastKind } from '../utils/downloadErrors'
import { useWithMoodleLock } from './MoodleLockContext'
import { clearExpansions } from './RowExpansionsContext'
import { clearSectionCollapse } from './SectionCollapseContext'
import type { RowEdit, RowEditsDispatch } from './RowEditsContext'
import type { ResolveMedia } from './ResolvedMediaContext'

interface DownloadsSessionState {
  // The course whose items are on the page, and the one a discovery is currently fetching. Starting a
  // discovery empties the page, so at most one of the two (or `failed`) names a course at a time.
  selected: string | null
  pending: string | null
  // The last discovery's failure, kept until the next discovery or `close`. `detail` is the service's
  // reason when it gave a code; null for every other failure, whose own channel already spoke.
  failed: { course: string; detail: ReactNode } | null
  items: Item[]
  edits: Record<string, RowEdit>
  reconnectKey: number
  // Bumps with every discovery that paints, so a reload of the open course is a new load.
  loadKey: number
}

interface DownloadsSessionActions {
  discover: (course: Course, opts?: { wait?: boolean }) => Promise<void>
  close: () => void
  reconnectHint: () => void
  resolveMedia: ResolveMedia
  // The lock is DownloadsView's, not the session's: it must not outlive the page.
  rowEdits: Omit<RowEditsDispatch, 'lock' | 'read'>
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
  const [failed, setFailed] = useState<DownloadsSessionState['failed']>(null)
  const [items, setItems] = useState<Item[]>([])
  const [reconnectKey, setReconnectKey] = useState(0)
  const [loadKey, setLoadKey] = useState(0)
  // Keyed by item ref and living above the media toggle, so a typed name, a kind toggle and a
  // playlist's cached children all survive a segment switch.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const withMoodleLock = useWithMoodleLock()

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
    sendUpdateRef.current?.('error', t`Your university session expired. Reconnect your account.`)
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

  // Starting empties the page (the old course's rows and typed names go at the pick, and a failure
  // never brings them back); `selected` is set only with items in hand, a failure lands in `failed`.
  const discover = useCallback(
    async (course: Course, { wait = false }: { wait?: boolean } = {}) => {
      if (!course.source_url) return
      const id = ++discoveryId.current
      clear()
      setSelected(null)
      setFailed(null)
      setPending(course.name)
      const fail = (detail: ReactNode = null) => setFailed({ course: course.name, detail })
      try {
        const url = course.source_url
        // `wait` is a reload nobody pressed (a source-URL edit): it waits out the lock instead of failing.
        const found = await withMoodleLock(() => listRecordings(url), {
          wait,
          stale: () => id !== discoveryId.current,
        })
        if (id !== discoveryId.current) return
        clear()
        setItems(found)
        setLoadKey((k) => k + 1)
        setSelected(course.name)
      } catch (err) {
        // The expired session is true whichever discovery learned it, so the hint fires even for a
        // superseded one: it moves the account chip, never the page.
        if (isReconnectError(err)) {
          reconnectHint()
          if (id === discoveryId.current) fail()
          return
        }
        if (id !== discoveryId.current) return
        // The client already toasted an unreachable service; a second toast would restate it. A busy
        // lock only raced the push that bars discovery.
        if (isConnectionError(err) || isMoodleBusyError(err)) return fail()
        // Bot protection is the site's, not the account's: no chip moves, and unlike the reconnect
        // hint it stays behind the ticket guard.
        if (isBlockedError(err)) {
          sendUpdateRef.current?.(
            blockedToastKind(err.challengeWindow),
            blockedMessage(err.challengeWindow),
          )
          return fail()
        }
        // A coded refusal's reason shows inline under the headline, never as a toast.
        const failure = failureOf(err)
        fail(failure.code ? serviceErrorNode(failure) : null)
      } finally {
        if (id === discoveryId.current) setPending(null)
      }
    },
    [clear, reconnectHint, withMoodleLock],
  )

  const close = useCallback(() => {
    discoveryId.current++
    setSelected(null)
    setPending(null)
    setFailed(null)
    clear()
  }, [clear])

  const actions = useMemo(
    () => ({ discover, close, reconnectHint, resolveMedia, rowEdits }),
    [discover, close, reconnectHint, resolveMedia, rowEdits],
  )
  const state = useMemo(
    () => ({ selected, pending, failed, items, edits, reconnectKey, loadKey }),
    [selected, pending, failed, items, edits, reconnectKey, loadKey],
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
