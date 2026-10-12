import { useCallback, useState } from 'react'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import { useWithMoodleLock } from '../contexts/MoodleLockContext'
import { checkCourseUrl } from '../services/autoDownloader'
import { checkFailure } from '../utils/coursePicker'

// One pasted course URL's check before it is saved. `check` answers whether to save; a refusal of any
// kind — a busy lock included, since the user pressed it — is kept as `failure` for "Save anyway".
export function useCourseUrlCheck() {
  const withMoodleLock = useWithMoodleLock()
  const [checking, setChecking] = useState(false)
  const [failure, setFailure] = useState<ServiceFailure | null>(null)

  const check = useCallback(
    async (url: string): Promise<boolean> => {
      setChecking(true)
      setFailure(null)
      try {
        await withMoodleLock(() => checkCourseUrl(url))
        return true
      } catch (err) {
        setFailure(checkFailure(err))
        return false
      } finally {
        setChecking(false)
      }
    },
    [withMoodleLock],
  )

  const clear = useCallback(() => setFailure(null), [])

  return { checking, failure, check, clear }
}
