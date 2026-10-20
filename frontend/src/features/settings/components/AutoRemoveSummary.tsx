import { Plural } from '@lingui/react/macro'
import type { AutoRemoveSweep } from '@/services/backend'

// The toast body after Apply swept the existing lectures: what was removed, then each reason a lecture
// was not, only when it happened.
export default function AutoRemoveSummary({ counts }: { counts: AutoRemoveSweep }) {
  const { removed, locked, deferred, failed } = counts
  return (
    <div data-auto-remove-sweep>
      <p>
        <Plural
          value={removed}
          _0="No lecture had files to remove."
          one="Removed files from # lecture."
          other="Removed files from # lectures."
        />
      </p>
      {locked > 0 && (
        <p>
          <Plural
            value={locked}
            one="# lecture was skipped: a file is open in another program. Close it and press Apply under “Disk space” again."
            other="# lectures were skipped: a file is open in another program. Close it and press Apply under “Disk space” again."
          />
        </p>
      )}
      {deferred > 0 && (
        <p>
          <Plural
            value={deferred}
            one="# lecture is being processed; its files will be removed when its run finishes."
            other="# lectures are being processed; their files will be removed when their run finishes."
          />
        </p>
      )}
      {failed > 0 && (
        <p>
          <Plural
            value={failed}
            one="Couldn't remove the files of # lecture."
            other="Couldn't remove the files of # lectures."
          />
        </p>
      )}
    </div>
  )
}
