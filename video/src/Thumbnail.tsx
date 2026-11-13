import { AbsoluteFill } from 'remotion';

export type ThumbnailProps = {
  title: string;
  subtitle?: string;
  theme: { bg: string; fg: string; accent: string };
};

/** 1280×720 YouTube thumbnail: big readable title, accent shapes, optional kicker. */
export const Thumbnail = ({ title, subtitle, theme }: ThumbnailProps) => {
  const len = title.length;
  const size = len <= 24 ? 128 : len <= 44 ? 100 : len <= 70 ? 78 : 62;
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -160, top: -160, width: 620, height: 620, borderRadius: '50%', background: theme.accent, opacity: 0.9 }} />
      <div style={{ position: 'absolute', right: 120, bottom: -140, width: 360, height: 360, borderRadius: '50%', border: `18px solid ${theme.fg}`, opacity: 0.25 }} />
      <div style={{ position: 'absolute', left: 70, top: 70, width: 150, height: 14, background: theme.accent }} />
      <div style={{ position: 'absolute', left: 70, right: 330, top: 120, bottom: 110, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 26 }}>
        {subtitle && <div style={{ color: theme.accent, fontSize: 44, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 4 }}>{subtitle}</div>}
        <div style={{ color: theme.fg, fontSize: size, fontWeight: 900, lineHeight: 1.05, textShadow: '0 4px 0 rgba(0,0,0,0.25)' }}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};
