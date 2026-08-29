import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { Locale } from '@/services/i18n'
import {
  fetchConfigOptions,
  saveSettings,
  type ConfigOptions,
  type Provider,
  type Settings,
} from '@/services/settings'
import ApiKeyField from './components/ApiKeyField'
import DataRootField from './components/DataRootField'
import DriveFields from './components/DriveFields'
import LanguageField from './components/LanguageField'
import { buildPatch, type SettingsForm } from './utils/patch'
import { missingEntries } from './utils/required'
import '@/styles/button.css'
import '@/styles/spinner.css'
import '@/styles/settings-form.css'
import './InitWall.css'

interface Props {
  stored: Settings
  onDone: () => void
}

type FormState = Omit<SettingsForm, 'uiLanguage' | 'autoRunOnBoot' | 'runnerControlsVisible'>

// How to get each key, in the words of someone who has never seen a developer console. Provider
// prose, so it is keyed by provider id; a provider without an entry simply shows the link alone.
function KeyGuide({ id }: { id: string }) {
  if (id === 'gemini') {
    return (
      <p className="settings-hint">
        <Trans>
          Open Google AI Studio using the link below, sign in with your Google account, and press
          "Create API key". Copy the key it shows you and paste it into the field.
        </Trans>
      </p>
    )
  }
  if (id === 'groq') {
    return (
      <p className="settings-hint">
        <Trans>
          Open the Groq console using the link below, sign in, and press "Create API Key". Copy it
          right away — Groq shows a key only once — and paste it into the field.
        </Trans>
      </p>
    )
  }
  return null
}

// The wall in front of the app: until the required entries are filled there is no sidebar, no route
// and no way past. See docs/SETTINGS.md.
export default function InitWall({ stored, onDone }: Props) {
  const { t, i18n } = useLingui()
  const [options, setOptions] = useState<ConfigOptions | null>(null)
  const [form, setForm] = useState<FormState>({
    geminiApiKey: '',
    groqApiKey: '',
    // In browser dev the prefill is whatever the store already holds.
    dataRoot: stored.dataRoot ?? '',
    driveEnabled: stored.driveEnabled ?? false,
    gdriveRootFolder: stored.gdriveRootFolder ?? '',
    geminiModel: stored.geminiModel ?? '',
  })
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const opts = await fetchConfigOptions()
        setOptions(opts)
        setForm((f) => ({ ...f, geminiModel: f.geminiModel || (opts.geminiModels[0] ?? '') }))
      } catch {
        // A downed service is already toasted centrally by the http client.
      }
    }
    void load()
  }, [])

  const missing = missingEntries({
    geminiKey: form.geminiApiKey,
    geminiKeyStored: stored.geminiApiKeySet,
    groqKey: form.groqApiKey,
    groqKeyStored: stored.groqApiKeySet,
    dataRoot: form.dataRoot,
    dataRootConfirmed: confirmed,
    driveEnabled: form.driveEnabled,
    gdriveRootFolder: form.gdriveRootFolder,
  })

  async function finish() {
    setSaving(true)
    setFailure('')
    try {
      // The two UI preferences are deliberately absent: the wall never asks, so they keep their
      // first-boot defaults.
      await saveSettings(buildPatch({ ...form, uiLanguage: i18n.locale as Locale }, stored))
      onDone()
    } catch (err) {
      // Shown in place, not toasted: a rejected data folder is the one thing standing in the way.
      setFailure((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function keyField(provider: Provider | undefined, field: 'geminiApiKey' | 'groqApiKey') {
    if (!provider) return null
    return (
      <div className="init-wall-key">
        <KeyGuide id={provider.id} />
        <ApiKeyField
          provider={provider}
          value={form[field]}
          onChange={(v) => setForm({ ...form, [field]: v })}
          storedKeyExists={field === 'geminiApiKey' ? stored.geminiApiKeySet : stored.groqApiKeySet}
        />
      </div>
    )
  }

  return (
    <div className="init-wall">
      <div className="init-wall-card">
        <header className="init-wall-header">
          {/* The product name is a brand, not copy — it reads the same in every locale. */}
          <p className="init-wall-brand">Fast Study</p>
          <h1 className="init-wall-title">
            <Trans>Let's set things up</Trans>
          </h1>
          <p className="init-wall-lede">
            <Trans>
              Three things are needed before the first lecture can be turned into a summary. This
              only happens once.
            </Trans>
          </p>
        </header>

        <section className="settings-section">
          <LanguageField />
        </section>

        {!options ? (
          <div className="init-wall-loading">
            <div className="spinner" />
          </div>
        ) : (
          <>
            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Your two API keys</Trans>
              </h2>
              <p className="settings-hint">
                <Trans>
                  Fast Study uses two free services: one turns the recording into text, the other
                  writes the summary. Both need a key of your own, and both are free to create.
                </Trans>
              </p>
              {keyField(
                options.providers.find((p) => p.id === 'gemini'),
                'geminiApiKey',
              )}
              {keyField(
                options.providers.find((p) => p.id === 'groq'),
                'groqApiKey',
              )}
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Where to keep everything</Trans>
              </h2>
              <DataRootField
                value={form.dataRoot}
                onChange={(v) => setForm({ ...form, dataRoot: v })}
                confirmed={confirmed}
                onConfirmedChange={setConfirmed}
              />
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">
                <Trans>Google Drive (optional)</Trans>
              </h2>
              <DriveFields
                value={{ enabled: form.driveEnabled, folder: form.gdriveRootFolder }}
                onChange={(v) =>
                  setForm({ ...form, driveEnabled: v.enabled, gdriveRootFolder: v.folder })
                }
                folderMissing={missing.includes('gdriveRootFolder')}
              />
            </section>
          </>
        )}

        <footer className="init-wall-footer">
          {failure && <p className="settings-status settings-status--danger">{failure}</p>}
          {missing.length > 0 && (
            <p className="settings-status">
              <Trans>Fill in the fields above to continue.</Trans>
            </p>
          )}
          <button
            className="btn btn--primary"
            disabled={saving || !options || missing.length > 0}
            onClick={() => void finish()}
          >
            {saving ? t`Saving…` : t`Start using Fast Study`}
          </button>
        </footer>
      </div>
    </div>
  )
}
