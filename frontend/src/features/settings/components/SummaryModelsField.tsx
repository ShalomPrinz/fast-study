import { useEffect, useRef } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import Tooltip from '@/shared/components/Tooltip'
import type { GeminiModel } from '@/services/settings'
import { moveModel, removeModel } from '../utils/geminiOrder'
import '@/styles/button.css'
import '@/styles/settings-form.css'
import './SummaryModelsField.css'

interface Props {
  // Every curated model; the ones not in `order` are offered under "Not used".
  models: GeminiModel[]
  // The models in use, top first: row 1 starts the summary, the rest take over when it is busy.
  order: string[]
  onChange: (order: string[]) => void
}

// A small badge matching the row's number, so a place name points at the row it waits on.
const Ref = ({ n }: { n: number }) => (
  <span className="summary-model-badge summary-model-badge--ref">{n}</span>
)

function Place({ index }: { index: number }) {
  if (index === 0) return <Trans>Starts with this</Trans>
  if (index === 1)
    return (
      <Trans>
        If <Ref n={1} /> is busy
      </Trans>
    )
  return (
    <Trans>
      If <Ref n={index} /> is busy too
    </Trans>
  )
}

type Dir = 'up' | 'down'

// The ordered summary-models list: arrows reorder, ✕ takes one out (disabled on the last), "Not used" adds.
export default function SummaryModelsField({ models, order, onChange }: Props) {
  const { t } = useLingui()
  // The arrow to refocus once the moved row has rendered at its new place.
  const refocus = useRef<{ id: string; dir: Dir } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const want = refocus.current
    refocus.current = null
    if (!want) return
    const row = root.current?.querySelector(`[data-model-id="${CSS.escape(want.id)}"]`)
    const arrow = (d: Dir) => row?.querySelector<HTMLButtonElement>(`.summary-model-${d}`)
    const other = want.dir === 'up' ? 'down' : 'up'
    const target = arrow(want.dir)?.disabled === false ? arrow(want.dir) : arrow(other)
    target?.focus()
  }, [order])

  const name = (id: string) => models.find((m) => m.id === id)?.name ?? id
  const unused = models.filter((m) => !order.includes(m.id))

  function move(index: number, dir: Dir) {
    refocus.current = { id: order[index], dir }
    onChange(moveModel(order, index, dir === 'up' ? -1 : 1))
  }

  function remove(id: string) {
    const next = removeModel(order, id)
    if (next) onChange(next)
  }

  return (
    <div className="settings-field summary-models" id="summary-models" ref={root}>
      <div className="settings-label">
        <span id="summary-models-label">
          <Trans>Summary models</Trans>
        </span>
      </div>
      <span className="settings-hint">
        <Trans>
          It starts with the top model. If that one is busy, it moves on to the next. The arrows
          change the order.
        </Trans>
      </span>
      <ol className="summary-models-list" aria-labelledby="summary-models-label">
        {order.map((id, i) => (
          <li key={id} className="summary-model-row" data-model-id={id}>
            <span className="summary-model-badge">{i + 1}</span>
            <span className="summary-model-text">
              <span className="summary-model-name">{name(id)}</span>
              <span className="summary-model-place">
                <Place index={i} />
              </span>
            </span>
            <button
              type="button"
              className="btn summary-model-btn summary-model-up"
              aria-label={t`Move up`}
              disabled={i === 0}
              onClick={() => move(i, 'up')}
            >
              ▲
            </button>
            <button
              type="button"
              className="btn summary-model-btn summary-model-down"
              aria-label={t`Move down`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 'down')}
            >
              ▼
            </button>
            <Tooltip content={order.length <= 1 ? t`Keep at least one model.` : null}>
              <button
                type="button"
                className="btn summary-model-btn summary-model-remove"
                aria-label={t`Take out of the list`}
                disabled={order.length <= 1}
                onClick={() => remove(id)}
              >
                ✕
              </button>
            </Tooltip>
          </li>
        ))}
      </ol>
      {unused.length > 0 && (
        <>
          <span className="summary-models-caption">
            <Trans>Not used — tap to add</Trans>
          </span>
          {unused.map((m) => (
            <button
              key={m.id}
              type="button"
              className="summary-model-add"
              data-model-id={m.id}
              onClick={() => onChange([...order, m.id])}
            >
              <span className="summary-model-badge summary-model-badge--add">+</span>
              <span className="summary-model-name">{m.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
