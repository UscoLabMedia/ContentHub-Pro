// Documentary mode: every scene with facts must carry sources that were actually checked.
// All of this is pure and local; fetching pages happens in the server (see server/src/verify.ts).

export type CheckResult = 'found' | 'not-found' | 'unreachable' | 'unchecked';

export interface SourceRef {
  title: string;
  url: string;
  /** Short exact quote from the page that supports the claim. */
  quote?: string;
  /** Result of opening the page and looking for the quote/numbers. */
  check: CheckResult;
  snippet?: string;
  /** The person confirmed this source themselves (overrides a failed automatic check). */
  manual?: boolean;
}

export interface Claim {
  text: string;
  sources: SourceRef[];
  /** Own calculation or conversion, kept visible ("1 µs ≈ 300 m: cálculo propio"). */
  calc?: string;
}

export interface SceneCheck {
  textKey: string;
  /** No factual data in this scene (opinion, intro, call to action): exempt from verification. */
  opinion?: boolean;
  claims: Claim[];
}

export type SceneStatus = 'verified' | 'pending' | 'opinion';

/** Stable key of a scene's wording: editing the text invalidates its verification. */
export function textKey(text: string): string {
  const t = normalize(text);
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h.toString(36) + t.length.toString(36);
}

export const sourceOk = (s: SourceRef): boolean => s.check === 'found' || s.manual === true;

export function sceneStatus(check: SceneCheck | undefined): SceneStatus {
  if (!check) return 'pending';
  if (check.opinion) return 'opinion';
  if (!check.claims.length) return 'pending';
  return check.claims.every((c) => c.sources.some(sourceOk)) ? 'verified' : 'pending';
}

export interface Gate {
  ok: boolean;
  verified: number;
  opinion: number;
  /** Scene indexes still without verified sources. */
  pending: number[];
}

export function gate(scenes: { text: string }[], checks: Record<string, SceneCheck>): Gate {
  const g: Gate = { ok: true, verified: 0, opinion: 0, pending: [] };
  scenes.forEach((s, i) => {
    const c = checks[textKey(s.text)];
    const st = sceneStatus(c);
    if (st === 'verified') g.verified++;
    else if (st === 'opinion') g.opinion++;
    else g.pending.push(i);
  });
  g.ok = g.pending.length === 0;
  return g;
}

export interface Credits {
  sources: { title: string; url: string }[];
  calcs: string[];
  /** Credit lines for CC BY images (set by the caller; see artCredits). */
  images?: string[];
  /** Credit lines for CC BY music (set by the caller; see musicCredits). */
  music?: string[];
  /** Credit lines for CC BY / NASA stock video (see brollCredits). */
  video?: string[];
}

/** Unique verified sources and own calculations of the scenes being delivered. */
export function creditsFrom(scenes: { text: string }[], checks: Record<string, SceneCheck>): Credits {
  const seen = new Set<string>();
  const out: Credits = { sources: [], calcs: [] };
  for (const s of scenes) {
    const c = checks[textKey(s.text)];
    if (!c || sceneStatus(c) !== 'verified') continue;
    for (const claim of c.claims) {
      for (const src of claim.sources.filter(sourceOk)) {
        if (!seen.has(src.url)) {
          seen.add(src.url);
          out.sources.push({ title: src.title || hostOf(src.url), url: src.url });
        }
      }
      if (claim.calc && !out.calcs.includes(claim.calc)) out.calcs.push(claim.calc);
    }
  }
  return out;
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Text of the closing "Fuentes" card shown in the video (short names, one per line). */
export function creditCardText(c: Credits, max = 7): string {
  const names = [...new Set(c.sources.map((s) => (s.title.length > 46 ? `${s.title.slice(0, 44)}…` : s.title)))];
  const lines = names.slice(0, max);
  if (names.length > max) lines.push(`y ${names.length - max} más (ver descripción)`);
  const imgs = (c.images ?? []).slice(0, 4);
  if (imgs.length) lines.push('Imágenes:', ...imgs);
  const mus = (c.music ?? []).slice(0, 2);
  if (mus.length) lines.push('Música:', ...mus);
  const vid = (c.video ?? []).slice(0, 3);
  if (vid.length) lines.push('Video:', ...vid);
  return `Fuentes\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------- local page check
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "20.200", "20,200" and "20 200" all become 20200; decimal commas become dots. */
function normalizeNumbers(s: string): string {
  return s
    .replace(/(\d)[.,\s](?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d),(\d)/g, '$1.$2');
}

export function numbersIn(text: string): string[] {
  const n = normalizeNumbers(normalize(text));
  return [...new Set(n.match(/\d+(?:\.\d+)?/g) ?? [])].filter((x) => x.length > 1 || Number(x) > 9);
}

const STOP = new Set(['para', 'como', 'pero', 'porque', 'entre', 'sobre', 'desde', 'hasta', 'cada', 'solo', 'esta', 'este', 'estos', 'estas', 'tiene', 'tienen', 'puede', 'pueden', 'segun', 'donde', 'cuando', 'unos', 'unas']);

/**
 * Does the page text support the claim? Found when the quote appears (accents/case/spaces ignored), or when every
 * number in the claim appears together with most of its significant words.
 */
export function pageSupports(pageText: string, claimText: string, quote?: string): { found: boolean; snippet?: string } {
  const page = normalize(pageText);
  const q = quote ? normalize(quote) : '';
  if (q.length >= 12) {
    const at = page.indexOf(q);
    if (at >= 0) return { found: true, snippet: snip(pageText, page, at) };
  }
  const pageN = normalizeNumbers(page);
  const nums = numbersIn(`${claimText} ${quote ?? ""}`); // a quote with wrong figures must not pass on its words alone
  if (!nums.length) {
    // No figures to look for: require the quote's key words to appear close together.
    const words = (q || normalize(claimText)).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w));
    if (words.length < 3) return { found: false };
    const hit = words.filter((w) => page.includes(w)).length;
    return hit / words.length >= 0.8 ? { found: true } : { found: false };
  }
  if (!nums.every((n) => new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(pageN))) return { found: false };
  const words = normalize(claimText).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w));
  const hit = words.filter((w) => page.includes(w)).length;
  const ok = words.length === 0 || hit / words.length >= 0.5;
  return ok ? { found: true, snippet: snip(pageText, page, Math.max(0, pageN.indexOf(nums[0]!))) } : { found: false };
}

function snip(original: string, normalized: string, at: number): string {
  // Offsets in the normalized text approximate offsets in the original one (same length modulo accents).
  const ratio = original.length / Math.max(1, normalized.length);
  const i = Math.max(0, Math.round(at * ratio) - 80);
  return original.slice(i, i + 220).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------- safe URLs (SSRF guard)
/** Blocks addresses a web page must never make us request: loopback, private ranges, link-local, metadata. */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function checkableUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}
