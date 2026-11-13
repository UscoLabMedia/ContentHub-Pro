import { Composition } from 'remotion';
import { PRESETS } from '@chp/core/presets';
import type { VideoSpec } from '@chp/core/schemas';
import { Piece } from './Piece.tsx';

const defaultProps: VideoSpec = {
  preset: 'tiktok',
  scenes: [
    { text: '¿Sabías que…?', durationSec: 3 },
    { text: 'Esto cambia cómo estudias en el Huila', durationSec: 5 },
    { text: 'Guarda y comparte', durationSec: 3 },
  ],
};

// One template for every platform: size and length come from the JSON spec (zero AI tokens).
export const Root = () => (
  <Composition
    id="Piece"
    component={Piece}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => {
      const p = PRESETS[props.preset] ?? PRESETS.tiktok!;
      const seconds = props.scenes.reduce((s, sc) => s + sc.durationSec, 0);
      return { width: p.width, height: p.height, fps: p.fps, durationInFrames: Math.max(1, Math.round(seconds * p.fps)) };
    }}
  />
);
