// @vitest-environment jsdom
import { createElement, useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import CourseCombobox from './CourseCombobox'

const COURSES = ['Algebra', 'Calculus', 'Physics']

// A controlled host, as ManualDownload is: the typed text feeds straight back as the value.
function open(initial = 'Calculus') {
  const onChange = vi.fn()
  function Host() {
    const [value, setValue] = useState(initial)
    return createElement(CourseCombobox, {
      id: 'c',
      value,
      options: COURSES,
      onChange: (v: string) => {
        onChange(v)
        setValue(v)
      },
    })
  }
  render(createElement(Host))
  const input = screen.getByRole('combobox') as HTMLInputElement
  fireEvent.focus(input)
  return { input, onChange }
}

const shown = () => screen.queryAllByRole('option').map((o) => o.textContent)

afterEach(cleanup)

describe('CourseCombobox', () => {
  it('lists every course for an unedited prefilled value, highlighting it', () => {
    open('Calculus')
    expect(shown()).toEqual(COURSES)
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('Calculus')
  })

  it('filters once the text is edited, and lists all again on the next focus', () => {
    const { input } = open('')
    fireEvent.change(input, { target: { value: 'ca' } })
    expect(shown()).toEqual(['Calculus'])
    fireEvent.blur(input)
    expect(shown()).toEqual([])
    fireEvent.focus(input)
    expect(shown()).toEqual(COURSES)
  })

  it('moves with the arrows, wrapping, and picks with Enter', () => {
    const { input, onChange } = open('Calculus')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('Algebra')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('Physics')
    expect(shown()).toEqual([])
  })

  it('closes on Escape and reopens on ArrowDown without picking', () => {
    const { input, onChange } = open('Calculus')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(shown()).toEqual([])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(shown()).toEqual(COURSES)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('sets the course on an option click', () => {
    const { input, onChange } = open('')
    fireEvent.click(screen.getByRole('option', { name: 'Physics' }))
    expect(onChange).toHaveBeenLastCalledWith('Physics')
    expect(input.value).toBe('Physics')
    expect(shown()).toEqual([])
  })

  it('reports a pick through onPick, never typed text, and tells of a blur', () => {
    const onPick = vi.fn()
    const onBlur = vi.fn()
    render(
      createElement(CourseCombobox, {
        id: 'p',
        value: '',
        options: COURSES,
        onChange: vi.fn(),
        onPick,
        onBlur,
      }),
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ph' } })
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: 'Physics' }))
    expect(onPick).toHaveBeenCalledWith('Physics')
    fireEvent.blur(input)
    expect(onBlur).toHaveBeenCalled()
  })
})
