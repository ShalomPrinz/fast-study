import { describe, it, expect, vi, afterEach } from 'vitest'
import { storeBody, ownerBodies, saveSettings, pickBacking, probeMoodleSite } from './settings'

const STORED = {
  data_root: '/data',
  gemini_api_key_set: true,
  groq_api_key_set: false,
  gemini_model: null,
  drive_enabled: null,
  gdrive_root_folder: null,
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
    expect(storeBody({ dataRoot: '/d', geminiApiKey: 'k', geminiModel: 'm' })).toEqual({
      data_root: '/d',
      gemini_api_key: 'k',
      gemini_model: 'm',
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

  it('routes the Moodle site to the auto-downloader alone', () => {
    expect(ownerBodies({ moodleSite: 'https://lemida.biu.ac.il' })).toEqual({
      backend: null,
      database: null,
      auto: { moodle_site: 'https://lemida.biu.ac.il' },
    })
  })

  // Launcher-only: the launcher itself pushes the switch to every service.
  it('gives error reports and the privacy answer no owner', () => {
    expect(ownerBodies({ errorReports: false, privacyConfirmed: true })).toEqual({
      backend: null,
      database: null,
      auto: null,
    })
  })

  it('gives an empty patch no owner at all', () => {
    expect(ownerBodies({})).toEqual({ backend: null, database: null, auto: null })
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

    await saveSettings({ dataRoot: '/d' })

    expect(calls).toEqual([
      'PUT http://localhost:8001/settings',
      'POST http://localhost:8001/config',
    ])
  })
})

describe('saveSettings through the launcher', () => {
  it('passes on a switch some service missed, and posts it to no service itself', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const write = vi.fn(async () => ({ errorReports: true, errorReportsRestartNeeded: true }))
    vi.stubGlobal('window', { faststudy: { settings: { read: vi.fn(), write } } })

    const saved = await saveSettings({ errorReports: true, privacyConfirmed: true })

    expect(write).toHaveBeenCalledWith({ errorReports: true, privacyConfirmed: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(saved.errorReportsRestartNeeded).toBe(true)
  })

  it('reads a write with no answer about the switch as nothing to restart for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(STORED)),
    )
    expect((await saveSettings({ dataRoot: '/d' })).errorReportsRestartNeeded).toBe(false)
  })
})

describe('saveSettings with a site', () => {
  it('pushes the site to the auto-downloader after the store', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url} ${init.body}`)
        return ok(STORED)
      }),
    )

    await saveSettings({ moodleSite: 'https://lemida.biu.ac.il' })

    expect(calls).toEqual([
      'PUT http://localhost:8001/settings {"moodle_site":"https://lemida.biu.ac.il"}',
      'POST http://localhost:3053/config {"moodle_site":"https://lemida.biu.ac.il"}',
    ])
  })
})

describe('probeMoodleSite', () => {
  it('carries an unsupported answer as a coded failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ok({
          status: 'unsupported',
          site: 'https://example.com',
          code: 'moodle_site_unsupported',
          params: { site: 'https://example.com', reason: 'not_moodle' },
        }),
      ),
    )
    const probe = await probeMoodleSite('https://example.com')
    expect(probe.status).toBe('unsupported')
    expect(probe.failure?.code).toBe('moodle_site_unsupported')
    expect(probe.failure?.params).toEqual({ site: 'https://example.com', reason: 'not_moodle' })
  })

  it('keeps an unverified answer uncoded, with the site it names', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ok({
          status: 'unverified',
          site: 'https://x.ac.il',
          params: { site: 'https://x.ac.il', detail: 'site_blocked' },
        }),
      ),
    )
    expect(await probeMoodleSite('https://x.ac.il/course/view.php?id=1')).toEqual({
      status: 'unverified',
      site: 'https://x.ac.il',
      failure: null,
    })
  })

  it('reads a failed request as unverified, never unsupported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )
    expect(await probeMoodleSite('https://x.ac.il')).toEqual({
      status: 'unverified',
      site: null,
      failure: null,
    })
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
