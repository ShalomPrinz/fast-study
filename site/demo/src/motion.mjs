// Eased keyframe tracks for the camera and the cursor, and the boxes they aim at.
import { Easing, interpolate } from 'remotion';
import { APP } from './theme.mjs';

const ease = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

export const progress = (frame, from, to, easing = ease) =>
  interpolate(frame, [from, to], [0, 1], { ...clamp, easing });

// `keys[0]` is where the value rests; each later key moves every field there between `from` and `to`.
export function track(frame, keys) {
  let value = keys[0].value;
  for (const key of keys.slice(1)) {
    const p = progress(frame, key.from, key.to);
    if (p === 0) break;
    value = Object.fromEntries(
      Object.keys(value).map((k) => [k, value[k] + (key.value[k] - value[k]) * p]),
    );
  }
  return value;
}

export const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
export const FULL = { x: 0, y: 0, ...APP };

// The window-shaped rect around `box` with `pad` CSS px around it, kept inside `bounds`; a box
// too tall for it keeps its top.
export function fit(box, pad = 40, bounds = FULL) {
  const aspect = APP.width / APP.height;
  let width = box.width + 2 * pad;
  let height = box.height + 2 * pad;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  const cut = width > bounds.width;
  if (cut) {
    width = bounds.width;
    height = width / aspect;
  }
  const x = box.x + box.width / 2 - width / 2;
  const y = cut ? box.y - pad : box.y + box.height / 2 - height / 2;
  return {
    x: Math.min(Math.max(bounds.x, x), bounds.x + bounds.width - width),
    y: Math.min(Math.max(bounds.y, y), bounds.y + bounds.height - height),
    width,
    height,
  };
}
