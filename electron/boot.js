// The launch screen's renderer: one snapshot, then a re-render on every push — see docs/BOOT.md.

const LABELS = {
  database: 'Database',
  backend: 'Pipeline',
  auto: 'Auto-downloader',
  server: 'Download server',
};

const elements = {
  sub: document.getElementById('sub'),
  services: document.getElementById('services'),
  error: document.getElementById('error'),
  log: document.getElementById('log'),
  update: document.getElementById('update'),
  actions: document.getElementById('actions'),
};

function detailFor(service) {
  if (service.state === 'failed') return service.error ?? 'failed';
  if (service.state === 'starting') return 'starting…';
  return service.state === 'ready' ? 'ready' : '';
}

// The failure view's update row; `icon` is a spinner while work is in flight, a mark when done.
const UPDATE_ROWS = {
  checking: { text: 'Checking for updates…', icon: 'spinner' },
  downloading: { text: 'Installing update…', icon: 'spinner' },
  none: { text: 'There is no update to install. Please contact us and report this issue.' },
  downloaded: {
    text: 'Update complete. Please close the app and open it again.',
    icon: 'mark',
    done: true,
  },
  error: {
    text: 'Could not check for updates. Check your internet connection, then close and reopen the app. If it keeps failing, please contact us and report this issue.',
  },
};

function renderUpdate(phase) {
  const row = UPDATE_ROWS[phase];
  elements.update.hidden = !row;
  elements.update.dataset.phase = phase ?? '';
  elements.update.classList.toggle('done', Boolean(row?.done));
  if (!row) return elements.update.replaceChildren();
  const text = document.createElement('span');
  text.textContent = row.text;
  const icon = row.icon && document.createElement('span');
  if (icon) {
    icon.className = row.icon;
    icon.textContent = row.icon === 'mark' ? '✓' : '';
  }
  elements.update.replaceChildren(...(icon ? [icon, text] : [text]));
}

function render(snapshot) {
  elements.services.replaceChildren(
    ...snapshot.services.map((service) => {
      const row = document.createElement('li');
      row.className = service.state;
      // Test ids are a contract with delivery/smoke/: raw service name and state, never display text.
      row.dataset.testid = 'boot-row';
      row.dataset.service = service.name;
      row.dataset.state = service.state;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = LABELS[service.name] ?? service.name;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = detailFor(service);
      row.append(dot, label, detail);
      return row;
    }),
  );
  const failed = Boolean(snapshot.error);
  elements.sub.textContent = failed ? 'FastStudy could not start.' : 'Starting services…';
  elements.error.textContent = snapshot.error ?? '';
  elements.error.hidden = !failed;
  elements.log.textContent = failed ? `Details: ${snapshot.logFile}` : '';
  elements.log.hidden = !failed;
  renderUpdate(failed ? snapshot.update : null);
  elements.actions.hidden = !failed;
}

document.getElementById('retry').addEventListener('click', () => window.faststudy.boot.retry());
document.getElementById('quit').addEventListener('click', () => window.faststudy.boot.quit());

window.faststudy.boot.subscribe(render);
window.faststudy.boot.snapshot().then(render);
