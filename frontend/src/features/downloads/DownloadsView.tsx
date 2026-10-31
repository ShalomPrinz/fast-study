import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import { ResolvedMediaContext } from './contexts/ResolvedMediaContext'
import ModeToggle from '@/shared/components/ModeToggle'
import type { ModeConfig } from '@/shared/components/ModeToggle'
import type { Media } from './services/autoDownloader'
import type { Course } from '@/types'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import PageHeader, { PageHeaderDot } from '@/shared/components/PageHeader'
import AccountStatus from '@/features/downloads/components/AccountStatus'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { ROUTES } from '@/shared/utils/routes'
import { courseLoadNotice } from '@/shared/utils/courseLoadNotice'
import CourseSourceBar from '@/features/downloads/components/CourseSourceBar'
import EditSourcePanel from '@/features/downloads/components/EditSourcePanel'
import AddCoursePanel from '@/features/downloads/components/AddCoursePanel'
import { useMoodleLockState } from '@/features/downloads/contexts/MoodleLockContext'
import { moodleLocked } from '@/features/downloads/utils/moodleLock'
import { moodleBusyMessage } from '@/features/downloads/utils/downloadErrors'
import ManualDownload from '@/features/downloads/components/ManualDownload'
import MediaNote from '@/features/downloads/components/MediaNote'
import FolderJobList from '@/features/downloads/components/FolderJobList'
import NewView from '@/features/downloads/components/NewView'
import ScopeControls from '@/features/downloads/components/ScopeControls'
import SectionGroup from '@/features/downloads/components/SectionGroup'
import PausedRunsBanner from '@/features/downloads/components/PausedRunsBanner'
import DownloadsTabs from '@/features/downloads/components/DownloadsTabs'
import ExtensionGuide from '@/features/extension/ExtensionGuide'
import { useDownloadsTab } from '@/features/downloads/hooks/useDownloadsTab'
import type { Scope } from '@/features/downloads/utils/scope'
import { MEDIA_KEY, readScope, writeScope } from '@/features/downloads/utils/scope'
import { groupSections, sectionId, showsMediaSegment } from '@/features/downloads/utils/sections'
import {
  RowEditsDispatchContext,
  RowEditsStateContext,
  RowLocksContext,
  useRowLocks,
} from './contexts/RowEditsContext'
import {
  useDownloadsActions,
  useDownloadsSession,
} from '@/features/downloads/contexts/DownloadsSessionContext'
import '@/styles/panel.css'
import '@/styles/pipeline-card.css'
import '@/styles/segmented.css'
import '@/styles/spinner.css'
import '@/styles/button.css'
import './DownloadsView.css'

function metaClass(shown: boolean): string {
  return shown ? 'downloads-meta-item' : 'downloads-meta-item downloads-meta-item--hidden'
}

// Downloads page: University (account, course sources, discovery), Extension (the setup guide) and
// Manual (paste a link) tabs under one frozen header. See docs/DOWNLOADS.md.
export default function DownloadsView() {
  const { t } = useLingui()
  const { courses, loaded, loadFailed } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)
  const withSource = active.filter((c) => c.source_url).length

  const { selected, pending, items, edits, reconnectKey, loadKey } = useDownloadsSession()
  const { discover, close, reconnectHint, resolveMedia, rowEdits } = useDownloadsActions()
  // The university is optional on the init wall, so a user without one lands here with nothing to sign in to.
  const status = useAuthStatus().status
  const unconfigured = status?.unconfigured
  // Only a probe that came back "not connected" bars discovery; one still in flight or failed says nothing.
  const disconnected = status?.connected === false
  const locked = moodleLocked(useMoodleLockState())
  // An unconfigured site bars discovery too, but the nudge already covers it, so it has no note.
  const barred = unconfigured || disconnected || locked
  const blockReason = unconfigured
    ? null
    : disconnected
      ? t`Connect your university account first`
      : locked
        ? moodleBusyMessage()
        : null
  // The course picked in the box; the session's `selected` is the one whose recordings are loaded.
  const [chosen, setChosen] = useState(pending ?? selected ?? '')
  const [panel, setPanel] = useState<'edit' | 'add' | null>(null)
  // A pick made while discovery was barred loads once the bar lifts; held by name so the load sees
  // the course's source URL as it is then.
  const [deferred, setDeferred] = useState<string | null>(null)
  const chosenCourse = active.find((c) => c.name === chosen)
  const [tab, selectTab] = useDownloadsTab()
  // Held here rather than in the session, so leaving the page drops every lock.
  const { locks, lock } = useRowLocks()
  // Mirrored into a ref so `read` keeps the dispatch bag's identity stable across keystrokes.
  const rows = useRef({ edits, locks })
  useEffect(() => {
    rows.current = { edits, locks }
  }, [edits, locks])
  const read = useCallback(() => rows.current, [])
  const dispatch = useMemo(() => ({ ...rowEdits, lock, read }), [rowEdits, lock, read])

  useEffect(() => {
    if (deferred && !barred) {
      setDeferred(null)
      const course = courses.find((c) => c.name === deferred && !c.archived)
      if (course?.source_url) void discover(course, { wait: true })
    }
  }, [deferred, barred, courses, discover])

  // A discovery that ended without painting its course leaves the box on the session's course, so
  // the box always names what is shown below.
  const prevPending = useRef(pending)
  useEffect(() => {
    const was = prevPending.current
    prevPending.current = pending
    // A course whose URL was just cleared stays in the box with the empty note.
    const hasSource = courses.some((c) => c.name === was && c.source_url)
    if (was && !pending && selected !== was && chosen === was && !deferred && hasSource)
      setChosen(selected ?? '')
  }, [pending, selected, chosen, deferred, courses])

  // Loads a course now, or once discovery is no longer barred (closing what is open meanwhile).
  function loadCourse(course: Course, wait: boolean) {
    if (barred) {
      close()
      setDeferred(course.name)
    } else void discover(course, { wait })
  }

  function pickCourse(name: string) {
    const course = active.find((c) => c.name === name)
    setChosen(name)
    // A course with no source opens the picker at once; a Moodle list already open is kept, not refetched.
    setPanel(course && !course.source_url ? 'edit' : null)
    if (!course || (name === selected && !deferred) || name === pending) return
    setDeferred(null)
    if (!course.source_url) return close()
    loadCourse(course, false)
  }

  const [scope, setScope] = useState<Scope>(readScope)
  function chooseScope(next: Scope) {
    setScope(next)
    writeScope(next)
  }
  // A paused section run's prompt lives in All, so open it on that run's media.
  function showAll(media: Media) {
    try {
      localStorage.setItem(MEDIA_KEY, media)
    } catch {
      // Storage blocked: All opens on its last media.
    }
    chooseScope('all')
  }

  const countOf = (media: Media) => items.filter((i) => i.media === media).length

  // Order matters: it drives the segment order and the default side (videos).
  const allMediaModes: Record<Media, ModeConfig> = {
    video: { label: t`Videos`, count: countOf('video'), icon: 'lecture' },
    material: { label: t`Materials`, count: countOf('material'), icon: 'file' },
    assignment: {
      label: t`Assignments`,
      count: countOf('assignment'),
      icon: 'document',
    },
    unknown: { label: t`Unknown`, count: countOf('unknown'), icon: 'question' },
  }
  const mediaModes = Object.fromEntries(
    Object.entries(allMediaModes).filter(([media, { count }]) =>
      showsMediaSegment(media as Media, count ?? 0),
    ),
  ) as Partial<Record<Media, ModeConfig>>

  const emptyState: Record<Media, string> = {
    video: t`No recordings found.`,
    material: t`No materials found.`,
    assignment: t`No assignments found.`,
    unknown: t`No files of unknown type found.`,
  }

  const loadNote =
    chosenCourse?.source_url && selected !== chosen
      ? pending === chosen
        ? t`Loading…`
        : blockReason
      : null

  return (
    <ResolvedMediaContext.Provider value={resolveMedia}>
      <main className="main-view main-view--page downloads-page">
        <PageHeader
          title={t`Downloads`}
          meta={
            // Every tab's meta, and the loading line, share one grid cell with the others hidden, so the
            // header keeps the tallest one's height and the tab row never moves.
            <div className="downloads-meta">
              {/* A button's height, held while the account chip is still loading and shows none. */}
              <span
                className="btn downloads-meta-item downloads-meta-item--hidden"
                aria-hidden="true"
              >
                &nbsp;
              </span>
              <div className={metaClass(tab === 'university')}>
                {/* Remounting on a reconnect hint forces a fresh probe: the cached status predates
                    the 401 that raised the hint and would still read "connected". */}
                <AccountStatus key={reconnectKey} />
                <PageHeaderDot />
                <span>{t`${withSource} courses with a source`}</span>
              </div>
              <div className={metaClass(tab === 'extension')}>
                <Trans>A one-time setup of about three minutes.</Trans>
              </div>
              <div className={metaClass(tab === 'manual')}>
                <Trans>Download any open video on the internet</Trans>
              </div>
              <div className={metaClass(tab === null)}>
                <Trans>Loading your data…</Trans>
              </div>
            </div>
          }
          secondaryActions={
            <div className="downloads-header-rows">
              <DownloadsTabs tab={tab} onSelect={selectTab} />
              {tab === 'university' && (
                <CourseSourceBar
                  chosen={chosenCourse?.name ?? ''}
                  names={active.map((c) => c.name)}
                  onPick={pickCourse}
                  onEdit={() => setPanel('edit')}
                  onAdd={() => setPanel('add')}
                  editing={panel === 'edit'}
                  adding={panel === 'add'}
                />
              )}
            </div>
          }
        />

        {/* Keyed by tab so each one opens at its own top rather than the last tab's scroll offset. */}
        <div className="page-body" key={tab ?? 'loading'}>
          <div className="page-column">
            {tab === null && (
              <div className="downloads-tab-loading">
                <div className="spinner" />
              </div>
            )}
            {tab === 'extension' && (
              <>
                <FolderJobList />
                <ExtensionGuide />
              </>
            )}
            {tab === 'manual' && <ManualDownload />}
            {tab === 'university' && (
              <>
                {unconfigured && (
                  <p className="downloads-site-nudge">
                    <Trans>
                      Choose your university in <Link to={ROUTES.settings}>Settings</Link> to
                      download from Moodle.
                    </Trans>
                  </p>
                )}

                {courseLoadNotice(courses, loaded, loadFailed) === 'failed' && (
                  <p className="source-list-failed">
                    <Trans>Courses failed to load.</Trans>
                  </p>
                )}

                {panel && (
                  <div className="source-panel">
                    {panel === 'add' ? (
                      <AddCoursePanel onDone={() => setPanel(null)} />
                    ) : (
                      chosenCourse && (
                        <EditSourcePanel
                          course={chosenCourse}
                          loaded={selected === chosenCourse.name}
                          loading={pending === chosenCourse.name}
                          onLoad={(course) => {
                            setDeferred(null)
                            close()
                            loadCourse(course, true)
                          }}
                          onDone={() => setPanel(null)}
                        />
                      )
                    )}
                  </div>
                )}

                {panel === null && chosenCourse && !chosenCourse.source_url && (
                  <p className="downloads-load-note" dir="auto">
                    <Trans>No source URL yet. Use the pencil to choose one.</Trans>
                  </p>
                )}
                {panel === null && loadNote && <p className="downloads-load-note">{loadNote}</p>}

                {selected && (
                  <>
                    <div className="section-head">
                      <h2 className="section-title" dir="auto">
                        <Trans>Recordings · {selected}</Trans>
                      </h2>
                      <span className="section-count">{t`${items.length} found`}</span>
                    </div>

                    <div className="recordings-panel">
                      <button className="recordings-close" onClick={close} aria-label={t`Close`}>
                        ×
                      </button>
                      <RowEditsDispatchContext.Provider value={dispatch}>
                        <RowEditsStateContext.Provider value={edits}>
                          <RowLocksContext.Provider value={locks}>
                            {scope === 'new' ? (
                              <>
                                <ScopeControls scope={scope} onScope={chooseScope} />
                                <NewView
                                  key={loadKey}
                                  course={selected}
                                  items={items}
                                  onReconnect={reconnectHint}
                                  onShowAll={showAll}
                                />
                              </>
                            ) : (
                              <ModeToggle
                                modes={mediaModes}
                                storageKey={MEDIA_KEY}
                                className="mode-toggle--cards"
                                wrap={(cards) => (
                                  <ScopeControls
                                    scope={scope}
                                    onScope={chooseScope}
                                    cards={cards}
                                  />
                                )}
                              >
                                {(media, selectMedia) => {
                                  const sections = groupSections(items, media)
                                  return (
                                    <>
                                      <MediaNote media={media} />
                                      <PausedRunsBanner
                                        course={selected}
                                        media={media}
                                        onSelectMedia={selectMedia}
                                        onShowNew={() => chooseScope('new')}
                                      />
                                      {!sections.length ? (
                                        <div className="recordings-status">{emptyState[media]}</div>
                                      ) : (
                                        sections.map((section) => {
                                          // No run identity for the synthetic bucket: an id would collide
                                          // with a real heading spelled the same — see docs/DOWNLOADS.md.
                                          const id = section.synthetic
                                            ? null
                                            : sectionId(selected, media, section.title)
                                          // The pile is per course and media too; one colon never matches a
                                          // run id, which always has two.
                                          const key = id ?? `${selected}:${media}`
                                          return (
                                            <SectionGroup
                                              key={key}
                                              collapseKey={key}
                                              section={{ ...section, id }}
                                              items={section.items}
                                              course={selected}
                                              onReconnect={reconnectHint}
                                            />
                                          )
                                        })
                                      )}
                                    </>
                                  )
                                }}
                              </ModeToggle>
                            )}
                          </RowLocksContext.Provider>
                        </RowEditsStateContext.Provider>
                      </RowEditsDispatchContext.Provider>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </ResolvedMediaContext.Provider>
  )
}
