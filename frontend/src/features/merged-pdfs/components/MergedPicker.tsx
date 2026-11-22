import { Trans, useLingui } from '@lingui/react/macro'
import type { MergedPart } from '@/types'
import Tooltip from '@/shared/components/Tooltip'
import { checkboxDisabled, mergeable, partKey, type PickItem } from '../utils/mergedSelection'
import '@/styles/button.css'
import '@/styles/chip.css'
import './MergedPicker.css'

interface Props {
  lectures: PickItem[]
  recitations: PickItem[]
  order: MergedPart[]
  onToggle: (part: MergedPart, on: boolean) => void
  onSelectAll: (parts: MergedPart[]) => void
  // A lectures-only course has one list, so one "select all" with no group heading.
  single: boolean
}

function Group({
  title,
  selectAll,
  items,
  order,
  onToggle,
  onSelectAll,
}: {
  title: string | null
  selectAll: string
  items: PickItem[]
  order: MergedPart[]
  onToggle: Props['onToggle']
  onSelectAll: Props['onSelectAll']
}) {
  const { t } = useLingui()
  const ticked = new Set(order.map(partKey))
  const pickable = mergeable(items)
  const allTicked = pickable.every((p) => ticked.has(partKey(p)))
  return (
    <div className="merged-group">
      <div className="merged-group-head">
        {title && <h3 className="merged-group-title">{title}</h3>}
        <button
          type="button"
          className="btn btn--ghost merged-select-all"
          disabled={allTicked}
          onClick={() => onSelectAll(pickable)}
        >
          {selectAll}
        </button>
      </div>
      <ul className="merged-pick-list">
        {items.map(({ part, state }) => {
          const missing = state === 'missing'
          const isTicked = ticked.has(partKey(part))
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
                  <span className="merged-pick-name" dir="auto">
                    {part.name}
                  </span>
                  {state === 'outdated' && (
                    <Tooltip content={t`The PDF is older than the latest summary text.`}>
                      <span className="chip chip--warn merged-pick-outdated">
                        <Trans>Outdated PDF</Trans>
                      </span>
                    </Tooltip>
                  )}
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
  lectures,
  recitations,
  order,
  onToggle,
  onSelectAll,
  single,
}: Props) {
  const { t } = useLingui()
  const empty = lectures.length === 0 && recitations.length === 0
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
            title={single ? null : t`Lectures`}
            selectAll={single ? t`Select all` : t`Select all lectures`}
            items={lectures}
            order={order}
            onToggle={onToggle}
            onSelectAll={onSelectAll}
          />
        )}
        {recitations.length > 0 && (
          <Group
            title={t`Recitations`}
            selectAll={t`Select all recitations`}
            items={recitations}
            order={order}
            onToggle={onToggle}
            onSelectAll={onSelectAll}
          />
        )}
      </div>
    </section>
  )
}
