// Real-data radar for topic ideas. Every item keeps the name and link of where it came from.
// Sources (all public, no API keys):
//   - Google Trends daily trending searches (Colombia)  https://trends.google.com/trending?geo=CO
//   - Google News top stories (Colombia) and a regional query  https://news.google.com
//   - Wikipedia (es) most-viewed articles, via the Wikimedia REST API  https://wikimedia.org/api/rest_v1
import { attr, blocks, tag } from './rss.ts';

export interface RadarEvidence {
  title: string;
  url: string;
  source: string;
}

export interface RadarItem {
  id: number;
  kind: 'trend' | 'news' | 'wiki';
  title: string;
  /** Human-readable origin, e.g. "Google Trends (CO)" or "El Tiempo vía Google News". */
  source: string;
  url?: string;
  metric?: string;
  date?: string;
  evidence?: RadarEvidence[];
}

export interface SourceReport {
  id: string;
  name: string;
  homepage: string;
  status: 'ok' | 'error';
  count: number;
  fetchedAt: string;
  error?: string;
  note: string;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Raw = Omit<RadarItem, 'id'>;

const UA = 'ContentHubPro/1.0 (personal content tool; contact via repository)';
const get = async (f: Fetcher, url: string): Promise<Response> => {
  const r = await f(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};

export function parseTrends(xml: string, geo: string): Raw[] {
  return blocks(xml, 'item').slice(0, 20).map((b): Raw => {
    const traffic = tag(b, 'ht:approx_traffic');
    const evidence = blocks(b, 'ht:news_item').slice(0, 2).map((n) => ({
      title: tag(n, 'ht:news_item_title') ?? '', url: tag(n, 'ht:news_item_url') ?? '', source: tag(n, 'ht:news_item_source') ?? 'Medio',
    })).filter((e) => e.title && e.url);
    return {
      kind: 'trend', title: tag(b, 'title') ?? '', source: `Google Trends (${geo})`, url: evidence[0]?.url,
      metric: traffic ? `${traffic} búsquedas` : undefined, date: tag(b, 'pubDate'), evidence,
    };
  }).filter((i) => i.title);
}

export function parseNews(xml: string, label: string, limit: number): Raw[] {
  return blocks(xml, 'item').slice(0, limit).map((b): Raw => {
    const outlet = tag(b, 'source') ?? 'Medio';
    const raw = tag(b, 'title') ?? '';
    const title = raw.endsWith(` - ${outlet}`) ? raw.slice(0, -(outlet.length + 3)) : raw;
    return { kind: 'news', title, source: `${outlet} vía Google News (${label})`, url: tag(b, 'link'), date: tag(b, 'pubDate') };
  }).filter((i) => i.title);
}

const WIKI_SKIP = /^(Wikipedia:|Especial:|Portada|Ayuda:|Categor[ií]a:|Archivo:|Plantilla:|Anexo:|Usuario:|Discusi[oó]n:)/i;
export function parseWiki(json: unknown, date: string): Raw[] {
  const articles = ((json as { items?: { articles?: { article: string; views: number }[] }[] }).items?.[0]?.articles ?? []);
  return articles
    .filter((a) => !WIKI_SKIP.test(a.article) && a.article !== '-')
    .slice(0, 15)
    .map((a) => ({
      kind: 'wiki', title: a.article.replace(/_/g, ' '), source: 'Wikipedia en español (más leídos)',
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(a.article)}`, metric: `${a.views.toLocaleString('es-CO')} visitas`, date,
    }));
}

const ymd = (d: Date) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;

interface Source {
  id: string;
  name: string;
  homepage: string;
  note: string;
  load: (f: Fetcher, o: RadarOptions) => Promise<Raw[]>;
}

export interface RadarOptions {
  geo?: string;
  region?: string;
  fetcher?: Fetcher;
  now?: () => Date;
}

const gnews = (q: string | null, geo: string) =>
  `https://news.google.com/rss${q ? `/search?q=${encodeURIComponent(q)}&` : '?'}hl=es-419&gl=${geo}&ceid=${geo}:es-419`;

export const SOURCES: Source[] = [
  {
    id: 'trends', name: 'Google Trends · búsquedas en tendencia', homepage: 'https://trends.google.com/trending?geo=CO',
    note: 'Búsquedas que más crecen hoy en el país, con volumen aproximado.',
    load: async (f, o) => parseTrends(await (await get(f, `https://trends.google.com/trending/rss?geo=${o.geo ?? 'CO'}`)).text(), o.geo ?? 'CO'),
  },
  {
    id: 'news', name: 'Google News · titulares del país', homepage: 'https://news.google.com/',
    note: 'Titulares principales de medios colombianos.',
    load: async (f, o) => parseNews(await (await get(f, gnews(null, o.geo ?? 'CO'))).text(), o.geo ?? 'CO', 15),
  },
  {
    id: 'local', name: 'Google News · noticias regionales', homepage: 'https://news.google.com/',
    note: 'Noticias que mencionan tu región.',
    load: async (f, o) => parseNews(await (await get(f, gnews(o.region ?? 'Huila', o.geo ?? 'CO'))).text(), o.region ?? 'Huila', 10),
  },
  {
    id: 'wiki', name: 'Wikipedia (es) · artículos más leídos', homepage: 'https://es.wikipedia.org/',
    note: 'Qué está leyendo la gente en español (señal de interés, no de Colombia en exclusiva).',
    load: async (f, o) => {
      const now = (o.now ?? (() => new Date()))();
      for (const back of [1, 2]) {
        const d = new Date(now.getTime() - back * 86_400_000);
        const r = await f(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/es.wikipedia/all-access/${ymd(d)}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
        if (r.ok) return parseWiki(await r.json(), ymd(d).replace(/\//g, '-'));
      }
      throw new Error('Sin datos de Wikimedia');
    },
  },
];

export async function fetchRadar(o: RadarOptions = {}): Promise<{ items: RadarItem[]; reports: SourceReport[]; fetchedAt: string }> {
  const f: Fetcher = o.fetcher ?? fetch;
  const results = await Promise.all(
    SOURCES.map(async (s) => {
      const fetchedAt = new Date().toISOString();
      try {
        const raw = await s.load(f, o);
        return { s, raw, report: { id: s.id, name: s.name, homepage: s.homepage, status: 'ok' as const, count: raw.length, fetchedAt, note: s.note } };
      } catch (e) {
        return { s, raw: [] as Raw[], report: { id: s.id, name: s.name, homepage: s.homepage, status: 'error' as const, count: 0, fetchedAt, error: e instanceof Error ? e.message : String(e), note: s.note } };
      }
    }),
  );
  const items = results.flatMap((r) => r.raw).map((it, i) => ({ ...it, id: i + 1 }));
  return { items, reports: results.map((r) => r.report), fetchedAt: new Date().toISOString() };
}

/** Compact lines for the AI: one per item, with the evidence outlets, so topics can cite ids. */
export function radarLines(items: RadarItem[]): string[] {
  return items.map((i) => `${i.id}|${i.source}|${i.title}${i.metric ? `|${i.metric}` : ''}${i.evidence?.length ? `|cobertura: ${i.evidence.map((e) => e.source).join(', ')}` : ''}`);
}
