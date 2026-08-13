import { useCallback, useMemo, useState } from 'react'
import type { Course, Kind } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { toast } from '@/services/toaster'
import type { Item, Media, ResolvedMedia } from './services/autoDownloader'
import { listRecordings, isReconnectError } from './services/autoDownloader'
import { ResolvedMediaContext } from './contexts/ResolvedMediaContext'
import ModeToggle from '@/shared/components/ModeToggle'
import type { ModeConfig } from '@/shared/components/ModeToggle'
import AuthPill from '@/features/downloads/components/AuthPill'
import CourseSourceRow from '@/features/downloads/components/CourseSourceRow'
import AddCourseRow from '@/features/downloads/components/AddCourseRow'
import SectionGroup from '@/features/downloads/components/SectionGroup'
import type { ExpandState } from '@/features/downloads/components/SectionGroup'
import { groupSections } from '@/features/downloads/utils/sections'
import { DownloadJobsProvider } from './contexts/DownloadJobsContext'
import type { RowEdit } from './contexts/RowEditsContext'
import { RowEditsDispatchContext, RowEditsStateContext } from './contexts/RowEditsContext'

// Order matters: it drives the segment order and the default side (videos).
const MEDIA_MODES: Record<Media, ModeConfig> = {
  video: { label: 'Videos' },
  material: { label: 'Materials' },
  unknown: { label: 'Unknown' },
}

const EMPTY_STATE: Record<Media, string> = {
  video: 'No recordings found.',
  material: 'No materials found.',
  unknown: 'No files of unknown type found.',
}

// Downloads page: BIU account, course source URLs, discovery. See docs/downloads.md.
export default function DownloadsView() {
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)

  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)
  // Both maps are keyed by item ref and live above the media toggle, so a typed name, a kind
  // toggle and a playlist's cached children survive a segment switch. Cleared only per course.
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [expansions, setExpansions] = useState<Record<string, ExpandState>>({})

  // Structural sharing is load-bearing: replacing only the edited ref's slice leaves every other
  // slice identical, which is what lets the memoized sibling rows bail out of a keystroke render.
  const setName = useCallback((ref: string, name: string) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], name } }))
  }, [])
  const setKind = useCallback((ref: string, kind: Kind) => {
    setEdits((prev) => ({ ...prev, [ref]: { ...prev[ref], kind } }))
  }, [])
  const dispatch = useMemo(() => ({ setName, setKind }), [setName, setKind])

  // A probe verdict is stamped onto the item itself, so it outlives the row and a segment switch —
  // and a later /list simply restates it from auto's own cache. Only the resolved item's identity
  // changes, leaving the memoized sibling rows alone. A ref that isn't here (an expanded playlist
  // child, whose items live in `expansions`) is a no-op — those are never 'unknown' rows.
  const resolveMedia = useCallback((ref: string, media: ResolvedMedia) => {
    setItems((prev) => prev.map((i) => (i.ref === ref ? { ...i, resolvedMedia: media } : i)))
  }, [])

  // Stable identity matters: this reaches every memoized row, and a keystroke re-renders this
  // component, so a fresh function here would defeat the sibling rows' bail-out.
  const reconnectHint = useCallback(() => {
    toast('error', 'BIU session expired. Reconnect your account.')
    setReconnectKey((k) => k + 1)
  }, [])

  async function discover(course: Course) {
    if (!course.source_url) return
    setSelected(course.name)
    setItems([])
    setEdits({})
    setExpansions({})
    setError(null)
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
  }

  return (
    <DownloadJobsProvider>
      <ResolvedMediaContext.Provider value={resolveMedia}>
        <main className="main-view main-view--panel">
          <div className="lecture-panel lecture-panel--wide">
            <h2 className="lecture-panel-title">Downloads</h2>

            <AuthPill key={reconnectKey} />

            <div className="source-list">
              {active.map((course) => (
                <CourseSourceRow
                  key={course.name}
                  course={course}
                  onDiscover={course.source_url ? () => discover(course) : undefined}
                  selected={selected === course.name}
                  discovering={selected === course.name && loading}
                />
              ))}
              <AddCourseRow />
            </div>

            {selected && (
              <div className="recordings-panel">
                <div className="recordings-header">
                  <span className="recordings-title" dir="auto">
                    Recordings · {selected}
                  </span>
                  <button
                    className="recordings-close"
                    onClick={() => {
                      setSelected(null)
                      setItems([])
                      setEdits({})
                      setExpansions({})
                      setError(null)
                    }}
                  >
                    close
                  </button>
                </div>
                {loading && <div className="recordings-status">Loading recordings…</div>}
                {error && <div className="recordings-status recordings-status--error">{error}</div>}
                <RowEditsDispatchContext.Provider value={dispatch}>
                  <RowEditsStateContext.Provider value={edits}>
                    <ModeToggle
                      modes={MEDIA_MODES}
                      storageKey="fastStudyDownloadsMedia"
                      className="mode-toggle--downloads"
                    >
                      {(media) => {
                        const sections = groupSections(items, media)
                        if (!sections.length)
                          return (
                            !loading &&
                            !error && <div className="recordings-status">{EMPTY_STATE[media]}</div>
                          )
                        return sections.map(([title, sectionItems]) => (
                          <SectionGroup
                            // Media-qualified: one Moodle heading usually holds both a video and its
                            // slides, and a bare title would reuse the instance — and its bulk-run
                            // state — for the other side's rows.
                            key={`${media}:${title}`}
                            title={title}
                            items={sectionItems}
                            course={selected}
                            onReconnect={reconnectHint}
                            expansions={{ map: expansions, set: setExpansions }}
                          />
                        ))
                      }}
                    </ModeToggle>
                  </RowEditsStateContext.Provider>
                </RowEditsDispatchContext.Provider>
              </div>
            )}
          </div>
        </main>
      </ResolvedMediaContext.Provider>
    </DownloadJobsProvider>
  )
}
