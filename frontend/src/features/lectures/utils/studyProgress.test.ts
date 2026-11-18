import { describe, it, expect } from 'vitest'
import {
  timelineClass,
  timelineCurrentIndex,
  timelineSegments,
  trackProgress,
} from './studyProgress'

const item = (name: string, done: boolean) => ({ name, done })

describe('trackProgress', () => {
  it('makes the first not-done item current', () => {
    const p = trackProgress([
      item('Lecture 1', true),
      item('Lecture 2', false),
      item('Lecture 3', false),
    ])
    expect(p).toEqual({ current: item('Lecture 2', false), done: 1, total: 3 })
  })

  it('keeps an earlier gap current even when later items are done', () => {
    const p = trackProgress([
      item('Lecture 1', true),
      item('Lecture 2', false),
      item('Lecture 3', true),
    ])
    expect(p).toEqual({ current: item('Lecture 2', false), done: 2, total: 3 })
  })

  it('has no current once every item is done', () => {
    const p = trackProgress([item('Lecture 1', true), item('Lecture 2', true)])
    expect(p).toEqual({ current: null, done: 2, total: 2 })
  })

  it('has no current and 0/0 for an empty track', () => {
    expect(trackProgress([])).toEqual({ current: null, done: 0, total: 0 })
  })
})

describe('timeline', () => {
  it('points at the first not-done item, or the last when all are done', () => {
    expect(timelineCurrentIndex([item('a', true), item('b', false), item('c', true)])).toBe(1)
    expect(timelineCurrentIndex([item('a', true), item('b', true)])).toBe(1)
    expect(timelineCurrentIndex([])).toBe(-1)
  })

  it('greens the line down to the current row and no further', () => {
    expect(timelineSegments(0, 4, 2)).toEqual({ top: 'none', bottom: 'done' })
    expect(timelineSegments(2, 4, 2)).toEqual({ top: 'done', bottom: 'todo' })
    expect(timelineSegments(3, 4, 2)).toEqual({ top: 'todo', bottom: 'none' })
  })

  it('has no segment past a lone row, and names the classes', () => {
    expect(timelineSegments(0, 1, 0)).toEqual({ top: 'none', bottom: 'none' })
    expect(timelineClass(1, 3, 1)).toBe('tl tl-top-done tl-bottom-todo')
  })
})
