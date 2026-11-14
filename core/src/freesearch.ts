// Free source search (no AI, no API keys): public search APIs + the same local figure/quote check.
//   - Wikipedia (es)            https://es.wikipedia.org/w/api.php   (MediaWiki API)
//   - OpenAlex                  https://api.openalex.org             (scholarly works, abstracts)
//   - Datos Abiertos Colombia   https://www.datos.gov.co             (Socrata open-data catalog)
// A source is kept only when its own text contains the claim's figures/words; anything else is dropped.
import { normalize, numbersIn, pageSupports, type SourceRef } from './verification.ts';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const UA = 'ContentHubPro/1.0 (personal content tool; source check)';
const STOP = new Set(['para', 'como', 'pero', 'porque', 'entre', 'sobre', 'desde', 'hasta', 'cada', 'solo', 'esta', 'este', 'estos', 'estas', 'tiene', 'tienen', 'puede', 'pueden', 'segun', 'donde', 'cuando', 'unos', 'unas', 'suscribete', 'comparte', 'video', 'canal']);

/** Sentences worth checking: with figures, names (capitalized mid-sentence) or enough substance. */
export function splitClaims(sceneText: string): string[] {
  const sentences = sceneText.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const worth = sentences.filter((s) => /\d/.test(s) || /[a-záéíóúñ,]\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/.test(s) || s.split(' ').length >= 8);
  return (worth.length ? worth : [sceneText.trim()]).slice(0, 3);
}

/** Search keywords: the claim's figures and its longest significant words. */
export function keywordsOf(claim: string, max = 6): string[] {
  const words = normalize(claim).split(/[^a-z0-9.]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w));
  const uniq = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, max);
  return [...numbersIn(claim).slice(0, 2), ...uniq];
}

export interface Candidate {
  title: string;
  url: string;
  /** The source's own text (article, abstract, dataset description) that the claim is checked against. */
  text: string;
  provider: 'wikipedia' | 'openalex' | 'datos';
}

// ----------------------------------------------------------------------------- parsers
export function parseWikiSearch(json: unknown): string[] {
  return ((json as { query?: { search?: { title: string }[] } }).query?.search ?? []).map((x) => x.title).slice(0, 3);
}

export function parseWikiExtract(json: unknown, lang: string): Candidate | null {
  const pages = Object.values((json as { query?: { pages?: Record<string, { title?: string; extract?: string }> } }).query?.pages ?? {});
  const p = pages[0];
  if (!p?.extract || !p.title) return null;
  return { title: `Wikipedia: ${p.title}`, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`, text: p.extract, provider: 'wikipedia' };
}

export function parseOpenAlex(json: unknown): Candidate[] {
  const results = (json as { results?: { id: string; display_name?: string; doi?: string; publication_year?: number; abstract_inverted_index?: Record<string, number[]> | null }[] }).results ?? [];
  return results.flatMap((r) => {
    const idx = r.abstract_inverted_index;
    if (!idx || !r.display_name) return [];
    const words: string[] = [];
    for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
    return [{ title: `${r.display_name}${r.publication_year ? ` (${r.publication_year})` : ''}`, url: r.doi ?? r.id, text: `${r.display_name}. ${words.filter(Boolean).join(' ')}`, provider: 'openalex' as const }];
  });
}

export function parseSocrata(json: unknown): Candidate[] {
  const results = (json as { results?: { resource?: { name?: string; description?: string }; link?: string; permalink?: string }[] }).results ?? [];
  return results.flatMap((r) => {
    const url = r.link ?? r.permalink;
    return url && r.resource?.name ? [{ title: `datos.gov.co: ${r.resource.name}`, url, text: `${r.resource.name}. ${r.resource.description ?? ''}`, provider: 'datos' as const }] : [];
  });
}

// ----------------------------------------------------------------------------- search
const json = async (f: Fetcher, url: string): Promise<unknown> => {
  const r = await f(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const wikiApi = (lang: string, params: string) => `https://${lang}.wikipedia.org/w/api.php?format=json&utf8=1&${params}`;

async function wikipedia(f: Fetcher, q: string, lang = 'es'): Promise<Candidate[]> {
  const titles = parseWikiSearch(await json(f, wikiApi(lang, `action=query&list=search&srlimit=3&srsearch=${encodeURIComponent(q)}`)));
  const out: Candidate[] = [];
  for (const t of titles) {
    const c = parseWikiExtract(await json(f, wikiApi(lang, `action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&titles=${encodeURIComponent(t)}`)), lang);
    if (c) out.push(c);
  }
  return out;
}

const openalex = async (f: Fetcher, q: string) =>
  parseOpenAlex(await json(f, `https://api.openalex.org/works?per-page=3&select=id,display_name,doi,publication_year,abstract_inverted_index&search=${encodeURIComponent(q)}`));

const datosgov = async (f: Fetcher, q: string) =>
  parseSocrata(await json(f, `https://api.us.socrata.com/api/catalog/v1?domains=www.datos.gov.co&search_context=www.datos.gov.co&limit=3&q=${encodeURIComponent(q)}`));

export interface FreeHit {
  source: SourceRef;
  provider: Candidate['provider'];
}

/** Co-occurrence check for claims without figures: the key words must sit close together, not just somewhere on the page. */
function windowed(text: string, claim: string): boolean {
  const words = keywordsOf(claim, 5);
  if (words.length < 3) return false;
  const t = normalize(text);
  const win = 600;
  for (let i = 0; i < t.length; i += 300) {
    const w = t.slice(i, i + win);
    if (words.filter((x) => w.includes(x)).length / words.length >= 0.8) return true;
  }
  return false;
}

/** Looks for up to `max` sources whose own text supports the claim. Providers are tried in order and a failing one is skipped. */
export async function searchFree(claim: string, o: { fetcher?: Fetcher; max?: number } = {}): Promise<FreeHit[]> {
  const f = o.fetcher ?? fetch;
  const max = o.max ?? 2;
  const q = keywordsOf(claim).join(' ');
  if (!q) return [];
  const hasNumbers = numbersIn(claim).length > 0;
  const hits: FreeHit[] = [];
  for (const provider of [() => wikipedia(f, q), () => openalex(f, q), () => datosgov(f, q)]) {
    if (hits.length >= max) break;
    let found: Candidate[] = [];
    try {
      found = await provider();
    } catch {
      continue;
    }
    for (const c of found) {
      if (hits.length >= max) break;
      const r = pageSupports(c.text, claim);
      if (!(hasNumbers ? r.found : r.found && windowed(c.text, claim))) continue;
      hits.push({ provider: c.provider, source: { title: c.title, url: c.url, check: 'found', snippet: r.snippet } });
    }
  }
  return hits;
}
