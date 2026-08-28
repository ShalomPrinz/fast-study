import { stepsFor, generatedFiles } from '@/features/course-overview/constants/overview'
import { useExtractor } from '@/features/course-overview/contexts/ExtractorContext'
import StepRow from './StepRow'
import '@/styles/chip.css'
import './ExtractorSteps.css'

// The branch's phase run, revealed under its row: every phase in order, then the files they write.
export default function ExtractorSteps() {
  const { extractor, expanded } = useExtractor()
  const { slug, phases } = extractor
  if (!expanded) return null

  return (
    <div className="overview-phases">
      <div className="overview-phase-run">
        {stepsFor(phases).map((step) => (
          <StepRow key={step.phase} step={step} />
        ))}
      </div>
      <div className="overview-file-chips">
        {generatedFiles(slug, phases).map((f) => (
          <span key={f} className="chip overview-file-chip">
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}
