import { resolveExtractor, resolveExtractorForRecording } from './registry.js';
import { postDownload, postDownloadYoutube } from '../http/serverClient.js';
import { parseZoomSummaries } from '../discovery/zoomSection.js';
import { classifyKind } from '../discovery/moodleCourse.js';
import { splitName } from '../lib/naming.js';

// Flatten the WS section tree into activities. `url` modules carry their external target
// in contents[].fileurl (YouTube/zoom/Drive/…) — the direct link the extractor expands,
// not the redirect view page. `resource`/unknown modTypes match no extractor → skipped.
function mapModules(sections) {
  const activities = [];
  for (const section of sections ?? []) {
    for (const module of section.modules ?? []) {
      activities.push({
        title: module.name,
        modType: module.modname,
        viewUrl: module.url,
        externalUrl: module.contents?.[0]?.fileurl,
        sectionName: section.name,
        kind: classifyKind(section.name, module.name),
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
 * videostream/zoom sniff the .mp4 fresh on the shared page; a youtube entry carries its
 * direct url (no navigation). See docs/BROWSING.md.
 * @param {import('playwright').Page|null} page  live shared page (null for youtube entries)
 * @param {{ recording: import('../extractors/VideoExtractor.js').Recording,
 *           course: string, name: string, kind: string, passcode?: string|null }} args
 *   passcode is looked up per course/lecture upstream; only the zoom path consumes it.
 */
export async function downloadRecording(page, { recording, course, name, kind, passcode }) {
  if (recording.strategy === 'youtube-playlist') {
    if (!recording.url) throw new Error('expand the playlist and download a specific entry');
    await postDownloadYoutube({ url: recording.url, course, lecture: name, kind });
    return;
  }
  const extractor = resolveExtractorForRecording(recording);
  if (!extractor) throw new Error(`no extractor for strategy ${recording.strategy}`);

  // Zoom yields 1-or-2 captures (before/after-break pair). Split into `<name>.1`/`<name>.2`
  // only when a distinct second .mp4 was captured; a lone recording keeps `<name>`.
  if (recording.strategy === 'zoom') {
    const caps = await extractor.captureVideo(page, recording, { passcode });
    const names = caps.length === 2 ? [splitName(name, 1), splitName(name, 2)] : [name];
    for (let i = 0; i < caps.length; i++) {
      await postDownload({ url: caps[i].url, headers: caps[i].headers, course, lecture: names[i], kind });
    }
    return;
  }

  const cap = await extractor.captureVideo(page, recording);
  await postDownload({ url: cap.url, headers: cap.headers, course, lecture: name, kind });
}
