import { describe, it, expect } from 'vitest'
import { sortLectures } from './lectureSort'

const names = (...ns: string[]) => ns.map((name) => ({ name }))
const sorted = (...ns: string[]) => sortLectures(names(...ns)).map((x) => x.name)

describe('sortLectures', () => {
  it('orders numbers numerically, not as text', () => {
    expect(sorted('Lecture 10', 'Lecture 2')).toEqual(['Lecture 2', 'Lecture 10'])
  })

  it('orders sub-numbers numerically', () => {
    expect(sorted('Lecture 1.10', 'Lecture 1.2')).toEqual(['Lecture 1.2', 'Lecture 1.10'])
  })

  it('puts a whole number before its sub-numbers', () => {
    expect(sorted('Lecture 3.1', 'Lecture 3')).toEqual(['Lecture 3', 'Lecture 3.1'])
  })

  it('ignores case', () => {
    expect(sorted('lecture 10', 'LECTURE 2')).toEqual(['LECTURE 2', 'lecture 10'])
  })

  it('puts unparsed names first, in locale order', () => {
    expect(sorted('Lecture 1', 'Zeta', 'Intro')).toEqual(['Intro', 'Zeta', 'Lecture 1'])
  })

  it('leaves the input untouched', () => {
    const input = names('Lecture 2', 'Lecture 1')
    sortLectures(input)
    expect(input.map((x) => x.name)).toEqual(['Lecture 2', 'Lecture 1'])
  })
})
