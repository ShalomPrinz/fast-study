import { useState } from 'react'
import type { Course } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { toast } from '@/services/toaster'
import type { Item } from './services/autoDownloader'
import { listRecordings, isReconnectError } from './services/autoDownloader'
import AuthPill from './AuthPill'
import CourseSourceRow from './CourseSourceRow'
import AddCourseRow from './AddCourseRow'
import RecordingRow from './RecordingRow'

// Downloads page: connect the BIU account, manage course source URLs, discover and download recordings
export default function DownloadsView() {
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)

  const [selected, setSelected] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reconnectHint() {
    toast('error', 'BIU session expired. Reconnect your account.')
  }

  // Discover one course's recordings in-page. Switching courses just re-calls /list
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
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title">Downloads</h2>

        <AuthPill />

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
              <span className="recordings-title" dir="auto">Recordings · {selected}</span>
              <button
                className="recordings-close"
                onClick={() => { setSelected(null); setItems([]); setError(null) }}
              >
                close 
              </button>
            </div>
            {loading && <div className="recordings-status">Loading recordings…</div>}
            {error && <div className="recordings-status recordings-status--error">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="recordings-status">No recordings found.</div>
            )}
            {items.map((item) => (
              <RecordingRow key={item.ref} item={item} course={selected} onReconnect={reconnectHint} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
