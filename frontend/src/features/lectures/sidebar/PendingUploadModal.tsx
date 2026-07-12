import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Kind } from '@/types'
import { uploadVideo } from '@/services/database'
import { toastPromise } from '@/services/toaster'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import ConfirmModal from '@/shared/components/ConfirmModal'

interface PendingUpload {
  course: string
  lecture: string
  file: File
  kind: Kind
}

interface PendingUploadValue {
  // Upload immediately (empty slot).
  trigger: (course: string, lecture: string, file: File, kind: Kind) => Promise<void>
  // Open the replace-confirmation modal first (slot already has a video.mp4).
  confirm: (course: string, lecture: string, file: File, kind: Kind) => void
}

const PendingUploadContext = createContext<PendingUploadValue | null>(null)

// Provider owns the pending-replace state and renders its own confirmation modal, so
// consumers never juggle a returned modal node — they just call trigger/confirm.
export function PendingUploadProvider({ children }: { children: ReactNode }) {
  const { refreshCourses } = useCourseTreeContext()
  const [pending, setPending] = useState<PendingUpload | null>(null)

  async function trigger(course: string, lecture: string, file: File, kind: Kind) {
    await toastPromise(uploadVideo(course, lecture, file, kind), {
      pending: 'Uploading video…',
      success: `Saved to ${lecture}`,
      error: 'Upload failed',
    })
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
          message={`Replace existing video.mp4 in "${pending.lecture}"?`}
          warning="Note: This will delete all files in this lecture."
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
