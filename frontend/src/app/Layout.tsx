import { useLingui } from '@lingui/react'
import { Outlet } from 'react-router-dom'
import { RunnerStatusProvider } from '@/shared/contexts/RunnerStatusContext'
import { CourseTreeProvider } from '@/shared/contexts/CourseTreeContext'
import { DownloadJobsProvider } from '@/features/downloads/contexts/DownloadJobsContext'
import { DownloadsSessionProvider } from '@/features/downloads/contexts/DownloadsSessionContext'
import { SectionRunsProvider } from '@/features/downloads/contexts/SectionRunsContext'
import { ToastContainer, toast } from '@/services/toaster'
import { isRtl } from '@/services/i18n'
import Sidebar from '@/shared/sidebar'
import AutoRunOnBoot from './AutoRunOnBoot'
import './Layout.css'

export default function Layout() {
  const rtl = isRtl(useLingui().i18n.locale)
  return (
    <CourseTreeProvider>
      <RunnerStatusProvider sendUpdate={toast}>
        <AutoRunOnBoot />
        <DownloadJobsProvider>
          <DownloadsSessionProvider sendUpdate={toast}>
            <SectionRunsProvider>
              <div className="layout">
                <Sidebar />
                <Outlet />
                <ToastContainer
                  position={rtl ? 'top-left' : 'top-right'}
                  rtl={rtl}
                  autoClose={3000}
                  closeOnClick
                />
              </div>
            </SectionRunsProvider>
          </DownloadsSessionProvider>
        </DownloadJobsProvider>
      </RunnerStatusProvider>
    </CourseTreeProvider>
  )
}
