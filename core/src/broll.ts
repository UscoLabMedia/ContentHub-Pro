// B-roll: free stock video as the background of a scene. Sources (all free; the first three need no key):
//   Wikimedia Commons, Internet Archive (public domain / CC0 / CC BY), NASA media library,
//   Pexels and Pixabay (free API keys the person pastes once; their licenses allow commercial use).
// Only licenses that allow commercial use are accepted; CC BY and NASA ask for a credit, which goes on the closing
// card and in the description like the other credits.
import { licenseOf } from './illustrations.ts';
import { normalize } from './verification.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const UA = 'ContentHubPro/1.0 (personal content tool; video search)';

export type BrollProvider = 'pexels' | 'pixabay' | 'commons' | 'archive' | 'nasa';
export type BrollLicense = 'cc0' | 'pdm' | 'by' | 'free' | 'nasa';

export interface BrollCandidate {
  id: string;
  title: string;
  author: string;
  provider: BrollProvider;
  /** The video file, or (archive/nasa) the address that lists the files, resolved when the clip is downloaded. */
  url: string;
  resolve?: 'archive' | 'nasa';
  thumb: string;
  page: string;
  durationSec: number;
  width: number;
  height: number;
  license: BrollLicense;
  licenseLabel: string;
  tags: string[];
}

/** What a scene keeps; the mp4 (no audio, 1080 px wide at most, 30 s at most) lives in the server's broll folder. */
export interface BrollRef {
  id: string;
  title: string;
  author: string;
  provider: BrollProvider;
  durationSec: number;
  /** Ready-to-print credit line; empty when none is required. */
  credit: string;
}

export const isBrollId = (s: string): boolean => /^[a-f0-9]{16}$/.test(s);
export const MAX_CLIP_SECONDS = 30;

export const PROVIDER_LABEL: Record<BrollProvider, string> = { pexels: 'Pexels', pixabay: 'Pixabay', commons: 'Wikimedia Commons', archive: 'Internet Archive', nasa: 'NASA' };

export function brollCredit(c: Pick<BrollCandidate, 'title' | 'author' | 'license' | 'licenseLabel' | 'provider'>): string {
  const t = c.title.length > 50 ? `${c.title.slice(0, 48)}…` : c.title;
  if (c.license === 'by') return `«${t}»${c.author ? `, ${c.author}` : ''} (${c.licenseLabel})`;
  if (c.license === 'nasa') return `NASA — «${t}»`;
  return ''; // public domain, CC0, Pexels and Pixabay licenses do not require attribution
}

const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ----------------------------------------------------------------------------- parsers
/** The file closest to 1080 px wide (but at least 640), mp4 only. */
export function pickPexelsFile(files: { file_type?: string; width?: number; height?: number; link?: string }[]): { link: string; width: number; height: number } | null {
  const ok = files.filter((f) => f.link && /mp4/.test(f.file_type ?? '') && (f.width ?? 0) >= 640);
  const best = ok.sort((a, b) => Math.abs(Math.min(a.width!, a.height!) - 1080) - Math.abs(Math.min(b.width!, b.height!) - 1080))[0];
  return best ? { link: best.link!, width: best.width!, height: best.height ?? 0 } : null;
}

export function parsePexels(json: unknown): BrollCandidate[] {
  const vids = (json as { videos?: { id?: number; url?: string; image?: string; duration?: number; user?: { name?: string }; video_files?: Parameters<typeof pickPexelsFile>[0] }[] }).videos ?? [];
  return vids.flatMap((v) => {
    const f = pickPexelsFile(v.video_files ?? []);
    if (!v.id || !f) return [];
    return [{ id: `px-${v.id}`, title: `Video ${v.id}`, author: v.user?.name ?? '', provider: 'pexels' as const, url: f.link, thumb: v.image ?? '', page: v.url ?? '', durationSec: v.duration ?? 0, width: f.width, height: f.height, license: 'free' as const, licenseLabel: 'Licencia Pexels', tags: [] }];
  });
}

export function parsePixabay(json: unknown): BrollCandidate[] {
  type Size = { url?: string; width?: number; height?: number };
  const hits = (json as { hits?: { id?: number; pageURL?: string; tags?: string; duration?: number; picture_id?: string; user?: string; videos?: Record<string, Size | undefined> }[] }).hits ?? [];
  return hits.flatMap((h) => {
    const s = [h.videos?.large, h.videos?.medium, h.videos?.small].find((x) => x?.url && (x.width ?? 0) >= 640);
    if (!h.id || !s?.url) return [];
    return [{ id: `pb-${h.id}`, title: (h.tags ?? '').split(',')[0]?.trim() || `Video ${h.id}`, author: h.user ?? '', provider: 'pixabay' as const, url: s.url, thumb: h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg` : '', page: h.pageURL ?? '', durationSec: h.duration ?? 0, width: s.width ?? 0, height: s.height ?? 0, license: 'free' as const, licenseLabel: 'Licencia Pixabay', tags: (h.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean) }];
  });
}

export function parseCommonsVideo(json: unknown): BrollCandidate[] {
  type Meta = Record<string, { value?: string } | undefined>;
  const pages = Object.values((json as { query?: { pages?: Record<string, { pageid?: number; title?: string; imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; mime?: string; width?: number; height?: number; extmetadata?: Meta }[] }> } }).query?.pages ?? {});
  return pages.flatMap((p) => {
    const i = p.imageinfo?.[0];
    const label = i?.extmetadata?.LicenseShortName?.value ?? '';
    const lic = licenseOf(label);
    if (!i || !lic || !p.title || !i.url || !/^video\/(webm|ogg)/.test(i.mime ?? '')) return [];
    return [{ id: `wc-${p.pageid ?? p.title}`, title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''), author: stripHtml(i.extmetadata?.Artist?.value ?? ''), provider: 'commons' as const, url: i.url, thumb: i.thumburl ?? '', page: i.descriptionurl ?? i.url, durationSec: Number(i.extmetadata?.Duration?.value) || 0, width: i.width ?? 0, height: i.height ?? 0, license: lic, licenseLabel: lic === 'by' ? label || 'CC BY' : lic === 'cc0' ? 'CC0' : 'Dominio público', tags: stripHtml(i.extmetadata?.ImageDescription?.value ?? '').split(' ').slice(0, 30) }];
  });
}

/** archive.org licenseurl -> allowed license (CC0, public domain, CC BY; never SA/NC/ND). */
export function archiveLicense(url: string): { license: BrollLicense; label: string } | null {
  const u = url.toLowerCase();
  if (/publicdomain\/zero/.test(u)) return { license: 'cc0', label: 'CC0' };
  if (/publicdomain/.test(u)) return { license: 'pdm', label: 'Dominio público' };
  const m = u.match(/creativecommons\.org\/licenses\/by\/(\d(?:\.\d)?)/);
  return m ? { license: 'by', label: `CC BY ${m[1]}` } : null;
}

export function parseArchive(json: unknown): BrollCandidate[] {
  const docs = (json as { response?: { docs?: { identifier?: string; title?: string | string[]; creator?: string | string[]; licenseurl?: string; runtime?: string }[] } }).response?.docs ?? [];
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  return docs.flatMap((d) => {
    const lic = archiveLicense(d.licenseurl ?? '');
    if (!d.identifier || !lic) return [];
    const parts = (d.runtime ?? '').split(':').map(Number);
    const sec = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts.length === 2 ? parts[0]! * 60 + parts[1]! : Number(d.runtime) || 0;
    return [{ id: `ia-${d.identifier}`, title: one(d.title) || d.identifier, author: one(d.creator), provider: 'archive' as const, url: d.identifier, resolve: 'archive' as const, thumb: `https://archive.org/services/img/${d.identifier}`, page: `https://archive.org/details/${d.identifier}`, durationSec: sec, width: 0, height: 0, license: lic.license, licenseLabel: lic.label, tags: [] }];
  });
}

/** The smallest sensible mp4/h.264 file of an archive.org item (from /metadata/<id>), or null. */
export function pickArchiveFile(identifier: string, json: unknown): string | null {
  const files = (json as { files?: { name?: string; format?: string; size?: string }[] }).files ?? [];
  const ok = files.filter((f) => f.name && /h\.264|mpeg4/i.test(f.format ?? '') && Number(f.size) > 50_000 && Number(f.size) < 150 * 1024 * 1024);
  const best = ok.sort((a, b) => Number(a.size) - Number(b.size))[ok.length > 2 ? 1 : 0]; // not the tiniest (low quality), not the biggest
  return best ? `https://archive.org/download/${identifier}/${encodeURIComponent(best.name!)}` : null;
}

export function parseNasa(json: unknown): BrollCandidate[] {
  const items = (json as { collection?: { items?: { href?: string; data?: { nasa_id?: string; title?: string; center?: string; photographer?: string; secondary_creator?: string }[]; links?: { href?: string }[] }[] } }).collection?.items ?? [];
  return items.flatMap((it) => {
    const d = it.data?.[0];
    if (!d?.nasa_id || !it.href) return [];
    return [{ id: `na-${d.nasa_id}`, title: d.title ?? d.nasa_id, author: d.photographer || d.secondary_creator || d.center || 'NASA', provider: 'nasa' as const, url: it.href, resolve: 'nasa' as const, thumb: it.links?.[0]?.href ?? '', page: `https://images.nasa.gov/details/${d.nasa_id}`, durationSec: 0, width: 0, height: 0, license: 'nasa' as const, licenseLabel: 'NASA', tags: [] }];
  });
}

/** From the list of files of a NASA item: a medium mp4 is plenty. */
export function pickNasaFile(json: unknown): string | null {
  const urls = (Array.isArray(json) ? json : []).filter((u): u is string => typeof u === 'string' && /\.mp4$/i.test(u));
  const by = (re: RegExp) => urls.find((u) => re.test(u));
  return by(/~medium\.mp4$/i) ?? by(/~mobile\.mp4$/i) ?? by(/~small\.mp4$/i) ?? by(/~orig\.mp4$/i) ?? urls[0] ?? null;
}

// ----------------------------------------------------------------------------- search
export interface BrollKeys { pexels?: string; pixabay?: string }

/** Round-robin by provider so the first results come from different sources; portrait/landscape matches first. */
export function rankBroll(cands: BrollCandidate[], portrait: boolean): BrollCandidate[] {
  const fit = (c: BrollCandidate) => (c.width && c.height ? ((c.height > c.width) === portrait ? 0 : 1) : 0.5) + (c.durationSec && c.durationSec < 3 ? 1 : 0);
  const by = new Map<BrollProvider, BrollCandidate[]>();
  for (const c of [...cands].sort((a, b) => fit(a) - fit(b))) by.set(c.provider, [...(by.get(c.provider) ?? []), c]);
  const order: BrollProvider[] = ['pexels', 'pixabay', 'commons', 'nasa', 'archive'];
  const lists = order.map((p) => by.get(p) ?? []).filter((l) => l.length);
  const out: BrollCandidate[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

/** Search every available source; a source that fails is skipped. Never throws. */
export async function searchBroll(query: string, o: { keys?: BrollKeys; portrait?: boolean; fetcher?: Fetcher; limit?: number } = {}): Promise<BrollCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const f = o.fetcher ?? fetch;
  const get = async (url: string, headers: Record<string, string> = {}): Promise<unknown> => {
    const r = await f(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  const enc = encodeURIComponent;
  const jobs: Promise<BrollCandidate[]>[] = [
    get(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${enc(`${q} filetype:video`)}&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=640`).then(parseCommonsVideo),
    get(`https://archive.org/advancedsearch.php?q=${enc(`${q} AND mediatype:movies AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons.org/licenses/by/*)`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=runtime&rows=8&output=json`).then(parseArchive),
    get(`https://images-api.nasa.gov/search?q=${enc(q)}&media_type=video&page_size=8`).then(parseNasa),
  ];
  if (o.keys?.pexels) jobs.push(get(`https://api.pexels.com/videos/search?query=${enc(q)}&per_page=8&orientation=${o.portrait ? 'portrait' : 'landscape'}`, { authorization: o.keys.pexels }).then(parsePexels));
  if (o.keys?.pixabay) jobs.push(get(`https://pixabay.com/api/videos/?key=${enc(o.keys.pixabay)}&q=${enc(q)}&per_page=8&safesearch=true`).then(parsePixabay));
  const all = (await Promise.allSettled(jobs)).flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  const words = normalize(q).split(/\s+/).filter((w) => w.length >= 3);
  // keyless sources match loosely: keep those whose title/tags mention a search word; key-based ones are already ranked by relevance
  const related = all.filter((c) => c.provider === 'pexels' || c.provider === 'pixabay' || !words.length || words.some((w) => normalize(`${c.title} ${c.tags.join(' ')}`).includes(w.slice(0, Math.max(4, w.length - 2)))));
  return rankBroll(related, o.portrait ?? true).slice(0, o.limit ?? 6);
}

/** Credit lines of the B-roll used by the delivered scenes (unique, only those that require one). */
export function brollCredits(scenes: { text: string }[], broll: Record<string, BrollRef | undefined>, keyOf: (t: string) => string): string[] {
  const out: string[] = [];
  for (const s of scenes) {
    const b = broll[keyOf(s.text)];
    if (b?.credit && !out.includes(b.credit)) out.push(b.credit);
  }
  return out;
}
