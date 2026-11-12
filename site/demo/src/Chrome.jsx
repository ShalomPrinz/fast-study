import { AbsoluteFill, Img } from 'remotion';
import icon from '../../img/icon.svg';
import { progress } from './motion.mjs';
import { COLOR, FONT, RAIL, frameOf } from './theme.mjs';
import { CAPTIONS, CAPTIONS_END, FLOWS, SCENES } from './timeline.mjs';

// The designed backdrop the app window sits on.
export function Backdrop() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(900px 700px at 12% 8%, #dfe4fb 0%, rgba(223, 228, 251, 0) 70%), radial-gradient(1000px 800px at 92% 96%, #d9def9 0%, rgba(217, 222, 249, 0) 70%), linear-gradient(135deg, ${COLOR.accentSoft} 0%, #f6f7fe 50%, #e9ecfb 100%)`,
      }}
    />
  );
}

// The four flows as numbered stops down the start-side margin, the one on screen lit.
export function ChapterRail({ strings, frame }) {
  const FRAME = frameOf(strings.dir);
  const rtl = strings.dir === 'rtl';
  const active = FLOWS.findLast((flow) => SCENES[flow].from <= frame) ?? FLOWS[0];
  return (
    <div
      style={{
        position: 'absolute',
        top: FRAME.y,
        height: FRAME.height,
        width: RAIL,
        left: rtl ? FRAME.x + FRAME.width : FRAME.x - RAIL,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 44,
        direction: strings.dir,
        fontFamily: FONT,
      }}
    >
      <Img src={icon} style={{ width: 76, height: 76, marginBottom: 30 }} />
      {FLOWS.map((flow, i) => {
        const past = FLOWS.indexOf(active) > i;
        const level =
          flow === active ? progress(frame, SCENES[flow].from, SCENES[flow].from + 14) : 0;
        return (
          <div
            key={flow}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
                fontWeight: 700,
                color: level > 0.5 ? '#fff' : past ? COLOR.accent : COLOR.text3,
                background: level > 0.5 ? COLOR.accent : COLOR.surface,
                border: `2px solid ${level > 0.5 || past ? COLOR.accent : COLOR.accentLine}`,
                transform: `scale(${1 + 0.14 * level})`,
                boxShadow: level > 0.5 ? '0 10px 24px rgba(79, 91, 213, 0.35)' : 'none',
              }}
            >
              {i + 1}
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: level > 0.5 ? 700 : 500,
                color: level > 0.5 ? COLOR.text : COLOR.text3,
              }}
            >
              {strings.chapters[flow]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One caption at a time in the strip under the window, each rising in as the one before fades.
export function Caption({ strings, frame }) {
  const index = CAPTIONS.findLastIndex((caption) => caption.from <= frame);
  if (index < 0) return null;
  const { key, from } = CAPTIONS[index];
  const until = CAPTIONS[index + 1]?.from ?? CAPTIONS_END;
  const enter = progress(frame, from, from + 10);
  const leave = progress(frame, until - 6, until);
  const FRAME = frameOf(strings.dir);
  return (
    <div
      style={{
        position: 'absolute',
        left: FRAME.x,
        width: FRAME.width,
        top: FRAME.y + FRAME.height + 22,
        height: 84,
        display: 'flex',
        justifyContent: 'center',
        opacity: enter * (1 - leave),
        transform: `translateY(${(1 - enter) * 18}px)`,
      }}
    >
      <div
        style={{
          height: 84,
          padding: '0 46px',
          borderRadius: 42,
          display: 'flex',
          alignItems: 'center',
          background: COLOR.ink,
          color: '#fff',
          fontFamily: FONT,
          fontSize: 40,
          fontWeight: 500,
          direction: strings.dir,
          whiteSpace: 'nowrap',
          boxShadow: '0 14px 34px rgba(23, 23, 31, 0.28)',
        }}
      >
        {strings.captions[key]}
      </div>
    </div>
  );
}
