/**
 * The error-code protocol's drift guard: the codes the services emit, the codes this SPA can say a
 * sentence for, and the codes `docs/ERROR-CODES.md` lists must stay one vocabulary. It lives in the
 * frontend suite because vitest is the only runner in the repo that reads the whole tree with `fs`.
 *
 * It finds codes by pattern, not by parsing the languages, so **a code written in a shape these
 * patterns do not match is silently missed** — the failure mode is a false negative, never a false
 * alarm. A code reached through a ternary, returned inside a tuple or defaulted behind an `or`
 * escapes today. Closing that would take a generated registry every service imports, which was
 * weighed and rejected: `lib/` reaches neither `frontend/` nor `electron/`, so a shared constants
 * module would be a second source of truth rather than one. The same gap is recorded under
 * "Known holes" in docs/ERROR-CODES.md.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serviceErrorRow } from './serviceErrors'

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

// Service source only. `lib/` is absent because the tool probe no longer carries a code, and
// `downloader/extension/` because the popup is not the SPA — both are "Excluded, and why".
const SERVICE_ROOTS = ['backend', 'database', 'downloader/server/src', 'downloader/auto/src']

// Tests are deliberately out: a fixture is a stand-in for a service's output, not an emission, so
// it may legitimately name a stale or invented code.
const SKIP_DIRS = new Set(['node_modules', '.venv', '__pycache__', 'dist', 'tests', '.pytest_cache'])

const CODE_LITERAL = /^(['"])([a-z][a-z0-9_]*)\1$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(path)
    return /\.(py|js)$/.test(name) && !/^test_|_test\.py$|\.test\.js$/.test(name) ? [path] : []
  })
}

// The top-level arguments of the call whose `(` sits at `open`; empty when the parens never close.
// Quotes are skipped so a comma or paren inside a string cannot split an argument.
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

// Where the code sits in each constructor's argument list. Python spells it second (`CodedError`
// and every subclass, `failure`, `error_fields`; `database_main._failure` third, after the status);
// JavaScript's `CodedError` spells it first. `PasscodeError('missing')` is deliberately absent —
// its first argument is a passcode reason, and its code is the literal its own `super(…)` passes.
const CALLS: Array<{ pattern: RegExp; arg: number }> = [
  { pattern: /\b\w*Error\s*\(/g, arg: 1 }, // python: raise CodedError(message, code, …)
  { pattern: /\bsuper\(\)\.__init__\s*\(/g, arg: 1 },
  { pattern: /\bfailure\s*\(/g, arg: 1 },
  { pattern: /\b_failure\s*\(/g, arg: 2 },
  { pattern: /\berror_fields\s*\(/g, arg: 1 },
  { pattern: /\b_error\s*\(/g, arg: 2 }, // python: database_main._error(prose, status, code, …)
  { pattern: /\bclassify\s*\(/g, arg: 2 }, // python: the code a TeX/pandoc log falls back to
  { pattern: /\bfinishJob\s*\(/g, arg: 3 }, // js: a download job's terminal record
  { pattern: /\bnew\s+(?!PasscodeError\b)\w*Error\s*\(/g, arg: 0 }, // js: new CodedError(code, …)
  { pattern: /\bsuper\s*\(/g, arg: 0 }, // js: a subclass naming its one code
]

// `code = "x"` (a python class attribute or keyword), `"code": "x"` and `code: 'x'` (a body literal).
const ASSIGNMENTS = [
  /\bcode\s*=\s*(['"])([a-z][a-z0-9_]*)\1/g,
  /(['"])code\1\s*:\s*(['"])([a-z][a-z0-9_]*)\2/g,
  /\bcode\s*:\s*(['"])([a-z][a-z0-9_]*)\1/g,
]

// Every code literal in one file. A forwarded code (`e.code`, `result.get("code")`, `err.code`) is a
// pass-through whose origin is a literal somewhere else, so nothing here tries to resolve one.
function emittedIn(src: string): string[] {
  const found: string[] = []
  for (const { pattern, arg } of CALLS) {
    pattern.lastIndex = 0
    for (const m of src.matchAll(pattern)) {
      const literal = callArgs(src, m.index + m[0].length - 1)[arg]?.trim()
      const code = literal?.match(CODE_LITERAL)
      if (code) found.push(code[2])
    }
  }
  for (const pattern of ASSIGNMENTS) {
    for (const m of src.matchAll(pattern)) found.push(m[m.length - 1])
  }
  return found
}

// The `code` column of every table in the protocol doc, with the reach the row claims. Column order
// differs between tables (the downloader's carries a `channel`), so both are read off the header.
function documented(): Map<string, Set<string>> {
  const lines = readFileSync(join(REPO, 'docs', 'ERROR-CODES.md'), 'utf8').split('\n')
  const rows = new Map<string, Set<string>>()
  let codeAt = -1
  let reachAt = -1

  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      codeAt = -1
      continue
    }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, ''))
    if (codeAt === -1) {
      codeAt = cells.indexOf('code')
      reachAt = cells.indexOf('reach')
      continue
    }
    const code = cells[codeAt]
    if (!code || /^-+$/.test(code)) continue
    rows.set(code, (rows.get(code) ?? new Set()).add(cells[reachAt]))
  }
  return rows
}

const emitted = new Set(
  SERVICE_ROOTS.flatMap((root) => sourceFiles(join(REPO, root))).flatMap((f) =>
    emittedIn(readFileSync(f, 'utf8')),
  ),
)

// The keys of `serviceErrors.ts`'s map, read as source so the map itself stays private. Each one is
// put back through `serviceErrorRow`, which proves the pattern found real keys and not prose.
const resolved = new Set(
  [...readFileSync(join(REPO, 'frontend/src/shared/i18n/serviceErrors.ts'), 'utf8').matchAll(
    /^ {2}([a-z][a-z0-9_]*): msg\(/gm,
  )].map((m) => m[1]),
)

const docs = documented()

describe('error-code drift', () => {
  it('reads every source of codes', () => {
    expect(emitted.size).toBeGreaterThan(50)
    expect(docs.size).toBeGreaterThan(50)
    expect([...resolved].filter((code) => serviceErrorRow(code) === null)).toEqual([])
  })

  it('documents every code a service emits', () => {
    const missing = [...emitted].filter((code) => !docs.has(code)).sort()
    expect(missing, `emitted but undocumented: ${missing.join(', ')}`).toEqual([])
  })

  it('documents every code the frontend writes a sentence for', () => {
    const missing = [...resolved].filter((code) => !docs.has(code)).sort()
    expect(missing, `has a catalog row but is undocumented: ${missing.join(', ')}`).toEqual([])
  })

  it('writes a sentence for every code the doc calls user-reachable', () => {
    const missing = [...docs]
      .filter(([code, reach]) => reach.has('user') && !resolved.has(code))
      .map(([code]) => code)
      .sort()
    expect(missing, `documented user-reach but no catalog row: ${missing.join(', ')}`).toEqual([])
  })
})
