import { Outlet } from 'react-router-dom'
import { RunnerStatusProvider } from '@/shared/contexts/RunnerStatusContext'
import { CourseTreeProvider } from '@/shared/contexts/CourseTreeContext'
import { ToastContainer, toast } from '@/services/toaster'
import Sidebar from '@/shared/sidebar'

export default function Layout() {
  return (
    <CourseTreeProvider>
      <RunnerStatusProvider sendUpdate={toast}>
        <div className="layout">
          <Sidebar />
          <Outlet />
          <ToastContainer position="top-right" autoClose={3000} closeOnClick />
        </div>
      </RunnerStatusProvider>
    </CourseTreeProvider>
  )
}
