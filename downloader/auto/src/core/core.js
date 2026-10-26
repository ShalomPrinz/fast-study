import { resolveExtractor, resolveExtractorForRecording } from './registry.js';
import { toolFor, toTarget } from './targets.js';
import {
  assertPluginfileReadable,
  pluginfileUrl,
  getCourseModule,
  getVideostreamContent,
  getSiteInfo,
  WsError,
} from '../moodle/wsClient.js';
import { parseZoomSummaries } from '../discovery/zoomSection.js';
import { classifyKind } from '../discovery/moodleCourse.js';
import { probeDriveFile } from '../extractors/GoogleDriveExtractor.js';
import { probeUrl } from '../lib/probeUrl.js';
import { CodedError, UnsupportedError } from '../lib/errors.js';
import { splitName } from '../lib/naming.js';
import { cacheCap, getCap } from './replayCache.js';
import { stripTags } from '../lib/html.js';
import { proxyCap } from '../moodle/files.js';
import { onMoodleHost } from '../moodle/site.js';

// Flatten the WS section tree into activities: one per module, except a `resource`, which yields
// one per file. Names arrive as HTML and are flattened first. See docs/BROWSING.md.
function mapModules(sections, courseId) {
  const activities = [];
  for (const section of sections ?? []) {
    const sectionName = stripTags(section.name || '');
    for (const module of section.modules ?? []) {
      const title = stripTags(module.name || '');
      const base = { modType: module.modname, viewUrl: module.url, sectionName, courseId };
      if (module.modname === 'resource') {
        const files = (module.contents ?? []).filter((c) => c.type === 'file');
        for (const file of files) {
          // Only a multi-file resource needs the filename to tell its rows apart; a
          // single-file one would just read "1-Git — 1-Git.pdf".
          const fileTitle = files.length > 1 ? `${title} — ${file.filename}` : title;
          activities.push({
            ...base,
            title: fileTitle,
            fileurl: file.fileurl,
            filename: file.filename,
            mimetype: file.mimetype,
            kind: classifyKind(sectionName, fileTitle),
          });
        }
        continue;
      }
      activities.push({
        ...base,
        title,
        externalUrl: module.contents?.[0]?.fileurl,
        kind: classifyKind(sectionName, title),
      });
    }
  }
  return activities;
}

// One activity per assignment file (`introattachments` + `introfiles`, any mimetype, deduped by
// fileurl). `cmid` joins the contents' module `id` for the section; no match → '' (hidden module).
function mapAssignments(sections, assignmentsAnswer, courseId) {
  const sectionOf = new Map();
  for (const section of sections ?? []) {
    for (const module of section.modules ?? [])
      sectionOf.set(String(module.id), stripTags(section.name || ''));
  }
  const activities = [];
  for (const course of assignmentsAnswer?.courses ?? []) {
    for (const assign of course.assignments ?? []) {
      const assignment = stripTags(assign.name || '');
      const sectionName = sectionOf.get(String(assign.cmid)) ?? '';
      const seen = new Set();
      for (const file of [...(assign.introattachments ?? []), ...(assign.introfiles ?? [])]) {
        if (!file.fileurl || seen.has(file.fileurl)) continue;
        seen.add(file.fileurl);
        activities.push({
          modType: 'assign',
          title: `${assignment} — ${file.filename}`,
          assignment,
          fileurl: file.fileurl,
          filename: file.filename,
          mimetype: file.mimetype,
          sectionName,
          courseId,
          kind: 'lecture', // not meaningful for an assignment file
        });
      }
    }
  }
  return activities;
}

/**
 * LISTING PATH: enumerate a course's recordings from the stateless WS contents — no
 * browser needed. Merges module cards with zoom-share links parsed out of each
 * section summary, then routes each activity to its extractor. See docs/BROWSING.md.
 * @param {Array<{ name?: string, summary?: string, modules?: object[] }>} sections
 *   core_course_get_contents result
 * @param {string} [courseId]  the listed course, carried on a videostream row for its resolve
 * @param {object} [assignmentsAnswer]  mod_assign_get_assignments result, absent when the site refuses it
 * @returns {import('../extractors/VideoExtractor.js').Recording[]}
 */
export function listRecordings(sections, courseId, assignmentsAnswer) {
  const activities = [
    ...mapModules(sections, courseId),
    ...parseZoomSummaries(sections),
    ...mapAssignments(sections, assignmentsAnswer, courseId),
  ];
  const recordings = [];
  for (const activity of activities) {
    const extractor = resolveExtractor(activity);
    if (!extractor) continue; // video, audio or HTML resource / non-http url target / unknown modType → skip
    for (const recording of extractor.toRecordings(activity)) recordings.push(recording);
  }
  return recordings;
}

/**
 * core_enrol_get_users_courses → the picker's rows, sorted by name. `name` is `fullname`, never
 * `displayname`, which some sites prefix with the code; `code` is `shortname`. `past`: hidden from
 * the user, or its end date has gone by — the picker sets those apart rather than dropping them.
 * @returns {Array<{ id: number, name: string, code: string|null, url: string, past: boolean }>}
 */
export function toCourses(courses, site, now = Date.now()) {
  return (courses ?? [])
    .map((c) => ({
      id: c.id,
      name: stripTags(c.fullname || ''),
      code: String(c.shortname ?? '').trim() || null,
      url: `${site}/course/view.php?id=${c.id}`,
      past: !!c.hidden || c.visible === 0 || (c.enddate > 0 && c.enddate * 1000 < now),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A filename's extension without its dot, or null when it has none — `link_not_a_video`'s `ext`,
// where null means the link served a web page rather than a file.
function extOf(filename) {
  const dot = filename ? filename.lastIndexOf('.') : -1;
  return dot > 0 ? filename.slice(dot + 1) : null;
}

// Invert splitName: '<base>.1'/'<base>.2' -> base; any other name is its own base. Used to
// recover the whole recording's base name from a single split target on `only` retry.
function baseName(name) {
  const m = /^(.*)\.[12]$/.exec(name);
  return m ? m[1] : name;
}

// Capture the zoom share fresh → [{ name, cap }], caching each. `name` is the BASE name: a share
// with a distinct second .mp4 yields `<name>.1`/`<name>.2`, anything else one.
async function captureTargets(
  page,
  recording,
  extractor,
  { name, course, kind, passcode, ref, onCaptchaSolved },
) {
  const caps = await extractor.captureVideo(page, recording, { passcode, onCaptchaSolved });
  const names = caps.length === 2 ? [splitName(name, 1), splitName(name, 2)] : [name];
  const targets = caps.map((cap, i) => ({ name: names[i], cap }));
  for (const t of targets) cacheCap(course, t.name, kind, 'video', t.cap, ref);
  return targets;
}

// Every download target of a whole zoom share resolved from the cache, or null if any is
// missing — a partial hit still needs a fresh capture (one share sniffs both clips).
function cachedTargets(course, name, kind) {
  const single = getCap(course, name, kind, 'video');
  if (single) return [{ name, cap: single.cap }];
  const c1 = getCap(course, splitName(name, 1), kind, 'video');
  const c2 = getCap(course, splitName(name, 2), kind, 'video');
  if (c1 && c2)
    return [
      { name: splitName(name, 1), cap: c1.cap },
      { name: splitName(name, 2), cap: c2.cap },
    ];
  return null;
}

/**
 * RESOLVE PATH (HTTP), no browser: preflight the Moodle file with the WS token, then hand server/
 * a path on auto that streams it (`GET /moodle/file/:id`), never the tokened URL. See docs/GATE.md.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, wstoken: string,
 *           ref?: string|null, forceCapture?: boolean }} args
 *   wstoken is the caller's Moodle WS token — required; pluginfile authenticates by it.
 *   ref is the discovery-row id that spawned this download, stamped onto the cached cap.
 *   forceCapture = bypass the replay cache and re-resolve the url fresh.
 * @returns {Promise<object[]>} one download target for server/ to run.
 */
export async function resolveMoodleFile({
  recording,
  course,
  name,
  kind,
  wstoken,
  ref,
  forceCapture = false,
}) {
  // Several files share one lecture/assignment name, so the fileurl tells them apart in the cache.
  const key = `${name}\u001f${recording.fileurl}`;
  const media = recording.assignment ? 'assignment' : 'material';
  let cap = forceCapture ? null : getCap(course, key, kind, media)?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    const size = await assertPluginfileReadable(pluginfileUrl(recording.fileurl, wstoken));
    cap = proxyCap({ fileurl: recording.fileurl, size });
    cacheCap(course, key, kind, media, cap, ref);
  }
  const target = toTarget({ name, cap, tool: toolFor(recording.strategy), fromCache });
  // The original name rides to server/, which hands it to the database for the disk extension.
  return [recording.filename ? { ...target, filename: recording.filename } : target];
}

// The first `<source … type="video/mp4">` of the handler's templates, `&amp;` decoded, or null;
// `types` collects every source type seen, for the refusal's prose.
function mp4Source(content, types) {
  for (const { html } of content?.templates ?? []) {
    for (const [tag] of String(html ?? '').matchAll(/<source\b[^>]*>/gi)) {
      const type = /\btype="([^"]*)"/i.exec(tag)?.[1] ?? '';
      const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1];
      types.push(type || '(none)');
      if (type.toLowerCase() !== 'video/mp4' || !src) continue;
      const url = src.replaceAll('&amp;', '&');
      try {
        const u = new URL(url);
        if (u.protocol === 'https:' && u.pathname.toLowerCase().endsWith('.mp4')) return url;
      } catch {}
    }
  }
  return null;
}

// Moodle answers both an expired token and a function outside the token's service with
// `accessexception`, so site info decides: a live token lacking the function is the site's refusal.
async function refusedVideostream(err, site, wstoken) {
  if (!(err instanceof WsError) || err.errorcode !== 'accessexception') throw err;
  const info = await getSiteInfo(site, wstoken);
  if ((info?.functions ?? []).some((f) => f.name === 'tool_mobile_get_content')) throw err;
  throw new UnsupportedError(
    'moodle_site_unsupported',
    { site, reason: 'videostream_unavailable' },
    `${site} cannot resolve videostream: its token service lacks tool_mobile_get_content`,
  );
}

/**
 * RESOLVE PATH (HTTP), no browser: a videostream module's .mp4, read from the page mod_videostream's
 * Moodle-app handler renders (one gated WS call, plus one for a row listed with no `courseId`).
 * An off-site .mp4 is a public file, so the target is a plain curl URL. See docs/MOODLE.md § Videostream.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, site: string,
 *           token: { wstoken: string, userid: number },
 *           ref?: string|null, forceCapture?: boolean }} args
 * @returns {Promise<object[]>} one download target for server/ to run.
 */
export async function resolveVideostream({
  recording,
  course,
  name,
  kind,
  site,
  token,
  ref,
  forceCapture = false,
}) {
  let cap = forceCapture ? null : getCap(course, name, kind, 'video')?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    const cmid = new URL(recording.pageUrl).searchParams.get('id');
    const courseid =
      recording.courseId ?? (await getCourseModule(site, token.wstoken, cmid)).cm?.course;
    const content = await getVideostreamContent(site, token.wstoken, {
      courseid,
      cmid,
      userid: token.userid,
    }).catch((err) => refusedVideostream(err, site, token.wstoken));
    const types = [];
    const url = mp4Source(content, types);
    if (!url)
      throw new CodedError(
        'videostream_no_mp4',
        { url: recording.pageUrl },
        `${recording.pageUrl} has no MP4 source (found: ${types.join(', ') || 'none'})`,
      );
    // A site that hosts the .mp4 itself gets it streamed through auto, under the gate (docs/GATE.md).
    cap = onMoodleHost(url) ? proxyCap({ url }) : { url, headers: [] };
    cacheCap(course, name, kind, 'video', cap, ref);
  }
  return [toTarget({ name, cap, tool: 'curl', fromCache })];
}

/**
 * RESOLVE PATH (HTTP), no browser: hand a specific expanded playlist entry (`url`) to yt-dlp
 * via server/. Single target, so there is no `only` semantics; the cap is just a `{url}`.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, ref?: string|null,
 *           forceCapture?: boolean }} args
 * @returns {Promise<object[]>} one download target for server/ to run.
 */
export async function resolveYtDlp({ recording, course, name, kind, ref, forceCapture = false }) {
  let cap = forceCapture ? null : getCap(course, name, kind, 'video')?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    if (!recording.url) throw new Error('expand the playlist and download a specific entry');
    cap = { url: recording.url };
    cacheCap(course, name, kind, 'video', cap, ref);
  }
  return [toTarget({ name, cap, tool: toolFor(recording.strategy), fromCache })];
}

/**
 * RESOLVE PATH (HTTP), no browser: a single Google Drive file, routed by its probed filename
 * (video → yt-dlp, else 422). `forceCapture` also re-probes. See docs/BROWSING.md.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, ref?: string|null,
 *           forceCapture?: boolean }} args
 * @returns {Promise<{ targets: object[], media: 'video' }>} one download target,
 *   plus what the file turned out to be.
 */
export async function resolveDriveFile({
  recording,
  course,
  name,
  kind,
  ref,
  forceCapture = false,
}) {
  const { filename, media } = await probeDriveFile(recording.pageUrl, {
    force: forceCapture,
  });
  if (!media) {
    const ext = filename.slice(filename.lastIndexOf('.'));
    throw new UnsupportedError(
      'link_not_a_video',
      { source: 'drive', url: recording.pageUrl, ext: extOf(filename) },
      `Google Drive file is a ${ext}, not a video: ${recording.pageUrl}. Open it in a browser and download manually.`,
    );
  }
  let cap = forceCapture ? null : getCap(course, name, kind, media)?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    // yt-dlp resolves the /file/d/ page itself, so the cap keeps the page URL.
    cap = { url: recording.pageUrl };
    cacheCap(course, name, kind, media, cap, ref);
  }
  const tool = toolFor(recording.strategy);
  return { targets: [toTarget({ name, cap, tool, fromCache })], media };
}

// `probeUrl`'s verdict on a link, or its coded refusal when the link is no file → { media, size,
// finalUrl }. Shared by a listed link and a pasted one, so both refuse with the same codes.
async function probeLink(url, force) {
  const { media, filename, certain, reason, size, finalUrl } = await probeUrl(url, { force });
  if (media) return { media, filename, size, finalUrl };
  if (!certain)
    throw new CodedError(
      'link_probe_inconclusive',
      { url },
      `couldn't read what ${url} is — the host didn't answer usefully`,
    );
  if (reason === 'missing')
    throw new UnsupportedError(
      'link_dead',
      { url },
      `${url} no longer exists — the host says the link is dead. Check the course page for a new one.`,
    );
  throw notAVideo(url, filename);
}

// `link_not_a_video` for a link whose file (or page) isn't a video. A CDN path can name the file
// without an extension ('…/asset'), so slice only on a real dot.
function notAVideo(url, filename) {
  const ext = extOf(filename);
  const what = ext ? `a ${ext} file, not a video` : 'a web page, not a file';
  return new UnsupportedError(
    'link_not_a_video',
    { source: 'link', url, ext },
    `${url} is ${what}. Open it in a browser and download manually.`,
  );
}

// A manual-form link → one video target: off the Moodle host yt-dlp with no network call, on it a
// fresh probe and a proxied curl target. Never the replay cache — nothing stable keys it (GATE.md).
export async function resolvePastedLink({ url, name }) {
  if (!onMoodleHost(url))
    return [toTarget({ name, cap: { url }, tool: toolFor('direct-url'), fromCache: false })];
  const { media, filename, size } = await probeLink(url, true);
  if (media !== 'video') throw notAVideo(url, filename);
  return [toTarget({ name, cap: proxyCap({ url, size }), tool: 'curl', fromCache: false })];
}

/**
 * RESOLVE PATH (HTTP), no browser: any other off-site link, routed by `probeUrl`. An uncertain
 * verdict is a plain Error (500, row stays clickable), never a 422. See docs/BROWSING.md.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, ref?: string|null,
 *           forceCapture?: boolean }} args
 * @returns {Promise<{ targets: object[], media: 'video' }>} one download target,
 *   plus what the link turned out to be.
 */
export async function resolveDirectUrl({
  recording,
  course,
  name,
  kind,
  ref,
  forceCapture = false,
}) {
  const url = recording.pageUrl;
  const { media, size, finalUrl } = await probeLink(url, forceCapture);
  let cap = forceCapture ? null : getCap(course, name, kind, media)?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    // A file on the Moodle host, or one a redirect lands there, is Moodle traffic: auto streams it
    // (docs/GATE.md), following the same redirects under the lock.
    const moodle = onMoodleHost(url) || (finalUrl && onMoodleHost(finalUrl));
    cap = moodle ? proxyCap({ url, size }) : { url };
    cacheCap(course, name, kind, media, cap, ref);
  }
  // A proxied video is one plain file on auto, which curl fetches; yt-dlp has no use for it.
  const tool = cap.proxied ? 'curl' : toolFor(recording.strategy);
  return { targets: [toTarget({ name, cap, tool, fromCache })], media };
}

/**
 * RESOLVE PATH (HTTP), browser capture (zoom): one echoed-back recording on the shared page → its
 * target(s), each cap kept in the replay cache. See docs/BROWSING.md.
 * @param {import('playwright').Page} page  live shared page
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, passcode?: string|null,
 *           ref?: string|null, only?: boolean, forceCapture?: boolean,
 *           onCaptchaSolved?: () => void }} args
 *   passcode is looked up per course/lecture upstream; onCaptchaSolved: see ZoomExtractor.
 *   ref is the discovery-row id that spawned this download — cached with every cap so a zoom
 *   before/after-break split pair groups under the one parent row.
 *   only = operate on just the single (course,name,kind) target (name may be a zoom split
 *   name); forceCapture = bypass the cache and capture fresh.
 * @returns {Promise<object[]>} one download target per .mp4 (zoom's before/after-break pair
 *   yields two), each `{ name, tool:'curl', url, headers, fromCache }`.
 */
export async function resolveRecording(
  page,
  {
    recording,
    course,
    name,
    kind,
    passcode,
    ref,
    only = false,
    forceCapture = false,
    onCaptchaSolved,
  },
) {
  const extractor = resolveExtractorForRecording(recording);
  if (!extractor) throw new Error(`no extractor for strategy ${recording.strategy}`);

  const replayed = replayRecording({ recording, course, name, kind, only, forceCapture });
  if (replayed) return replayed;
  const tool = toolFor(recording.strategy);

  if (only) {
    // Miss/force: one zoom share sniffs BOTH clips, so re-capture the whole recording (using
    // the inverted base name so the split matches) and keep only the cap for the request.
    const captured = await captureTargets(page, recording, extractor, {
      name: baseName(name),
      course,
      kind,
      passcode,
      ref,
      onCaptchaSolved,
    });
    const chosen =
      captured.find((t) => t.name === name) ?? (captured.length === 1 ? captured[0] : null);
    if (!chosen)
      throw new CodedError('zoom_clip_missing', { name }, `captured clips don't include ${name}`);
    return [toTarget({ name: chosen.name, cap: chosen.cap, tool, fromCache: false })];
  }

  // Whole recording, not fully cached: capture it.
  const targets = await captureTargets(page, recording, extractor, {
    name,
    course,
    kind,
    passcode,
    ref,
    onCaptchaSolved,
  });
  return targets.map((t) => toTarget({ name: t.name, cap: t.cap, tool, fromCache: false }));
}

// A zoom share's targets from the replay cache, or null when it must be captured. `only`: just the
// one named target (a zoom split name keys the cache directly); else the whole share, every target cached.
function replayRecording({ recording, course, name, kind, only = false, forceCapture = false }) {
  if (forceCapture) return null;
  const tool = toolFor(recording.strategy);
  if (only) {
    const hit = getCap(course, name, kind, 'video');
    return hit ? [toTarget({ name, cap: hit.cap, tool, fromCache: true })] : null;
  }
  const cached = cachedTargets(course, name, kind);
  return cached
    ? cached.map((t) => toTarget({ name: t.name, cap: t.cap, tool, fromCache: true }))
    : null;
}
