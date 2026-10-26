import { Trans } from '@lingui/react/macro'
import { useLingui } from '@lingui/react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/app/Layout'
import InitGate from '@/app/InitGate'
import { SettingsProvider } from '@/shared/contexts/SettingsContext'
import AssignmentView from '@/features/lectures/AssignmentView'
import MainView from '@/features/lectures/MainView'
import EditAssignmentDocView from '@/features/lectures/EditAssignmentDocView'
import LecturesLayout from '@/features/lectures/LecturesLayout'
import EditSummaryView from '@/features/lectures/EditSummaryView'
import CourseView from '@/features/course-overview/CourseView'
import DownloadsView from '@/features/downloads/DownloadsView'
import SearchView from '@/features/search/SearchView'
import RunnerView from '@/features/runner/RunnerView'
import SettingsView from '@/features/settings/SettingsView'
import EmptyCard from '@/shared/components/EmptyCard'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { courseLoadNotice } from '@/shared/utils/courseLoadNotice'
import { ToastContainer } from '@/services/toaster'
import { isRtl } from '@/services/i18n'
import { ROUTES } from '@/shared/utils/routes'
import '@/styles/panel.css'

// The lectures home: a lecture to pick, or — with no active course — how to add one or why none loaded.
function EmptyState() {
  const { courses, loaded, loadFailed } = useCourseTreeContext()
  const notice = courseLoadNotice(courses, loaded, loadFailed)
  return (
    <main
      className={
        notice ? `main-view main-view--empty main-view--${notice}` : 'main-view main-view--empty'
      }
    >
      <EmptyCard icon="lecture" error={notice === 'failed'}>
        {notice === 'no-courses' ? (
          <Trans>Add a course from Downloads or New course to get started</Trans>
        ) : notice === 'failed' ? (
          <Trans>Courses failed to load.</Trans>
        ) : (
          <Trans>Select a lecture to get started</Trans>
        )}
      </EmptyCard>
    </main>
  )
}

export default function App() {
  const rtl = isRtl(useLingui().i18n.locale)
  return (
    <SettingsProvider>
      {/* Above the gate, not inside `Layout`: the first-run wall and the boot settings fetch both
          render before any route does, and a toast with no mounted container is queued, not shown. */}
      <ToastContainer
        position={rtl ? 'top-left' : 'top-right'}
        rtl={rtl}
        autoClose={3000}
        closeOnClick
      />
      <InitGate>
        <Routes>
          <Route element={<Layout />}>
            {/* The tree pane's pages; the editor sits outside so it gets the full width. */}
            <Route element={<LecturesLayout />}>
              <Route index element={<EmptyState />} />
              <Route path={ROUTES.overview} element={<CourseView />} />
              <Route path={ROUTES.assignment} element={<AssignmentView />} />
              <Route path={ROUTES.lecture} element={<MainView />} />
            </Route>
            <Route path={ROUTES.downloads} element={<DownloadsView />} />
            <Route path={ROUTES.search} element={<SearchView />} />
            <Route path={ROUTES.running} element={<RunnerView />} />
            <Route path={ROUTES.settings} element={<SettingsView />} />
            <Route path={ROUTES.editor} element={<EditSummaryView />} />
            <Route path={ROUTES.assignmentEditor} element={<EditAssignmentDocView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </InitGate>
    </SettingsProvider>
  )
}
