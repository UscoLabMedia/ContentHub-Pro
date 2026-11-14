import { z } from 'zod';

// Compact JSON contracts for every AI step. Short outputs = fewer tokens.
export const TrendsOut = z.object({
  trends: z.array(z.object({ title: z.string(), context: z.string(), virality: z.number(), sourceIds: z.array(z.number()) })),
});

export const TreatmentOut = z.object({
  options: z.array(
    z.object({
      id: z.enum(['myth', 'analogy', 'history']),
      title: z.string(),
      hook: z.string(),
      why: z.string(),
    }),
  ),
});

export const AudienceOut = z.object({
  profile: z.string(),
  ageRange: z.string(),
  bestPlatforms: z.array(z.string()),
  risks: z.array(z.string()),
});

export const PlatformId = z.enum(['tiktok', 'instagram', 'facebook', 'youtube_short', 'youtube_long', 'spotify']);
export type PlatformId = z.infer<typeof PlatformId>;

export const FormatsOut = z.object({
  recommendations: z.array(
    z.object({ platform: PlatformId, format: z.string(), durationSec: z.number(), rationale: z.string() }),
  ),
});

export const ScriptOut = z.object({
  options: z.array(
    z.object({
      label: z.string(),
      hook: z.string(),
      beats: z.array(z.object({ tSec: z.number(), text: z.string(), visual: z.string() })),
      cta: z.string(),
      caption: z.string(),
    }),
  ),
});

export const MetricsAnalysisOut = z.object({
  insights: z.array(z.string()),
  whatWorked: z.string(),
  whatToChange: z.string(),
  nextIdeas: z.array(z.string()),
});

export const HighlightsOut = z.object({
  highlights: z.array(z.object({ startSec: z.number(), endSec: z.number(), point: z.string() })),
});

export const SourceIdeasOut = z.object({
  summary: z.string(),
  ideas: z.array(
    z.object({
      title: z.string(),
      platform: PlatformId,
      format: z.string(),
      hook: z.string(),
      startSec: z.number(),
      endSec: z.number(),
      why: z.string(),
    }),
  ),
});
export type SourceIdea = z.infer<typeof SourceIdeasOut>['ideas'][number];

export const PublishCopyOut = z.object({
  items: z.array(
    z.object({ platform: PlatformId, title: z.string(), caption: z.string(), hashtags: z.array(z.string()), bestTime: z.string() }),
  ),
});
export type PublishCopy = z.infer<typeof PublishCopyOut>['items'][number];

export const VerifyOut = z.object({
  scenes: z.array(
    z.object({
      key: z.string(),
      opinion: z.boolean(),
      claims: z.array(
        z.object({
          claim: z.string(),
          calc: z.string(),
          sources: z.array(z.object({ title: z.string(), url: z.string(), quote: z.string() })),
        }),
      ),
    }),
  ),
});

const SubAnimEnum = z.enum(['pop', 'slideUp', 'bounce', 'fade', 'typewriter', 'zoom', 'shake', 'wipe']);
export const SubtitleSheetOut = z.object({
  category: z.enum(['condensed', 'sans', 'heavy', 'rounded', 'comic', 'handwritten', 'serif']),
  uppercase: z.boolean(),
  outline: z.boolean(),
  shadow: z.boolean(),
  highlight: z.enum(['box', 'color', 'underline', 'none']),
  animation: SubAnimEnum,
  similar: z.array(SubAnimEnum).max(4),
  notes: z.string().max(160),
});
export const SubtitleStyleSchema = z.object({
  font: z.string(), uppercase: z.boolean(), color: z.string(), stroke: z.object({ color: z.string(), width: z.number() }), shadow: z.boolean(),
  highlight: z.object({ mode: z.enum(['box', 'color', 'underline', 'none']), color: z.string(), textColor: z.string() }),
  animation: SubAnimEnum, rotate: z.array(SubAnimEnum), position: z.enum(['top', 'center', 'bottom']), size: z.number(), wordsPerGroup: z.number(),
});

export const StyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  blurb: z.string(),
  palette: z.object({ bg: z.string(), fg: z.string(), accent: z.string(), accent2: z.string() }),
  background: z.enum(['solid', 'paper', 'halftone', 'gradient']),
  motion: z.number(),
  subtitle: z.object({ uppercase: z.boolean(), marker: z.boolean(), position: z.enum(['bottom', 'center']) }),
  particles: z.boolean(),
  cameraPattern: z.array(z.enum(['zoomIn', 'zoomOut', 'panL', 'panR', 'push', 'still'])).optional(),
  pace: z.number().optional(),
  captions: SubtitleStyleSchema.optional(),
});

export const StyleSheetOut = z.object({
  background: z.enum(['solid', 'paper', 'halftone', 'gradient']),
  cutouts: z.boolean(),
  handDrawn: z.boolean(),
  particles: z.boolean(),
  uppercaseText: z.boolean(),
  highlightedWords: z.boolean(),
  notes: z.string(),
});
export type StyleSheet = z.infer<typeof StyleSheetOut>;

export const MusicMoodOut = z.object({ mood: z.enum(['documental', 'inspirador', 'alegre', 'energico', 'calmo', 'tenso', 'misterioso', 'triste']), hint: z.string().max(40) });

export const ArtQueriesOut = z.object({
  scenes: z.array(z.object({ key: z.string(), query: z.string().max(60), draw: z.string().max(160) })).max(40),
});
export const DrawOut = z.object({ svg: z.string().max(16000) });

/** Input of the Remotion template; built locally from a script (zero tokens). */
export const VideoSpec = z.object({
  preset: z.string(),
  scenes: z.array(z.object({ text: z.string(), durationSec: z.number(), audioUrl: z.string().optional(), card: z.boolean().optional(), speechSec: z.number().optional(), art: z.object({ url: z.string(), kind: z.enum(['image', 'svg']) }).optional(), broll: z.object({ url: z.string(), durationSec: z.number() }).optional() })),
  theme: z.object({ bg: z.string(), fg: z.string(), accent: z.string() }).optional(),
  style: StyleSchema.optional(),
  /** Background music with its mix (the URL is added by the server). */
  music: z.object({ url: z.string(), volume: z.number(), duck: z.boolean(), duckTo: z.number(), fadeInSec: z.number(), fadeOutSec: z.number() }).optional(),
  /** Sound-effects track (WAV) built by the server for this video. */
  sfx: z.object({ url: z.string() }).optional(),
  /** Fonts the person uploaded: loaded by the render browser from this server. */
  fonts: z.array(z.object({ family: z.string(), url: z.string() })).optional(),
});
export type VideoSpec = z.infer<typeof VideoSpec>;
export type ScriptOption = z.infer<typeof ScriptOut>['options'][number];

export const OUTPUT_SCHEMAS = {
  trends: TrendsOut,
  treatment: TreatmentOut,
  audience: AudienceOut,
  formats: FormatsOut,
  script: ScriptOut,
  metricsAnalysis: MetricsAnalysisOut,
  sourceHighlights: HighlightsOut,
  contentIdeas: SourceIdeasOut,
  publishCopy: PublishCopyOut,
  verifyClaims: VerifyOut,
  styleFromSheet: StyleSheetOut,
  artQueries: ArtQueriesOut,
  musicMood: MusicMoodOut,
  subtitleFromSheet: SubtitleSheetOut,
  drawIllustration: DrawOut,
} as const;
