import { resolveExtractor, resolveExtractorForRecording } from './registry.js';
import { postDownload, postDownloadFile, postDownloadYoutube } from '../http/serverClient.js';
import { assertPluginfileReadable, pluginfileUrl } from '../moodle/wsClient.js';
import { parseZoomSummaries } from '../discovery/zoomSection.js';
import { classifyKind } from '../discovery/moodleCourse.js';
import { probeDriveFile } from '../extractors/GoogleDriveExtractor.js';
import { UnsupportedError } from '../lib/errors.js';
import { splitName } from '../lib/naming.js';
import { cacheCap, getCap } from './replayCache.js';
import { stripTags } from '../lib/html.js';

// Flatten the WS section tree into activities. `url` modules carry their external target
// in contents[].fileurl (YouTube/zoom/Drive/…) — the direct link the extractor expands,
// not the redirect view page. A `resource` module is the one type that can hold SEVERAL
// files, so it yields one activity per file (each its own downloadable row); every other
// modType yields exactly one. Unknown modTypes match no extractor → skipped.
// Names arrive as HTML, so they're flattened before being displayed or keyword-matched.
function mapModules(sections) {
  const activities = [];
  for (const section of sections ?? []) {
    const sectionName = stripTags(section.name || '');
    for (const module of section.modules ?? []) {
      const title = stripTags(module.name || '');
      const base = { modType: module.modname, viewUrl: module.url, sectionName };
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

/**
 * LISTING PATH: enumerate a course's recordings from the stateless WS contents — no
 * browser needed. Merges module cards with zoom-share links parsed out of each
 * section summary, then routes each activity to its extractor. See docs/BROWSING.md.
 * @param {Array<{ name?: string, summary?: string, modules?: object[] }>} sections
 *   core_course_get_contents result
 * @returns {import('../extractors/VideoExtractor.js').Recording[]}
 */
export function listRecordings(sections) {
  const activities = [...mapModules(sections), ...parseZoomSummaries(sections)];
  const recordings = [];
  for (const activity of activities) {
    const extractor = resolveExtractor(activity);
    if (!extractor) continue; // non-PDF resource/non-recording url/unknown → skip
    for (const recording of extractor.toRecordings(activity)) recordings.push(recording);
  }
  return recordings;
}

// Invert splitName: '<base>.1'/'<base>.2' -> base; any other name is its own base. Used to
// recover the whole recording's base name from a single split target on `only` retry.
function baseName(name) {
  const m = /^(.*)\.[12]$/.exec(name);
  return m ? m[1] : name;
}

// Capture the whole recording fresh → [{ name, cap }] download targets, caching each.
// Zoom recordings yield `<name>.1`/`<name>.2`, so split only on a distinct second .mp4.
// Every other strategy yields one. `name` here is the BASE name the split derives from.
async function captureTargets(page, recording, extractor, { name, course, kind, passcode, ref }) {
  let targets;
  if (recording.strategy === 'zoom') {
    const caps = await extractor.captureVideo(page, recording, { passcode });
    const names = caps.length === 2 ? [splitName(name, 1), splitName(name, 2)] : [name];
    targets = caps.map((cap, i) => ({ name: names[i], cap }));
  } else {
    const cap = await extractor.captureVideo(page, recording);
    targets = [{ name, cap }];
  }
  for (const t of targets) cacheCap(course, t.name, kind, 'video', t.cap, ref);
  return targets;
}

// Every download target of a whole recording resolved from the cache, or null if any is
// missing — a partial hit still needs a fresh capture (one zoom share sniffs both clips).
function cachedTargets(recording, course, name, kind) {
  if (recording.strategy === 'zoom') {
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
  const hit = getCap(course, name, kind, 'video');
  return hit ? [{ name, cap: hit.cap }] : null;
}

/**
 * DOWNLOAD PATH (HTTP), no browser: the WS token turns the Moodle fileurl into a plain HTTP
 * URL that server/ fetches as one of the lecture's materials. Its own entry point because a
 * strategy that needs no browser must be handed its credential explicitly — folding it into
 * the capture dispatcher made every per-strategy secret look optional. Single target, so
 * there is no `only` semantics; the cap is just a `{url}`. See docs/BROWSING.md.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, wstoken: string,
 *           ref?: string|null, forceCapture?: boolean }} args
 *   wstoken is the caller's Moodle WS token — required; pluginfile authenticates by it.
 *   ref is the discovery-row id that spawned this download, stamped onto the server/ job.
 *   forceCapture = bypass the replay cache and re-resolve the url fresh.
 * @returns {Promise<string[]>} server/ job ids (one), followed on server/'s /events.
 */
export async function downloadMoodleFile({
  recording,
  course,
  name,
  kind,
  wstoken,
  ref,
  forceCapture = false,
}) {
  let cap = forceCapture ? null : getCap(course, name, kind, 'material')?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    const url = pluginfileUrl(recording.fileurl, wstoken);
    await assertPluginfileReadable(url);
    cap = { url };
    cacheCap(course, name, kind, 'material', cap, ref);
  }
  const jobId = await postDownloadFile({
    url: cap.url,
    course,
    lecture: name,
    kind,
    ref,
    fromCache,
  });
  return [jobId].filter(Boolean);
}

/**
 * DOWNLOAD PATH (HTTP), no browser: hand a specific expanded playlist entry (`url`) to yt-dlp
 * via server/. Single target, so there is no `only` semantics; the cap is just a `{url}`.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, ref?: string|null,
 *           forceCapture?: boolean }} args
 * @returns {Promise<string[]>} server/ job ids (one), followed on server/'s /events.
 */
export async function downloadYtDlp({ recording, course, name, kind, ref, forceCapture = false }) {
  let cap = forceCapture ? null : getCap(course, name, kind, 'video')?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    if (!recording.url) throw new Error('expand the playlist and download a specific entry');
    cap = { url: recording.url };
    cacheCap(course, name, kind, 'video', cap, ref);
  }
  const jobId = await postDownloadYoutube({
    url: cap.url,
    course,
    lecture: name,
    kind,
    ref,
    fromCache,
  });
  return [jobId].filter(Boolean);
}

/**
 * DOWNLOAD PATH (HTTP), no browser: a single Google Drive file. Its own entry point because it
 * is the one strategy whose media isn't known until it runs — the probe resolves the real
 * filename first and routes on its extension: a video goes to yt-dlp, a PDF becomes one of the
 * lecture's materials, anything else can never succeed and says so (422). Single target; the
 * cap is just a `{url}`, cached under the media that actually lands.
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, ref?: string|null,
 *           forceCapture?: boolean }} args
 * @returns {Promise<{ jobIds: string[], media: 'video'|'material' }>} server/ job ids (one),
 *   followed on server/'s /events, plus what the file turned out to be.
 */
export async function downloadDriveFile({
  recording,
  course,
  name,
  kind,
  ref,
  forceCapture = false,
}) {
  const { filename, media, downloadUrl } = await probeDriveFile(recording.pageUrl);
  if (!media) {
    const ext = filename.slice(filename.lastIndexOf('.'));
    throw new UnsupportedError(
      `Google Drive file is a ${ext}, not a video: ${recording.pageUrl}. Open it in a browser and download manually.`,
    );
  }
  let cap = forceCapture ? null : getCap(course, name, kind, media)?.cap;
  const fromCache = Boolean(cap);
  if (!cap) {
    // yt-dlp resolves the /file/d/ page itself; /download-file needs the direct-download URL.
    cap = { url: media === 'video' ? recording.pageUrl : downloadUrl };
    cacheCap(course, name, kind, media, cap, ref);
  }
  const post = media === 'video' ? postDownloadYoutube : postDownloadFile;
  const jobId = await post({ url: cap.url, course, lecture: name, kind, ref, fromCache });
  return { jobIds: [jobId].filter(Boolean), media };
}

/**
 * DOWNLOAD PATH (HTTP), browser capture: resolve one echoed-back recording on the live shared
 * page and hand its target(s) to server/. videostream/zoom sniff the .mp4 fresh; the no-browser
 * strategies have their own entry points above. Each resolved cap is kept in the session replay
 * cache (see replayCache.js) so a retry replays it without re-capturing. See docs/BROWSING.md.
 * @param {import('playwright').Page} page  live shared page
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, passcode?: string|null,
 *           ref?: string|null, only?: boolean, forceCapture?: boolean }} args
 *   passcode is looked up per course/lecture upstream; only the zoom path consumes it.
 *   ref is the discovery-row id that spawned this download — stamped onto every server/
 *   job so a zoom before/after-break split pair groups under the one parent row.
 *   only = operate on just the single (course,name,kind) target (name may be a zoom split
 *   name); forceCapture = bypass the cache and capture fresh.
 * @returns {Promise<string[]>} server/ job ids — one per started download (zoom's
 *   before/after-break pair yields two), followed on server/'s /events and resyncable
 *   via server/'s /jobs.
 */
export async function downloadRecording(
  page,
  { recording, course, name, kind, passcode, ref, only = false, forceCapture = false },
) {
  const extractor = resolveExtractorForRecording(recording);
  if (!extractor) throw new Error(`no extractor for strategy ${recording.strategy}`);

  const postCap = (cap, lecture, fromCache) =>
    postDownload({ url: cap.url, headers: cap.headers, course, lecture, kind, ref, fromCache });

  // `only`: operate on just the one requested (course,name,kind) target (name may be a zoom
  // split name). A cache hit is keyed directly by that name — no splitting needed.
  if (only) {
    if (!forceCapture) {
      const hit = getCap(course, name, kind, 'video');
      if (hit) return [await postCap(hit.cap, name, true)].filter(Boolean);
    }
    // Miss/force: one zoom share sniffs BOTH clips, so re-capture the whole recording (using
    // the inverted base name so the split matches) and keep only the cap for the request.
    const targets = await captureTargets(page, recording, extractor, {
      name: baseName(name),
      course,
      kind,
      passcode,
      ref,
    });
    const chosen =
      targets.find((t) => t.name === name) ?? (targets.length === 1 ? targets[0] : null);
    if (!chosen) throw new Error(`captured clips don't include ${name}`);
    return [await postCap(chosen.cap, chosen.name, false)].filter(Boolean);
  }

  // Whole recording. Replay from the cache when every resulting target is cached, else capture.
  const cached = forceCapture ? null : cachedTargets(recording, course, name, kind);
  const targets =
    cached ??
    (await captureTargets(page, recording, extractor, { name, course, kind, passcode, ref }));
  const fromCache = Boolean(cached);
  const jobIds = [];
  for (const t of targets) jobIds.push(await postCap(t.cap, t.name, fromCache));
  return jobIds.filter(Boolean);
}
