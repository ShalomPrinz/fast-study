import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useAnyJobActive } from '@/features/downloads/contexts/DownloadJobsContext'
import { useAnyRunActive } from '@/features/downloads/contexts/SectionRunsContext'
import { runtimeBridge } from '@/services/runtime'
import {
  canRestartServices,
  dismissServiceDown,
  restartNeedsConfirm,
  serviceDownShown,
  subscribeServiceDown,
} from '@/services/serviceHealth'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import ConfirmModal from '@/shared/components/ConfirmModal'
import '@/styles/button.css'
import './ServiceBanner.css'

// Sticky strip atop the content column while a service is down; the user keeps working and may
// dismiss it. Packaged, Restart reboots every service and reloads the window.
export default function ServiceBanner() {
  const { t } = useLingui()
  const shown = useSyncExternalStore(subscribeServiceDown, serviceDownShown)
  const { status } = useRunnerStatus()
  const jobsActive = useAnyJobActive()
  const runsActive = useAnyRunActive()
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Publishes the live height on :root so the toast container (outside Layout) sits below it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const observer = new ResizeObserver(() =>
      root.style.setProperty('--service-banner-h', `${el.offsetHeight}px`),
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--service-banner-h')
    }
  }, [shown])
  if (!shown) return null

  const pipeline =
    !!status &&
    (status.inFlight.length > 0 || status.overviewRunning.length > 0 || status.runner.running)
  function restart() {
    setConfirming(false)
    runtimeBridge()?.services?.restart()
  }
  function onRestart() {
    if (restartNeedsConfirm({ pipeline, downloadJobs: jobsActive, sectionRuns: runsActive }))
      setConfirming(true)
    else restart()
  }

  const canRestart = canRestartServices()
  return (
    <div ref={ref} className="service-banner" role="alert">
      <span className="service-banner-dot" aria-hidden="true" />
      <span className="service-banner-text">
        {canRestart ? (
          <Trans>Part of FastStudy isn't responding.</Trans>
        ) : (
          <Trans>Part of FastStudy isn't responding. Restart the services.</Trans>
        )}
      </span>
      {canRestart && (
        <button
          type="button"
          className="btn btn--primary service-banner-restart"
          onClick={onRestart}
        >
          <Trans>Restart</Trans>
        </button>
      )}
      <button type="button" className="btn btn--ghost" onClick={dismissServiceDown}>
        <Trans>Dismiss</Trans>
      </button>
      {confirming && (
        <ConfirmModal
          message={t`Restart FastStudy's services?`}
          warning={t`Work in progress will be stopped.`}
          confirmLabel={t`Restart`}
          cancelLabel={t`Cancel`}
          onConfirm={restart}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
