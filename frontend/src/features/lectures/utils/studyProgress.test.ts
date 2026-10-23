import { describe, it, expect } from 'vitest'
import { trackProgress } from './studyProgress'

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
