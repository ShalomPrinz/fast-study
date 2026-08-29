import { useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { probeKey, type Provider } from '@/services/settings'
import Icon from '@/shared/components/Icon'
import { prefixStatus, shouldProbe, type KeyStatus } from '../utils/keyStatus'
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

// One write-only key field: the value goes out and never comes back, and the field carries a single
// status slot that the prefix hint fills first and any probe result then overwrites.
export default function ApiKeyField({ provider, value, onChange, storedKeyExists }: Props) {
  const { t } = useLingui()
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
    // Any edit invalidates the last verdict; the offline prefix hint is what is left to show.
    setStatus(prefixStatus(next, provider.keyPrefix))
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
      {/* Not a `<label>` wrapper: the console link inside one would activate the input instead. */}
      <div className="settings-label">
        <label htmlFor={`key-${provider.id}`}>
          <Trans>{provider.displayName} API key</Trans>
        </label>
        <a
          className="settings-link"
          href={provider.consoleUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          <Trans>Get a key</Trans>
          <Icon icon="external-link" />
        </a>
      </div>
      <input
        id={`key-${provider.id}`}
        className="settings-input settings-input--code"
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
      <p className={`settings-status ${status ? (TONE[status.kind] ?? '') : ''}`}>{message()}</p>
    </div>
  )
}
