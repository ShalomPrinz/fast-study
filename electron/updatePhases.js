/** Map electron-updater's events onto one of checking | downloading | none | downloaded | error and
 *  call `report` on each change. A late error never demotes a finished download. Pure over `emitter`. */
function wirePhases(emitter, report) {
  let current = null;
  const set = (next) => {
    if (current === 'downloaded' || current === next) return;
    current = next;
    report(next);
  };
  emitter.on('checking-for-update', () => set('checking'));
  emitter.on('update-available', () => set('downloading'));
  emitter.on('update-not-available', () => set('none'));
  emitter.on('update-downloaded', () => set('downloaded'));
  emitter.on('error', () => set('error'));
  return { fail: () => set('error') };
}

module.exports = { wirePhases };
