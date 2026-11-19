// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import SummaryModelsField from './SummaryModelsField'

i18n.load('en', {})
i18n.activate('en')

const MODELS = [
  { id: 'a', name: 'Model A' },
  { id: 'b', name: 'Model B' },
  { id: 'c', name: 'Model C' },
]

function Harness({ start, spy }: { start: string[]; spy?: (o: string[]) => void }) {
  const [order, setOrder] = useState(start)
  return (
    <I18nProvider i18n={i18n}>
      <SummaryModelsField
        models={MODELS}
        order={order}
        onChange={(o) => {
          spy?.(o)
          setOrder(o)
        }}
      />
    </I18nProvider>
  )
}

const rows = () =>
  [...document.querySelectorAll<HTMLElement>('.summary-model-row')].map((r) => r.dataset.modelId)
const row = (id: string) =>
  document.querySelector<HTMLElement>(`.summary-model-row[data-model-id="${id}"]`)!

describe('SummaryModelsField', () => {
  it('moves a row down and keeps focus on its down arrow while it can still move', () => {
    render(<Harness start={['a', 'b', 'c']} />)
    const down = row('a').querySelector<HTMLButtonElement>('.summary-model-down')!
    down.focus()
    fireEvent.click(down)
    expect(rows()).toEqual(['b', 'a', 'c'])
    expect(document.activeElement).toBe(row('a').querySelector('.summary-model-down'))
    fireEvent.click(document.activeElement!)
    expect(rows()).toEqual(['b', 'c', 'a'])
    // Last row: down is disabled now, so focus moves to up.
    expect(document.activeElement).toBe(row('a').querySelector('.summary-model-up'))
  })

  it('disables up on the top row and down on the last', () => {
    render(<Harness start={['a', 'b']} />)
    expect(row('a').querySelector<HTMLButtonElement>('.summary-model-up')!.disabled).toBe(true)
    expect(row('b').querySelector<HTMLButtonElement>('.summary-model-down')!.disabled).toBe(true)
  })

  it('removes a row into "Not used" and adds it back at the end', () => {
    render(<Harness start={['a', 'b', 'c']} />)
    fireEvent.click(row('a').querySelector('.summary-model-remove')!)
    expect(rows()).toEqual(['b', 'c'])
    fireEvent.click(document.querySelector('.summary-model-add[data-model-id="a"]')!)
    expect(rows()).toEqual(['b', 'c', 'a'])
    expect(document.querySelector('.summary-model-add')).toBeNull()
  })

  it('refuses to remove the last row and says so until the list changes', () => {
    const spy = vi.fn()
    render(<Harness start={['a']} spy={spy} />)
    fireEvent.click(row('a').querySelector('.summary-model-remove')!)
    expect(spy).not.toHaveBeenCalled()
    expect(rows()).toEqual(['a'])
    expect(document.querySelector('.summary-models-error')).not.toBeNull()
    fireEvent.click(document.querySelector('.summary-model-add[data-model-id="b"]')!)
    expect(document.querySelector('.summary-models-error')).toBeNull()
  })
})
