import { Img, staticFile } from 'remotion';
import { progress } from './motion.mjs';
import { APP, COLOR, frameOf } from './theme.mjs';

const CROSSFADE = 8;

// The app inside a rounded, shadowed frame: the stills of one screen stacked in the app's own
// CSS-px space, seen through `camera` (a rect of that space), with the cursor drawn above.
export function AppWindow({ lang, dir, shots, frame, base, states, camera, cursor }) {
  const FRAME = frameOf(dir);
  const zoom = FRAME.width / camera.width;
  // The state on screen and the one it fades in over; earlier ones are fully covered.
  const started = states.filter((state) => state.from <= frame).slice(-2);
  return (
    <div
      style={{
        position: 'absolute',
        left: FRAME.x,
        top: FRAME.y,
        width: FRAME.width,
        height: FRAME.height,
        borderRadius: 20,
        overflow: 'hidden',
        background: COLOR.bg,
        boxShadow:
          '0 50px 110px rgba(23, 23, 31, 0.24), 0 12px 30px rgba(23, 23, 31, 0.1), 0 0 0 1px rgba(23, 23, 31, 0.08)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: APP.width,
          height: APP.height,
          transformOrigin: '0 0',
          transform: `scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
        }}
      >
        <Still lang={lang} shot={shots[base]} opacity={1} />
        {started.map((state) => (
          <Still
            key={state.shot}
            lang={lang}
            shot={shots[state.shot]}
            opacity={progress(frame, state.from, state.from + CROSSFADE)}
          />
        ))}
      </div>
      {cursor && <Cursor {...cursor} camera={camera} zoom={zoom} frame={frame} />}
    </div>
  );
}

function Still({ lang, shot, opacity }) {
  const { x, y, width, height } = shot.rect;
  return (
    <Img
      src={staticFile(`footage/${lang}/${shot.file}`)}
      style={{ position: 'absolute', left: x, top: y, width, height, opacity }}
    />
  );
}

// A drawn pointer at an app-space point; `click` is the frame it presses, with a ripple after it.
function Cursor({ x, y, opacity, click, camera, zoom, frame }) {
  const left = (x - camera.x) * zoom;
  const top = (y - camera.y) * zoom;
  const since = click === undefined ? -1 : frame - click;
  const press = since >= -4 && since < 8 ? 1 - 0.14 * (1 - Math.abs(since - 2) / 6) : 1;
  const ripple = since >= 0 && since < 24 ? since / 24 : null;
  return (
    <div style={{ position: 'absolute', left, top, opacity }}>
      {ripple !== null && (
        <div
          style={{
            position: 'absolute',
            left: -60,
            top: -60,
            width: 120,
            height: 120,
            borderRadius: '50%',
            border: `5px solid ${COLOR.accent}`,
            background: 'rgba(79, 91, 213, 0.16)',
            transform: `scale(${0.25 + 0.75 * (1 - (1 - ripple) ** 3)})`,
            opacity: 1 - ripple,
          }}
        />
      )}
      <svg
        width="46"
        height="46"
        viewBox="0 0 24 24"
        style={{
          position: 'absolute',
          left: -8,
          top: -5,
          transform: `scale(${press})`,
          transformOrigin: '8px 5px',
          filter: 'drop-shadow(0 4px 6px rgba(23, 23, 31, 0.35))',
        }}
      >
        <path
          d="M5 3l14 7.5-6.2 1.7-2.4 6.3z"
          fill="#fff"
          stroke={COLOR.ink}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
