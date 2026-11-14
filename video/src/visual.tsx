import type { CSSProperties, ReactNode } from 'react';
import { Easing, Img, Loop, OffthreadVideo, interpolate, random, spring } from 'remotion';
import { animFor, captionsOf, fontInfo, isUserFont } from '@chp/core/subtitles';
import { isKeyWord } from '@chp/core/rhythm';
import { captionGroups, formatCount, withSpokenTimes, wordTimings, readingSeconds, type CameraKind, type HeroNumber, type StyleProfile } from '@chp/core/style';

export interface Cam {
  s: number;
  x: number; // percent of width
  y: number; // percent of height
  r: number; // degrees
}

const DEFAULT_ORDER: CameraKind[] = ['zoomIn', 'zoomOut', 'panL', 'panR', 'push'];

/** A virtual-camera move per scene: the style's copied pattern if it has one, otherwise a rotation of moves. */
export function camera(index: number, frame: number, dur: number, motion: number, pattern?: CameraKind[]): Cam {
  const p = Easing.inOut(Easing.quad)(Math.min(1, frame / Math.max(1, dur)));
  const m = motion;
  const kind = pattern && pattern.length ? pattern[index % pattern.length]! : DEFAULT_ORDER[index % DEFAULT_ORDER.length]!;
  switch (kind) {
    case 'zoomIn': return { s: 1.02 + 0.09 * m * p, x: 0, y: 0, r: 0 };
    case 'zoomOut': return { s: 1.02 + 0.09 * m * (1 - p), x: 0, y: 0, r: 0 };
    case 'panL': return { s: 1.07, x: (0.5 - p) * 6 * m, y: 0, r: 0 };
    case 'panR': return { s: 1.07, x: (p - 0.5) * 6 * m, y: 0, r: 0 };
    case 'still': return { s: 1.02, x: 0, y: 0, r: 0 };
    default: return { s: 1.03 + 0.08 * m * p, x: 0, y: (0.5 - p) * 3 * m, r: (p - 0.5) * 2.4 * m };
  }
}

export const camTransform = (c: Cam, parallax = 1): string => `translate(${c.x * parallax}%, ${c.y * parallax}%) scale(${1 + (c.s - 1) * parallax}) rotate(${c.r * parallax}deg)`;

const fill: CSSProperties = { position: 'absolute', inset: 0 };

/** Back layer: the style's background (solid, paper with torn pieces, halftone dots, or a slow gradient). */
export const Background = ({ style, frame, index, width, height }: { style: StyleProfile; frame: number; index: number; width: number; height: number }) => {
  const { bg, accent, accent2 } = style.palette;
  const drift = frame * 0.25;
  if (style.background === 'gradient')
    return <div style={{ ...fill, background: `linear-gradient(${140 + Math.sin(frame / 90) * 12}deg, ${bg} 0%, ${bg} 45%, ${accent2}40 100%)` }} />;
  if (style.background === 'halftone')
    return (
      <div style={{ ...fill, background: bg }}>
        <div style={{ ...fill, backgroundImage: `radial-gradient(circle, ${accent} 3px, transparent 3.6px)`, backgroundSize: '26px 26px', backgroundPosition: `${drift}px ${drift * 0.6}px`, opacity: 0.22, WebkitMaskImage: 'linear-gradient(135deg, black 0%, transparent 55%)', maskImage: 'linear-gradient(135deg, black 0%, transparent 55%)' }} />
      </div>
    );
  if (style.background === 'paper') {
    const pieces = [0, 1, 2].map((i) => {
      const cx = random(`px${index}-${i}`) * width;
      const cy = random(`py${index}-${i}`) * height;
      const size = width * (0.5 + random(`ps${index}-${i}`) * 0.4);
      const jag = Array.from({ length: 9 }, (_, k) => {
        const a = (k / 9) * Math.PI * 2;
        const rr = 0.42 + random(`pj${index}-${i}-${k}`) * 0.16;
        return `${50 + Math.cos(a) * rr * 100}% ${50 + Math.sin(a) * rr * 100}%`;
      }).join(',');
      return { cx, cy, size, jag, color: i === 1 ? accent2 : accent, rot: random(`pr${index}-${i}`) * 40 - 20 };
    });
    return (
      <div style={{ ...fill, background: bg, overflow: 'hidden' }}>
        {pieces.map((p, i) => (
          <div key={i} style={{ position: 'absolute', left: p.cx - p.size / 2 + Math.sin(frame / 120 + i) * 18, top: p.cy - p.size / 2 + Math.cos(frame / 140 + i) * 14, width: p.size, height: p.size, background: p.color, opacity: 0.16, clipPath: `polygon(${p.jag})`, transform: `rotate(${p.rot + frame * 0.04}deg)` }} />
        ))}
        <svg width="100%" height="100%" style={{ ...fill, opacity: 0.1, mixBlendMode: 'multiply' }}>
          <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={index + 1} /></filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      </div>
    );
  }
  return <div style={{ ...fill, background: bg }} />;
};

/** Middle layer: big rings and bars that move at their own speed (parallax) so the scene is never flat. */
export const Motif = ({ style, frame, index, width, height }: { style: StyleProfile; frame: number; index: number; width: number; height: number }) => (
  <div style={fill}>
    {[0, 1, 2].map((i) => {
      const size = width * (0.28 + random(`ms${index}-${i}`) * 0.3);
      const left = random(`ml${index}-${i}`) * width * 0.9 - size * 0.2;
      const top = random(`mt${index}-${i}`) * height * 0.8 - size * 0.1;
      const color = i % 2 ? style.palette.accent2 : style.palette.accent;
      const ring = i !== 2;
      return (
        <div key={i} style={{ position: 'absolute', left, top, width: size, height: ring ? size : size * 0.12, borderRadius: ring ? '50%' : 8, border: ring ? `${Math.max(6, width * 0.012)}px solid ${color}` : undefined, background: ring ? undefined : color, opacity: 0.28, transform: `rotate(${frame * (0.15 + i * 0.07) * (i % 2 ? -1 : 1)}deg) scale(${1 + Math.sin(frame / 50 + i) * 0.04})` }} />
      );
    })}
  </div>
);

/** Front layer: soft blurred pieces crossing faster than everything else (depth). */
export const Particles = ({ style, frame, index, width, height }: { style: StyleProfile; frame: number; index: number; width: number; height: number }) => {
  if (!style.particles) return null;
  const colors = [style.palette.accent, style.palette.accent2, style.palette.fg];
  return (
    <div style={{ ...fill, pointerEvents: 'none' }}>
      {Array.from({ length: 9 }, (_, i) => {
        const speed = 0.8 + random(`vs${index}-${i}`) * 2.2;
        const x = ((random(`vx${index}-${i}`) * 1.4 + (frame * speed) / (width * 0.18)) % 1.3) - 0.15;
        const y = random(`vy${index}-${i}`) * height + Math.sin(frame / 40 + i) * 20;
        const size = 14 + random(`vz${index}-${i}`) * 46;
        return <div key={i} style={{ position: 'absolute', left: x * width, top: y, width: size, height: size * (i % 3 === 0 ? 0.6 : 1), borderRadius: i % 2 ? '50%' : 6, background: colors[i % 3], opacity: 0.22 + random(`vo${i}`) * 0.2, filter: `blur(${size > 36 ? 4 : 1.5}px)`, transform: `rotate(${frame * speed}deg)` }} />;
      })}
    </div>
  );
};

/** A figure that counts up and flies in from the camera. */
export const Hero = ({ hero, style, frame, fps, width, height, startFrame = 4 }: { hero: HeroNumber; style: StyleProfile; frame: number; fps: number; width: number; height: number; /** The frame at which the number appears: the moment the voice says it. */ startFrame?: number }) => {
  if (frame < startFrame) return null;
  const enter = spring({ frame: frame - startFrame, fps, config: { damping: 14, stiffness: 120 } });
  const count = interpolate(frame, [startFrame + 2, startFrame + 2 + fps * 1.3], [0, hero.value], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const portrait = height > width;
  const size = width * (portrait ? 0.2 : 0.13);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: portrait ? '16%' : '12%', display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${0.6 + 0.4 * enter})`, opacity: Math.min(1, enter * 1.4), filter: `blur(${(1 - Math.min(1, enter)) * 8}px)` }}>
      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 900, fontSize: size, lineHeight: 1, color: style.palette.accent, textShadow: `0 ${size * 0.04}px 0 ${style.palette.fg}22`, letterSpacing: -2 }}>{formatCount(count, hero)}</div>
      {hero.unit && <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, fontSize: size * 0.34, color: style.palette.fg, opacity: 0.9, marginTop: size * 0.04 }}>{hero.unit}</div>}
    </div>
  );
};

/** Stock video as the scene's background: loops when shorter than the scene, silent, with a veil in the style's color so captions stay readable. */
export const Broll = ({ broll, style, durationInFrames, fps }: { broll: { url: string; durationSec: number }; style: StyleProfile; durationInFrames: number; fps: number }) => {
  const clip = Math.max(1, Math.round((broll.durationSec > 0 ? Math.min(broll.durationSec, 30) : durationInFrames / fps) * fps));
  const video = <OffthreadVideo src={broll.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  return (
    <div style={{ position: 'absolute', inset: 0, background: style.palette.bg }}>
      {clip < durationInFrames ? <Loop durationInFrames={clip}>{video}</Loop> : video}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(${style.palette.bg}99, ${style.palette.bg}55 45%, ${style.palette.bg}99)` }} />
    </div>
  );
};

/** A torn edge: points around a rectangle, each pushed inward by an uneven amount (a slow wave plus fine noise). */
const tornPolygon = (seed: string, steps = 96, amp = 3.4): string => {
  const n = Math.round(steps / 4);
  const pts: string[] = [];
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < n; i++) {
      const u = (i / n) * 100;
      const d = amp * (0.3 + 0.35 * Math.abs(Math.sin(i * 0.85 + side * 2.1 + random(`${seed}w`) * 6)) + 0.45 * random(`${seed}-${side}-${i}`));
      const [x, y] = side === 0 ? [u, d] : side === 1 ? [100 - d, u] : side === 2 ? [100 - u, 100 - d] : [d, 100 - u];
      pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
    }
  }
  return `polygon(${pts.join(',')})`;
};

/** A paper cut-out: cream margin, irregular torn edge, grain and a soft shadow (the look of the paper-collage reels). */
const TornCard = ({ children, seed, paper, size }: { children: ReactNode; seed: string; paper: string; size: number }) => (
  <div style={{ position: 'absolute', inset: 0, filter: `drop-shadow(${size * 0.012}px ${size * 0.02}px ${size * 0.02}px rgba(0,0,0,0.38))` }}>
    <div style={{ position: 'absolute', inset: 0, background: paper, clipPath: tornPolygon(seed), padding: '9%', boxSizing: 'border-box' }}>
      {children}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.14, mixBlendMode: 'multiply', pointerEvents: 'none' }}>
        <filter id={`grain-${seed}`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={Math.round(random(`${seed}g`) * 99)} /></filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </div>
  </div>
);

const paperOf = (bg: string): string => {
  const n = parseInt(bg.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150 ? '#fffaf0' : '#f4ead5';
};

/**
 * The scene's illustration: enters with a spring, floats slowly, and sits above the subtitles (below the giant number if any).
 * As a paper cut-out (the paper style, or when chosen) it is a torn card that bounces in and shakes a little, one pose every 1/8 s.
 */
export const Art = ({ art, style, frame, fps, width, height, hasHero, index = 0 }: { art: { url: string; kind: 'image' | 'svg' }; style: StyleProfile; frame: number; fps: number; width: number; height: number; hasHero: boolean; index?: number }) => {
  const cut = style.paperCut ?? style.background === 'paper';
  const enter = spring({ frame: frame - 6, fps, config: cut ? { damping: 9, stiffness: 150 } : { damping: 13, stiffness: 110 } });
  const portrait = height > width;
  const box = Math.min(width, height) * (hasHero ? 0.42 : portrait ? 0.62 : 0.66) * (cut ? 1.12 : 1); // the paper margin takes space: the card is a bit larger
  const top = hasHero ? (portrait ? 0.4 : 0.44) : style.subtitle.position === 'center' ? 0.12 : portrait ? 0.2 : 0.1;
  const bob = Math.sin(frame / (fps * 0.9)) * box * 0.012;
  const pose = Math.floor(frame / (fps / 8)); // stop-motion: a new pose 8 times a second
  const jx = cut ? (random(`ax${index}-${pose}`) - 0.5) * 6 : 0;
  const jy = cut ? (random(`ay${index}-${pose}`) - 0.5) * 6 : 0;
  const jr = cut ? (random(`ar${index}-${pose}`) - 0.5) * 1.4 + (random(`at${index}`) - 0.5) * 6 : 0; // a fixed tilt per scene plus the shake
  const sticker = style.background === 'paper' && !cut;
  const img = <Img src={art.url} style={{ width: '100%', height: '100%', objectFit: 'contain', ...(cut ? {} : { filter: sticker ? `drop-shadow(0 0 0 #fff) drop-shadow(${box * 0.012}px ${box * 0.016}px 0 ${style.palette.fg}55)` : `drop-shadow(0 ${box * 0.02}px ${box * 0.03}px rgba(0,0,0,0.25))`, borderRadius: art.kind === 'image' && !sticker ? box * 0.04 : 0 }) }} />;
  return (
    <div style={{ position: 'absolute', left: '50%', top: `${top * 100}%`, width: box, height: box, marginLeft: -box / 2, transform: `translate(${jx}px, ${bob + jy}px) scale(${0.55 + 0.45 * enter}) rotate(${(1 - enter) * -6 + (sticker ? -2 : 0) + jr}deg)`, opacity: Math.min(1, enter * 1.5) }}>
      {cut ? <TornCard seed={`art${index}`} paper={paperOf(style.palette.bg)} size={box}>{img}</TornCard> : img}
    </div>
  );
};

const readable = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150 ? '#111111' : '#ffffff';
};

/** Subtitles: up to N words at a time; the spoken word is marked; each group enters with the scene's animation. */
export const Karaoke = ({ text, style, frame, fps, speechSec, wordTimes, durationSec, width, height, index, keywords }: { text: string; keywords?: string[]; wordTimes?: { from: number; to: number }[]; style: StyleProfile; frame: number; fps: number; speechSec?: number; durationSec: number; width: number; height: number; index: number }) => {
  const cap = captionsOf(style);
  const span = Math.max(0.6, Math.min(speechSec ?? readingSeconds(text), durationSec - 0.35));
  const words = withSpokenTimes(wordTimings(text, 0.15, span), wordTimes);
  const groups = captionGroups(words, cap.wordsPerGroup);
  const t = frame / fps;
  let g = 0;
  groups.forEach((grp, i) => { if (grp[0]!.from <= t) g = i; });
  const group = groups[g];
  if (!group) return null;
  const anim = animFor(cap, index);
  const portrait = height > width;
  const font = fontInfo(cap.font);
  const family = isUserFont(cap.font) ? `'user-${cap.font.slice(5)}', sans-serif` : font.family;
  const fs = width * (portrait ? 0.072 : 0.042) * cap.size * (font.category === 'condensed' ? 1.18 : 1);
  const enterF = Math.max(0, frame - Math.round(group[0]!.from * fps));
  const e = interpolate(enterF, [0, 7], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const sp = spring({ frame: enterF, fps, config: { damping: anim === 'bounce' ? 7 : 12, stiffness: 200 } });
  const box: CSSProperties = { position: 'absolute', left: '5%', right: '5%', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: fs * 0.18, fontFamily: family, fontWeight: isUserFont(cap.font) ? 700 : font.weight, fontSize: fs, lineHeight: 1.15, textAlign: 'center' };
  if (cap.position === 'center') Object.assign(box, { top: '50%', transform: 'translateY(-50%)' });
  else if (cap.position === 'top') box.top = portrait ? '12%' : '9%';
  else box.bottom = portrait ? '15%' : '8%';
  // group-level entrance
  let ge: CSSProperties = {};
  if (anim === 'pop') ge = { transform: `scale(${0.6 + 0.4 * Math.min(1.1, sp)})`, opacity: Math.min(1, e * 1.6) };
  else if (anim === 'slideUp') ge = { transform: `translateY(${(1 - e) * fs * 1.2}px)`, opacity: e };
  else if (anim === 'bounce') ge = { transform: `translateY(${(1 - sp) * fs * 1.6}px)`, opacity: Math.min(1, e * 2) };
  else if (anim === 'fade') ge = { opacity: e };
  else if (anim === 'zoom') ge = { transform: `scale(${2.2 - 1.2 * e})`, opacity: e, filter: `blur(${(1 - e) * 6}px)` };
  else if (anim === 'shake') ge = { transform: `rotate(${Math.sin(enterF * 1.9) * 5 * (1 - e)}deg) scale(${0.85 + 0.15 * Math.min(1.1, sp)})`, opacity: Math.min(1, e * 2) };
  else if (anim === 'wipe') ge = { clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` };
  const sw = fs * cap.stroke.width;
  const tx = cap.uppercase ? 'uppercase' : 'none';
  return (
    <div style={box}>
      <div style={{ display: 'contents' }}>
        {group.map((w, i) => {
          if (anim === 'typewriter' && t < w.from) return null;
          const active = t >= w.from && t < w.to + 0.02;
          const wp = spring({ frame: frame - Math.round(w.from * fps), fps, config: { damping: 11, stiffness: 220 } });
          const h = cap.highlight;
          const marked = active && h.mode !== 'none';
          const emph = isKeyWord(w.word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''), keywords); // key words: bigger, italic, in the highlight color
          const shown = anim === 'typewriter' ? w.word.slice(0, Math.max(1, Math.ceil(w.word.length * Math.min(1, (t - w.from) / 0.22)))) : w.word;
          return (
            <span key={`${g}-${i}`} style={{ display: 'inline-block', padding: `0 ${fs * 0.14}px`, borderRadius: fs * 0.12, background: marked && h.mode === 'box' ? h.color : 'transparent', color: marked ? (h.mode === 'box' ? h.textColor : h.mode === 'color' ? h.color : cap.color) : emph ? (h.mode === 'none' ? style.palette.accent : h.color) : cap.color, fontStyle: emph ? 'italic' : undefined, fontSize: emph ? fs * 1.12 : undefined, borderBottom: marked && h.mode === 'underline' ? `${fs * 0.09}px solid ${h.color}` : undefined, transform: `${ge.transform ?? ''} scale(${active ? 1 + 0.12 * Math.min(1, wp) : 1}) rotate(${marked && h.mode === 'box' ? -2 : 0}deg)`, opacity: ge.opacity, filter: ge.filter, clipPath: ge.clipPath, textTransform: tx, WebkitTextStroke: marked && h.mode === 'box' ? undefined : sw > 0 ? `${sw}px ${cap.stroke.color}` : undefined, paintOrder: 'stroke fill', textShadow: cap.shadow && !(marked && h.mode === 'box') ? `0 ${fs * 0.05}px 0 ${cap.stroke.color}88` : undefined }}>{shown}</span>
          );
        })}
      </div>
    </div>
  );
};
