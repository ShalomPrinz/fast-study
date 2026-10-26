// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Tooltip from './Tooltip'

function disabledButton(content: string | undefined) {
  return createElement(Tooltip, {
    content,
    children: createElement('button', { disabled: true }, 'Generate'),
  })
}

describe('Tooltip on a disabled control', () => {
  it('opens from a hover over the disabled button', async () => {
    render(disabledButton('Generate the summary first'))
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.mouseEnter(button)
      fireEvent.mouseMove(button)
    })
    expect((await screen.findByRole('tooltip', {}, { timeout: 1500 })).textContent).toBe(
      'Generate the summary first',
    )
  })

  it('adds no wrapper around the button', () => {
    const { container } = render(disabledButton('Generate the summary first'))
    expect(container.firstElementChild?.tagName).toBe('BUTTON')
  })
})
