import { useLingui } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'
import type { Course } from '@/types'
import { canOpenWith, openMergedPdf, openMergedPdfWith } from '@/services/open'
import { formatDateTime } from '@/shared/utils/format'
import { mergedNewRoute } from '@/shared/utils/url'
import { useTimingStats } from '@/shared/hooks/useTimingStats'
import ProgressBar from '@/shared/components/ProgressBar'
import ServiceError from '@/shared/components/ServiceError'
import StatusNode, { type StatusNodeState } from '@/shared/components/StatusNode'
import OpenWithMenu from '@/features/lectures/components/OpenWithMenu'
import type { MergedPrefill } from '../types'
import { mergeInputBytes, type MergedRow } from '../utils/mergedRows'
import './MergedRow.css'

const NODE: Record<MergedRow['run']['state'], StatusNodeState> = {
  idle: 'done',
  waiting: 'pending',
  running: 'running',
  failed: 'failed',
}

// One history row: title, when it was made, its parts in merge order, and what a run on it is doing.
// A first creation has no stored entry, so it shows the file name and its run alone.
export default function MergedRowView({
  course,
  row,
  courseNode,
}: {
  course: string
  row: MergedRow
  courseNode: Course | undefined
}) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { item, run } = row
  const stats = useTimingStats(
    run.state === 'running' ? 'merge_pdf' : null,
    mergeInputBytes(item, courseNode),
  )

  function recreate() {
    if (!item) return
    const prefill: MergedPrefill = {
      title: item.title,
      parts: item.parts.map(({ name, kind }) => ({ name, kind })),
    }
    navigate(mergedNewRoute(course), { state: prefill })
  }

  return (
    <div className={`pipeline-row merged-row merged-row--${run.state}`}>
      <StatusNode state={NODE[run.state]} />
      <div className="pipeline-row-body">
        <div className="merged-row-title" dir="auto">
          {item?.title ?? row.name}
        </div>
        {item && (
          <>
            <div className="merged-row-date">{formatDateTime(Date.parse(item.createdAt))}</div>
            <ol className="merged-parts">
              {item.parts.map((part, i) => (
                <li key={`${i}|${part.kind}|${part.name}`} className="merged-part">
                  <bdi>{part.name}</bdi>
                  {!part.exists && <span className="chip chip--danger">{t`missing`}</span>}
                </li>
              ))}
            </ol>
          </>
        )}
        {run.state === 'waiting' && (
          <p className="merged-row-note">{t`Waiting for another merge to finish`}</p>
        )}
        {run.state === 'running' && (
          <ProgressBar stats={stats} startedAt={Date.parse(run.startedAt) || Date.now()} />
        )}
        {run.state === 'failed' && (
          <p className="merged-row-error">
            <ServiceError failure={run.error} />
          </p>
        )}
      </div>
      {item?.stale && <span className="chip chip--warn">{t`Newer version available`}</span>}
      {item && (
        <div className="merged-row-actions">
          <button className="btn btn--ghost" onClick={() => void openMergedPdf(course, item.name)}>
            {t`Open`}
          </button>
          {canOpenWith() && (
            <OpenWithMenu onOpenWith={() => void openMergedPdfWith(course, item.name)} />
          )}
          <button className="btn btn--ghost" onClick={recreate}>
            {t`Re-create`}
          </button>
        </div>
      )}
    </div>
  )
}
