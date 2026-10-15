const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULT = { width: 1400, height: 900 };
// Below this the fixed sidebar columns squeeze the content; capped by the work area all the same.
const MINIMUM = { width: 1024, height: 640 };

function file() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function dimension(value, fallback, min, max) {
  const wanted = Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  return Math.max(min, Math.min(wanted, max));
}

/** The window's minimum size on a display with this work area: a minimum bigger than the screen
 *  cannot be honoured. */
function minimumSize(workArea) {
  return {
    width: Math.min(MINIMUM.width, workArea.width),
    height: Math.min(MINIMUM.height, workArea.height),
  };
}

/** The size and maximized flag to open with: the saved ones fitted between the minimum and the work
 *  area, so a smaller monitor never gets an oversized window; anything unusable falls back to 1400x900. */
function restoredSize(saved, workArea) {
  const state = saved && typeof saved === 'object' ? saved : {};
  const min = minimumSize(workArea);
  return {
    width: dimension(state.width, DEFAULT.width, min.width, workArea.width),
    height: dimension(state.height, DEFAULT.height, min.height, workArea.height),
    maximized: state.maximized === true,
  };
}

/** The saved state, or null when there is none or it does not parse — `restoredSize` handles both. */
function load() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return null;
  }
}

/** Synchronous, so the `exit` handler can call it; a failed write only costs the next launch its size. */
function save(state) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(state) + '\n');
  } catch {
    // Nothing to do about it on the way out.
  }
}

module.exports = { file, load, minimumSize, restoredSize, save };
