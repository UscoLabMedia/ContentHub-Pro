// Output presets per platform. Phone-first: nothing above 1080p (4K is deliberately unsupported).
export interface Preset {
  id: string;
  platform: 'tiktok' | 'instagram' | 'facebook' | 'youtube' | 'spotify';
  width: number;
  height: number;
  fps: 30;
  maxSeconds: number;
  kind: 'video' | 'image' | 'audio';
}

export const PRESETS: Record<string, Preset> = {
  tiktok: { id: 'tiktok', platform: 'tiktok', width: 1080, height: 1920, fps: 30, maxSeconds: 60, kind: 'video' },
  instagram_reel: { id: 'instagram_reel', platform: 'instagram', width: 1080, height: 1920, fps: 30, maxSeconds: 90, kind: 'video' },
  instagram_carousel: { id: 'instagram_carousel', platform: 'instagram', width: 1080, height: 1350, fps: 30, maxSeconds: 0, kind: 'image' },
  facebook_reel: { id: 'facebook_reel', platform: 'facebook', width: 1080, height: 1920, fps: 30, maxSeconds: 90, kind: 'video' },
  facebook_feed: { id: 'facebook_feed', platform: 'facebook', width: 1080, height: 1350, fps: 30, maxSeconds: 240, kind: 'video' },
  youtube_short: { id: 'youtube_short', platform: 'youtube', width: 1080, height: 1920, fps: 30, maxSeconds: 60, kind: 'video' },
  youtube_long: { id: 'youtube_long', platform: 'youtube', width: 1920, height: 1080, fps: 30, maxSeconds: 900, kind: 'video' },
  spotify_audiogram: { id: 'spotify_audiogram', platform: 'spotify', width: 1080, height: 1080, fps: 30, maxSeconds: 90, kind: 'audio' },
};

/**
 * Draft = exactly half size (1080p -> 540p). Half keeps both sides integers for every preset;
 * a true 480p scale (4/9) yields fractional heights and the video encoder rejects them.
 */
export const DRAFT_SCALE = 0.5;

/** Final = native preset size (<= 1080p). */
export function renderScale(_preset: Preset, quality: 'draft' | 'final'): number {
  return quality === 'final' ? 1 : DRAFT_SCALE;
}
