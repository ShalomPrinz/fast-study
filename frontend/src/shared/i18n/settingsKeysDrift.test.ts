/**
 * The frontend sends `settings.write` a patch keyed by its `SettingsField` names (the keys of `WIRE`
 * in `services/settings.ts`); Electron's `store.js` refuses any key outside its `FIELDS`. A key missing
 * there fails every save at runtime, so both are read as source and compared.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

// The keys of a top-level object literal assigned to `anchor`, read as `  key:` lines.
function keysOf(src: string, anchor: RegExp): string[] {
  const start = src.search(anchor)
  if (start === -1) return []
  const body = src.slice(src.indexOf('{', start), src.indexOf('\n}', start))
  return [...body.matchAll(/^ {2}([A-Za-z]+):/gm)].map((m) => m[1])
}

const wire = keysOf(
  readFileSync(join(REPO, 'frontend/src/services/settings.ts'), 'utf8'),
  /const WIRE\b/,
)
const fields = keysOf(readFileSync(join(REPO, 'electron/store.js'), 'utf8'), /const FIELDS\b/)

describe('settings keys drift', () => {
  it('reads both key sets', () => {
    expect(wire.length).toBeGreaterThan(10)
    expect(fields.length).toBeGreaterThan(10)
  })

  it("accepts every key the frontend sends in Electron's FIELDS", () => {
    const missing = wire.filter((key) => !fields.includes(key))
    expect(missing, `sent by the frontend but absent from electron/store.js: ${missing}`).toEqual(
      [],
    )
  })
})
