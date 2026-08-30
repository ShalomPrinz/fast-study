import { describe, it, expect, vi, afterEach } from 'vitest'
import { storeBody, ownerBodies, saveSettings, pickBacking } from './settings'

const STORED = {
  data_root: '/data',
  gemini_api_key_set: true,
  groq_api_key_set: false,
  gemini_model: null,
  drive_enabled: null,
  gdrive_root_folder: null,
  ui_language: 'he',
  runner_controls_visible: null,
}

// Minimal stand-in for the parts of Response the http client touches.
function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storeBody', () => {
  it('renames every named field to its wire key and omits the rest', () => {
    expect(storeBody({ dataRoot: '/d', geminiApiKey: 'k', runnerControlsVisible: false })).toEqual({
      data_root: '/d',
      gemini_api_key: 'k',
      runner_controls_visible: false,
    })
  })

  it('keeps an empty string, which clears a key rather than leaving it alone', () => {
    expect(storeBody({ groqApiKey: '' })).toEqual({ groq_api_key: '' })
  })
})

describe('ownerBodies', () => {
  it('routes each field to its single owner', () => {
    const { backend, database } = ownerBodies({
      dataRoot: '/d',
      geminiModel: 'gemini-3.5-flash',
      driveEnabled: true,
    })
    expect(backend).toEqual({ gemini_model: 'gemini-3.5-flash', drive_enabled: true })
    expect(database).toEqual({ data_root: '/d' })
  })

  it('gives the frontend-owned settings no owner at all', () => {
    expect(ownerBodies({ uiLanguage: 'en', runnerControlsVisible: true })).toEqual({
      backend: null,
      database: null,
    })
  })
})

describe('saveSettings', () => {
  it('writes the store before pushing to the owners', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url}`)
        return ok(STORED)
      }),
    )

    const settings = await saveSettings({ dataRoot: '/d', groqApiKey: 'k' })

    expect(calls).toEqual([
      'PUT http://localhost:8001/settings',
      'POST http://localhost:8000/config',
      'POST http://localhost:8001/config',
    ])
    expect(settings.dataRoot).toBe('/data')
    expect(settings.groqApiKeySet).toBe(false)
  })

  it('skips an owner with nothing to apply', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url}`)
        return ok(STORED)
      }),
    )

    await saveSettings({ runnerControlsVisible: true })

    expect(calls).toEqual(['PUT http://localhost:8001/settings'])
  })
})

describe('pickBacking', () => {
  it('prefers the Electron bridge when the preload exposed one', async () => {
    const bridge = { read: vi.fn(), write: vi.fn() }
    vi.stubGlobal('window', { faststudy: { settings: bridge } })
    expect(pickBacking()).toBe(bridge)
  })

  it('falls back to the database service in a plain browser', () => {
    vi.stubGlobal('window', {})
    expect(pickBacking()).not.toBeUndefined()
    expect(pickBacking()).toHaveProperty('read')
  })
})
