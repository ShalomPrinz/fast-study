import { Trans } from '@lingui/react/macro'
import { Routes, Route } from 'react-router-dom'
import Layout from '@/app/Layout'
import MainView from '@/features/lectures/MainView'
import EditSummaryView from '@/features/lectures/EditSummaryView'
import CourseView from '@/features/course-overview/CourseView'
import DownloadsView from '@/features/downloads/DownloadsView'
import SearchView from '@/features/search/SearchView'
import '@/styles/panel.css'

function EmptyState() {
  return (
    <main className="main-view main-view--empty">
      <p className="empty-state">
        <Trans>Select a lecture to get started</Trans>
      </p>
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
        <Route path=":course/:lecture" element={<MainView />} />
        <Route path=":course/:lecture/edit" element={<EditSummaryView />} />
      </Route>
    </Routes>
  )
}
