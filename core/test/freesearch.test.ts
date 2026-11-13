import { describe, expect, it } from 'vitest';
import { keywordsOf, parseOpenAlex, parseSocrata, parseWikiExtract, parseWikiSearch, searchFree, splitClaims } from '../src/index.ts';

// Fixtures follow the public response formats of the MediaWiki, OpenAlex and Socrata APIs.
const WIKI_SEARCH = { query: { search: [{ title: 'Sistema de posicionamiento global' }, { title: 'Galileo' }] } };
const wikiExtract = (title: string, extract: string) => ({ query: { pages: { '1': { title, extract } } } });
const OPENALEX = { results: [
  { id: 'https://openalex.org/W1', display_name: 'GPS orbits', doi: 'https://doi.org/10.1/x', publication_year: 2008, abstract_inverted_index: { Los: [0], satélites: [1], GPS: [2], orbitan: [3], a: [4], 20200: [5], km: [6] } },
  { id: 'https://openalex.org/W2', display_name: 'Sin resumen', abstract_inverted_index: null },
] };
const SOCRATA = { results: [{ resource: { name: 'Producción de café', description: 'Toneladas por municipio' }, link: 'https://www.datos.gov.co/d/abcd-1234' }, { resource: { name: 'sin link' } }] };

describe('claims and keywords', () => {
  it('keeps sentences with figures, names or substance and drops fillers', () => {
    expect(splitClaims('Hola amigos. Los satélites orbitan a 20.200 km. ¡Suscríbete!')).toEqual(['Los satélites orbitan a 20.200 km.']);
    expect(splitClaims('¡Suscríbete!')).toEqual(['¡Suscríbete!']); // never returns nothing
  });
  it('builds keywords with figures first and no filler words', () => {
    const k = keywordsOf('Los satélites GPS orbitan a unos 20.200 km de altura');
    expect(k[0]).toBe('20200');
    expect(k).toEqual(expect.arrayContaining(['satelites', 'orbitan', 'altura']));
    expect(k).not.toContain('unos');
  });
});

describe('parsers', () => {
  it('reads MediaWiki search and extract', () => {
    expect(parseWikiSearch(WIKI_SEARCH)).toEqual(['Sistema de posicionamiento global', 'Galileo']);
    const c = parseWikiExtract(wikiExtract('Sistema de posicionamiento global', 'texto'), 'es')!;
    expect(c.url).toBe('https://es.wikipedia.org/wiki/Sistema_de_posicionamiento_global');
    expect(parseWikiExtract({ query: { pages: {} } }, 'es')).toBeNull();
  });
  it('rebuilds OpenAlex abstracts and skips works without one', () => {
    const r = parseOpenAlex(OPENALEX);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ url: 'https://doi.org/10.1/x', provider: 'openalex' });
    expect(r[0]!.text).toContain('Los satélites GPS orbitan a 20200 km');
  });
  it('reads Socrata catalog entries that have a link', () => {
    expect(parseSocrata(SOCRATA).map((c) => c.title)).toEqual(['datos.gov.co: Producción de café']);
  });
});

describe('searchFree', () => {
  const fake = (routes: Record<string, unknown>, fail: string[] = []) => async (url: string | URL | Request) => {
    const u = String(url);
    if (fail.some((x) => u.includes(x))) throw new Error('blocked');
    for (const [k, v] of Object.entries(routes)) if (u.includes(k)) return new Response(JSON.stringify(v));
    return new Response('{}');
  };
  const WIKI_TEXT = 'El segmento espacial del GPS consta de 24 satélites operativos que orbitan a una altura de 20.200 km sobre la Tierra.';
  const routes = { 'list=search': WIKI_SEARCH, 'prop=extracts': wikiExtract('Sistema de posicionamiento global', WIKI_TEXT), 'openalex.org': OPENALEX, 'socrata.com': SOCRATA };

  it('keeps only sources whose own text contains the figure, and cites them', async () => {
    const hits = await searchFree('Los satélites GPS orbitan a unos 20.200 km de altura', { fetcher: fake(routes) as typeof fetch });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.source).toMatchObject({ check: 'found', url: 'https://es.wikipedia.org/wiki/Sistema_de_posicionamiento_global' });
    expect(hits[0]!.source.snippet).toContain('20.200');
  });
  it('drops sources with a different figure and survives a failing provider', async () => {
    expect(await searchFree('Los satélites GPS orbitan a 36.000 km de altura', { fetcher: fake(routes) as typeof fetch })).toEqual([]);
    const hits = await searchFree('Los satélites GPS orbitan a unos 20.200 km de altura', { fetcher: fake(routes, ['wikipedia.org']) as typeof fetch });
    expect(hits.map((h) => h.provider)).toEqual(['openalex']); // Wikipedia was blocked; OpenAlex still found it
  });
  it('claims without figures need the key words close together', async () => {
    const far = 'Los satélites orbitan. ' + 'relleno '.repeat(300) + 'La órbita de transferencia geoestacionaria usa propulsores químicos.';
    const r = { 'list=search': WIKI_SEARCH, 'prop=extracts': wikiExtract('X', far) };
    expect(await searchFree('Los satélites geoestacionarios usan propulsores químicos para la órbita', { fetcher: fake(r) as typeof fetch })).toEqual([]);
    const near = { 'list=search': WIKI_SEARCH, 'prop=extracts': wikiExtract('X', 'Los satélites geoestacionarios usan propulsores químicos para ajustar la órbita.') };
    expect((await searchFree('Los satélites geoestacionarios usan propulsores químicos para la órbita', { fetcher: fake(near) as typeof fetch })).length).toBeGreaterThanOrEqual(1);
  });
});
