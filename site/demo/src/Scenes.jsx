import { Img, staticFile } from 'remotion';
import { FULL, center, fit, progress, track } from './motion.mjs';
import { APP, COLOR, frameOf } from './theme.mjs';
import { AppWindow } from './Window.jsx';

const lerp = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });

// Flow 1: the wide Downloads page, a push in on the recording's card, the click, the bar advancing.
export function Download({ lang, dir, shots, frame }) {
  const { rect, boxes } = shots['download-0'];
  const { card, button } = boxes;
  // Nothing under the next section's card is ever framed: the list below it is the course's other rows.
  const floor = card.y + card.height + 216;
  const pane = { ...rect, height: floor };
  // The window down to that floor, as wide as its shape allows, the sidebar's side kept whole.
  const width = (floor * APP.width) / APP.height;
  const wide = { x: rect.x === 0 ? APP.width - width : 0, y: 0, width, height: floor };
  const close = fit({ ...card, y: card.y - 40, height: card.height + 110 }, 60, pane);
  const camera = track(frame, [
    { value: wide },
    { from: 34, to: 84, value: close },
    { from: 300, to: 392, value: fit(close, 46, pane) },
  ]);
  const rest = { x: card.x + card.width / 2, y: card.y + card.height + 150 };
  const cursor = lerp(rest, center(button), progress(frame, 72, 116));
  const leave = progress(frame, 136, 170);
  return (
    <AppWindow
      lang={lang}
      dir={dir}
      shots={shots}
      frame={frame}
      base="downloads-window"
      states={[
        { shot: 'download-0', from: 0 },
        { shot: 'download-1', from: 126 },
        { shot: 'download-2', from: 162 },
        { shot: 'download-3', from: 196 },
        { shot: 'download-4', from: 230 },
        { shot: 'download-5', from: 264 },
        { shot: 'download-done', from: 300 },
      ]}
      camera={camera}
      cursor={{
        x: cursor.x,
        y: cursor.y + leave * 90,
        opacity: progress(frame, 60, 74) * (1 - leave),
        click: 120,
      }}
    />
  );
}

// Flow 2: the lecture's steps card, one captured state per step, ending on the finished lecture.
export function Pipeline({ lang, dir, shots, frame }) {
  const done = shots.finished.boxes;
  // The page beside the dark panes, as wide as the window, its top just above the steps card.
  const page = (shot) => {
    const { x, width } = shots[shot].rect;
    return {
      x,
      y: shots[shot].boxes.steps.y - 40,
      width,
      height: (width * APP.height) / APP.width,
    };
  };
  const camera = track(frame, [
    { value: FULL },
    { from: 32, to: 82, value: page('pipeline-idle') },
    { from: 334, to: 352, value: page('pipeline-pdf') },
    { from: 392, to: 452, value: fit(done.column, 30, shots.finished.rect) },
  ]);
  return (
    <AppWindow
      lang={lang}
      dir={dir}
      shots={shots}
      frame={frame}
      base="lecture-window"
      states={[
        { shot: 'pipeline-idle', from: 0 },
        { shot: 'pipeline-audio', from: 95 },
        { shot: 'pipeline-transcribe-1', from: 150 },
        { shot: 'pipeline-transcribe-2', from: 198 },
        { shot: 'pipeline-summarize-1', from: 245 },
        { shot: 'pipeline-summarize-2', from: 293 },
        { shot: 'pipeline-pdf', from: 340 },
        { shot: 'finished', from: 388 },
      ]}
      camera={camera}
    />
  );
}

// Flow 3: the finished lecture's PDF preview, opened, then the PDF itself as a sheet panned downwards.
export function Pdf({ lang, dir, shots, sheet, frame }) {
  const { rect, boxes } = shots.finished;
  const { column, pdf, openPdf } = boxes;
  const camera = track(frame, [
    { value: fit(column, 30, rect) },
    { from: 14, to: 58, value: fit({ ...pdf, height: 300 }, 36, rect) },
  ]);
  const cursor = lerp(center(pdf), center(openPdf), progress(frame, 40, 78));
  const FRAME = frameOf(dir);
  const open = progress(frame, 92, 112);
  const height = (FRAME.width / sheet.width) * sheet.height;
  const pan = progress(frame, 130, 345) * Math.max(0, height - FRAME.height);
  return (
    <>
      <AppWindow
        lang={lang}
        dir={dir}
        dir={dir}
        shots={shots}
        frame={frame}
        base="finished-window"
        states={[{ shot: 'finished', from: 0 }]}
        camera={camera}
        cursor={{ ...cursor, opacity: progress(frame, 30, 42), click: 84 }}
      />
      <div
        style={{
          position: 'absolute',
          left: FRAME.x,
          top: FRAME.y,
          width: FRAME.width,
          height: FRAME.height,
          borderRadius: 20,
          overflow: 'hidden',
          background: COLOR.surface,
          opacity: open,
          transform: `scale(${0.94 + 0.06 * open})`,
          boxShadow:
            '0 50px 110px rgba(23, 23, 31, 0.24), 0 12px 30px rgba(23, 23, 31, 0.1), 0 0 0 1px rgba(23, 23, 31, 0.08)',
        }}
      >
        <Img
          src={staticFile(`footage/${sheet.file}`)}
          style={{ position: 'absolute', left: 0, top: -pan, width: FRAME.width, height }}
        />
      </div>
    </>
  );
}

// Flow 4: the finished lecture's header, the camera and cursor closing in on its Drive control.
export function Drive({ lang, dir, shots, frame }) {
  const { rect, boxes } = shots.finished;
  const { column, drive, header, actions } = boxes;
  // The whole header — title, state and the three buttons — from just above the title down.
  const width = actions.width + 28;
  const view = {
    x: actions.x - 14,
    y: header.y + 14,
    width,
    height: (width * APP.height) / APP.width,
  };
  const camera = track(frame, [
    { value: fit(column, 30, rect) },
    { from: 16, to: 62, value: fit(header, 0, rect) },
    { from: 84, to: 150, value: view },
  ]);
  const rest = { x: header.x + header.width / 2, y: header.y + header.height + 90 };
  const cursor = lerp(rest, center(drive), progress(frame, 70, 122));
  return (
    <AppWindow
      lang={lang}
      dir={dir}
      shots={shots}
      frame={frame}
      base="finished-window"
      states={[{ shot: 'finished', from: 0 }]}
      camera={camera}
      cursor={{ ...cursor, opacity: progress(frame, 60, 74), click: 130 }}
    />
  );
}
