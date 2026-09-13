import { Trans } from '@lingui/react/macro'
import { useLingui } from '@lingui/react'
import { Routes, Route } from 'react-router-dom'
import Layout from '@/app/Layout'
import InitGate from '@/app/InitGate'
import { SettingsProvider } from '@/shared/contexts/SettingsContext'
import MainView from '@/features/lectures/MainView'
import EditSummaryView from '@/features/lectures/EditSummaryView'
import CourseView from '@/features/course-overview/CourseView'
import DownloadsView from '@/features/downloads/DownloadsView'
import SearchView from '@/features/search/SearchView'
import RunnerView from '@/features/runner/RunnerView'
import SettingsView from '@/features/settings/SettingsView'
import Icon from '@/shared/components/Icon'
import { ToastContainer } from '@/services/toaster'
import { isRtl } from '@/services/i18n'
import '@/styles/panel.css'

function EmptyState() {
  return (
    <main className="main-view main-view--empty">
      <div className="empty-state">
        <span className="empty-state-icon">
          <Icon icon="lecture" />
        </span>
        <p className="empty-state-title">
          <Trans>Select a lecture to get started</Trans>
        </p>
      </div>
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
            <Route index element={<EmptyState />} />
            <Route path="course/:course" element={<CourseView />} />
            <Route path="downloads" element={<DownloadsView />} />
            <Route path="search" element={<SearchView />} />
            <Route path="running" element={<RunnerView />} />
            <Route path="settings" element={<SettingsView />} />
            <Route path=":course/:lecture" element={<MainView />} />
            <Route path=":course/:lecture/edit" element={<EditSummaryView />} />
          </Route>
        </Routes>
      </InitGate>
    </SettingsProvider>
  )
}
