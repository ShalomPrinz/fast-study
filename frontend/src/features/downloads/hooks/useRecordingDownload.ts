import { useRef, useState } from 'react'
import type { Kind } from '@/types'
import type { Item, PasscodeError } from '@/features/downloads/services/autoDownloader'
import {
  isPasscodeError,
  isReconnectError,
  isUnsupportedError,
  saveZoomPasscode,
} from '@/features/downloads/services/autoDownloader'
import { downloadItem } from '@/features/downloads/services/downloadServer'
import type { JobProgress } from '@/features/downloads/contexts/DownloadJobsContext'
import type { PasscodePromptProps } from '@/features/downloads/components/PasscodePrompt'
import { toastDownloadError } from '@/features/downloads/utils/downloadErrors'
import { applyRenames } from '@/features/downloads/utils/renames'
import { useResolveMedia } from '@/features/downloads/contexts/ResolvedMediaContext'
import { useRowEditsDispatch } from '@/features/downloads/contexts/RowEditsContext'

type Result = 'fail' | null

// Owns just the download effect: the action (whole-row download + per-clip retry) and its own
// pending/retrying/queue-failure/passcode state. Display and the overwrite confirm live in the row.
// Called unconditionally, so the row's expandable branch can early-return past the download surface.
// `name` is the row's effective (resolved) name.
export function useRecordingDownload({
  item,
  course,
  name: effectiveName,
  kind,
  onReconnect,
}: {
  item: Item
  course: string
  name: string
  kind: Kind
  onReconnect: () => void
}) {
  // What this download proves the file to be — one of the two moments an 'unknown' row learns its
  // type (the bulk queue is the other), reported upward so the answer outlives this row.
  const resolveMedia = useResolveMedia()
  // The server's canonical spelling replaces the row's name, so the row compares against disk.
  const { setName } = useRowEditsDispatch()
  const [pending, setPending] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [result, setResult] = useState<Result>(null)

  // Opened on a 409 passcode gate. Never co-renders with the overwrite confirm, which is
  // already dismissed by the time download() can hit the 409.
  const [passcodePrompt, setPasscodePrompt] = useState(false)
  const [savingPasscode, setSavingPasscode] = useState(false)
  const [passcodeReason, setPasscodeReason] = useState<PasscodeError['reason']>('missing')
  // The intent that hit the passcode gate, resumed once the passcode is saved: the whole-row download
  // or a single job's retry. `name` is what the passcode is saved for and what a failure toasts.
  const passcodeResume = useRef<{ name: string; run: () => Promise<void> } | null>(null)

  // Shared trigger for the row download and per-job retry: funnels the reconnect/passcode gates the
  // same way. Success is the jobs' to report (the snapshot ping drives the row into flight); only a
  // failure to queue — which throws — is the trigger's to surface. `resume` re-runs this intent
  // post-passcode.
  async function runIntent(
    args: { ref: string; course: string; name: string; kind: Kind; only?: boolean },
    name: string,
    resume: () => Promise<void>,
  ) {
    try {
      const { media, renames } = await downloadItem(args)
      resolveMedia(args.ref, media)
      applyRenames(renames, [args], setName)
    } catch (err) {
      // Reconnect and passcode steer the UI elsewhere, so only the fallthrough toasts.
      if (isReconnectError(err)) onReconnect()
      else if (isPasscodeError(err)) {
        passcodeResume.current = { name, run: resume }
        setPasscodeReason(err.reason)
        setPasscodePrompt(true)
      } else {
        // A 422 is the probe's verdict on this file, so it resolves the row as surely as a success.
        if (isUnsupportedError(err)) resolveMedia(args.ref, 'unsupported')
        setResult('fail')
        toastDownloadError(name, err)
      }
    }
  }

  async function download() {
    setPending(true)
    setResult(null)
    await runIntent({ ref: item.ref, course, name: effectiveName, kind }, effectiveName, download)
    setPending(false)
  }

  // Replay one job's download (a single clip) via `only`, leaving its siblings untouched.
  async function retryClip(job: JobProgress) {
    setRetryingId(job.id)
    setResult(null)
    await runIntent(
      { ref: job.ref, course: job.course, name: job.title, kind: job.kind, only: true },
      job.title,
      () => retryClip(job),
    )
    setRetryingId(null)
  }

  // Save the passcode, then resume whatever intent hit the gate (row download or a per-job retry).
  // Closing the modal and starting the resume batch into one render, so no spinner flashes off.
  async function submitPasscode(passcode: string, scope: 'course' | 'lecture') {
    if (!passcode) return
    const resume = passcodeResume.current
    const name = resume?.name ?? effectiveName
    setSavingPasscode(true)
    try {
      await saveZoomPasscode({ course, name, passcode, scope })
    } catch (err) {
      setResult('fail')
      toastDownloadError(name, err)
      setSavingPasscode(false)
      setPasscodePrompt(false)
      passcodeResume.current = null
      return
    }
    setSavingPasscode(false)
    setPasscodePrompt(false)
    passcodeResume.current = null
    await (resume?.run ?? download)()
  }

  function cancelPasscode() {
    setPasscodePrompt(false)
    passcodeResume.current = null
    setResult('fail')
  }

  // Shaped for <PasscodePrompt>; null when the gate is closed.
  const passcode: PasscodePromptProps | null = passcodePrompt
    ? {
        reason: passcodeReason,
        busy: savingPasscode,
        onSubmit: submitPasscode,
        onCancel: cancelPasscode,
      }
    : null

  return {
    download,
    retryClip,
    pending,
    retryingId,
    failed: result === 'fail',
    passcode,
  }
}
