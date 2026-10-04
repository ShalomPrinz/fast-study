import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { probeDataRoot, type DataRootProbe } from '@/services/settings'
import ServiceError from '@/shared/components/ServiceError'
import '@/styles/settings-form.css'

interface Props {
  value: string
  onChange: (value: string) => void
  // Present only on the init wall, which probes the folder as it is typed and gates on the verdict.
  onUnusableChange?: (unusable: boolean) => void
}

// The pause after the last keystroke before a typed path is probed.
const PROBE_DELAY_MS = 400

// Where every course, lecture, video and summary is kept on this machine.
export default function DataRootField({ value, onChange, onUnusableChange }: Props) {
  const { t } = useLingui()
  const [probe, setProbe] = useState<DataRootProbe>({ kind: 'unknown' })
  const seq = useRef(0)

  // On load and on each change: the last verdict stands until a newer one lands, and a slower
  // earlier probe never overwrites a newer one's.
  useEffect(() => {
    if (!onUnusableChange) return
    const id = ++seq.current
    const timer = setTimeout(async () => {
      const result = await probeDataRoot(value)
      if (id !== seq.current) return
      setProbe(result)
      onUnusableChange(result.kind === 'unusable')
    }, PROBE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value, onUnusableChange])

  const invalid = !!onUnusableChange && (!value.trim() || probe.kind === 'unusable')

  return (
    <div className="settings-field">
      <div className="settings-label">
        <label htmlFor="data-root">
          <Trans>Data folder</Trans>
        </label>
      </div>
      <p className="settings-hint">
        <Trans>
          Every course, lecture, video and summary is stored here. Use a folder on this computer
          that is not synced to the cloud.
        </Trans>
      </p>
      <input
        id="data-root"
        data-testid="data-root-input"
        className={`settings-input settings-input--code ${invalid ? 'settings-input--invalid' : ''}`}
        value={value}
        spellCheck={false}
        placeholder={t`C:\\Users\\you\\AppData\\Local\\FastStudy\\data`}
        onChange={(e) => onChange(e.target.value)}
      />
      {probe.kind === 'unusable' && (
        <p className="settings-status settings-status--danger" id="data-root-status">
          <ServiceError failure={probe.failure} />
        </p>
      )}
      {/* A first run has no old folder to re-point from, so the wall says where the data lives instead. */}
      {onUnusableChange ? (
        <p className="settings-note">
          <Trans>
            Everything stays on this computer. Fast Study has no servers of its own and keeps no
            copy of your lectures or summaries.
          </Trans>
        </p>
      ) : (
        <p className="settings-note settings-note--warn">
          <Trans>
            This only changes where the app looks — it never moves your files. The old folder stays
            as it is, and choosing it again brings everything back.
          </Trans>
        </p>
      )}
    </div>
  )
}
