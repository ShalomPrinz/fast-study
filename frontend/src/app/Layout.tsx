import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { SnapshotProvider } from '@/shared/contexts/SnapshotProvider'
import { DownloadJobsProvider } from '@/features/downloads/contexts/DownloadJobsContext'
import { AuthStatusProvider } from '@/features/downloads/contexts/AuthStatusContext'
import { DownloadsSessionProvider } from '@/features/downloads/contexts/DownloadsSessionContext'
import { SectionRunsProvider } from '@/features/downloads/contexts/SectionRunsContext'
import { toast } from '@/services/toaster'
import CaptchaBanner from '@/features/downloads/components/CaptchaBanner'
import { toastCaptchaSolved } from '@/features/downloads/utils/zoomCaptcha'
import { toastSiteCaptchaSolved } from '@/features/downloads/utils/captchaBanner'
import Sidebar from '@/shared/sidebar'
import DriveConsentPrompt from './DriveConsentPrompt'
import { warnBrokenTools } from './toolWarnings'
import { loadSupportedMaterials } from './supportedMaterials'
import { SupportedMaterialsProvider } from '@/shared/contexts/SupportedMaterialsContext'
import type { SupportedExtensions } from '@/features/lectures/utils/materials'
import { useGeneralFolderPicker } from '@/features/downloads/hooks/useGeneralFolderPicker'
import { TourProvider } from '@/shared/contexts/TourContext'
import Tour from '@/features/tour/Tour'
import './Layout.css'

export default function Layout() {
  // Here, not above the gate: the warning is about features the app shell offers, not the first-run wall.
  useEffect(() => {
    void warnBrokenTools()
  }, [])
  const [supported, setSupported] = useState<SupportedExtensions>(null)
  useEffect(() => {
    void loadSupportedMaterials().then(setSupported)
  }, [])
  useGeneralFolderPicker()
  return (
    <TourProvider>
      <SupportedMaterialsProvider supported={supported}>
        <SnapshotProvider sendUpdate={toast}>
          <DownloadJobsProvider>
            <AuthStatusProvider onSiteCaptchaSolved={toastSiteCaptchaSolved}>
              <DownloadsSessionProvider sendUpdate={toast}>
                <SectionRunsProvider onCaptchaSolved={() => toastCaptchaSolved(true)}>
                  <div className="layout">
                    <Sidebar />
                    {/* The banner spans the content column only, never the sidebar; the route keeps the row
                      flex its pages were built for. */}
                    <div className="layout-content">
                      <CaptchaBanner />
                      <div className="layout-route">
                        <Outlet />
                      </div>
                    </div>
                    {/* Route-independent by design: the run that needs consent is not the screen the
                      user is on. */}
                    <DriveConsentPrompt />
                    <Tour />
                  </div>
                </SectionRunsProvider>
              </DownloadsSessionProvider>
            </AuthStatusProvider>
          </DownloadJobsProvider>
        </SnapshotProvider>
      </SupportedMaterialsProvider>
    </TourProvider>
  )
}
