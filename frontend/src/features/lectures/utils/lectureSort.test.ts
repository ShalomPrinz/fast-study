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

  it('puts unparsed names first, in locale order', () => {
    expect(sorted('Lecture 1', 'Zeta', 'Intro')).toEqual(['Intro', 'Zeta', 'Lecture 1'])
  })

  it('orders any prefix numerically, not only Lecture', () => {
    expect(sorted('שיעור 10', 'שיעור 2', 'שיעור 1', 'שיעור 11')).toEqual([
      'שיעור 1',
      'שיעור 2',
      'שיעור 10',
      'שיעור 11',
    ])
  })

  it('orders Hebrew sub-numbers before the next number', () => {
    expect(sorted('הרצאה 2', 'הרצאה 1.2', 'הרצאה 1.1')).toEqual([
      'הרצאה 1.1',
      'הרצאה 1.2',
      'הרצאה 2',
    ])
  })

  it('orders mixed prefixes by number alone', () => {
    expect(sorted('Lecture 10', 'הרצאה 2', 'Lecture 1')).toEqual([
      'Lecture 1',
      'הרצאה 2',
      'Lecture 10',
    ])
  })

  it('keeps a trailing suffix unparsed, at the head', () => {
    expect(sorted('שיעור 2', 'שיעור 10 - המשך', 'שיעור 1')).toEqual([
      'שיעור 10 - המשך',
      'שיעור 1',
      'שיעור 2',
    ])
  })

  it('sorts a numbered name of any prefix by its number, not at the head', () => {
    expect(sorted('סיכום 2024', 'Lecture 4', 'Intro 3', 'Lecture 2')).toEqual([
      'Lecture 2',
      'Intro 3',
      'Lecture 4',
      'סיכום 2024',
    ])
  })

  it('breaks a tie on number and sub-number by locale order', () => {
    expect(sorted('Lecture 3', 'Intro 3')).toEqual(['Intro 3', 'Lecture 3'])
    expect(sorted('הרצאה 1.2', 'Lecture 1.2')).toEqual(['Lecture 1.2', 'הרצאה 1.2'])
  })

  it('orders Hebrew recitation names numerically', () => {
    expect(sorted('תרגול 10', 'תרגול 2', 'תרגול 1')).toEqual(['תרגול 1', 'תרגול 2', 'תרגול 10'])
  })

  it('leaves the input untouched', () => {
    const input = names('Lecture 2', 'Lecture 1')
    sortLectures(input)
    expect(input.map((x) => x.name)).toEqual(['Lecture 2', 'Lecture 1'])
  })
})
