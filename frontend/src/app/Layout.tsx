import { Outlet } from 'react-router-dom'
import { RunnerStatusProvider } from '@/shared/contexts/RunnerStatusContext'
import { CourseTreeProvider } from '@/shared/contexts/CourseTreeContext'
import { DownloadJobsProvider } from '@/features/downloads/contexts/DownloadJobsContext'
import { DownloadsSessionProvider } from '@/features/downloads/contexts/DownloadsSessionContext'
import { SectionRunsProvider } from '@/features/downloads/contexts/SectionRunsContext'
import { ToastContainer, toast } from '@/services/toaster'
import Sidebar from '@/shared/sidebar'

export default function Layout() {
  return (
    <CourseTreeProvider>
      <RunnerStatusProvider sendUpdate={toast}>
        <DownloadJobsProvider>
          <DownloadsSessionProvider sendUpdate={toast}>
            <SectionRunsProvider>
              <div className="layout">
                <Sidebar />
                <Outlet />
                <ToastContainer position="top-right" autoClose={3000} closeOnClick />
              </div>
            </SectionRunsProvider>
          </DownloadsSessionProvider>
        </DownloadJobsProvider>
      </RunnerStatusProvider>
    </CourseTreeProvider>
  )
}
