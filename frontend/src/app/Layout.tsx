import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { SnapshotProvider } from '@/shared/contexts/SnapshotProvider'
import { DownloadJobsProvider } from '@/features/downloads/contexts/DownloadJobsContext'
import { AuthStatusProvider } from '@/features/downloads/contexts/AuthStatusContext'
import { DownloadsSessionProvider } from '@/features/downloads/contexts/DownloadsSessionContext'
import { SectionRunsProvider } from '@/features/downloads/contexts/SectionRunsContext'
import { toast } from '@/services/toaster'
import Sidebar from '@/shared/sidebar'
import DriveConsentPrompt from './DriveConsentPrompt'
import { warnBrokenTools } from './toolWarnings'
import './Layout.css'

export default function Layout() {
  // Here, not above the gate: the warning is about features the app shell offers, not the first-run wall.
  useEffect(() => {
    void warnBrokenTools()
  }, [])
  return (
    <SnapshotProvider sendUpdate={toast}>
      <DownloadJobsProvider>
        <AuthStatusProvider>
          <DownloadsSessionProvider sendUpdate={toast}>
            <SectionRunsProvider>
              <div className="layout">
                <Sidebar />
                <Outlet />
                {/* Route-independent by design: the run that needs consent is not the screen the
                      user is on. */}
                <DriveConsentPrompt />
              </div>
            </SectionRunsProvider>
          </DownloadsSessionProvider>
        </AuthStatusProvider>
      </DownloadJobsProvider>
    </SnapshotProvider>
  )
}
