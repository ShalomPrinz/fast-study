import '@fontsource/heebo/400.css';
import '@fontsource/heebo/500.css';
import '@fontsource/heebo/700.css';
import '@fontsource/heebo/800.css';
import { Composition } from 'remotion';
import { Demo } from './Demo.jsx';
import { FPS, VIDEO } from './theme.mjs';
import { TOTAL } from './timeline.mjs';

export function Root() {
  return (
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={TOTAL}
      fps={FPS}
      width={VIDEO.width}
      height={VIDEO.height}
      defaultProps={{ lang: 'he' }}
    />
  );
}
