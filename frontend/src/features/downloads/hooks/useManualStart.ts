import { downloadUrl } from '@/features/downloads/services/downloadServer'
import type { UrlDownload } from '@/features/downloads/services/downloadServer'
import {
  useMoodleLockState,
  useWithMoodleLock,
} from '@/features/downloads/contexts/MoodleLockContext'
import { rowLocked } from '@/features/downloads/utils/moodleLock'
import { onMoodleSite, parseTarget } from '@/features/downloads/utils/manualDownload'
import { useSettingsContext } from '@/shared/contexts/SettingsContext'

// The manual form's two Moodle-lock decisions, shared by Download and Retry: a link on the configured
// Moodle site is a Moodle button (disabled while locked, sent through the lock); any other link is not.
export function useManualStart() {
  const site = useSettingsContext().settings?.moodleSite ?? null
  const lock = useMoodleLockState()
  const withMoodleLock = useWithMoodleLock()

  // Posts one manual download; the stored spelling comes back in `target`, the typed one otherwise.
  // A raced 429 rethrows a MoodleBusyError, which `toastDownloadError` swallows.
  async function start(request: UrlDownload) {
    const send = () => downloadUrl(request)
    const { jobId, target } = await (onMoodleSite(request.url, site)
      ? withMoodleLock(send)
      : send())
    return {
      jobId,
      target: parseTarget(target) ?? { course: request.course, lecture: request.lecture },
    }
  }

  return {
    locked: (url: string) => rowLocked(onMoodleSite(url, site), lock),
    start,
  }
}
