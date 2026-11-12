// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Tooltip from './Tooltip'

afterEach(cleanup)

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

async function hoverOpen(onAncestor: Record<string, () => void> = {}) {
  render(
    createElement(
      'div',
      onAncestor,
      createElement(Tooltip, {
        content: 'Hint text',
        children: createElement('button', null, 'Go'),
      }),
    ),
  )
  const button = screen.getByRole('button')
  await act(async () => {
    fireEvent.mouseEnter(button, { clientX: 10, clientY: 10 })
  })
  const tooltip = await screen.findByRole('tooltip', {}, { timeout: 1500 })
  return { button, tooltip }
}

describe('Tooltip hover into the hint', () => {
  it('stays open when the pointer moves from the anchor into the hint', async () => {
    const { button, tooltip } = await hoverOpen()
    await act(async () => {
      fireEvent.mouseLeave(button, { clientX: 10, clientY: 0, relatedTarget: tooltip })
      fireEvent.mouseEnter(tooltip)
      fireEvent.mouseMove(tooltip, { clientX: 10, clientY: -5 })
    })
    expect(screen.queryByRole('tooltip')).not.toBeNull()
  })

  it('stays open while a drag-select drifts out, and closes on a release outside with no selection', async () => {
    const { button, tooltip } = await hoverOpen()
    await act(async () => {
      fireEvent.mouseLeave(button, { clientX: 10, clientY: 0, relatedTarget: tooltip })
      fireEvent.mouseEnter(tooltip)
      fireEvent.pointerDown(tooltip, { button: 0 })
      fireEvent.mouseLeave(tooltip, { clientX: 500, clientY: 500, relatedTarget: document.body })
      fireEvent.mouseMove(document.body, { clientX: 500, clientY: 500 })
    })
    expect(screen.queryByRole('tooltip')).not.toBeNull()
    await act(async () => {
      fireEvent.pointerUp(document.body)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Tooltip hint isolation', () => {
  it('keeps a press or click in the hint from reaching React ancestors', async () => {
    const calls: string[] = []
    const { tooltip } = await hoverOpen({
      onClick: () => calls.push('click'),
      onPointerDown: () => calls.push('pointerdown'),
      onMouseDown: () => calls.push('mousedown'),
    })
    await act(async () => {
      fireEvent.pointerDown(tooltip, { button: 0 })
      fireEvent.mouseDown(tooltip)
      fireEvent.click(tooltip)
      fireEvent.pointerUp(tooltip)
    })
    expect(calls).toEqual([])
  })
})

describe('Tooltip drag-select end', () => {
  it('stops ignoring hover closes after a pointercancel', async () => {
    const { button, tooltip } = await hoverOpen()
    await act(async () => {
      fireEvent.mouseLeave(button, { clientX: 10, clientY: 0, relatedTarget: tooltip })
      fireEvent.mouseEnter(tooltip)
      fireEvent.pointerDown(tooltip, { button: 0 })
      fireEvent.pointerCancel(document.body)
      fireEvent.mouseLeave(tooltip, { clientX: 500, clientY: 500, relatedTarget: document.body })
      fireEvent.mouseMove(document.body, { clientX: 500, clientY: 500 })
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('ends the drag on a release inside the hint, so leaving it closes the hint', async () => {
    const { button, tooltip } = await hoverOpen()
    await act(async () => {
      fireEvent.mouseLeave(button, { clientX: 10, clientY: 0, relatedTarget: tooltip })
      fireEvent.mouseEnter(tooltip)
      fireEvent.pointerDown(tooltip, { button: 0 })
      fireEvent.pointerUp(tooltip)
      fireEvent.mouseLeave(tooltip, { clientX: 500, clientY: 500, relatedTarget: document.body })
      fireEvent.mouseMove(document.body, { clientX: 500, clientY: 500 })
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Tooltip drag-select containment', () => {
  const rootUserSelect = () => document.documentElement.style.userSelect

  for (const [how, finish] of [
    ['pointerup', () => fireEvent.pointerUp(document.body)],
    ['pointercancel', () => fireEvent.pointerCancel(document.body)],
    ['unmount', () => cleanup()],
  ] as const) {
    it(`makes the page unselectable for the drag and restores it on ${how}`, async () => {
      document.documentElement.style.userSelect = 'auto'
      const { tooltip } = await hoverOpen()
      await act(async () => {
        fireEvent.pointerDown(tooltip, { button: 0 })
      })
      expect(rootUserSelect()).toBe('none')
      await act(async () => {
        finish()
      })
      expect(rootUserSelect()).toBe('auto')
      document.documentElement.style.userSelect = ''
    })
  }

  for (const order of [
    [1, 2],
    [2, 1],
  ]) {
    it(`restores it once two touches on two hints both lift, ${order.join(' then ')}`, async () => {
      document.documentElement.style.userSelect = 'auto'
      render(
        createElement(
          'div',
          null,
          createElement(Tooltip, { content: 'A', children: createElement('button', null, 'A') }),
          createElement(Tooltip, { content: 'B', children: createElement('button', null, 'B') }),
        ),
      )
      await act(async () => {
        for (const button of screen.getAllByRole('button')) fireEvent.mouseEnter(button)
      })
      await screen.findByText('B', { selector: '.tooltip-content' }, { timeout: 1500 })
      const hints = screen.getAllByRole('tooltip')
      expect(hints).toHaveLength(2)
      await act(async () => {
        fireEvent.pointerDown(hints[0], { button: 0, pointerId: 1 })
        fireEvent.pointerDown(hints[1], { button: 0, pointerId: 2 })
        fireEvent.pointerUp(document.body, { pointerId: order[0] })
      })
      expect(rootUserSelect()).toBe('none')
      await act(async () => {
        fireEvent.pointerUp(document.body, { pointerId: order[1] })
      })
      expect(rootUserSelect()).toBe('auto')
      document.documentElement.style.userSelect = ''
    })
  }
})
