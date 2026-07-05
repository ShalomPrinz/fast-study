import { Outlet } from 'react-router-dom'
import { RunnerStatusProvider } from '@/contexts/RunnerStatusContext'
import { CourseTreeProvider } from '@/contexts/CourseTreeContext'
import { ToastContainer, toast } from '@/services/toaster'
import Sidebar from '@/components/sidebar'

export default function Layout() {
  return (
    <CourseTreeProvider>
      <RunnerStatusProvider sendUpdate={toast}>
        <div className="layout">
          <Sidebar />
          <Outlet />
          <ToastContainer position="top-right" autoClose={3000} />
        </div>
      </RunnerStatusProvider>
    </CourseTreeProvider>
  )
}
