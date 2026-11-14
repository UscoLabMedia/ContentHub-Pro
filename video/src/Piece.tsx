import { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VideoSpec } from '@chp/core/schemas';
import { DEFAULT_STYLE, heroNumber, type StyleProfile } from '@chp/core/style';
import './fonts.ts';
import { musicGain, normalizeMix, speechWindows } from '@chp/core/music';
import { heroStartSec, segmentCount } from '@chp/core/rhythm';
import { captionsOf, fontInfo, isUserFont } from '@chp/core/subtitles';
import { Art, Background, Broll, Hero, Karaoke, Motif, Particles, camTransform, camera } from './visual.tsx';

export const styleOf = (spec: { style?: unknown; theme?: VideoSpec['theme'] }): StyleProfile => {
  if (spec.style) return spec.style as StyleProfile;
  const t = spec.theme;
  return t ? { ...DEFAULT_STYLE, palette: { bg: t.bg, fg: t.fg, accent: t.accent, accent2: t.accent } } : DEFAULT_STYLE;
};

/** Closing "Fuentes" card: title line + one source per line, left aligned and calm. */
export const Card = ({ text, style }: { text: string; style: StyleProfile }) => {
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
  // A long scene is divided into equal segments (a change every ~5 s): a new camera move and a new arrangement of the layers, so nothing stays still.
  const segs = segmentCount(durationInFrames / fps);
  const segLen = durationInFrames / segs;
  const seg = Math.min(segs - 1, Math.floor(frame / segLen));
  const segFrame = frame - seg * segLen;
  const cam = segs > 1 ? camera(index + seg, segFrame, segLen, style.motion, style.cameraPattern) : camera(index, frame, durationInFrames, style.motion, style.cameraPattern);
  // A zoom hit that decays in ~9 frames: on every key word (beat) and, lighter, at each automatic change.
  const hit = (since: number) => (since >= 0 && since < 9 ? (1 - since / 9) ** 2 : 0);
  const beat = Math.max(0, ...(scene.beats ?? []).map((tb) => hit(frame - Math.round(tb * fps))));
  const cut = seg > 0 ? hit(segFrame) : 0;
  // Z-axis transition: arrives from far away, leaves toward the camera.
  const inP = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const outP = interpolate(frame, [durationInFrames - 8, durationInFrames], [0, 1], { extrapolateLeft: 'clamp' });
  const zoom = (0.9 + 0.1 * inP) * (1 + 0.08 * outP) * (1 + 0.05 * beat + 0.035 * cut);
  const hero = heroNumber(scene.text);
  const heroAt = hero ? heroStartSec(scene) : null;
  const heroFrame = heroAt === null ? 4 : Math.max(4, Math.round(heroAt * fps) - 3); // the number appears as the voice says it
  return (
    <AbsoluteFill style={{ opacity: inP * (1 - outP), transform: `scale(${zoom})`, filter: `blur(${(1 - inP) * 6 + outP * 5}px)`, overflow: 'hidden', background: style.palette.bg }}>
      {scene.audioUrl && <Audio src={scene.audioUrl} />}
      {scene.broll ? (
        <div style={{ position: 'absolute', inset: 0, transform: `${camTransform(cam, 0.6)} scale(1.12)` }}>
          <Broll broll={scene.broll} style={style} durationInFrames={durationInFrames} fps={fps} />
        </div>
      ) : (
        <>
          <div style={{ position: 'absolute', inset: 0, transform: camTransform(cam, 0.6) }}>
            <Background style={style} frame={frame} index={index} width={width} height={height} />
          </div>
          <div style={{ position: 'absolute', inset: 0, transform: camTransform(cam, 1.5) }}>
            <div style={{ position: 'absolute', inset: 0, opacity: seg > 0 ? Math.min(1, segFrame / 6) : 1 }}><Motif style={style} frame={frame} index={index + seg * 17} width={width} height={height} /></div>
          </div>
        </>
      )}
      {scene.art && <Art art={scene.art} style={style} frame={frame} fps={fps} width={width} height={height} hasHero={!!hero} />}
      {hero && <Hero hero={hero} style={style} frame={frame} fps={fps} width={width} height={height} startFrame={heroFrame} />}
      <Particles style={style} frame={frame} index={index + 7} width={width} height={height} />
      <Karaoke text={scene.text} style={style} frame={frame} fps={fps} speechSec={scene.speechSec} wordTimes={scene.wordTimes} durationSec={scene.durationSec} width={width} height={height} index={index} />
    </AbsoluteFill>
  );
};

/** Waits until the subtitle font (bundled or uploaded by the person) is ready before any frame is drawn. */
export const useSubtitleFonts = (style: StyleProfile, fonts: VideoSpec['fonts']) => {
  const [handle] = useState(() => delayRender('subtitle fonts'));
  useEffect(() => {
    const cap = captionsOf(style);
    const load = async () => {
      for (const f of fonts ?? []) {
        const face = new FontFace(f.family, `url(${f.url})`, { weight: '700' });
        document.fonts.add(await face.load());
      }
      const q = isUserFont(cap.font) ? `700 40px 'user-${cap.font.slice(5)}'` : `${fontInfo(cap.font).weight} 40px ${fontInfo(cap.font).family.split(',')[0]}`;
      await document.fonts.load(q, 'Aá');
    };
    load().catch(() => {}).finally(() => continueRender(handle));
  }, [handle, style, fonts]);
};

export const Piece = (spec: VideoSpec) => {
  const { fps } = useVideoConfig();
  const style = styleOf(spec);
  useSubtitleFonts(style, spec.fonts);
  const mix = spec.music ? normalizeMix(spec.music) : null;
  const win = speechWindows(spec.scenes.map((s) => ({ durationSec: s.durationSec, speechSec: s.speechSec, card: s.card })));
  let from = 0;
  return (
    <AbsoluteFill style={{ background: style.palette.bg }}>
      {spec.music && mix && <Audio src={spec.music.url} loop loopVolumeCurveBehavior="extend" volume={(f) => musicGain(f / fps, win, mix)} />}
      {spec.sfx && <Audio src={spec.sfx.url} />}
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
