import { Routes, Route } from 'react-router-dom'
import Layout from '@/app/Layout'
import MainView from '@/features/lectures/MainView'
import EditSummaryView from '@/features/lectures/EditSummaryView'
import CourseView from '@/features/course-overview/CourseView'
import DownloadsView from '@/features/downloads/DownloadsView'

function EmptyState() {
  return (
    <main className="main-view main-view--empty">
      <p className="empty-state">Select a lecture to get started</p>
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
        <Route path=":course/:lecture" element={<MainView />} />
        <Route path=":course/:lecture/edit" element={<EditSummaryView />} />
      </Route>
    </Routes>
  )
}
