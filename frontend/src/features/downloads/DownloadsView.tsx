import { useMemo, useState } from 'react'
import type { Course } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { toast } from '@/services/toaster'
import type { Item } from './services/autoDownloader'
import { listRecordings, isReconnectError } from './services/autoDownloader'
import AuthPill from '@/features/downloads/components/AuthPill'
import CourseSourceRow from '@/features/downloads/components/CourseSourceRow'
import AddCourseRow from '@/features/downloads/components/AddCourseRow'
import SectionGroup from '@/features/downloads/components/SectionGroup'
import { DownloadJobsProvider } from './contexts/DownloadJobsContext'

// Items whose Moodle heading is blank still need a home.
const OTHER_SECTION = 'Other'

// Downloads page: BIU account, course source URLs, discovery. See docs/downloads.md.
export default function DownloadsView() {
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)

  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reconnectKey, setReconnectKey] = useState(0)

  // First-seen order: the server's order is the page's order.
  const sections = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const item of items) {
      const key = item.section || OTHER_SECTION
      const bucket = map.get(key)
      if (bucket) bucket.push(item)
      else map.set(key, [item])
    }
    return [...map]
  }, [items])

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
              {!loading && !error && items.length === 0 && (
                <div className="recordings-status">No recordings found.</div>
              )}
              {sections.map(([title, sectionItems]) => (
                <SectionGroup
                  key={title}
                  title={title}
                  items={sectionItems}
                  course={selected}
                  onReconnect={reconnectHint}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </DownloadJobsProvider>
  )
}
