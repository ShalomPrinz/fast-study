// The import route's NDJSON answer: progress lines, then exactly one final line. Pure — the one
// fetch lives in `services/database.ts`.
import { RequestError } from '@/services/http'
import type { ErrorParams } from '@/shared/i18n/serviceErrors'

export type ImportLine =
  | { type: 'progress'; copied: number; total: number }
  | { type: 'done'; originalKept: boolean }
  | { type: 'error'; message: string; code: string | null; params: ErrorParams | null }

// One parsed line as an event; null for a line that is none of the three shapes.
export function interpretImportLine(line: unknown): ImportLine | null {
  if (typeof line !== 'object' || line === null) return null
  const o = line as Record<string, unknown>
  if (o.done === true) return { type: 'done', originalKept: o.originalKept === true }
  const err = o.error
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>
    const params = e.params && typeof e.params === 'object' ? (e.params as ErrorParams) : null
    return {
      type: 'error',
      message: typeof e.message === 'string' ? e.message : '',
      code: typeof e.code === 'string' ? e.code : null,
      params,
    }
  }
  if (typeof o.copied === 'number' && typeof o.total === 'number') {
    return { type: 'progress', copied: o.copied, total: o.total }
  }
  return null
}

// Calls `onLine` with each non-blank line as it completes, including an unterminated last one.
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onLine(line)
    if (done) break
  }
  if (buffer.trim()) onLine(buffer)
}

// Reads the stream to its final line: resolves on `done`, throws the coded error of an `error` line,
// and throws codeless when the stream ends with neither.
export async function readImportResult(
  body: ReadableStream<Uint8Array>,
  onProgress: (copied: number, total: number) => void,
): Promise<{ originalKept: boolean }> {
  let result: ImportLine | null = null
  await readNdjson(body, (raw) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const line = interpretImportLine(parsed)
    if (!line) return
    if (line.type === 'progress') onProgress(line.copied, line.total)
    else result = line
  })
  const final = result as ImportLine | null
  if (final?.type === 'done') return { originalKept: final.originalKept }
  if (final?.type === 'error') throw new RequestError(final.message, final.code, final.params)
  throw new RequestError('The import ended without an answer.')
}
