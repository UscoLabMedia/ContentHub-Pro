import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VideoSpec } from '@chp/core/schemas';
import { DEFAULT_STYLE, heroNumber, type StyleProfile } from '@chp/core/style';
import { Background, Hero, Karaoke, Motif, Particles, camTransform, camera } from './visual.tsx';

const styleOf = (spec: VideoSpec): StyleProfile => {
  if (spec.style) return spec.style as StyleProfile;
  const t = spec.theme;
  return t ? { ...DEFAULT_STYLE, palette: { bg: t.bg, fg: t.fg, accent: t.accent, accent2: t.accent } } : DEFAULT_STYLE;
};

/** Closing "Fuentes" card: title line + one source per line, left aligned and calm. */
const Card = ({ text, style }: { text: string; style: StyleProfile }) => {
  const { width, height } = useVideoConfig();
  const [title, ...lines] = text.split('\n');
  const size = width * (height > width ? 0.05 : 0.026);
  return (
    <AbsoluteFill style={{ background: style.palette.bg, justifyContent: 'center', padding: width * 0.08, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ width: width * 0.12, height: 8, background: style.palette.accent, marginBottom: size }} />
      <div style={{ color: style.palette.accent, fontSize: size * 1.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 4, marginBottom: size * 0.8 }}>{title}</div>
      {lines.map((l, i) => (
        <div key={i} style={{ color: style.palette.fg, fontSize: size, fontWeight: 600, lineHeight: 1.5, opacity: 0.92 }}>{l}</div>
      ))}
    </AbsoluteFill>
  );
};

const Scene = ({ scene, index, style }: { scene: VideoSpec['scenes'][number]; index: number; style: StyleProfile }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const cam = camera(index, frame, durationInFrames, style.motion, style.cameraPattern);
  // Z-axis transition: arrives from far away, leaves toward the camera.
  const inP = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const outP = interpolate(frame, [durationInFrames - 8, durationInFrames], [0, 1], { extrapolateLeft: 'clamp' });
  const zoom = (0.9 + 0.1 * inP) * (1 + 0.08 * outP);
  const hero = heroNumber(scene.text);
  return (
    <AbsoluteFill style={{ opacity: inP * (1 - outP), transform: `scale(${zoom})`, filter: `blur(${(1 - inP) * 6 + outP * 5}px)`, overflow: 'hidden', background: style.palette.bg }}>
      {scene.audioUrl && <Audio src={scene.audioUrl} />}
      <div style={{ position: 'absolute', inset: 0, transform: camTransform(cam, 0.6) }}>
        <Background style={style} frame={frame} index={index} width={width} height={height} />
      </div>
      <div style={{ position: 'absolute', inset: 0, transform: camTransform(cam, 1.5) }}>
        <Motif style={style} frame={frame} index={index} width={width} height={height} />
      </div>
      {hero && <Hero hero={hero} style={style} frame={frame} fps={fps} width={width} height={height} />}
      <Particles style={style} frame={frame} index={index + 7} width={width} height={height} />
      <Karaoke text={scene.text} style={style} frame={frame} fps={fps} speechSec={scene.speechSec} durationSec={scene.durationSec} width={width} height={height} />
    </AbsoluteFill>
  );
};

export const Piece = (spec: VideoSpec) => {
  const { fps } = useVideoConfig();
  const style = styleOf(spec);
  let from = 0;
  return (
    <AbsoluteFill style={{ background: style.palette.bg }}>
      {spec.scenes.map((s, i) => {
        const dur = Math.max(1, Math.round(s.durationSec * fps));
        const el = (
          <Sequence key={i} from={from} durationInFrames={dur}>
            {s.card ? <Card text={s.text} style={style} /> : <Scene scene={s} index={i} style={style} />}
          </Sequence>
        );
        from += dur;
        return el;
      })}
    </AbsoluteFill>
  );
};
