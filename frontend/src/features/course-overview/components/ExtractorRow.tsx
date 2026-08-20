import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { OverviewExtractor } from '@/types'
import { toastInitResult } from '@/services/toaster'
import { generatedFiles, branchStatus } from '@/features/course-overview/constants/overview'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { ExtractorContext } from '@/features/course-overview/contexts/ExtractorContext'
import type { ExtractorValue } from '@/features/course-overview/contexts/ExtractorContext'
import ExtractorHeader from './ExtractorHeader'
import ExtractorSteps from './ExtractorSteps'
import '@/styles/modal.css'
import '@/styles/file-row.css'

export default function ExtractorRow({ extractor }: { extractor: OverviewExtractor }) {
  const { t } = useLingui()
  const { files, status, generate } = useCourseOverview()
  const { slug, phases } = extractor
  const [expanded, setExpanded] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)

  const bs = branchStatus(status, files, slug, phases)

  // No skipExisting: an explicit re-generate overwrites.
  async function regenerate() {
    setRegenerateOpen(false)
    const result = await generate([slug])
    toastInitResult(result, {
      busy: t`Overview is already running for this course`,
      error: t`Overview failed to start`,
    })
  }

  const value: ExtractorValue = {
    extractor,
    expanded,
    toggleExpanded: () => setExpanded((v) => !v),
    confirmRegenerate: () => setRegenerateOpen(true),
  }

  return (
    <ExtractorContext.Provider value={value}>
      <div className={`file-row course-branch${bs.done ? ' file-row--present' : ''}`}>
        <ExtractorHeader />
        <ExtractorSteps />
      </div>

      {regenerateOpen && (
        <ConfirmModal
          message={t`The following files will be re-generated:`}
          detail={
            <ul className="modal-file-list">
              {generatedFiles(slug, phases).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={regenerate}
          onCancel={() => setRegenerateOpen(false)}
        />
      )}
    </ExtractorContext.Provider>
  )
}
