import { describe, expect, it } from 'vitest';
import { decode, fetchRadar, parseNews, parseTrends, parseWiki, radarLines } from '../src/index.ts';

// Fixtures follow the public feed formats (Google Trends RSS, Google News RSS, Wikimedia REST).
const TRENDS = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item><title>selección colombia</title><ht:approx_traffic>200K+</ht:approx_traffic><pubDate>Thu, 12 Nov 2026 10:00:00 -0800</pubDate>
<ht:news_item><ht:news_item_title>Colombia &amp; Brasil: el partido</ht:news_item_title><ht:news_item_url>https://eltiempo.com/a</ht:news_item_url><ht:news_item_source>El Tiempo</ht:news_item_source></ht:news_item>
<ht:news_item><ht:news_item_title>Así quedó la tabla</ht:news_item_title><ht:news_item_url>https://semana.com/b</ht:news_item_url><ht:news_item_source>Semana</ht:news_item_source></ht:news_item></item>
<item><title>precio del café</title><ht:approx_traffic>20K+</ht:approx_traffic></item></channel></rss>`;
const NEWS = `<rss><channel><item><title><![CDATA[Huila exporta más café - El Diario del Huila]]></title><link>https://news.google.com/rss/articles/abc</link><pubDate>Thu, 12 Nov 2026 08:00:00 GMT</pubDate><source url="https://diariodelhuila.com">El Diario del Huila</source></item></channel></rss>`;
const WIKI = { items: [{ articles: [{ article: 'Portada', views: 9 }, { article: 'Especial:Buscar', views: 8 }, { article: 'Gabriel_García_Márquez', views: 12345 }, { article: 'Café', views: 999 }] }] };

describe('radar parsers', () => {
  it('decodes entities and CDATA', () => {
    expect(decode('A &amp; B &#233; <![CDATA[<b>x</b>]]>')).toBe('A & B é x');
  });
  it('Google Trends: title, traffic and the outlets covering it', () => {
    const t = parseTrends(TRENDS, 'CO');
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ kind: 'trend', title: 'selección colombia', source: 'Google Trends (CO)', metric: '200K+ búsquedas', url: 'https://eltiempo.com/a' });
    expect(t[0]!.evidence!.map((e) => e.source)).toEqual(['El Tiempo', 'Semana']);
    expect(t[0]!.evidence![0]!.title).toBe('Colombia & Brasil: el partido');
  });
  it('Google News: strips the outlet suffix and keeps the outlet as source', () => {
    const n = parseNews(NEWS, 'Huila', 10);
    expect(n[0]).toMatchObject({ title: 'Huila exporta más café', source: 'El Diario del Huila vía Google News (Huila)' });
  });
  it('Wikipedia: skips system pages and links the article', () => {
    const w = parseWiki(WIKI, '2026-11-12');
    expect(w.map((x) => x.title)).toEqual(['Gabriel García Márquez', 'Café']);
    expect(w[0]!.url).toBe('https://es.wikipedia.org/wiki/Gabriel_Garc%C3%ADa_M%C3%A1rquez');
  });
});

describe('fetchRadar', () => {
  const fakeFetch = (fail: string[] = []) => async (url: string | URL | Request) => {
    const u = String(url);
    if (fail.some((f) => u.includes(f))) throw new Error('blocked');
    if (u.includes('trends.google.com')) return new Response(TRENDS);
    if (u.includes('q=Huila')) return new Response(NEWS);
    if (u.includes('news.google.com')) return new Response(NEWS);
    return new Response(JSON.stringify(WIKI));
  };

  it('merges sources, numbers items and reports each source', async () => {
    const r = await fetchRadar({ fetcher: fakeFetch() as typeof fetch });
    expect(r.reports.map((x) => [x.id, x.status])).toEqual([['trends', 'ok'], ['news', 'ok'], ['local', 'ok'], ['wiki', 'ok']]);
    expect(r.items.map((i) => i.id)).toEqual(r.items.map((_, i) => i + 1));
    expect(radarLines(r.items)[0]).toBe('1|Google Trends (CO)|selección colombia|200K+ búsquedas|cobertura: El Tiempo, Semana');
  });
  it('a failing source is reported, not fatal', async () => {
    const r = await fetchRadar({ fetcher: fakeFetch(['wikimedia']) as typeof fetch });
    expect(r.reports.find((x) => x.id === 'wiki')).toMatchObject({ status: 'error', count: 0 });
    expect(r.reports.filter((x) => x.status === 'ok')).toHaveLength(3);
    expect(r.items.length).toBeGreaterThan(0);
  });
});
