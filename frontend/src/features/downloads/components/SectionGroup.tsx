import { useEffect, useId } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Item } from '@/features/downloads/services/autoDownloader'
import RecordingRow from './RecordingRow'
import PlaylistGroup from './PlaylistGroup'
import GroupHeader from './GroupHeader'
import BulkRunControls from './BulkRunControls'
import BulkRunNotes from './BulkRunNotes'
import { useJobsByRef } from '@/features/downloads/contexts/DownloadJobsContext'
import { useRowEdits, useRowLocksMap } from '@/features/downloads/contexts/RowEditsContext'
import { IDLE_EXPAND, useAllExpansions } from '@/features/downloads/contexts/RowExpansionsContext'
import { usePlaylistRuns } from '@/features/downloads/contexts/SectionRunsContext'
import { useMoodleLockState } from '@/features/downloads/contexts/MoodleLockContext'
import { moodleLocked } from '@/features/downloads/utils/moodleLock'
import {
  expandSection,
  toggleSection,
  useSectionOpen,
} from '@/features/downloads/contexts/SectionCollapseContext'
import { useBulkRun } from '@/features/downloads/hooks/useBulkRun'
import { bulkGate, runBusy } from '@/features/downloads/utils/runStatus'
import { leafCount, sectionTitle } from '@/features/downloads/utils/sections'
import './SectionGroup.css'

interface Props {
  // `id` keys the section's run (`${course}:${media}:${title}`), null for the synthetic pile, whose
  // title is ours rather than Moodle's.
  section: { id: string | null; title: string; synthetic: boolean }
  // The section's collapse key: `id`, or a course- and media-qualified one for the synthetic pile.
  collapseKey: string
  items: Item[]
  course: string
  onReconnect: () => void
}

// One Moodle section: starts its bulk run and reflects it, above its rows and playlists.
// See docs/BULK.md.
export default function SectionGroup({ section, collapseKey, items, course, onReconnect }: Props) {
  const { t } = useLingui()
  const jobsByRef = useJobsByRef()
  const edits = useRowEdits()
  const locks = useRowLocksMap()
  // The whole map: the bulk queue needs every playlist's children, and "Download all" needs to know
  // they are all expanded. The rows themselves subscribe per ref.
  const expansions = useAllExpansions()
  const id = section.id
  // Our own label, so translated here, media-neutral since it spans segments; a Moodle heading spelled
  // the same passes through untouched.
  const label = section.synthetic ? t`Other links` : sectionTitle(section.title)
  const bulk = useBulkRun(id, course, label)
  const locked = moodleLocked(useMoodleLockState())
  // A playlist's own run over rows this section's run would queue too.
  const playlistBusy = usePlaylistRuns(id).some((run) => runBusy(run, course, jobsByRef))
  const paused = bulk.run?.status === 'paused'
  const open = useSectionOpen(collapseKey)
  const bodyId = useId()

  // A parked run's passcode prompt lives in the body, so a pause opens the section.
  useEffect(() => {
    if (paused) expandSection(collapseKey)
  }, [paused, collapseKey])

  const childrenOf = (ref: string) => (expansions[ref] ?? IDLE_EXPAND).children
  const allExpanded = items.every((i) => !i.expandable || childrenOf(i.ref) !== null)
  // The header's count and the button's are the leaves the run would queue, not the rows shown.
  const leaves = leafCount(items, childrenOf)
  const gate = bulkGate({
    ready: allExpanded,
    busy: bulk.state.busy,
    otherBusy: playlistBusy,
    locked,
  })

  // A playlist contributes its children, never its own ref — the backend rejects that.
  const queue = () =>
    items.flatMap((item) => (item.expandable ? (childrenOf(item.ref) ?? []) : [item]))

  return (
    <div className="recordings-section">
      <GroupHeader
        scope="section"
        title={label}
        count={leaves}
        toggle={{
          open,
          loading: false,
          controls: bodyId,
          onClick: () => toggleSection(collapseKey),
        }}
      >
        {id !== null && (
          <BulkRunControls
            scope="section"
            bulk={bulk}
            count={leaves}
            gate={gate}
            onStart={() => void bulk.start(queue(), true)}
          />
        )}
      </GroupHeader>

      {/* Hidden, not unmounted: the rows and the prompt hold in-flight download and passcode state. */}
      <div id={bodyId} className="recordings-section-body" hidden={!open}>
        <BulkRunNotes bulk={bulk} scope="section" />

        {items.map((item) =>
          item.expandable ? (
            <PlaylistGroup
              key={item.ref}
              item={item}
              course={course}
              sectionKey={id}
              sectionBusy={bulk.state.busy}
              onReconnect={onReconnect}
            />
          ) : (
            <RecordingRow
              key={item.ref}
              item={item}
              edit={edits[item.ref]}
              lock={locks[item.ref]}
              course={course}
              onReconnect={onReconnect}
            />
          ),
        )}
      </div>
    </div>
  )
}
