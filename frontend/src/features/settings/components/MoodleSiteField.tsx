import { useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { probeMoodleSite } from '@/services/settings'
import ServiceError from '@/shared/components/ServiceError'
import { choiceForSite, MOODLE_SITE_PRESETS, OTHER_SITE } from '../utils/moodleSites'
import { savableSite, siteProber, type SiteStatus } from '../utils/siteStatus'
import '@/styles/settings-form.css'

interface Props {
  // The site the form would save: the stored one until an edit, then whatever the probe allows.
  value: string
  // Called with `''` while nothing savable is chosen, which is what holds the save back.
  onChange: (site: string) => void
  // Told of each site the probe confirms, before any save — the wall stores it right away.
  onSupported?: (site: string) => void
}

const TONE: Record<string, string> = {
  supported: 'settings-status--ok',
  unsupported: 'settings-status--danger',
  unverified: 'settings-status--warn',
}

// The university's Moodle site: a preset or any pasted address, probed before it can be saved.
// See docs/SETTINGS.md.
export default function MoodleSiteField({ value, onChange, onSupported }: Props) {
  const { t } = useLingui()
  const [choice, setChoice] = useState(() => choiceForSite(value || null))
  const [typed, setTyped] = useState(() => (choice === OTHER_SITE ? value : ''))
  const [status, setStatus] = useState<SiteStatus>(null)
  // The probe lands after renders the parent's callback may have been replaced in.
  const report = useRef({ onChange, onSupported })
  report.current = { onChange, onSupported }
  const latest = useRef(typed)
  latest.current = typed
  const prober = useMemo(
    () =>
      siteProber(probeMoodleSite, (next) => {
        setStatus(next)
        report.current.onChange(savableSite(next))
        if (next?.kind === 'supported') report.current.onSupported?.(next.site)
      }),
    [],
  )

  // Any edit forgets the last answer and holds the save until a new one lands.
  function forget() {
    prober.reset()
    setStatus(null)
    onChange('')
  }

  function pick(next: string) {
    setChoice(next)
    setTyped('')
    forget()
    const preset = MOODLE_SITE_PRESETS.find((p) => p.id === next)
    if (preset) void prober.probe(preset.url)
  }

  const message = () => {
    switch (status?.kind) {
      case 'checking':
        return t`Checking…`
      case 'supported':
        return (
          <Trans>
            Found your university's Moodle: <bdi dir="ltr">{status.site}</bdi>
          </Trans>
        )
      case 'unsupported':
        return <ServiceError failure={status.failure} />
      case 'unverified':
        return t`We couldn't check this site right now. You can still save it.`
      default:
        return ''
    }
  }

  return (
    <div
      className={`settings-field ${status ? `moodle-site--${status.kind}` : ''}`}
      id="moodle-site"
    >
      <div className="settings-label">
        <label htmlFor="moodle-site-select">
          <Trans>University</Trans>
        </label>
      </div>
      <select
        id="moodle-site-select"
        className="settings-select"
        value={choice}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="" disabled>
          {t`Choose your university…`}
        </option>
        {MOODLE_SITE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {t(preset.name)}
          </option>
        ))}
        <option value={OTHER_SITE}>{t`Other…`}</option>
      </select>
      {choice === OTHER_SITE && (
        <input
          id="moodle-site-url"
          className="settings-input settings-input--code"
          type="url"
          dir="ltr"
          spellCheck={false}
          aria-label={t`Your university's Moodle address`}
          placeholder="https://moodle.example.ac.il"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value)
            forget()
          }}
          onBlur={() => void prober.probe(latest.current)}
          // The change event carrying the pasted text fires after `paste`, so probe on the next tick.
          onPaste={() => setTimeout(() => void prober.probe(latest.current), 0)}
        />
      )}
      <span className="settings-hint">
        <Trans>
          Fast Study finds your recordings on your university's Moodle site. If it isn't listed,
          choose "Other…" and paste the address of its Moodle.
        </Trans>
      </span>
      <p className={`settings-status ${status ? (TONE[status.kind] ?? '') : ''}`}>{message()}</p>
    </div>
  )
}
