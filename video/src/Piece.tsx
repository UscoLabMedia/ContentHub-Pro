import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VideoSpec } from '@chp/core/schemas';

const DEFAULT_THEME = { bg: '#0f172a', fg: '#f8fafc', accent: '#6366f1' };

const Scene = ({ text, theme }: { text: string; theme: typeof DEFAULT_THEME }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const enter = interpolate(frame, [0, 0.4 * fps], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: theme.bg, justifyContent: 'center', padding: width * 0.08 }}>
      <div style={{ width: width * 0.12, height: 8, background: theme.accent, marginBottom: 40, opacity: enter }} />
      <div
        style={{
          color: theme.fg,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 700,
          fontSize: width * 0.075,
          lineHeight: 1.15,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 40}px)`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const Piece = ({ scenes, theme }: VideoSpec) => {
  const { fps } = useVideoConfig();
  const t = theme ?? DEFAULT_THEME;
  let from = 0;
  return (
    <AbsoluteFill>
      {scenes.map((s, i) => {
        const dur = Math.max(1, Math.round(s.durationSec * fps));
        const el = (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <Scene text={s.text} theme={t} />
          </Sequence>
        );
        from += dur;
        return el;
      })}
    </AbsoluteFill>
  );
};
