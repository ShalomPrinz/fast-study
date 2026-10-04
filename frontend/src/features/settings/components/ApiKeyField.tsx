import { useRef, useState, type ReactNode } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { openExternalUrl } from '@/services/open'
import { probeKey, type Provider } from '@/services/settings'
import Icon from '@/shared/components/Icon'
import { prefixStatus, shouldProbe, type KeyStatus } from '../utils/keyStatus'
import gemini2 from '@/assets/key-steps/gemini-2.png'
import gemini3 from '@/assets/key-steps/gemini-3.png'
import gemini4 from '@/assets/key-steps/gemini-4.png'
import gemini5 from '@/assets/key-steps/gemini-5.png'
import gemini6 from '@/assets/key-steps/gemini-6.png'
import groq2 from '@/assets/key-steps/groq-2.png'
import groq3 from '@/assets/key-steps/groq-3.png'
import groq4 from '@/assets/key-steps/groq-4.png'
import '@/styles/settings-form.css'

interface Props {
  provider: Provider
  value: string
  onChange: (value: string) => void
  // A stored key never comes back from the store, so the field shows a placeholder instead.
  storedKeyExists: boolean
}

const TONE: Record<string, string> = {
  valid: 'settings-status--ok',
  rejected: 'settings-status--danger',
  prefix: 'settings-status--warn',
  unverified: 'settings-status--warn',
}

// The provider's key page, opened outside the app; it reads as a link inside a sentence of the steps.
function ConsoleLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      className="settings-link"
      href={url}
      onClick={(e) => {
        e.preventDefault()
        void openExternalUrl(url)
      }}
    >
      {children}
      <Icon icon="external-link" />
    </a>
  )
}

// Click-by-click steps for a first-time user, keyed by provider id; the button names stay English in
// every locale because the provider consoles are English. A provider without steps shows no guide.
function keySteps(provider: Provider): ReactNode[] | null {
  const url = provider.consoleUrl
  if (provider.id === 'gemini') {
    return [
      <Trans>
        Click <ConsoleLink url={url}>Get a key</ConsoleLink> and sign in with your Google account.
      </Trans>,
      <Trans>Click "Create API key".</Trans>,
      <Trans>In the project list, choose "Create project".</Trans>,
      <Trans>Give the project any name and click "Create project".</Trans>,
      <Trans>Back in the key window, click "Create key".</Trans>,
      <Trans>Click "Copy key" and paste the key here.</Trans>,
    ]
  }
  if (provider.id === 'groq') {
    return [
      <Trans>
        Click <ConsoleLink url={url}>Get a key</ConsoleLink> and sign in with Google or your email.
      </Trans>,
      <Trans>Click "Create API Key".</Trans>,
      <Trans>Type any name (for example FastStudy) and click "Submit".</Trans>,
      <Trans>
        Click "Copy" and paste the key here. Groq shows the key only once, so copy it before you
        close the window.
      </Trans>,
    ]
  }
  return null
}

// A screenshot per step, in step order, or `null` for a step without one (it shows no toggle);
// swapping a file in `assets/key-steps/` is all an update takes.
const SHOTS: Record<string, (string | null)[]> = {
  gemini: [null, gemini2, gemini3, gemini4, gemini5, gemini6],
  groq: [null, groq2, groq3, groq4],
}

// One write-only key field: the value goes out and never comes back, and the field carries a single
// status slot that the prefix hint fills first and any probe result then overwrites.
export default function ApiKeyField({ provider, value, onChange, storedKeyExists }: Props) {
  const { t } = useLingui()
  const steps = keySteps(provider)
  const [status, setStatus] = useState<KeyStatus>(null)
  const probed = useRef<string | null>(null)
  // The probe reads the value at fire time, which for a paste is one tick after the event.
  const latest = useRef(value)
  latest.current = value
  const seq = useRef(0)

  async function probe() {
    const key = latest.current.trim()
    if (!shouldProbe(key, probed.current)) return
    probed.current = key
    const id = ++seq.current
    setStatus({ kind: 'checking' })
    const result = await probeKey(provider.id, key)
    // A slower earlier probe must not overwrite a newer one's verdict.
    if (id === seq.current) setStatus({ kind: result })
  }

  function handleChange(next: string) {
    onChange(next)
    // An edit invalidates everything the field remembers about the last probe: the verdict shown, the
    // in-flight probe that would otherwise land on this new text, and the value that blocks a re-probe.
    setStatus(prefixStatus(next, provider.keyPrefix))
    seq.current += 1
    probed.current = null
  }

  const message = () => {
    switch (status?.kind) {
      case 'checking':
        return t`Checking…`
      case 'valid':
        return t`Key verified`
      case 'rejected':
        return t`${provider.displayName} rejected this key. Generate a new one in its console.`
      case 'unverified':
        return t`We couldn't check this key right now. You can still save it.`
      case 'prefix':
        return t`This doesn't look like a ${provider.displayName} key — those start with ${provider.keyPrefix}. You can still save it.`
      default:
        return ''
    }
  }

  return (
    <div className="settings-field">
      <div className="settings-label">
        <label htmlFor={`key-${provider.id}`}>
          <Trans>{provider.displayName} API key</Trans>
        </label>
      </div>
      {/* Always open: the steps are the whole help a first-time user has, and step 1 holds the link. */}
      {steps && (
        <div className="settings-guide" data-testid="api-key-help" data-provider={provider.id}>
          <p className="settings-guide-title">
            <Trans>How do I get a key?</Trans>
          </p>
          <ol className="settings-steps">
            {steps.map((text, i) => {
              const shot = SHOTS[provider.id]?.[i]
              const step = i + 1
              const name = provider.displayName
              return (
                <li key={step}>
                  {text}
                  {/* Collapsed by default: the steps read on their own, the picture is for a user stuck. */}
                  {shot && (
                    <details className="settings-shot">
                      <summary>
                        <Trans>Show screenshot</Trans>
                      </summary>
                      <img src={shot} alt={t`Screenshot of ${name}, step ${step}`} loading="lazy" />
                    </details>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
      <input
        id={`key-${provider.id}`}
        data-testid="api-key-input"
        data-provider={provider.id}
        className={`settings-input settings-input--code ${storedKeyExists ? 'settings-input--prose-placeholder' : ''}`}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={storedKeyExists ? t`A key is saved — type to replace it` : provider.keyPrefix}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => void probe()}
        // The change event carrying the pasted text fires after `paste`, so probe on the next tick.
        onPaste={() => setTimeout(() => void probe(), 0)}
      />
      <p
        className={`settings-status ${status ? (TONE[status.kind] ?? '') : ''}`}
        data-testid="api-key-status"
        data-provider={provider.id}
        data-status={status?.kind}
      >
        {message()}
      </p>
    </div>
  )
}
