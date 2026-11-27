import os from 'node:os';
import path from 'node:path';
import { screenshot } from '../../lib/mac.js';
import { manualImport } from '../17-manual-import.js';

// The shared body with its first source in ~/Downloads, where a Files-and-Folders (TCC) prompt may stand:
// the wait is bounded, and the read is recorded as `read without a prompt`, `prompted` or `refused`.
export default () =>
  manualImport({
    guard: {
      sourceDir: path.join(os.homedir(), 'Downloads', 'faststudy-smoke-import'),
      waitMs: 45_000,
      desktop: () => screenshot('import-tcc-prompt.png'),
    },
  });
