import { describe, expect, it } from 'vitest'
import { stallLatched, stallWho } from './stallNote'

describe('stallWho', () => {
  it('names Lemida for a Moodle job on the BIU preset', () => {
    expect(stallWho('moodle', 'https://lemida.biu.ac.il')).toBe('lemida')
    expect(stallWho('moodle', 'https://lemida.biu.ac.il/')).toBe('lemida')
  })
  it('names the university for any other saved site or none', () => {
    expect(stallWho('moodle', 'https://moodle.huji.ac.il/2026-27')).toBe('university')
    expect(stallWho('moodle', 'https://x.example.edu')).toBe('university')
    expect(stallWho('moodle', null)).toBe('university')
  })
  it('names the server for a non-Moodle source whatever the site', () => {
    expect(stallWho('other', 'https://lemida.biu.ac.il')).toBe('server')
  })
})

describe('stallLatched', () => {
  const run = (id: string, stalled: boolean, status = 'running') =>
    stallLatched({ id, status, stalled })
  it('keeps the note once stalled, even when bytes flow again', () => {
    expect(run('l1', false)).toBe(false)
    expect(run('l1', true)).toBe(true)
    expect(run('l1', false)).toBe(true)
  })
  it('starts a restarted job (new id) without the note', () => {
    run('l2', true)
    expect(run('l2b', false)).toBe(false)
  })
  it('hides the note on a terminal status and does not bring it back', () => {
    run('l3', true)
    expect(run('l3', true, 'done')).toBe(false)
    expect(run('l3', false)).toBe(false)
  })
})
