import { Router } from 'express';
import { folderError, readFolder, writeFolder } from '../generalFolder.js';
import { broadcastFolderPick, pickerCount } from '../events.js';

const router = Router();

// The folder general-mode downloads land in; the popup shows it read-only.
router.get('/general-folder', (req, res) => res.json({ folder: readFolder() }));

// The app window's answer to a `folder:pick`: an absolute path to an existing, writable directory.
router.post('/general-folder', (req, res) => {
  const folder = req.body?.folder;
  const error = folderError(folder);
  if (error) return res.status(400).json(error);
  writeFolder(folder);
  res.json({ folder });
});

// The popup can't host a native picker (Chrome closes it when the OS dialog takes focus), so it
// asks the app window to open one over its `/events?picker=1` stream; with none open there is nobody to ask.
router.post('/general-folder/pick', (req, res) => {
  if (!pickerCount())
    return res.status(409).json({
      error: 'no FastStudy app window is open to show the folder picker',
      code: 'folder_picker_unavailable',
      params: {},
    });
  broadcastFolderPick(readFolder());
  res.json({ status: 'ok' });
});

export default router;
