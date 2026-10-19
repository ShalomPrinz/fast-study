import { createFolderPick, type PickFolder } from '@/features/settings/utils/folderPick'

// Answers the popup's `folder:pick`: opens the dialog at the current folder and saves the choice.
// A request while it is up is dropped, a cancel saves nothing, and any failure goes to `onError`.
export function createGeneralFolderPick(
  pick: PickFolder,
  save: (folder: string) => Promise<void>,
  onError: (err: unknown) => void,
) {
  const open = createFolderPick(pick)
  return async (current: string | undefined): Promise<void> => {
    let saving: Promise<void> | undefined
    try {
      await open(current ?? '', (path) => {
        saving = save(path)
      })
      await saving
    } catch (err) {
      onError(err)
    }
  }
}
