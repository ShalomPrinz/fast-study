import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import { ResolvedMediaContext } from './contexts/ResolvedMediaContext'
import ModeToggle from '@/shared/components/ModeToggle'
import type { ModeConfig } from '@/shared/components/ModeToggle'
import type { Media } from './services/autoDownloader'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import PageHeader, { PageHeaderDot } from '@/shared/components/PageHeader'
import AccountStatus from '@/features/downloads/components/AccountStatus'
import { useAuthStatus } from '@/features/downloads/contexts/AuthStatusContext'
import { ROUTES } from '@/shared/utils/routes'
import { courseLoadNotice } from '@/shared/utils/courseLoadNotice'
import CourseSourceRow from '@/features/downloads/components/CourseSourceRow'
import AddCourseRow from '@/features/downloads/components/AddCourseRow'
import ManualDownload from '@/features/downloads/components/ManualDownload'
import SectionGroup from '@/features/downloads/components/SectionGroup'
import PausedRunsBanner from '@/features/downloads/components/PausedRunsBanner'
import DownloadsTabs from '@/features/downloads/components/DownloadsTabs'
import ExtensionGuide from '@/features/extension/ExtensionGuide'
import { useDownloadsTab } from '@/features/downloads/hooks/useDownloadsTab'
import { groupSections, sectionId } from '@/features/downloads/utils/sections'
import { RowEditsDispatchContext, RowEditsStateContext } from './contexts/RowEditsContext'
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

  const { selected, pending, items, edits, reconnectKey } = useDownloadsSession()
  const { discover, close, reconnectHint, resolveMedia, rowEdits } = useDownloadsActions()
  // The university is optional on the init wall, so a user without one lands here with nothing to sign in to.
  const unconfigured = useAuthStatus().status?.unconfigured
  const [tab, selectTab] = useDownloadsTab()

  const countOf = (media: Media) => items.filter((i) => i.media === media).length

  // Order matters: it drives the segment order and the default side (videos).
  const mediaModes: Record<Media, ModeConfig> = {
    video: { label: t`Videos`, count: countOf('video') },
    material: { label: t`Materials`, count: countOf('material') },
    unknown: { label: t`Unknown`, count: countOf('unknown') },
  }

  const emptyState: Record<Media, string> = {
    video: t`No recordings found.`,
    material: t`No materials found.`,
    unknown: t`No files of unknown type found.`,
  }

  return (
    <ResolvedMediaContext.Provider value={resolveMedia}>
      <main className="main-view main-view--page downloads-page">
        <PageHeader
          title={t`Downloads`}
          meta={
            // Every tab's meta shares one grid cell, the others hidden, so the header keeps the
            // tallest one's height and the tab row never moves on a switch.
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
            </div>
          }
          secondaryActions={<DownloadsTabs tab={tab} onSelect={selectTab} />}
        />

        {/* Keyed by tab so each one opens at its own top rather than the last tab's scroll offset. */}
        <div className="page-body" key={tab ?? 'loading'}>
          <div className="page-column">
            {tab === null && (
              <div className="downloads-tab-loading">
                <div className="spinner" />
              </div>
            )}
            {tab === 'extension' && <ExtensionGuide />}
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

                <div className="section-head">
                  <h2 className="section-title">
                    <Trans>Course sources</Trans>
                  </h2>
                </div>

                <div className="source-list">
                  {courseLoadNotice(courses, loaded, loadFailed) === 'failed' && (
                    <p className="source-list-failed">
                      <Trans>Courses failed to load.</Trans>
                    </p>
                  )}
                  {active.map((course) => (
                    <CourseSourceRow
                      key={course.name}
                      course={course}
                      onDiscover={course.source_url ? () => discover(course) : undefined}
                      selected={selected === course.name}
                      discovering={pending === course.name}
                    />
                  ))}
                  <AddCourseRow />
                </div>

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
                      <RowEditsDispatchContext.Provider value={rowEdits}>
                        <RowEditsStateContext.Provider value={edits}>
                          <ModeToggle
                            modes={mediaModes}
                            storageKey="fastStudyDownloadsMedia"
                            className="mode-toggle--light"
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
