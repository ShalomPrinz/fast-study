// The launch screen's renderer. It reads one snapshot through the preload bridge and then re-renders
// on every push; the snapshot is what closes the race between this script running and main's first
// event, which would otherwise be sent to a page with no listener yet.

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
  actions: document.getElementById('actions'),
};

// A tool the boot probe could not run: the service is up and one feature of it is not, which is worth
// saying here and never worth failing a launch over.
function unusableTools(tools) {
  return Object.entries(tools ?? {})
    .filter(([, state]) => state !== 'ok')
    .map(([name, state]) => `${name} ${state}`);
}

function detailFor(service) {
  if (service.state === 'failed') return { text: service.error ?? 'failed' };
  if (service.state === 'starting') return { text: 'starting…' };
  if (service.state !== 'ready') return { text: '' };
  const broken = unusableTools(service.tools);
  return broken.length ? { text: broken.join(', '), warn: true } : { text: 'ready' };
}

function render(snapshot) {
  elements.services.replaceChildren(
    ...snapshot.services.map((service) => {
      const row = document.createElement('li');
      row.className = service.state;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = LABELS[service.name] ?? service.name;
      const { text, warn } = detailFor(service);
      const detail = document.createElement('span');
      detail.className = warn ? 'detail warn' : 'detail';
      detail.textContent = text;
      row.append(dot, label, detail);
      return row;
    }),
  );
  const failed = Boolean(snapshot.error);
  elements.sub.textContent = failed ? 'Fast Study could not start.' : 'Starting services…';
  elements.error.textContent = snapshot.error ?? '';
  elements.error.hidden = !failed;
  elements.log.textContent = failed ? `Details: ${snapshot.logFile}` : '';
  elements.log.hidden = !failed;
  elements.actions.hidden = !failed;
}

document.getElementById('retry').addEventListener('click', () => window.faststudy.boot.retry());
document.getElementById('quit').addEventListener('click', () => window.faststudy.boot.quit());

window.faststudy.boot.subscribe(render);
window.faststudy.boot.snapshot().then(render);
