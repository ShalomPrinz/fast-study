import { Trans, useLingui } from '@lingui/react/macro'
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
import '@/styles/panel.css'
import '@/styles/segmented.css'
import './DownloadsView.css'

// Downloads page: BIU account, course source URLs, discovery. See docs/downloads.md.
export default function DownloadsView() {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)

  const { selected, items, loading, error, edits, reconnectKey } = useDownloadsSession()
  const { discover, close, reconnectHint, resolveMedia, rowEdits } = useDownloadsActions()

  // Order matters: it drives the segment order and the default side (videos).
  const mediaModes: Record<Media, ModeConfig> = {
    video: { label: t`Videos` },
    material: { label: t`Materials` },
    unknown: { label: t`Unknown` },
  }

  const emptyState: Record<Media, string> = {
    video: t`No recordings found.`,
    material: t`No materials found.`,
    unknown: t`No files of unknown type found.`,
  }

  return (
    <ResolvedMediaContext.Provider value={resolveMedia}>
      <main className="main-view main-view--panel">
        <div className="lecture-panel lecture-panel--wide">
          <h2 className="lecture-panel-title">
            <Trans>Downloads</Trans>
          </h2>

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
                  <Trans>Recordings · {selected}</Trans>
                </span>
                <button className="recordings-close" onClick={close}>
                  <Trans>close</Trans>
                </button>
              </div>
              {loading && (
                <div className="recordings-status">
                  <Trans>Loading recordings…</Trans>
                </div>
              )}
              {error && <div className="recordings-status recordings-status--error">{error}</div>}
              <RowEditsDispatchContext.Provider value={rowEdits}>
                <RowEditsStateContext.Provider value={edits}>
                  <ModeToggle
                    modes={mediaModes}
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
                              !error && <div className="recordings-status">{emptyState[media]}</div>
                            : sections.map((section) => {
                                // The synthetic bucket gets no run identity at all: it spans every
                                // heading in the course, and an id would collide with a real
                                // heading spelled the same — one run slot for two sections.
                                const id = section.synthetic
                                  ? null
                                  : sectionId(selected, media, section.title)
                                return (
                                  <SectionGroup
                                    key={id ?? 'other-videos'}
                                    section={{ ...section, id }}
                                    items={section.items}
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
