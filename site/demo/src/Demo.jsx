import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import enShots from '../public/footage/en/manifest.json';
import heShots from '../public/footage/he/manifest.json';
import { EndCard, PosterCard, TitleCard } from './Cards.jsx';
import { Backdrop, Caption, ChapterRail } from './Chrome.jsx';
import { Download, Drive, Pdf, Pipeline } from './Scenes.jsx';
import en from './strings/en.json';
import he from './strings/he.json';
import { FPS } from './theme.mjs';
import { FADE, SCENES, TOTAL } from './timeline.mjs';

// Everything a language changes: its strings (direction included) and its footage.
const LANGS = { he: { strings: he, footage: heShots }, en: { strings: en, footage: enShots } };
const WEIGHTS = [400, 500, 700, 800];
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
// The music sits under the picture: a short fade in, two seconds out.
const LEVEL = 0.45;

// A scene on its stretch of the timeline, faded in over the scene before it.
function Scene({ name, children }) {
  const frame = useCurrentFrame();
  const { from, duration } = SCENES[name];
  const opacity = interpolate(frame, [from, from + FADE], [0, 1], clamp);
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <AbsoluteFill style={{ opacity: from === 0 ? 1 : opacity }}>
        {children(frame - from)}
      </AbsoluteFill>
    </Sequence>
  );
}

// No frame renders before Heebo has loaded in every weight the video sets, Hebrew included.
function useHeebo() {
  const [handle] = useState(() => delayRender('Heebo'));
  useEffect(() => {
    Promise.all(
      WEIGHTS.map((weight) =>
        document.fonts.load(`${weight} 40px Heebo`, `${he.tagline} ${en.tagline}`),
      ),
    ).then(() => continueRender(handle));
  }, [handle]);
}

// The still the page shows before the video plays.
export function Poster({ lang }) {
  useHeebo();
  return <PosterCard strings={LANGS[lang].strings} />;
}

export function Demo({ lang }) {
  const frame = useCurrentFrame();
  const { strings, footage } = LANGS[lang];
  const { shots, sheet } = footage;
  useHeebo();

  const flows = { from: SCENES.download.from, until: SCENES.end.from + FADE };
  return (
    <AbsoluteFill style={{ background: '#1b1b26' }}>
      <Audio
        src={staticFile('music.mp3')}
        volume={(f) =>
          LEVEL *
          interpolate(f, [0, 0.5 * FPS], [0, 1], clamp) *
          interpolate(f, [TOTAL - 2 * FPS, TOTAL - 2], [1, 0], clamp)
        }
      />
      <Scene name="title">{(local) => <TitleCard strings={strings} frame={local} />}</Scene>
      <Sequence from={flows.from} durationInFrames={flows.until - flows.from} layout="none">
        <AbsoluteFill
          style={{ opacity: interpolate(frame, [flows.from, flows.from + FADE], [0, 1], clamp) }}
        >
          <Backdrop />
          <ChapterRail strings={strings} frame={frame} />
        </AbsoluteFill>
      </Sequence>
      <Scene name="download">
        {(local) => <Download lang={lang} dir={strings.dir} shots={shots} frame={local} />}
      </Scene>
      <Scene name="pipeline">
        {(local) => <Pipeline lang={lang} dir={strings.dir} shots={shots} frame={local} />}
      </Scene>
      <Scene name="pdf">
        {(local) => <Pdf lang={lang} dir={strings.dir} shots={shots} sheet={sheet} frame={local} />}
      </Scene>
      <Scene name="drive">
        {(local) => <Drive lang={lang} dir={strings.dir} shots={shots} frame={local} />}
      </Scene>
      <Caption strings={strings} frame={frame} />
      <Scene name="end">{(local) => <EndCard strings={strings} frame={local} />}</Scene>
    </AbsoluteFill>
  );
}
