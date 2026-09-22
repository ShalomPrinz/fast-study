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
  actions: document.getElementById('actions'),
};

// A tool the boot probe could not run costs one feature, never the launch. A usable tool is the
// bare string 'ok'; anything else is lib/tools' {state, params}, whose `state` is the reason.
function unusableTools(tools) {
  return Object.entries(tools ?? {})
    .filter(([, result]) => result !== 'ok')
    .map(([name, result]) => `${name} ${result?.state ?? result}`);
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
      // Test ids are a contract with delivery/smoke/: raw service name and state, never display text.
      row.dataset.testid = 'boot-row';
      row.dataset.service = service.name;
      row.dataset.state = service.state;
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
