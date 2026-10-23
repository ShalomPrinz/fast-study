import { Plural, useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import type { BulkRun } from '@/features/downloads/hooks/useBulkRun'
import {
  dismissPasscode,
  usePasscodeDismissed,
} from '@/features/downloads/contexts/SectionRunsContext'
import { captchaTimeoutReason } from '@/features/downloads/utils/downloadErrors'
import type { GroupScope } from '@/features/downloads/utils/sections'
import { GROUP_SELECTOR } from '@/features/downloads/utils/sections'
import PasscodePrompt from './PasscodePrompt'
import './BulkRunNotes.css'

interface Props {
  bulk: BulkRun
  // Names what "run again" runs.
  scope: GroupScope
}

// What a group's run says inside the body: the rows a stopped run never reached or can't confirm, and
// a section run's parked passcode prompt. See docs/BULK.md.
export default function BulkRunNotes({ bulk, scope }: Props) {
  const { t } = useLingui()
  const { run, state, passcode } = bulk
  const paused = run?.status === 'paused' ? run.paused : null
  const dismissed = usePasscodeDismissed(run?.id ?? null)
  const { stalled, notStarted, captchaTimedOut } = state
  const section = scope === 'section'
  const stoppedBecause =
    run?.status === 'reconnect'
      ? section
        ? t`the university session expired. Reconnect, then run the section again.`
        : t`the university session expired. Reconnect, then run the playlist again.`
      : run?.status === 'cancelled'
        ? section
          ? t`the run was cancelled. Run the section again to pick them up.`
          : t`the run was cancelled. Run the playlist again to pick them up.`
        : section
          ? t`the run stopped early. Run the section again to pick them up.`
          : t`the run stopped early. Run the playlist again to pick them up.`

  const unsolvedBecause = captchaTimeoutReason()

  return (
    <>
      {captchaTimedOut > 0 && (
        <div className={`bulk-run-note ${GROUP_SELECTOR[scope]}-stalled`}>
          {plural(captchaTimedOut, {
            one: `# recording wasn't downloaded: ${unsolvedBecause}`,
            other: `# recordings weren't downloaded: ${unsolvedBecause}`,
          })}
        </div>
      )}

      {/* Rows the run stopped short of. The summary omits them, so a run halted at row 3 of 20 would
          read exactly like a finished one — and unlike the unverified rows, this one has an action. */}
      {notStarted > 0 && (
        <div className={`bulk-run-note ${GROUP_SELECTOR[scope]}-stalled`}>
          {plural(notStarted, {
            one: `# recording never started — ${stoppedBecause}`,
            other: `# recordings never started — ${stoppedBecause}`,
          })}
        </div>
      )}

      {stalled > 0 && (
        <div className={`bulk-run-note ${GROUP_SELECTOR[scope]}-stalled`}>
          <Plural
            value={stalled}
            one="Couldn't confirm # download — the lecture may have been deleted or renamed, or the file saved under a different name."
            other="Couldn't confirm # downloads — the lecture may have been deleted or renamed, or the file saved under a different name."
          />
        </div>
      )}

      {/* A playlist run never parks: its children are YouTube, and only a Zoom share has a passcode. */}
      {section && paused && run && !dismissed && (
        <PasscodePrompt
          reason={paused.reason}
          busy={passcode.saving}
          onSubmit={passcode.submit}
          onCancel={() => void passcode.cancel()}
          onDismiss={() => dismissPasscode(run.id)}
        />
      )}
    </>
  )
}
