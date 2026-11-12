import { AbsoluteFill, Img, spring } from 'remotion';
import icon from '../../img/icon.svg';
import { progress } from './motion.mjs';
import { COLOR, FONT, FPS } from './theme.mjs';

function Dark({ children, dir }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1100px 800px at 50% 38%, #343a78 0%, rgba(52, 58, 120, 0) 70%), radial-gradient(900px 700px at 88% 100%, #2a2f66 0%, rgba(42, 47, 102, 0) 70%), ${COLOR.dark}`,
        fontFamily: FONT,
        direction: dir,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

const rise = (frame, from) => {
  const p = progress(frame, from, from + 16);
  return { opacity: p, transform: `translateY(${(1 - p) * 26}px)` };
};

function Brand({ strings, frame, size }) {
  const pop = spring({ frame, fps: FPS, config: { damping: 14, stiffness: 120 } });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3, direction: 'ltr' }}>
      <Img
        src={icon}
        style={{
          width: size,
          height: size,
          transform: `scale(${pop})`,
          filter: 'drop-shadow(0 24px 50px rgba(79, 91, 213, 0.55))',
        }}
      />
      <div
        style={{
          fontSize: size * 0.82,
          fontWeight: 800,
          color: '#fff',
          letterSpacing: -2,
          ...rise(frame, 6),
        }}
      >
        {strings.name}
      </div>
    </div>
  );
}

export function TitleCard({ strings, frame }) {
  return (
    <Dark dir={strings.dir}>
      <Brand strings={strings} frame={frame} size={190} />
      <div
        style={{
          marginTop: 64,
          fontSize: 56,
          fontWeight: 500,
          color: COLOR.darkFg,
          ...rise(frame, 20),
        }}
      >
        {strings.tagline}
      </div>
    </Dark>
  );
}

export function EndCard({ strings, frame }) {
  return (
    <Dark dir={strings.dir}>
      <Brand strings={strings} frame={frame} size={150} />
      <div
        style={{
          marginTop: 70,
          height: 112,
          padding: '0 70px',
          borderRadius: 56,
          display: 'flex',
          alignItems: 'center',
          background: COLOR.accent,
          color: '#fff',
          fontSize: 54,
          fontWeight: 700,
          boxShadow: '0 22px 50px rgba(79, 91, 213, 0.45)',
          ...rise(frame, 22),
        }}
      >
        {strings.end.cta}
      </div>
      <div style={{ marginTop: 30, fontSize: 36, color: COLOR.darkMuted, ...rise(frame, 30) }}>
        {strings.end.note}
      </div>
      <div
        style={{
          marginTop: 56,
          fontSize: 50,
          fontWeight: 500,
          color: COLOR.accentOnDark,
          direction: 'ltr',
          ...rise(frame, 40),
        }}
      >
        {strings.end.url}
      </div>
    </Dark>
  );
}
