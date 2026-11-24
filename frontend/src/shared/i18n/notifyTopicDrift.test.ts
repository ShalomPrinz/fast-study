/**
 * The notify-topic drift guard: every topic literal at a notify call site in the repo must be in the
 * four-topic vocabulary of `database/docs/EVENTS.md`. Like `errorCodeDrift.test.ts` it finds call sites
 * by pattern, so a topic reached through a variable is silently missed — a false negative, never an alarm.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOPICS } from '@/services/events'

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

const SKIP_DIRS = new Set([
  'node_modules',
  '.venv',
  '__pycache__',
  'dist',
  'tests',
  '.pytest_cache',
])
const TEST_FILE = /^test_|_test\.py$|\.test\.(js|ts|tsx)$/

function sourceFiles(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(path, ext)
    return ext.test(name) && !TEST_FILE.test(name) ? [path] : []
  })
}

// The source of the call whose `(` sits at `open`, split at top-level commas; quotes are skipped so
// a comma or paren inside a string cannot split an argument.
function callArgs(src: string, open: number): string[] {
  const args: string[] = []
  let depth = 0
  let start = open + 1
  let quote = ''
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) {
      if (--depth === 0) return [...args, src.slice(start, i)]
    } else if (ch === ',' && depth === 1) {
      args.push(src.slice(start, i))
      start = i + 1
    }
  }
  return []
}

interface Site {
  file: string
  calls: string[][] // the quoted literals of each call
}

// `argsOf` picks the arguments of a call that hold topics (the frontend's are its second argument).
function scan(
  root: string,
  ext: RegExp,
  pattern: RegExp,
  argsOf: (args: string[]) => string[] = (a) => a,
): Site[] {
  return sourceFiles(join(REPO, root), ext).map((file) => {
    const src = readFileSync(file, 'utf8')
    const calls = [...src.matchAll(pattern)].map((m) =>
      argsOf(callArgs(src, m.index + m[0].length - 1)).flatMap((a) =>
        [...a.matchAll(/(['"])([^'"]*)\1/g)].map((l) => l[2]),
      ),
    )
    return { file, calls }
  })
}

const PY = /\.py$/
const JS = /\.(js|ts|tsx)$/

const database = scan('database', PY, /\bbroadcast_notify\s*\(/g)
const sites: Site[] = [
  ...database,
  ...scan('backend', PY, /\bnotify\s*\(/g),
  ...scan('downloader/server/src', JS, /\bnotifyFrontend\s*\(/g),
  ...scan('frontend/src', JS, /\b(?:useNotify|subscribeNotify)\s*\(/g, (a) => a.slice(1)),
]

describe('notify topic drift', () => {
  it('finds the tagged call sites in database/', () => {
    const tagged = database.flatMap((s) => s.calls).filter((c) => c.length > 0)
    expect(tagged.length).toBeGreaterThan(5)
  })

  it('uses only vocabulary topics at every call site', () => {
    const unknown = sites.flatMap((s) =>
      s.calls
        .flat()
        .filter((t) => !(TOPICS as readonly string[]).includes(t))
        .map((t) => `${s.file}: ${t}`),
    )
    expect(unknown).toEqual([])
  })
})
