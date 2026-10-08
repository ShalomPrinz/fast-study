import { toast } from '@/services/toaster'
import { fetchBackendTools } from '@/services/backend'
import { fetchDownloadServerTools } from '@/features/downloads/services/downloadServer'
import { fetchAutoDownloaderTools } from '@/features/downloads/services/autoDownloader'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import type { ToolReport } from '@/types'

// One failure per broken tool across every report, so a yt-dlp both downloader services probe warns
// once; the first report naming it broken wins. A null report is a service that did not answer.
export function brokenTools(reports: Array<ToolReport | null>): ServiceFailure[] {
  const broken = new Map<string, ServiceFailure>()
  for (const report of reports) {
    for (const [tool, status] of Object.entries(report ?? {})) {
      if (status === 'ok' || broken.has(tool)) continue
      broken.set(tool, {
        message: `${tool}: ${status.state}`,
        code: status.code,
        params: status.params,
      })
    }
  }
  return [...broken.values()]
}

let checked = false

// Once per page load — a module flag, so a StrictMode double mount or a remount cannot re-announce.
// A service that is down is skipped here; its client already toasted the connection failure.
export async function warnBrokenTools(): Promise<void> {
  if (checked) return
  checked = true
  const settled = await Promise.allSettled([
    fetchBackendTools(),
    fetchDownloadServerTools(),
    fetchAutoDownloaderTools(),
  ])
  const reports = settled.map((r) => (r.status === 'fulfilled' ? r.value : null))
  for (const failure of brokenTools(reports)) toast('warning', serviceErrorNode(failure))
}
