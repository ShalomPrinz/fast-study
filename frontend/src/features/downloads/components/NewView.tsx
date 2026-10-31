import { useState } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import type { Item, Media } from '@/features/downloads/services/autoDownloader'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { updateSkipped } from '@/services/database'
import { toastFailure } from '@/shared/utils/failure'
import { jobsForRef, useJobsByRef } from '@/features/downloads/contexts/DownloadJobsContext'
import { useMoodleLockState } from '@/features/downloads/contexts/MoodleLockContext'
import {
  resolveRow,
  useRowEdits,
  useRowLocksMap,
} from '@/features/downloads/contexts/RowEditsContext'
import { useAllExpansions } from '@/features/downloads/contexts/RowExpansionsContext'
import { useEngagedRefs } from '@/features/downloads/contexts/SectionRunsContext'
import { useBulkRun } from '@/features/downloads/hooks/useBulkRun'
import { hasResource } from '@/features/downloads/utils/existingItems'
import { moodleLocked } from '@/features/downloads/utils/moodleLock'
import {
  anyRecognised,
  buildNewView,
  checkedRefs,
  courseSubmitGated,
  entryCount,
  recognisedByRef,
  sectionCheck,
  selectableRefs,
  showsSkipBanner,
  skippableRefs,
  toggleSection,
} from '@/features/downloads/utils/newView'
import type { NewEntry } from '@/features/downloads/utils/newView'
import { courseRunId, sectionTitle, OTHER_LINKS_SECTION } from '@/features/downloads/utils/sections'
import { moodleBusyMessage } from '@/features/downloads/utils/downloadErrors'
import Tooltip from '@/shared/components/Tooltip'
import BulkRunNotes from './BulkRunNotes'
import PausedRunsBanner from './PausedRunsBanner'
import PlaylistGroup from './PlaylistGroup'
import RecordingRow from './RecordingRow'
import '@/styles/button.css'
import './NewView.css'

interface Props {
  course: string
  items: Item[]
  onReconnect: () => void
  // Opens the All view on this media, for a paused section run whose prompt lives there.
  onShowAll: (media: Media) => void
}

// The "approve what's new" list: not-downloaded, not-skipped rows grouped by media then Moodle section,
// each with a checkbox, under a sticky bar that downloads or skips the checked ones. Mounted per load,
// so its checks reset on a reload. See docs/DOWNLOADS.md.
export default function NewView({ course, items, onReconnect, onShowAll }: Props) {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const edits = useRowEdits()
  const locks = useRowLocksMap()
  const expansions = useAllExpansions()
  const jobsByRef = useJobsByRef()
  const heldByRun = useEngagedRefs(course)
  const lock = useMoodleLockState()
  const bulk = useBulkRun(courseRunId(course), course, course, 'course')
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  const [marking, setMarking] = useState(false)

  const skipped = courses.find((c) => c.name === course)?.skipped ?? []
  const childrenOf = (ref: string) => {
    const state = expansions[ref]
    return state?.expanded ? state.children : null
  }

  // Downloaded by stored source, or by the suggested name — never the typed one, so a row does not
  // vanish while the user retypes its name onto an existing lecture.
  const isDone = (item: Item) => {
    const { name, kind } = resolveRow(
      item,
      { kind: edits[item.ref]?.kind },
      courses,
      course,
      locks[item.ref],
    )
    return recognisedByRef(item, courses, course) || hasResource(item, name, kind, courses, course)
  }

  // A run walking the row or a download running on it keeps it listed until it lands.
  const byRef = new Map<string, Item>()
  for (const item of items) {
    byRef.set(item.ref, item)
    for (const child of expansions[item.ref]?.children ?? []) byRef.set(child.ref, child)
  }
  const engaged = (ref: string) => {
    const item = byRef.get(ref)
    const working =
      heldByRun.has(ref) || jobsForRef(jobsByRef, course, ref).some((j) => j.status === 'running')
    return working && !(item && isDone(item))
  }

  const groups = buildNewView(items, { skipped: new Set(skipped), isDone, engaged, childrenOf })
  const refs = selectableRefs(groups)
  const checked = checkedRefs(refs, unchecked, engaged)
  const queue = checked.flatMap((ref) => byRef.get(ref) ?? [])
  const total = groups.reduce(
    (n, g) => n + g.sections.reduce((m, s) => m + entryCount(s.entries, childrenOf), 0),
    0,
  )
  const moodleGated = queue.some((i) => i.moodle)
  const appending = bulk.run?.status === 'running' || bulk.run?.status === 'paused'
  const blocked = courseSubmitGated({
    hasMoodleRow: moodleGated,
    locked: moodleLocked(lock),
    appending,
  })

  const showBanner = showsSkipBanner({
    skipped,
    recognised: anyRecognised(items, courses, course),
    newCount: total,
  })

  async function mark(toSkip: string[]) {
    if (!toSkip.length || marking) return
    setMarking(true)
    try {
      await updateSkipped(course, { add: toSkip })
    } catch (err) {
      toastFailure(err)
    }
    setMarking(false)
  }

  const labels: Record<Media, string> = {
    video: t`Videos`,
    material: t`Materials`,
    assignment: t`Assignments`,
    unknown: t`Unknown`,
  }

  const { state, run } = bulk
  return (
    <div className="new-view">
      <PausedRunsBanner course={course} media={null} onSelectMedia={(media) => onShowAll(media)} />

      {showBanner && (
        <div className="new-banner">
          <span className="new-banner-text">
            <Plural
              value={total}
              one="This course has # item you haven't marked. Skip all old content?"
              other="This course has # items you haven't marked. Skip all old content?"
            />
          </span>
          <button
            className="btn btn--ghost new-banner-skip"
            disabled={marking}
            onClick={() => void mark(skippableRefs(groups, engaged))}
          >
            <Trans>Skip all</Trans>
          </button>
        </div>
      )}

      <BulkRunNotes bulk={bulk} scope="course" />

      {!groups.length && (
        <div className="recordings-status new-empty">
          <Trans>Nothing new in this course.</Trans>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.media} className="new-media">
          <h3 className="new-media-title">
            {labels[group.media]}
            <span className="new-count">
              {group.sections.reduce((n, s) => n + entryCount(s.entries, childrenOf), 0)}
            </span>
          </h3>
          {group.sections.map((section) => {
            const sectionRefs = section.entries.filter((e) => !e.playlist).map((e) => e.item.ref)
            const check = sectionCheck(sectionRefs, unchecked, engaged)
            return (
              <div
                key={section.synthetic ? OTHER_LINKS_SECTION : section.title}
                className="new-section"
              >
                <label className="new-section-head">
                  {sectionRefs.length > 0 && (
                    <input
                      type="checkbox"
                      className="new-section-check"
                      checked={check === 'all'}
                      disabled={sectionRefs.every(engaged)}
                      ref={(el) => {
                        if (el) el.indeterminate = check === 'some'
                      }}
                      onChange={() => setUnchecked(toggleSection(sectionRefs, unchecked, engaged))}
                      aria-label={t`Select all in this section`}
                    />
                  )}
                  <span className="new-section-title" dir="auto">
                    {section.synthetic ? t`Other links` : sectionTitle(section.title)}
                  </span>
                  <span className="new-count">{entryCount(section.entries, childrenOf)}</span>
                </label>
                {section.entries.map((entry) => (
                  <NewRow
                    key={entry.item.ref}
                    entry={entry}
                    course={course}
                    checked={!unchecked.has(entry.item.ref) && !engaged(entry.item.ref)}
                    disabled={engaged(entry.item.ref)}
                    onCheck={(on) =>
                      setUnchecked((prev) => {
                        const next = new Set(prev)
                        if (on) next.delete(entry.item.ref)
                        else next.add(entry.item.ref)
                        return next
                      })
                    }
                    onReconnect={onReconnect}
                  />
                ))}
              </div>
            )
          })}
        </section>
      ))}

      <div className="new-bar">
        <span className="new-bar-status">
          {state.queueing && run && (
            <Trans>
              Downloading {run.at}/{run.total}…
            </Trans>
          )}
          {!state.queueing && state.active > 0 && <Trans>Downloading {state.active} more…</Trans>}
          {state.summary}
        </span>
        <Tooltip content={t`They'll no longer show under New, but stay listed under All.`}>
          <button
            className="btn btn--ghost new-bar-skip"
            disabled={!checked.length || marking}
            onClick={() => void mark(checked)}
          >
            <Trans>Mark selected as irrelevant</Trans>
          </button>
        </Tooltip>
        <Tooltip content={blocked ? moodleBusyMessage() : undefined}>
          <button
            className="btn btn--primary new-bar-download"
            disabled={!queue.length || blocked}
            onClick={() => void bulk.start(queue, moodleGated && !appending)}
          >
            {t`Download selected (${queue.length})`}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

// One line of the list: a checkbox beside the row, or a playlist's expand-only header.
function NewRow({
  entry,
  course,
  checked,
  disabled,
  onCheck,
  onReconnect,
}: {
  entry: NewEntry
  course: string
  checked: boolean
  disabled: boolean
  onCheck: (on: boolean) => void
  onReconnect: () => void
}) {
  const { t } = useLingui()
  const edits = useRowEdits()
  const locks = useRowLocksMap()
  const { item } = entry
  if (entry.playlist)
    return (
      <PlaylistGroup
        item={item}
        course={course}
        sectionKey={null}
        sectionBusy={false}
        onReconnect={onReconnect}
        expandOnly
      />
    )
  return (
    <div className="new-row">
      <input
        type="checkbox"
        className="new-row-check"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheck(e.target.checked)}
        aria-label={t`Select ${item.title}`}
      />
      <div className="new-row-card">
        <RecordingRow
          item={item}
          edit={edits[item.ref]}
          lock={locks[item.ref]}
          course={course}
          onReconnect={onReconnect}
        />
      </div>
    </div>
  )
}
