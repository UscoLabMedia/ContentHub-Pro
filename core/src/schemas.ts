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

/** Input of the Remotion template; built locally from a script (zero tokens). */
export const VideoSpec = z.object({
  preset: z.string(),
  scenes: z.array(z.object({ text: z.string(), durationSec: z.number(), audioUrl: z.string().optional(), card: z.boolean().optional() })),
  theme: z.object({ bg: z.string(), fg: z.string(), accent: z.string() }).optional(),
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
} as const;
