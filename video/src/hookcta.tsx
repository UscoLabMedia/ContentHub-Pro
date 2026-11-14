import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { captionsOf, fontInfo, isUserFont } from '@chp/core/subtitles';
import type { StyleProfile } from '@chp/core/style';
import { Background, paperOf, tornPolygon } from './visual.tsx';

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
const onColor = (hex: string) => (lum(hex) > 150 ? '#1b1b1b' : '#ffffff');
const family = (style: StyleProfile) => {
  const cap = captionsOf(style);
  const f = fontInfo(cap.font);
  return { family: isUserFont(cap.font) ? `'user-${cap.font.slice(5)}', sans-serif` : f.family, weight: isUserFont(cap.font) ? 700 : f.weight };
};

/** The opening labels: paper tags at the top that slide in, and leave a little before `endFrame`. Meant to sit inside a Sequence that starts at 0. */
export const Hook = ({ lines, style, endFrame }: { lines: string[]; style: StyleProfile; endFrame: number }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const font = family(style);
  const portrait = height > width;
  const base = portrait ? width * 0.056 : height * 0.066;
  const paper = paperOf(style.palette.bg);
  const out = interpolate(frame, [endFrame - 0.4 * fps, endFrame], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {lines.map((text, i) => {
        const size = Math.min(base, (width * 0.82) / Math.max(8, text.length * 0.6));
        const enter = spring({ frame: frame - i * 5, fps, config: { damping: 11, stiffness: 150 } });
        const slide = (1 - Math.min(1, enter)) * width * 0.6 * (i % 2 ? 1 : -1);
        const color = i === 0 ? '#1b1b1b' : lum(style.palette.accent) > 140 ? '#1b1b1b' : style.palette.accent; // dark when the accent is too light for cream paper
        return (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (portrait ? 0.075 : 0.06) * height + i * size * 2.3, display: 'flex', justifyContent: 'center', transform: `translate(${slide}px, ${-out * height * 0.2}px) rotate(${i % 2 ? 1.1 : -1.4}deg)`, opacity: 1 - out }}>
            <div style={{ filter: `drop-shadow(0 ${size * 0.1}px ${size * 0.15}px rgba(0,0,0,0.4))` }}>
              <div style={{ background: paper, clipPath: tornPolygon(`hook${i}`, 64, 4), padding: `${size * 0.42}px ${size * 0.8}px`, fontFamily: font.family, fontWeight: font.weight, fontSize: size, lineHeight: 1.05, color, textTransform: captionsOf(style).uppercase ? 'uppercase' : 'none', whiteSpace: 'nowrap' }}>{text}</div>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** The final screen: a button that bounces in and pulses, with up to two small lines under it. A generic play icon, never a brand logo. */
export const CtaCard = ({ text, cta, style }: { text: string; cta: { lines: string[]; icon?: boolean }; style: StyleProfile }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const font = family(style);
  const portrait = height > width;
  const size = portrait ? width * 0.058 : height * 0.07;
  const enter = spring({ frame: frame - 6, fps, config: { damping: 12, stiffness: 150 } }); // a small bounce: the button must never leave the screen
  const pulse = 1 + 0.035 * Math.sin((frame / fps) * 6);
  const label = Math.min(size * 0.92, (width * 0.5) / Math.max(8, text.length * 0.6));
  const btn = style.palette.accent;
  const fg = onColor(btn);
  const lineIn = interpolate(frame, [fps * 0.7, fps * 1.1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: style.palette.bg, overflow: 'hidden' }}>
      <Background style={style} frame={frame} index={97} width={width} height={height} />
      <AbsoluteFill style={{ background: `${style.palette.bg}cc` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '44%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 1.1, transform: 'translateY(-50%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.5, background: btn, color: fg, borderRadius: 999, padding: `${size * 0.55}px ${size * 1.1}px`, fontFamily: font.family, fontWeight: font.weight, fontSize: label, boxShadow: `0 ${size * 0.25}px ${size * 0.6}px rgba(0,0,0,0.35)`, transform: `scale(${Math.max(0, enter) * pulse})`, opacity: Math.min(1, enter * 1.6), whiteSpace: 'nowrap' }}>
          {cta.icon !== false && (
            <svg width={label * 1.5} height={label * 1.5} viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="46" fill={fg} />
              <polygon points="40,28 40,72 74,50" fill={btn} />
            </svg>
          )}
          <span>{text}</span>
        </div>
        {cta.lines.map((l, i) => (
          <div key={i} style={{ fontFamily: font.family, fontWeight: font.weight, fontSize: size * (i === 0 ? 0.72 : 0.58), color: style.palette.fg, opacity: lineIn * (i === 0 ? 0.95 : 0.7), transform: `translateY(${(1 - lineIn) * 18}px)`, textAlign: 'center', padding: `0 ${width * 0.06}px` }}>{l}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
