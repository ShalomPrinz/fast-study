import { useState } from 'react'
import type { Kind } from '../../types'
import { uploadVideo } from '../../services/database'
import { toastPromise } from '../../services/toaster'
import ConfirmModal from '../ConfirmModal'

interface PendingUpload {
  course: string
  lecture: string
  file: File
  kind: Kind
}

interface Options {
  onUploaded: (course: string) => void
}

export function usePendingUpload({ onUploaded }: Options) {
  const [pending, setPending] = useState<PendingUpload | null>(null)

  async function trigger(course: string, lecture: string, file: File, kind: Kind) {
    await toastPromise(uploadVideo(course, lecture, file, kind), {
      pending: 'Uploading video…',
      success: `Saved to ${lecture}`,
      error: 'Upload failed',
    })
    onUploaded(course)
  }

  function confirm(course: string, lecture: string, file: File, kind: Kind) {
    setPending({ course, lecture, file, kind })
  }

  const modal = pending && (
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
  )

  return { confirm, trigger, modal }
}
