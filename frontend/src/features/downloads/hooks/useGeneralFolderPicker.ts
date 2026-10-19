import { useEffect } from 'react'
import { pickFolder } from '@/services/runtime'
import { toast } from '@/services/toaster'
import { isConnectionError } from '@/services/http'
import { serviceErrorNode } from '@/shared/components/ServiceError'
import { failureOf } from '@/shared/utils/failure'
import { setGeneralFolder, subscribeFolderPick } from '../services/downloadServer'
import { createGeneralFolderPick } from '../utils/generalFolderPick'

// App-wide answer to the extension popup's "Choose folder…", which can come while any page is open.
// With no native dialog (browser dev, an older launcher) nothing subscribes; see docs/EXTENSION.md.
export function useGeneralFolderPicker(): void {
  useEffect(() => {
    if (!pickFolder) return
    const onPick = createGeneralFolderPick(pickFolder, setGeneralFolder, (err) => {
      // A ConnectionError was already toasted by the shared client.
      if (!isConnectionError(err)) toast('error', serviceErrorNode(failureOf(err)))
    })
    return subscribeFolderPick((folder) => void onPick(folder))
  }, [])
}
