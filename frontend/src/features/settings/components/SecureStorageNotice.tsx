import { Trans } from '@lingui/react/macro'
import { canStoreApiKeys } from '@/services/runtime'
import '@/styles/settings-form.css'

// Plain words for a machine that cannot keep an API key, rendered where the key fields would
// otherwise be — both screens leave those out entirely rather than show one that cannot be filled.
export default function SecureStorageNotice() {
  if (canStoreApiKeys) return null
  return (
    <p className="settings-note settings-note--warn settings-note--no-key-storage">
      <Trans>
        This computer can't keep API keys safely, so they can't be saved here. Everything else on
        this screen works as usual.
      </Trans>
    </p>
  )
}
