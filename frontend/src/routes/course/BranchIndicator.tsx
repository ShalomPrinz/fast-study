import type { BranchStatus } from '@/constants/overview'

// Pure status glyph for one extractor's final PDF.
export default function BranchIndicator({ status }: { status: BranchStatus }) {
  if (status.running) return <span className="spinner spinner--sm" />
  if (status.error) return <span className="course-stage-error" title={status.error}>⚠</span>
  if (status.done) return <span className="file-check">✓</span>
  return <span className="course-stage-dot" />
}
