import { describe, it, expect } from 'vitest'
import { brokenTools } from './toolWarnings'

const missing = (tool: string) => ({ code: 'tool_missing', state: 'missing', params: { tool } })

describe('brokenTools', () => {
  it('reports nothing when every tool is ok', () => {
    expect(
      brokenTools([
        { ffmpeg: 'ok', pandoc: 'ok' },
        { 'yt-dlp': 'ok', curl: 'ok' },
      ]),
    ).toEqual([])
  })

  it('reports a tool broken in two services once, from the first report', () => {
    const exited = {
      code: 'tool_exited',
      state: 'exited 1',
      params: { tool: 'yt-dlp', exit_code: 1 },
    }
    const result = brokenTools([
      { ffmpeg: 'ok' },
      { 'yt-dlp': exited },
      { 'yt-dlp': missing('yt-dlp') },
    ])
    expect(result).toEqual([
      { message: 'yt-dlp: exited 1', code: 'tool_exited', params: exited.params },
    ])
  })

  it('reports a tool broken in one service even when another finds it ok', () => {
    expect(
      brokenTools([{ 'yt-dlp': 'ok' }, { 'yt-dlp': missing('yt-dlp') }]).map((f) => f.code),
    ).toEqual(['tool_missing'])
  })

  it('skips a service that did not answer', () => {
    expect(brokenTools([null, { pandoc: missing('pandoc') }, null])).toHaveLength(1)
  })
})
