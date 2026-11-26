import { describe, it, expect } from 'vitest'
import { interpretImportLine, readImportResult, readNdjson } from './videoImportStream'

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk))
      c.close()
    },
  })
}

describe('interpretImportLine', () => {
  it('tells progress, done and error lines apart, and ignores anything else', () => {
    expect(interpretImportLine({ copied: 5, total: 10 })).toEqual({
      type: 'progress',
      copied: 5,
      total: 10,
    })
    expect(interpretImportLine({ done: true, originalKept: true })).toEqual({
      type: 'done',
      originalKept: true,
    })
    expect(interpretImportLine({ done: true })).toEqual({ type: 'done', originalKept: false })
    expect(
      interpretImportLine({
        error: { code: 'video_import_failed', params: { file: 'v' }, message: 'm' },
      }),
    ).toEqual({ type: 'error', code: 'video_import_failed', params: { file: 'v' }, message: 'm' })
    expect(interpretImportLine({ hello: 1 })).toBeNull()
    expect(interpretImportLine(null)).toBeNull()
  })
})

describe('readNdjson', () => {
  it('joins lines split across chunks and keeps an unterminated last line', async () => {
    const lines: string[] = []
    await readNdjson(streamOf('{"a":1}\n{"b"', ':2}\n\n{"c":3}'), (l) => lines.push(l))
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })
})

describe('readImportResult', () => {
  it('reports each progress line then resolves on done', async () => {
    const seen: number[][] = []
    const result = await readImportResult(
      streamOf(
        '{"copied":1,"total":4}\n{"copied":4,"total":4}\n{"done":true,"originalKept":false}\n',
      ),
      (c, t) => seen.push([c, t]),
    )
    expect(seen).toEqual([
      [1, 4],
      [4, 4],
    ])
    expect(result).toEqual({ originalKept: false })
  })

  it('throws the coded error of an error line', async () => {
    await expect(
      readImportResult(
        streamOf(
          '{"error":{"code":"import_source_stranded","params":{"kept":"t"},"message":"m"}}\n',
        ),
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'import_source_stranded', params: { kept: 't' } })
  })

  it('throws codeless when the stream ends without a final line', async () => {
    await expect(
      readImportResult(streamOf('{"copied":1,"total":2}\n'), () => {}),
    ).rejects.toMatchObject({
      code: null,
    })
  })
})
