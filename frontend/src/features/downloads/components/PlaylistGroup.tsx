import { memo, useId } from 'react'
import type { Item } from '@/features/downloads/services/autoDownloader'
import { expandItem, isReconnectError } from '@/features/downloads/services/autoDownloader'
import {
  expansionOf,
  patchExpansion,
  useRowExpansion,
} from '@/features/downloads/contexts/RowExpansionsContext'
import { useRowEdits, useRowLocksMap } from '@/features/downloads/contexts/RowEditsContext'
import { useMoodleLockState } from '@/features/downloads/contexts/MoodleLockContext'
import { useBulkRun } from '@/features/downloads/hooks/useBulkRun'
import { rowLocked } from '@/features/downloads/utils/moodleLock'
import { expandErrorText } from '@/features/downloads/utils/downloadErrors'
import { bulkGate } from '@/features/downloads/utils/runStatus'
import { playlistRunId } from '@/features/downloads/utils/sections'
import BulkRunControls from './BulkRunControls'
import BulkRunNotes from './BulkRunNotes'
import GroupHeader from './GroupHeader'
import RecordingRow from './RecordingRow'
import SkippedMark from './SkippedMark'
import '@/features/downloads/DownloadsView.css'
import './PlaylistGroup.css'

interface Props {
  item: Item
  course: string
  // The enclosing section's run key — null for the synthetic pile, which runs nothing — and whether
  // its run is busy, which holds this playlist's own "Download all".
  sectionKey: string | null
  sectionBusy: boolean
  onReconnect: () => void
  // The New view's playlist: only the expand toggle, its children selected as rows of the view.
  expandOnly?: boolean
}

// A playlist row as a collapsible group: a section-style header with its own "Download all", and its
// children, fetched on first expand, indented beneath. See docs/BULK.md §Playlists.
const PlaylistGroup = memo(function PlaylistGroup({
  item,
  course,
  sectionKey,
  sectionBusy,
  onReconnect,
  expandOnly = false,
}: Props) {
  // Subscribed per ref, so expanding one playlist leaves every other row alone. The store is shared
  // with SectionGroup, whose own queue needs the same children.
  const expand = useRowExpansion(item.ref)
  const runKey = sectionKey === null ? null : playlistRunId(sectionKey, item.ref)
  const bulk = useBulkRun(runKey, course, item.title)
  const children = expand.children
  // Children are YouTube, so the run waits out the Moodle lock only if auto flagged one as Moodle.
  const moodle = children?.some((c) => c.moodle) ?? false
  const locked = rowLocked(moodle, useMoodleLockState())
  const gate = bulkGate({
    ready: children !== null,
    busy: bulk.state.busy,
    otherBusy: sectionBusy,
    locked,
  })
  const bodyId = useId()
  // Cached on first expand; reads the store, so a click mid-fetch can't fetch twice.
  async function toggle() {
    const current = expansionOf(item.ref)
    if (current.children) {
      patchExpansion(item.ref, { expanded: !current.expanded })
      return
    }
    if (current.expanding) return
    patchExpansion(item.ref, { expanding: true, error: null })
    try {
      // Not gated: a playlist's children are YouTube, never Moodle.
      const fetched = await expandItem(item.ref)
      patchExpansion(item.ref, { children: fetched, expanded: true, expanding: false })
    } catch (err) {
      if (isReconnectError(err)) onReconnect()
      patchExpansion(item.ref, { expanding: false, error: expandErrorText(err) })
    }
  }

  return (
    <div className="recording-playlist">
      <GroupHeader
        scope="playlist"
        title={item.title}
        count={expandOnly ? null : (children?.length ?? null)}
        toggle={{
          open: expand.expanded,
          loading: expand.expanding,
          controls: bodyId,
          onClick: () => void toggle(),
        }}
      >
        {!expandOnly && <SkippedMark course={course} refKey={item.ref} />}
        {runKey !== null && !expandOnly && (
          <BulkRunControls
            scope="playlist"
            bulk={bulk}
            count={children?.length ?? null}
            gate={gate}
            onStart={() => void bulk.start(children ?? [], moodle)}
          />
        )}
      </GroupHeader>
      {expand.error && (
        <div className="recordings-status recordings-status--error">{expand.error}</div>
      )}
      {/* Hidden, not unmounted: the rows hold in-flight download state. */}
      {children && !expandOnly && (
        <div id={bodyId} className="recording-children" hidden={!expand.expanded}>
          <BulkRunNotes bulk={bulk} scope="playlist" />
          <ChildRows items={children} course={course} onReconnect={onReconnect} />
        </div>
      )}
    </div>
  )
})

export default PlaylistGroup

// Slices the edits map for a playlist's children, so only the group subscribes to it — a leaf that
// did would re-render on every keystroke in the section.
function ChildRows({
  items,
  course,
  onReconnect,
}: {
  items: Item[]
  course: string
  onReconnect: () => void
}) {
  const edits = useRowEdits()
  const locks = useRowLocksMap()
  return (
    <>
      {items.map((child) => (
        <RecordingRow
          key={child.ref}
          item={child}
          edit={edits[child.ref]}
          lock={locks[child.ref]}
          course={course}
          onReconnect={onReconnect}
        />
      ))}
    </>
  )
}
