import { describe, it, expect } from 'vitest'
import { rowAction } from './rowAction'

const row = (over: Partial<Parameters<typeof rowAction>[0]> = {}) => ({
  pending: false,
  unsupported: false,
  failed: false,
  done: false,
  ...over,
})

describe('rowAction', () => {
  it('never offers retry on an unsupported row, whose button is disabled', () => {
    expect(rowAction(row({ unsupported: true, failed: true }))).toBe('download')
  })

  it('offers retry on a failed row that is still downloadable', () => {
    expect(rowAction(row({ failed: true }))).toBe('retry')
  })

  it('shows the spinner while a request is in flight, whatever else holds', () => {
    expect(rowAction(row({ pending: true, failed: true }))).toBe('pending')
  })

  it('reads done after a finished download, and download otherwise', () => {
    expect(rowAction(row({ done: true }))).toBe('done')
    expect(rowAction(row())).toBe('download')
  })
})
