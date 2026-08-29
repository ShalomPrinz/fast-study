import { Trans } from '@lingui/react/macro'
import { Routes, Route } from 'react-router-dom'
import Layout from '@/app/Layout'
import MainView from '@/features/lectures/MainView'
import EditSummaryView from '@/features/lectures/EditSummaryView'
import CourseView from '@/features/course-overview/CourseView'
import DownloadsView from '@/features/downloads/DownloadsView'
import SearchView from '@/features/search/SearchView'
import SettingsView from '@/features/settings/SettingsView'
import Icon from '@/shared/components/Icon'
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
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<EmptyState />} />
        <Route path="course/:course" element={<CourseView />} />
        <Route path="downloads" element={<DownloadsView />} />
        <Route path="search" element={<SearchView />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path=":course/:lecture" element={<MainView />} />
        <Route path=":course/:lecture/edit" element={<EditSummaryView />} />
      </Route>
    </Routes>
  )
}
