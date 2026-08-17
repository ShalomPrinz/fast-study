import { ResolvedMediaContext } from './contexts/ResolvedMediaContext'
import ModeToggle from '@/shared/components/ModeToggle'
import type { ModeConfig } from '@/shared/components/ModeToggle'
import type { Media } from './services/autoDownloader'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import AuthPill from '@/features/downloads/components/AuthPill'
import CourseSourceRow from '@/features/downloads/components/CourseSourceRow'
import AddCourseRow from '@/features/downloads/components/AddCourseRow'
import SectionGroup from '@/features/downloads/components/SectionGroup'
import PausedRunsBanner from '@/features/downloads/components/PausedRunsBanner'
import { groupSections, sectionId } from '@/features/downloads/utils/sections'
import { RowEditsDispatchContext, RowEditsStateContext } from './contexts/RowEditsContext'
import {
  useDownloadsActions,
  useDownloadsSession,
} from '@/features/downloads/contexts/DownloadsSessionContext'

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

  const { selected, items, loading, error, edits, reconnectKey } = useDownloadsSession()
  const { discover, close, reconnectHint, resolveMedia, rowEdits } = useDownloadsActions()

  return (
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
                <button className="recordings-close" onClick={close}>
                  close
                </button>
              </div>
              {loading && <div className="recordings-status">Loading recordings…</div>}
              {error && <div className="recordings-status recordings-status--error">{error}</div>}
              <RowEditsDispatchContext.Provider value={rowEdits}>
                <RowEditsStateContext.Provider value={edits}>
                  <ModeToggle
                    modes={MEDIA_MODES}
                    storageKey="fastStudyDownloadsMedia"
                    className="mode-toggle--downloads"
                  >
                    {(media, selectMedia) => {
                      const sections = groupSections(items, media)
                      return (
                        <>
                          <PausedRunsBanner
                            course={selected}
                            media={media}
                            onSelectMedia={selectMedia}
                          />
                          {!sections.length
                            ? !loading &&
                              !error && (
                                <div className="recordings-status">{EMPTY_STATE[media]}</div>
                              )
                            : sections.map(([title, sectionItems]) => {
                                const id = sectionId(selected, media, title)
                                return (
                                  <SectionGroup
                                    key={id}
                                    section={{ id, title }}
                                    items={sectionItems}
                                    course={selected}
                                    onReconnect={reconnectHint}
                                  />
                                )
                              })}
                        </>
                      )
                    }}
                  </ModeToggle>
                </RowEditsStateContext.Provider>
              </RowEditsDispatchContext.Provider>
            </div>
          )}
        </div>
      </main>
    </ResolvedMediaContext.Provider>
  )
}
