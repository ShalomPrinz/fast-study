import { createContext, useContext, useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { Kind } from '@/types'
import { uploadVideo } from '@/services/database'
import { toast, toastPending } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import { useRunnerStatus } from '@/shared/contexts/RunnerStatusContext'
import { isLectureRenameLocked } from '@/features/lectures/utils/renameLock'
import ConfirmModal from '@/shared/components/ConfirmModal'

interface PendingUpload {
  course: string
  lecture: string
  file: File
  kind: Kind
}

interface PendingUploadValue {
  // Upload immediately (empty slot). Never rejects: a failure or a refusal is toasted here.
  trigger: (course: string, lecture: string, file: File, kind: Kind) => Promise<void>
  // Open the replace-confirmation modal first (slot already has a video.mp4).
  confirm: (course: string, lecture: string, file: File, kind: Kind) => void
}

const PendingUploadContext = createContext<PendingUploadValue | null>(null)

// Renders its own confirm modal, so consumers just call trigger/confirm.
export function PendingUploadProvider({ children }: { children: ReactNode }) {
  const { t } = useLingui()
  const { refreshCourses } = useCourseTreeContext()
  const { status } = useRunnerStatus()
  const [pending, setPending] = useState<PendingUpload | null>(null)

  async function trigger(course: string, lecture: string, file: File, kind: Kind) {
    // The upload wipes the lecture's derived files under a run that keeps writing the old video's,
    // so a run that started since the drop (or while the confirm was open) refuses it here.
    if (isLectureRenameLocked(status, course, lecture, kind)) {
      toast('error', t`Can't replace the video while it's being processed or waiting in line`)
      return
    }
    const progress = toastPending(t`Uploading video…`)
    try {
      await uploadVideo(course, lecture, file, kind)
    } catch (e) {
      progress.dismiss()
      toastFailure(e)
      return
    }
    progress.succeed(t`Saved to ${lecture}`)
    refreshCourses()
  }

  function confirm(course: string, lecture: string, file: File, kind: Kind) {
    setPending({ course, lecture, file, kind })
  }

  return (
    <PendingUploadContext.Provider value={{ trigger, confirm }}>
      {children}
      {pending && (
        <ConfirmModal
          message={t`Replace the existing video in "${pending.lecture}"?`}
          warning={t`Note: This deletes the lecture's audio, transcript, summary and PDF. Materials are kept.`}
          onConfirm={() => {
            const { course, lecture, file, kind } = pending
            setPending(null)
            trigger(course, lecture, file, kind)
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </PendingUploadContext.Provider>
  )
}

export function usePendingUpload() {
  const ctx = useContext(PendingUploadContext)
  if (!ctx) throw new Error('usePendingUpload must be used within PendingUploadProvider')
  return ctx
}
