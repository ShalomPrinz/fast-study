// The app's own tokens (frontend/src/styles/tokens.css) and the video's fixed geometry.
export const COLOR = {
  bg: '#fbfbfd',
  surface: '#ffffff',
  text: '#17171f',
  text2: '#55596b',
  text3: '#8b8f9f',
  line: '#e8e9ef',
  ink: '#17171f',
  accent: '#4f5bd5',
  accentSoft: '#eef1fd',
  accentLine: '#d5daf7',
  accentOnDark: '#98b0ff',
  ok: '#3f9f6a',
  dark: '#1b1b26',
  darkRaise: '#2c2c3d',
  darkFg: '#d7d9e6',
  darkMuted: '#8a8fa3',
};
export const FONT = "'Heebo', sans-serif";
export const FPS = 30;
export const VIDEO = { width: 1920, height: 1080 };
// The app window and the chapter rail beside it, centred as one block; the rail takes the start side.
const WINDOW = { y: 34, width: 1456, height: 910 };
export const RAIL = 250;
const MARGIN = (VIDEO.width - WINDOW.width - RAIL) / 2;
export const frameOf = (dir) => ({ ...WINDOW, x: MARGIN + (dir === 'rtl' ? 0 : RAIL) });
// The layout every still was captured in, CSS px.
export const APP = { width: 1280, height: 800 };
