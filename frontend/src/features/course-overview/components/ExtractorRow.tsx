import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { OverviewExtractor } from '@/types'
import { toastInitResult } from '@/services/toaster'
import { generatedFiles } from '@/features/course-overview/constants/overview'
import ConfirmModal from '@/shared/components/ConfirmModal'
import { useCourseOverview } from '@/features/course-overview/contexts/CourseOverviewContext'
import { ExtractorContext } from '@/features/course-overview/contexts/ExtractorContext'
import type { ExtractorValue } from '@/features/course-overview/contexts/ExtractorContext'
import ExtractorHeader from './ExtractorHeader'
import ExtractorSteps from './ExtractorSteps'
import '@/styles/modal.css'
import '@/styles/pipeline-card.css'
import './ExtractorRow.css'

export default function ExtractorRow({ extractor }: { extractor: OverviewExtractor }) {
  const { t } = useLingui()
  const { generate } = useCourseOverview()
  const { slug, phases } = extractor
  const [expanded, setExpanded] = useState(false)
  const [regenerateOpen, setRegenerateOpen] = useState(false)

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
      {/* Wraps the row and its phase run as one branch, so the card's divider falls between
          branches rather than between a row and the panel it opened. */}
      <div className="overview-branch">
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
