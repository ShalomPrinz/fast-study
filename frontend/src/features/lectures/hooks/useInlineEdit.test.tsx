// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act, render } from '@testing-library/react'
import { useInlineEdit } from './useInlineEdit'

function Harness({ open, other }: { open: boolean; other: boolean }) {
  const edit = useInlineEdit(open || null, { yieldFocus: true })
  return (
    <>
      {other && <input data-testid="other" defaultValue="typed" />}
      {open && <input data-testid="mine" ref={edit.ref} />}
    </>
  )
}

describe('useInlineEdit yieldFocus', () => {
  it('takes focus when nothing else is being edited', () => {
    const { getByTestId, rerender } = render(<Harness open={false} other={false} />)
    rerender(<Harness open other={false} />)
    expect(document.activeElement).toBe(getByTestId('mine'))
  })

  it('leaves focus and text with another focused input', () => {
    const { getByTestId, rerender } = render(<Harness open={false} other />)
    const other = getByTestId('other') as HTMLInputElement
    act(() => other.focus())
    rerender(<Harness open other />)
    expect(getByTestId('mine')).toBeTruthy()
    expect(document.activeElement).toBe(other)
    expect(other.value).toBe('typed')
  })
})
