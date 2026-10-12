import { useEffect, useRef, useState } from 'react'
import { isConnectionError } from '@/services/http'
import { toastFailure } from '@/shared/utils/failure'
import { useDownloadsActions } from '../contexts/DownloadsSessionContext'
import { useWithMoodleLock } from '../contexts/MoodleLockContext'
import type { EnrolledCourses } from '../services/autoDownloader'
import { fetchEnrolledCourses, isBlockedError, isReconnectError } from '../services/autoDownloader'
import type { PickerList } from '../utils/coursePicker'
import { toastBlocked } from '../utils/downloadErrors'
import { MoodleLockAbandoned } from '../utils/moodleLock'

// The account's courses, fetched once per open while `enabled`, waiting out the Moodle lock. A failure leaves
// 'unavailable' (the paste input) after the page's usual word: reconnect hint, block toast, or the reason.
export function useEnrolledCourses(enabled: boolean): PickerList {
  const [list, setList] = useState<PickerList>('loading')
  const withMoodleLock = useWithMoodleLock()
  const { reconnectHint } = useDownloadsActions()

  // One request per mount, kept across StrictMode's remount: the site walls a second call made
  // seconds after the first (downloader/auto/docs/MOODLE.md § The course picker).
  const request = useRef<Promise<EnrolledCourses> | null>(null)
  const live = useRef(false)

  useEffect(() => {
    if (!enabled) return
    live.current = true
    let gone = false
    const pending = (request.current ??= withMoodleLock(fetchEnrolledCourses, {
      wait: true,
      stale: () => !live.current,
    }))
    pending
      .then((answer) => {
        if (!gone) setList(answer.available ? answer.courses : 'unavailable')
      })
      .catch((err) => {
        // Dropped while disabled before it was sent: the next enable sends a fresh one.
        if (err instanceof MoodleLockAbandoned) {
          if (request.current === pending) request.current = null
          return
        }
        if (gone) return
        setList('unavailable')
        if (isReconnectError(err)) reconnectHint()
        else if (isBlockedError(err)) toastBlocked(err.challengeWindow)
        else if (!isConnectionError(err)) toastFailure(err)
      })
    return () => {
      gone = true
      live.current = false
    }
  }, [enabled, withMoodleLock, reconnectHint])

  return list
}
