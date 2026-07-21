import { resolveExtractor, resolveExtractorForRecording } from './registry.js';
import { postDownload, postDownloadYoutube } from '../http/serverClient.js';
import { parseZoomSummaries } from '../discovery/zoomSection.js';
import { classifyKind } from '../discovery/moodleCourse.js';
import { assertPubliclyShared } from '../extractors/GoogleDriveExtractor.js';
import { splitName } from '../lib/naming.js';
import { stripTags } from '../lib/html.js';

// Flatten the WS section tree into activities. `url` modules carry their external target
// in contents[].fileurl (YouTube/zoom/Drive/…) — the direct link the extractor expands,
// not the redirect view page. `resource`/unknown modTypes match no extractor → skipped.
// Names arrive as HTML, so they're flattened before being displayed or keyword-matched.
function mapModules(sections) {
  const activities = [];
  for (const section of sections ?? []) {
    const sectionName = stripTags(section.name || '');
    for (const module of section.modules ?? []) {
      const title = stripTags(module.name || '');
      activities.push({
        title,
        modType: module.modname,
        viewUrl: module.url,
        externalUrl: module.contents?.[0]?.fileurl,
        sectionName,
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
    if (!extractor) continue; // resource/non-recording url/unknown → skip
    for (const recording of extractor.toRecordings(activity)) recordings.push(recording);
  }
  return recordings;
}

/**
 * DOWNLOAD PATH (HTTP): resolve one echoed-back recording and hand it to server/.
 * videostream/zoom sniff the .mp4 fresh on the shared page; youtube/google-drive carry a
 * direct url yt-dlp resolves (no navigation). See docs/BROWSING.md.
 * @param {import('playwright').Page|null} page  live shared page (null for yt-dlp strategies)
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, passcode?: string|null }} args
 *   passcode is looked up per course/lecture upstream; only the zoom path consumes it.
 * @returns {Promise<string[]>} server/ job ids — one per started download (zoom's
 *   before/after-break pair yields two), followed on server/'s /events and resyncable
 *   via server/'s /jobs.
 */
export async function downloadRecording(page, { recording, course, name, kind, passcode }) {
  // yt-dlp strategies: no browser, no capture. A youtube entry must be a specific
  // expanded playlist entry (`url`); a Drive file downloads straight from its `pageUrl`,
  // preflighted so a non-public file fails as 422 rather than silently in server/'s job.
  if (recording.strategy === 'youtube-playlist' || recording.strategy === 'google-drive') {
    let url = recording.pageUrl;
    if (recording.strategy === 'youtube-playlist') {
      if (!recording.url) throw new Error('expand the playlist and download a specific entry');
      url = recording.url;
    } else {
      await assertPubliclyShared(url);
    }
    const jobId = await postDownloadYoutube({ url, course, lecture: name, kind });
    return [jobId].filter(Boolean);
  }
  const extractor = resolveExtractorForRecording(recording);
  if (!extractor) throw new Error(`no extractor for strategy ${recording.strategy}`);

  // Zoom yields 1-or-2 captures (before/after-break pair). Split into `<name>.1`/`<name>.2`
  // only when a distinct second .mp4 was captured; a lone recording keeps `<name>`.
  if (recording.strategy === 'zoom') {
    const caps = await extractor.captureVideo(page, recording, { passcode });
    const names = caps.length === 2 ? [splitName(name, 1), splitName(name, 2)] : [name];
    const jobIds = [];
    for (let i = 0; i < caps.length; i++) {
      jobIds.push(await postDownload({ url: caps[i].url, headers: caps[i].headers, course, lecture: names[i], kind }));
    }
    return jobIds.filter(Boolean);
  }

  const cap = await extractor.captureVideo(page, recording);
  const jobId = await postDownload({ url: cap.url, headers: cap.headers, course, lecture: name, kind });
  return [jobId].filter(Boolean);
}
