import { Trans, useLingui } from '@lingui/react/macro'
import type { MergedPart } from '@/types'
import Tooltip from '@/shared/components/Tooltip'
import {
  checkboxDisabled,
  mergeable,
  partKey,
  sectionTick,
  type PickItem,
} from '../utils/mergedSelection'
import { useCourseHeadings } from '../hooks/useCourseHeadings'
import OutdatedChip from './OutdatedChip'
import '@/features/downloads/components/GroupHeader.css'
import '@/styles/button.css'
import '@/styles/chip.css'
import './MergedPicker.css'

interface Props {
  course: string
  groups: { lectures: PickItem[]; recitations: PickItem[] }
  order: MergedPart[]
  onToggle: (part: MergedPart, on: boolean) => void
  onToggleSection: (items: PickItem[]) => void
  // A lectures-only course has one list, so one section checkbox with no group heading.
  single: boolean
}

function Group({
  course,
  kind,
  title,
  items,
  order,
  headings,
  onToggle,
  onToggleSection,
}: {
  course: string
  kind: MergedPart['kind']
  title: string
  items: PickItem[]
  order: MergedPart[]
  headings: Record<string, string>
  onToggle: Props['onToggle']
  onToggleSection: Props['onToggleSection']
}) {
  const { t } = useLingui()
  const ticked = new Set(order.map(partKey))
  const tick = sectionTick(items, order)
  const noPdf = mergeable(items).length === 0
  return (
    <div className="merged-group">
      {/* The header reuses the downloads group header's hover; the label's ::after stretches the click over the whole line. */}
      <div className="group-header merged-group-head">
        <h3 className="merged-group-heading">
          <Tooltip content={noPdf ? t`No summary in this section has a PDF yet` : undefined}>
            <label className="merged-section-label">
              <input
                type="checkbox"
                className="merged-section-toggle"
                data-kind={kind}
                disabled={noPdf}
                checked={tick === 'all'}
                ref={(el) => {
                  if (el) el.indeterminate = tick === 'some'
                }}
                onChange={() => onToggleSection(items)}
              />
              <span className="group-header-title merged-group-title">{title}</span>
            </label>
          </Tooltip>
        </h3>
      </div>
      <ul className="merged-pick-list">
        {items.map(({ part, state }) => {
          const missing = state === 'missing'
          const isTicked = ticked.has(partKey(part))
          const heading = headings[partKey(part)]
          return (
            <li key={partKey(part)}>
              <Tooltip content={missing ? t`No summary PDF yet` : undefined}>
                <label
                  className={`merged-pick${missing ? ' merged-pick--missing' : ''}`}
                  data-part={partKey(part)}
                >
                  <input
                    type="checkbox"
                    disabled={checkboxDisabled(state, isTicked)}
                    checked={isTicked}
                    onChange={(e) => onToggle(part, e.target.checked)}
                  />
                  <span className="merged-pick-text">
                    <span className="merged-pick-name" dir="auto">
                      {part.name}
                    </span>
                    {heading && (
                      <Tooltip content={heading}>
                        <span className="merged-pick-heading" dir="auto">
                          {heading}
                        </span>
                      </Tooltip>
                    )}
                  </span>
                  {state === 'outdated' && <OutdatedChip course={course} part={part} />}
                </label>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Every lecture and recitation of the course with a checkbox, in the sidebar's order.
export default function MergedPicker({
  course,
  groups,
  order,
  onToggle,
  onToggleSection,
  single,
}: Props) {
  const { t } = useLingui()
  const headings = useCourseHeadings(course)
  const { lectures, recitations } = groups
  const empty = lectures.length === 0 && recitations.length === 0
  const shared = { course, order, headings, onToggle, onToggleSection }
  return (
    <section className="merged-col merged-col--select" aria-labelledby="merged-select-title">
      <h2 className="merged-col-title" id="merged-select-title">
        <Trans>Summaries</Trans>
      </h2>
      <div className="merged-col-body">
        {empty && (
          <p className="merged-hint">
            <Trans>This course has no lectures yet.</Trans>
          </p>
        )}
        {lectures.length > 0 && (
          <Group
            {...shared}
            kind="lecture"
            title={single ? t`Select all` : t`Lectures`}
            items={lectures}
          />
        )}
        {recitations.length > 0 && (
          <Group {...shared} kind="recitation" title={t`Recitations`} items={recitations} />
        )}
      </div>
    </section>
  )
}
