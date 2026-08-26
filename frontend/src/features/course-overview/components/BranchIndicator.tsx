import type { BranchStatus } from '@/features/course-overview/constants/overview'
import StatusNode from '@/shared/components/StatusNode'

// Status glyph for one extractor's final PDF.
export default function BranchIndicator({ status }: { status: BranchStatus }) {
  if (status.running) return <StatusNode state="running" />
  if (status.error) return <StatusNode state="failed" title={status.error} />
  if (status.done) return <StatusNode state="done" />
  return <StatusNode state="pending" />
}
