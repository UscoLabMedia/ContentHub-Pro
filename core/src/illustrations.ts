// Scene illustrations. No fixed catalog: each scene gets one that fits its topic and the chosen style.
// Order (cheapest first): free web search of openly licensed images (no AI, no keys) -> an SVG drawn by Claude.
//   - Openverse          https://api.openverse.org      (CC0, public domain, CC BY)
//   - Wikimedia Commons  https://commons.wikimedia.org (CC0, public domain, CC BY)
// Only public domain, CC0 and CC BY are accepted (usable commercially). CC BY needs a credit: it goes on the
// closing card and in the description, like the sources.
import { keywordsOf } from './freesearch.ts';
import { normalize } from './verification.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const UA = 'ContentHubPro/1.0 (personal content tool; image search)';

export type LicenseId = 'cc0' | 'pdm' | 'by';

export interface ArtCandidate {
  id: string;
  title: string;
  /** Image file (≤1280 px wide when the provider can resize). */
  url: string;
  thumb: string;
  author: string;
  license: LicenseId;
  licenseLabel: string;
  /** Page of the work (shown as the credit link). */
  page: string;
  provider: 'openverse' | 'commons';
  /** Words the provider attached to it (used only for the relevance check). */
  tags: string[];
  /** Original size when the provider says it (a tiny file looks bad full screen). */
  width?: number;
  height?: number;
}

/** What a scene keeps: the file lives in the server's art folder under `id`. */
export interface ArtRef {
  id: string;
  kind: 'image' | 'svg';
  ext: 'png' | 'jpg' | 'webp' | 'svg';
  title: string;
  origin: 'web' | 'ai';
  /** Ready-to-print credit line; empty when none is required (public domain, CC0, own drawing). */
  credit: string;
}

export const isArtId = (s: string): boolean => /^[a-f0-9]{16}$/.test(s);
export const ART_EXTS = ['png', 'jpg', 'webp', 'svg'] as const;

// ----------------------------------------------------------------------------- licenses
/** Accepts only CC0, public domain and CC BY (any version). Anything with SA / NC / ND is rejected. */
export function licenseOf(label: string): LicenseId | null {
  const l = label.toLowerCase().replace(/[-_]/g, ' ').trim();
  if (/\b(sa|nc|nd)\b|share ?alike|non ?commercial|no ?deriv/.test(l)) return null;
  if (/^(cc0|cc 0|cc zero)|public domain mark|^pdm\b|^pd\b|public domain|dominio p[uú]blico/.test(l)) return l.startsWith('cc0') || l.startsWith('cc 0') ? 'cc0' : 'pdm';
  if (/^(cc )?by( \d|$)/.test(l) || /^cc by\b/.test(l)) return 'by';
  return null;
}

const LABEL: Record<LicenseId, string> = { cc0: 'CC0', pdm: 'Dominio público', by: 'CC BY' };

export function creditLine(c: Pick<ArtCandidate, 'title' | 'author' | 'licenseLabel' | 'license' | 'page'>): string {
  if (c.license !== 'by') return ''; // public domain and CC0 do not require attribution
  const t = c.title.length > 60 ? `${c.title.slice(0, 58)}…` : c.title;
  return `«${t}»${c.author ? `, ${c.author}` : ''} (${c.licenseLabel || LABEL.by})`;
}

// ----------------------------------------------------------------------------- queries
/** Local search terms (no AI): the scene's most significant words. */
export function artQuery(sceneText: string, max = 3): string {
  return keywordsOf(sceneText, 8).filter((w) => !/^\d/.test(w)).slice(0, max).join(' ');
}

const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

// ----------------------------------------------------------------------------- parsers
const OK_MIME = /^(image\/(png|jpe?g|webp|svg\+xml))$/;

export function parseOpenverse(json: unknown): ArtCandidate[] {
  const results = (json as { results?: { id?: string; title?: string; url?: string; thumbnail?: string; creator?: string; license?: string; license_version?: string; foreign_landing_url?: string; filetype?: string; width?: number; height?: number; tags?: { name?: string }[] }[] }).results ?? [];
  return results.flatMap((r) => {
    const lic = licenseOf(r.license === 'by' ? 'cc by' : (r.license ?? ''));
    const ft = (r.filetype ?? '').toLowerCase();
    if (!lic || !r.id || !r.url || !/^(png|jpe?g|webp|svg)$/.test(ft)) return [];
    return [{
      id: `ov-${r.id}`, title: r.title || 'Sin título', url: r.url, thumb: r.thumbnail || r.url, author: r.creator ?? '',
      license: lic, licenseLabel: lic === 'by' ? `CC BY${r.license_version ? ` ${r.license_version}` : ''}` : LABEL[lic],
      page: r.foreign_landing_url || r.url, provider: 'openverse' as const, tags: (r.tags ?? []).map((t) => t.name ?? '').filter(Boolean), width: r.width, height: r.height,
    }];
  });
}

export function parseCommons(json: unknown): ArtCandidate[] {
  type Meta = Record<string, { value?: string } | undefined>;
  const pages = Object.values((json as { query?: { pages?: Record<string, { pageid?: number; title?: string; imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; mime?: string; width?: number; height?: number; extmetadata?: Meta }[] }> } }).query?.pages ?? {});
  return pages.flatMap((p) => {
    const i = p.imageinfo?.[0];
    const label = i?.extmetadata?.LicenseShortName?.value ?? '';
    const lic = licenseOf(label);
    if (!i || !lic || !p.title || !OK_MIME.test(i.mime ?? '') || !(i.thumburl || i.url)) return [];
    return [{
      id: `wc-${p.pageid ?? p.title}`, title: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      url: i.mime === 'image/svg+xml' ? (i.thumburl ?? i.url!) : (i.thumburl || i.url!), thumb: i.thumburl || i.url!,
      author: stripHtml(i.extmetadata?.Artist?.value ?? ''), license: lic, licenseLabel: lic === 'by' ? label || 'CC BY' : LABEL[lic],
      page: i.descriptionurl ?? i.url!, provider: 'commons' as const, tags: stripHtml(i.extmetadata?.ImageDescription?.value ?? '').split(' ').slice(0, 30), width: i.width, height: i.height,
    }];
  });
}

/** Keeps candidates whose title/tags mention at least one search word (providers return loose matches). */
export function relevant(cands: ArtCandidate[], query: string): ArtCandidate[] {
  const words = normalize(query).split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return cands;
  return cands.filter((c) => {
    const hay = normalize(`${c.title} ${c.tags.join(' ')}`);
    return words.some((w) => hay.includes(w.slice(0, Math.max(4, w.length - 2))));
  });
}

/**
 * How well a candidate fits a scene (higher = better). `queries` go from the most specific to the most general: matching the first
 * counts most. Words found in the title weigh more than in the tags; a tiny image or a very wide panorama is penalized.
 */
export function scoreArt(c: ArtCandidate, queries: string[], portrait = true): number {
  const title = normalize(c.title);
  const tags = normalize(c.tags.join(' '));
  let best = 0;
  queries.forEach((q, qi) => {
    const words = normalize(q).split(/\s+/).filter((w) => w.length >= 3);
    if (!words.length) return;
    let hit = 0;
    for (const w of words) {
      const stem = w.slice(0, Math.max(4, w.length - 2));
      hit += title.includes(stem) ? 1 : tags.includes(stem) ? 0.6 : 0;
    }
    best = Math.max(best, (hit / words.length) * (1 - qi * 0.22));
  });
  let score = best * 10;
  if (c.width && c.height) {
    if (Math.min(c.width, c.height) < 500) score -= 3; // would look soft or pixelated
    else if (Math.max(c.width, c.height) >= 1000) score += 1;
    const ratio = c.width / c.height;
    if (ratio > 2.4 || ratio < 0.4) score -= 2; // panoramas and strips do not fill a vertical or horizontal frame
    score += (ratio < 1) === portrait ? 0.5 : 0;
  }
  if (c.license !== 'by') score += 0.5; // no credit to print
  if (/\b(logo|icon|diagram|map of|flag of)\b/.test(title) && !queries.some((q) => /logo|icon|diagram|map|flag/i.test(q))) score -= 1.5;
  return score;
}

/** Free web search for one query, unranked. A provider that fails is skipped. */
async function searchOne(q: string, fetcher: Fetcher): Promise<ArtCandidate[]> {
  const get = async (url: string): Promise<unknown> => {
    const r = await fetcher(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  const jobs: Promise<ArtCandidate[]>[] = [
    get(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm,by&page_size=12&mature=false`).then(parseOpenverse),
    get(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap|drawing`)}&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1280`).then(parseCommons),
  ];
  return (await Promise.allSettled(jobs)).flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}

/**
 * The best images for a scene given its search plan (most specific query first, then broader ones). Every query is tried,
 * the results are merged without repeats and ranked by `scoreArt`; candidates that do not mention any search word are dropped.
 * Never throws.
 */
export async function searchArtPlan(queries: string[], o: { fetcher?: Fetcher; limit?: number; portrait?: boolean } = {}): Promise<ArtCandidate[]> {
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 3);
  if (!qs.length) return [];
  const fetcher = o.fetcher ?? fetch;
  const lists = await Promise.all(qs.map((q) => searchOne(q, fetcher)));
  const seen = new Set<string>();
  const all = lists.flat().filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return all
    .map((c) => ({ c, score: scoreArt(c, qs, o.portrait ?? true) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c)
    .slice(0, o.limit ?? 6);
}

/** Free web search for one query, best first (kept for single-term searches). Never throws. */
export async function searchArt(query: string, fetcher: Fetcher = fetch, limit = 6): Promise<ArtCandidate[]> {
  return searchArtPlan([query], { fetcher, limit });
}

// ----------------------------------------------------------------------------- SVG drawn by the model
const MAX_SVG = 14_000;

/** Accepts only a plain, self-contained SVG: no scripts, event handlers, external references or HTML. */
export function sanitizeSvg(raw: string): string | null {
  const svg = raw.trim().replace(/^```(?:svg|xml)?\s*|\s*```$/g, '').trim();
  if (svg.length < 40 || svg.length > MAX_SVG || !/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return null;
  const body = svg.replace(/\sxmlns(:\w+)?="[^"]*"/g, ''); // the namespace URL is not a reference
  if (/<\s*(script|foreignObject|iframe|object|embed|image|use|style|link|a)\b/i.test(body)) return null;
  if (/\son[a-z]+\s*=/i.test(body) || /javascript:|data:|https?:|@import|url\(\s*['"]?(?!#)/i.test(body)) return null;
  if (/<!ENTITY|<!DOCTYPE/i.test(svg)) return null;
  const open = svg.match(/^<svg[^>]*>/i)![0];
  if (!/xmlns=/.test(open)) return svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

export const artFileExt = (mime: string): ArtRef['ext'] | null =>
  /png/.test(mime) ? 'png' : /jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : /svg/.test(mime) ? 'svg' : null;

/** Credit lines of the illustrations used by the delivered scenes (unique, only those that require one). */
export function artCredits(scenes: { text: string }[], art: Record<string, ArtRef | undefined>, keyOf: (t: string) => string): string[] {
  const out: string[] = [];
  for (const s of scenes) {
    const a = art[keyOf(s.text)];
    if (a?.credit && !out.includes(a.credit)) out.push(a.credit);
  }
  return out;
}
