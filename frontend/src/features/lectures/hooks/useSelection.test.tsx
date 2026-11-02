import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useNavigationType } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useSelection } from '@/features/lectures/hooks/useSelection'

function setup() {
  return renderHook(() => ({ sel: useSelection(), type: useNavigationType() }), {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  })
}

describe('useSelection.onSelect', () => {
  it('pushes by default', () => {
    const { result } = setup()
    act(() => result.current.sel.onSelect('C', 'L', 'lecture'))
    expect(result.current.type).toBe('PUSH')
  })

  it('replaces the entry when asked, for a URL a rename invalidated', () => {
    const { result } = setup()
    act(() => result.current.sel.onSelect('C', 'L', 'lecture', { replace: true }))
    expect(result.current.type).toBe('REPLACE')
  })
})
