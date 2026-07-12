import { stepsFor } from '@/features/course-overview/constants/overview'
import { useExtractor } from '@/features/course-overview/contexts/ExtractorContext'
import StepRow from './StepRow'

// per-phase breakdown for one extractor
export default function ExtractorSteps() {
  const { extractor, expanded } = useExtractor()
  if (!expanded) return null
  return (
    <div className="course-steps">
      {stepsFor(extractor.phases).map((step) => (
        <StepRow key={step.phase} step={step} />
      ))}
    </div>
  )
}
