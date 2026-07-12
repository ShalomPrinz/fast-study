import { stepsFor } from '@/constants/overview'
import { useExtractor } from '@/routes/course/ExtractorContext'
import StepRow from '@/routes/course/StepRow'

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
