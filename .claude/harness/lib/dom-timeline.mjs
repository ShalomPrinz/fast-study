// An always-on DOM timeline for a browser session: a snapshot per document, then id-keyed diff
// batches pushed from the page, kept in a small ring and replayed into a scratch page on query, so
// any CSS selector can be asked about a moment whose nodes no longer exist.

// Nodes plus ops kept across all segments, and the age past which an old segment is dropped:
// harness sessions are short, and a long task has no use for a DOM history.
export const BUDGET = 20_000;
export const WINDOW_MS = 2 * 60_000;

/** Runs in every page as an init script; reports through the `__domTimeline` binding. */
export function recorder({ budget, windowMs }) {
  const send = window.__domTimeline;
  if (window !== window.top || typeof send !== 'function') return;
  const doc = `${performance.timeOrigin}-${Math.random().toString(36).slice(2, 8)}`;
  const ids = new WeakMap([[document, 0]]);
  let next = 1;
  let size = 0;
  // Bumped once per rendering opportunity, so a state that lived across no frame was never painted.
  let frame = 0;
  const tick = () => {
    frame++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const now = () => performance.timeOrigin + performance.now();
  const id = (node) => {
    if (!ids.has(node)) ids.set(node, next++);
    return ids.get(node);
  };
  const cut = (text) => (text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
  // Script and stylesheet text is bulk no selector asks about.
  const OPAQUE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
  const XHTML = 'http://www.w3.org/1999/xhtml';
  function serialize(node) {
    size++;
    if (node.nodeType === 3) return [id(node), '#text', cut(node.data)];
    if (node.nodeType === 8) return [id(node), '#comment', cut(node.data)];
    const attrs = {};
    for (const attr of node.attributes) attrs[attr.name] = cut(attr.value);
    const kids = OPAQUE.has(node.nodeName) ? [] : [...node.childNodes].filter(kept).map(serialize);
    const out = [id(node), node.localName, attrs, kids];
    if (node.namespaceURI !== XHTML) out.push(node.namespaceURI);
    return out;
  }
  const kept = (node) => node.nodeType === 1 || node.nodeType === 3 || node.nodeType === 8;
  const emit = (message) => {
    send({ doc, t: now(), frame, size, ...message }).catch(() => {});
    size = 0;
  };
  // Since the last snapshot. The page decides its own checkouts: one asked for from Node would
  // queue behind the very burst that made it due.
  let grown = 0;
  let taken = 0;
  const snapshot = () => {
    taken = now();
    emit({ url: location.href, snap: [...document.childNodes].filter(kept).map(serialize) });
    grown = 0;
  };

  const insideAdded = (node, added) => {
    for (let up = node.parentNode; up; up = up.parentNode) if (added.has(up)) return true;
    return false;
  };
  // Removals first, then each added subtree as it stands now, right to left so every insert's
  // next sibling is already known to the replay.
  function batch(records) {
    const ops = [];
    const added = new Set();
    const texts = new Set();
    const attrs = new Map();
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.removedNodes) if (ids.has(node)) ops.push(['-', ids.get(node)]);
        for (const node of record.addedNodes) added.add(node);
      } else if (record.type === 'characterData') texts.add(record.target);
      else {
        if (!attrs.has(record.target)) attrs.set(record.target, new Set());
        attrs.get(record.target).add(record.attributeName);
      }
    }
    const roots = [...added]
      .filter(
        (node) =>
          kept(node) &&
          node.isConnected &&
          ids.has(node.parentNode) &&
          !OPAQUE.has(node.parentNode.nodeName) &&
          !insideAdded(node, added),
      )
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1));
    for (const root of roots) {
      let before = root.nextSibling;
      while (before && !ids.has(before)) before = before.nextSibling;
      ops.push(['+', ids.get(root.parentNode), before ? ids.get(before) : null, serialize(root)]);
    }
    const live = (node) => node.isConnected && ids.has(node) && !insideAdded(node, added);
    for (const node of texts) if (live(node)) ops.push(['t', ids.get(node), cut(node.data)]);
    for (const [node, names] of attrs) {
      if (!live(node)) continue;
      for (const name of names) ops.push(['a', ids.get(node), name, node.getAttribute(name)]);
    }
    size += ops.length;
    if (!ops.length) return void (size = 0);
    grown += size;
    emit({ ops });
    if (grown > budget / 2 || taken < now() - windowMs / 2) snapshot();
  }
  const observer = new MutationObserver(batch);
  // A typed value or a ticked box is a property, never a mutation.
  const onInput = (event) => {
    batch(observer.takeRecords());
    const el = event.target;
    if (!ids.has(el)) return;
    const value = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    size++;
    emit({ ops: [['v', ids.get(el), value]] });
  };
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onInput, true);
  snapshot();
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
}

/** The kept segments, one per snapshot, trimmed to the budget and window as messages arrive. */
export function createStore({ budget = BUDGET, windowMs = WINDOW_MS, clock = Date.now } = {}) {
  const segments = [];
  const total = () => segments.reduce((sum, segment) => sum + segment.size, 0);
  let docs = 0;
  /** Add one message, then drop what is past the budget or the window. */
  function take(message) {
    const { doc, t, frame, size, url, snap, ops } = message;
    if (snap) {
      const same = segments.at(-1)?.doc === doc;
      segments.push({
        doc,
        n: same ? docs : ++docs,
        url,
        t,
        frame,
        snap,
        batches: [],
        size,
        end: t,
      });
    } else {
      const current = segments.at(-1);
      // A batch from a document that has already been replaced, sent as it unloaded.
      if (current?.doc !== doc) return;
      current.batches.push({ t, frame, ops });
      current.size += size;
      current.end = t;
    }
    const now = clock();
    while (segments.length > 1 && (total() > budget || segments[1].t < now - windowMs))
      segments.shift();
  }
  return { segments, take, total };
}

/** Runs in the scratch page: rebuild each segment, and after every batch read what `selector` matches. */
export function replay({ segments, selector, attr, until, html }) {
  const states = [];
  let found = null;
  for (const segment of segments) {
    const doc = document.implementation.createHTMLDocument('');
    doc.removeChild(doc.documentElement);
    const nodes = new Map([[0, doc]]);
    const ids = new WeakMap();
    const build = ([id, tag, data, kids, ns]) => {
      let node;
      if (tag === '#text') node = doc.createTextNode(data);
      else if (tag === '#comment') node = doc.createComment(data);
      else {
        node = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag);
        for (const [name, value] of Object.entries(data)) {
          try {
            node.setAttribute(name, value);
          } catch {
            // A name the parser took and setAttribute refuses; the rest of the node still counts.
          }
        }
        for (const kid of kids) node.appendChild(build(kid));
      }
      nodes.set(id, node);
      ids.set(node, id);
      return node;
    };
    const apply = ([kind, id, a, b]) => {
      const node = nodes.get(id);
      if (!node) return;
      if (kind === '-') node.remove();
      else if (kind === '+') {
        const before = a == null ? null : nodes.get(a);
        node.insertBefore(build(b), before?.parentNode === node ? before : null);
      } else if (kind === 't') node.data = a;
      else if (kind === 'a') {
        if (b === null) node.removeAttribute(a);
        else node.setAttribute(a, b);
      } else if (kind === 'v') {
        if (typeof a === 'boolean') node.checked = a;
        else node.value = a;
      }
    };
    const FORM = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
    const read = (t, frame) => {
      const matches = [...doc.querySelectorAll(selector)].map((el) => ({
        id: ids.get(el),
        text: (FORM.has(el.nodeName)
          ? String(el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value)
          : el.textContent
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120),
        ...(attr ? { attr: el.getAttribute(attr) } : {}),
      }));
      states.push({ t, frame, doc: segment.n, url: segment.url, matches });
    };
    for (const tuple of segment.snap) {
      try {
        doc.appendChild(build(tuple));
      } catch {
        // A second document element: the snapshot raced the parser, the next batch has it.
      }
    }
    read(segment.t, segment.frame);
    for (const batch of segment.batches) {
      if (until != null && batch.t > until) break;
      for (const op of batch.ops) {
        try {
          apply(op);
        } catch {
          // One op the rebuilt tree cannot take must not end the replay.
        }
      }
      read(batch.t, batch.frame);
    }
    if (html) found = [...doc.querySelectorAll(selector)].map((el) => el.outerHTML);
  }
  return { states, html: found };
}

/** ISO, epoch ms, or negative ms back from now. */
export function parseTime(value, now = Date.now()) {
  if (value == null || value === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    return n < 0 ? now + n : n;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`not a time: ${value}`);
  return parsed;
}

// What a state looks like to a reader, ids aside: a remount keeps it, a change does not.
const shape = (state) => JSON.stringify(state.matches.map(({ text, attr }) => [text, attr]));
const sameIds = (a, b) => a.matches.map((m) => m.id).join() === b.matches.map((m) => m.id).join();

/** Only the states that differ from the one before, from the last one at or before `since`. */
export function changes(states, since) {
  const out = states.filter((state, i) => {
    const prev = states[i - 1];
    return !prev || prev.doc !== state.doc || shape(prev) !== shape(state) || !sameIds(prev, state);
  });
  if (since == null) return out;
  const start = out.findLastIndex((state) => state.t <= since);
  return out.slice(Math.max(start, 0));
}

/** A state left and come back to within `maxMs`: each transient run, painted if a frame passed. */
export function flickers(states, maxMs) {
  const runs = [];
  // Remounts aside: a flicker is what a reader could have seen change.
  const steps = changes(states).filter(
    (state, i, all) =>
      i === 0 || all[i - 1].doc !== state.doc || shape(all[i - 1]) !== shape(state),
  );
  for (let i = 1; i < steps.length; i++) {
    const before = steps[i - 1];
    for (let j = i + 1; j < steps.length && steps[j].t - steps[i].t <= maxMs; j++) {
      if (steps[j].doc !== before.doc) break;
      if (shape(steps[j]) !== shape(before)) continue;
      runs.push({
        from: steps[i].t,
        to: steps[j].t,
        painted: steps[j].frame > steps[i].frame,
        steady: before,
        transient: steps.slice(i, j),
      });
      i = j;
      break;
    }
  }
  return runs;
}

const iso = (t) => new Date(t).toISOString();
const describe = (state) =>
  state.matches.length
    ? state.matches
        .map(
          (m) =>
            `#${m.id} ${JSON.stringify(m.text)}${'attr' in m ? ` [${JSON.stringify(m.attr)}]` : ''}`,
        )
        .join(' | ')
    : 'absent';

/** One line per change, naming a remount and a new page. */
export function formatHistory(steps) {
  return steps
    .map((state, i) => {
      const prev = steps[i - 1];
      const note =
        prev && prev.doc !== state.doc
          ? ` (new page ${state.url})`
          : prev && shape(prev) === shape(state)
            ? ' (remount)'
            : '';
      return `${iso(state.t)} f${state.frame} ${state.matches.length}× ${describe(state)}${note}`;
    })
    .join('\n');
}

export function formatFlickers(runs) {
  if (!runs.length) return 'no flicker';
  return runs
    .map(
      (run) =>
        `${iso(run.from)} ${Math.round(run.to - run.from)} ms ${run.painted ? 'painted' : 'never painted'}: ` +
        `${describe(run.steady)} → ${run.transient.map(describe).join(' → ')} → back`,
    )
    .join('\n');
}

/** Record `page` into a fresh store, and answer queries by replaying it in a scratch context. */
export async function recordDom(browser, context, page) {
  const store = createStore();
  // The binding first: Playwright runs init scripts in registration order.
  await context.exposeBinding('__domTimeline', (source, message) => {
    if (source.page === page) store.take(message);
  });
  await context.addInitScript(recorder, { budget: BUDGET, windowMs: WINDOW_MS });

  // Its own context, so the recorder never runs in it and /eval's `context.pages()` never sees it.
  let scratch;
  const replayed = async (query) => {
    scratch ??= await browser.newContext().then((c) => c.newPage());
    return scratch.evaluate(replay, query);
  };
  // Every segment that still runs at or after `from`.
  const kept = (from) =>
    store.segments.filter((_, i, all) => from == null || (all[i + 1]?.t ?? Infinity) >= from);
  return {
    summary() {
      const { segments } = store;
      if (!segments.length) return 'nothing recorded yet';
      const pages = new Set(segments.map((s) => s.doc)).size;
      return `recording since ${iso(segments[0].t)}, ${pages} page(s), ${store.total()} of ${BUDGET} kept`;
    },
    async history({ selector, attr, since }) {
      const from = parseTime(since);
      const { states } = await replayed({ selector, attr, segments: kept(from) });
      return formatHistory(changes(states, from));
    },
    async at({ t, selector }) {
      const until = parseTime(t) ?? Date.now();
      const segment = store.segments.findLast((s) => s.t <= until);
      if (!segment) return `nothing recorded at ${iso(until)}`;
      const query = { segments: [segment], selector: selector ?? 'body', until, html: true };
      const { html } = await replayed(query);
      return html.length ? html.join('\n') : 'absent';
    },
    async flicker({ selector, attr, maxMs, since }) {
      const from = parseTime(since);
      const { states } = await replayed({ selector, attr, segments: kept(from) });
      return formatFlickers(flickers(changes(states, from), Number(maxMs ?? 300)));
    },
  };
}
