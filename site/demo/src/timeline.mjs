// Every scene's place in the video, in frames at 30 fps; a scene fades in over the tail of the one before.
export const FADE = 12;
export const SCENES = {
  title: { from: 0, duration: 102 },
  download: { from: 90, duration: 392 },
  pipeline: { from: 470, duration: 542 },
  pdf: { from: 1000, duration: 362 },
  drive: { from: 1350, duration: 252 },
  end: { from: 1590, duration: 210 },
};
export const TOTAL = SCENES.end.from + SCENES.end.duration;
export const FLOWS = ['download', 'pipeline', 'pdf', 'drive'];

// When each caption comes up, in frames from the start of the video.
const at = (scene, local) => SCENES[scene].from + local;
export const CAPTIONS = [
  { key: 'download', from: at('download', 14) },
  { key: 'auto', from: at('pipeline', 6) },
  { key: 'audio', from: at('pipeline', 95) },
  { key: 'transcribe', from: at('pipeline', 150) },
  { key: 'summarize', from: at('pipeline', 245) },
  { key: 'export', from: at('pipeline', 340) },
  { key: 'ready', from: at('pipeline', 388) },
  { key: 'pdf', from: at('pdf', 6) },
  { key: 'drive', from: at('drive', 6) },
];
export const CAPTIONS_END = SCENES.end.from + FADE;
