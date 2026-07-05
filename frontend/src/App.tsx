import { Routes, Route } from 'react-router-dom'
import Layout from './routes/Layout'
import MainView from './routes/MainView'
import EditSummaryView from './routes/EditSummaryView'
import CourseView from './routes/CourseView'

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
        <Route path=":course/:lecture" element={<MainView />} />
        <Route path=":course/:lecture/edit" element={<EditSummaryView />} />
      </Route>
    </Routes>
  )
}
