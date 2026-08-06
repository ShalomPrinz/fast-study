import { useState } from 'react'
import type { Course } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { toast } from '@/services/toaster'
import type { Item, Media } from './services/autoDownloader'
import { listRecordings, isReconnectError } from './services/autoDownloader'
import ModeToggle from '@/shared/components/ModeToggle'
import type { ModeConfig } from '@/shared/components/ModeToggle'
import AuthPill from '@/features/downloads/components/AuthPill'
import CourseSourceRow from '@/features/downloads/components/CourseSourceRow'
import AddCourseRow from '@/features/downloads/components/AddCourseRow'
import SectionGroup from '@/features/downloads/components/SectionGroup'
import { groupSections } from '@/features/downloads/utils/sections'
import { DownloadJobsProvider } from './contexts/DownloadJobsContext'

// Order matters: it drives the segment order and the default side (videos).
const MEDIA_MODES: Record<Media, ModeConfig> = {
  video: { label: 'Videos' },
  material: { label: 'Materials' },
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

  function reconnectHint() {
    toast('error', 'BIU session expired. Reconnect your account.')
    setReconnectKey((k) => k + 1)
  }

  async function discover(course: Course) {
    if (!course.source_url) return
    setSelected(course.name)
    setItems([])
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
      <main className="main-view main-view--panel">
        <div className="lecture-panel">
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
                    setError(null)
                  }}
                >
                  close
                </button>
              </div>
              {loading && <div className="recordings-status">Loading recordings…</div>}
              {error && <div className="recordings-status recordings-status--error">{error}</div>}
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
                      !error && (
                        <div className="recordings-status">
                          {media === 'material' ? 'No materials found.' : 'No recordings found.'}
                        </div>
                      )
                    )
                  return sections.map(([title, sectionItems]) => (
                    <SectionGroup
                      key={title}
                      title={title}
                      items={sectionItems}
                      course={selected}
                      onReconnect={reconnectHint}
                    />
                  ))
                }}
              </ModeToggle>
            </div>
          )}
        </div>
      </main>
    </DownloadJobsProvider>
  )
}
