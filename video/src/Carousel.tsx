import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CarouselSpec, SlideSpec } from '@chp/core/carousel';
import { captionsOf, fontInfo, isUserFont } from '@chp/core/subtitles';
import type { StyleProfile } from '@chp/core/style';
import { Card, styleOf, useSubtitleFonts } from './Piece.tsx';
import { Art, Background, Broll, Motif } from './visual.tsx';

/**
 * Instagram carousel: one frame of this composition = one slide (the frame number is the slide index).
 * Uses the person's style (palette, background, subtitle font); the slide's illustration or B-roll frame if its scene has one.
 */
const Slide = ({ slide, index, total, style }: { slide: SlideSpec; index: number; total: number; style: StyleProfile }) => {
  const { width, height } = useVideoConfig();
  const cap = captionsOf(style);
  const font = fontInfo(cap.font);
  const family = isUserFont(cap.font) ? `'user-${cap.font.slice(5)}', sans-serif` : font.family;
  const cover = slide.role === 'cover';
  const hasArt = !!slide.art;
  const len = slide.text.length;
  // Big and readable: shrinks with the amount of text; the cover is a little bigger.
  const base = width * (len <= 40 ? 0.095 : len <= 90 ? 0.075 : 0.062) * (cover ? 1.1 : 1) * Math.min(1.15, Math.max(0.85, cap.size)) * (font.category === 'condensed' ? 1.18 : 1);
  const sw = base * cap.stroke.width;
  const margin = width * 0.08;
  return (
    <AbsoluteFill style={{ background: style.palette.bg, overflow: 'hidden' }}>
      {slide.broll ? (
        <Broll broll={slide.broll} style={style} durationInFrames={30} fps={30} />
      ) : (
        <>
          <Background style={style} frame={0} index={index} width={width} height={height} />
          <Motif style={style} frame={0} index={index} width={width} height={height} />
        </>
      )}
      {/* its own box in the upper part (landscape proportions inside, so the image never reaches the text below) */}
      {slide.art && (
        <div style={{ position: 'absolute', left: 0, top: height * 0.05, width, height: height * 0.56 }}>
          <Art art={slide.art} style={style} frame={60} fps={30} width={width} height={height * 0.56} hasHero={false} />
        </div>
      )}
      {/* the image sits in the upper part; the text goes in the lower part when there is an image, centered otherwise */}
      <div style={{ position: 'absolute', left: margin, right: margin, top: hasArt ? '58%' : '14%', bottom: '14%', display: 'flex', alignItems: hasArt ? 'flex-start' : 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: family, fontWeight: isUserFont(cap.font) ? 700 : font.weight, fontSize: base, lineHeight: 1.18, textAlign: 'center', color: cap.color, textTransform: cap.uppercase ? 'uppercase' : 'none', WebkitTextStroke: sw > 0 ? `${sw}px ${cap.stroke.color}` : undefined, paintOrder: 'stroke fill', textShadow: cap.shadow ? `0 ${base * 0.05}px 0 ${cap.stroke.color}88` : undefined }}>{slide.text}</div>
      </div>
      <div style={{ position: 'absolute', left: margin, top: height * 0.045, width: width * 0.14, height: 10, background: style.palette.accent }} />
      <div style={{ position: 'absolute', right: margin, top: height * 0.035, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, fontSize: width * 0.036, color: cap.color, opacity: 0.85, WebkitTextStroke: sw > 0 ? `${Math.min(sw, 4)}px ${cap.stroke.color}` : undefined, paintOrder: 'stroke fill' }}>{index + 1}/{total}</div>
      {index < total - 1 && (
        <div style={{ position: 'absolute', right: margin, bottom: height * 0.04, display: 'flex', alignItems: 'center', gap: width * 0.015, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 900, color: style.palette.accent, fontSize: width * 0.07, lineHeight: 1 }}>
          {cover && <span style={{ fontSize: width * 0.03, fontWeight: 800, color: cap.color, opacity: 0.9, WebkitTextStroke: sw > 0 ? `${Math.min(sw, 3)}px ${cap.stroke.color}` : undefined, paintOrder: 'stroke fill' }}>Desliza</span>}
          <span>→</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

export const Carousel = (spec: CarouselSpec) => {
  const frame = useCurrentFrame();
  const style = styleOf(spec);
  useSubtitleFonts(style, spec.fonts);
  const slide = spec.slides[Math.min(frame, spec.slides.length - 1)]!;
  if (slide.role === 'sources') {
    const total = spec.slides.length;
    return (
      <AbsoluteFill>
        <Card text={slide.text} style={style} />
        <div style={{ position: 'absolute', right: '8%', top: '3.5%', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, fontSize: 38, color: style.palette.fg, opacity: 0.85 }}>{frame + 1}/{total}</div>
      </AbsoluteFill>
    );
  }
  return <Slide slide={slide} index={frame} total={spec.slides.length} style={style} />;
};
