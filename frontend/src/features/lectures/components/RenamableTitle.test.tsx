import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RenamableTitle from '@/features/lectures/components/RenamableTitle'

const commit = vi.fn()
const cancel = vi.fn()

vi.mock('@/features/lectures/hooks/useLectureRename', () => ({
  useLectureRename: () => ({
    renaming: true,
    edit: { ref: { current: null }, value: 'New', setValue: vi.fn() },
    locked: false,
    pendingName: null,
    actions: { start: vi.fn(), cancel, commit },
  }),
}))

describe('RenamableTitle approve button', () => {
  it('commits on click and keeps input focus on mousedown so blur-cancel cannot fire first', () => {
    render(<RenamableTitle course="c" lecture="l" kind="lecture" />)
    const btn = screen.getByRole('button', { name: /approve/i })
    // fireEvent returns false when the default (the focus move that blurs the input) was prevented.
    expect(fireEvent.mouseDown(btn)).toBe(false)
    fireEvent.click(btn)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })
})
