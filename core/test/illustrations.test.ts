import { describe, expect, it } from 'vitest';
import { artCredits, artQuery, creditLine, licenseOf, parseCommons, parseOpenverse, relevant, sanitizeSvg, scoreArt, searchArt, searchArtPlan, type ArtCandidate } from '../src/illustrations.ts';

describe('licenses', () => {
  it('accepts CC0, public domain and CC BY only', () => {
    expect(licenseOf('CC0 1.0')).toBe('cc0');
    expect(licenseOf('Public domain')).toBe('pdm');
    expect(licenseOf('Public Domain Mark 1.0')).toBe('pdm');
    expect(licenseOf('CC BY 4.0')).toBe('by');
    expect(licenseOf('CC BY-SA 4.0')).toBeNull();
    expect(licenseOf('CC BY-NC 2.0')).toBeNull();
    expect(licenseOf('CC BY-ND 2.0')).toBeNull();
    expect(licenseOf('All rights reserved')).toBeNull();
  });
  it('asks for credit only for CC BY', () => {
    const base = { title: 'Satelite GPS', author: 'Ana', page: 'https://x', licenseLabel: 'CC BY 4.0' };
    expect(creditLine({ ...base, license: 'by' })).toBe('«Satelite GPS», Ana (CC BY 4.0)');
    expect(creditLine({ ...base, license: 'cc0' })).toBe('');
  });
});

describe('parsers', () => {
  it('keeps free-license images of usable formats from Openverse', () => {
    const r = parseOpenverse({ results: [
      { id: 'a', title: 'Satellite', url: 'https://i/a.png', thumbnail: 'https://i/t.png', creator: 'Ana', license: 'by', license_version: '4.0', foreign_landing_url: 'https://p/a', filetype: 'png', tags: [{ name: 'orbit' }] },
      { id: 'b', title: 'NC', url: 'https://i/b.png', license: 'by-nc', filetype: 'png' },
      { id: 'c', title: 'Gif', url: 'https://i/c.gif', license: 'cc0', filetype: 'gif' },
    ] });
    expect(r.map((x) => x.id)).toEqual(['ov-a']);
    expect(r[0]).toMatchObject({ license: 'by', licenseLabel: 'CC BY 4.0', tags: ['orbit'] });
  });
  it('keeps free-license files from Commons and drops SA/NC and odd types', () => {
    const page = (id: number, lic: string, mime = 'image/png') => ({ pageid: id, title: `File:Pic${id}.png`, imageinfo: [{ url: `https://u/${id}`, thumburl: `https://t/${id}`, descriptionurl: `https://d/${id}`, mime, extmetadata: { LicenseShortName: { value: lic }, Artist: { value: '<a href="x">Luis</a>' } } }] });
    const r = parseCommons({ query: { pages: { 1: page(1, 'CC BY 4.0'), 2: page(2, 'CC BY-SA 4.0'), 3: page(3, 'Public domain'), 4: page(4, 'CC0', 'application/pdf') } } });
    expect(r.map((x) => x.id).sort()).toEqual(['wc-1', 'wc-3']);
    expect(r.find((x) => x.id === 'wc-1')?.author).toBe('Luis');
  });
});

describe('search', () => {
  const ov = { results: [{ id: 'a', title: 'GPS satellite in orbit', url: 'https://i/a.svg', creator: 'A', license: 'cc0', filetype: 'svg' }, { id: 'z', title: 'Random cat', url: 'https://i/z.png', license: 'cc0', filetype: 'png' }] };
  it('drops loose matches, prefers drawings, and survives a failing provider', async () => {
    const f = (async (u: string) => (u.includes('openverse') ? new Response(JSON.stringify(ov)) : new Response('x', { status: 500 }))) as unknown as typeof fetch;
    const r = await searchArt('gps satellite', f);
    expect(r.map((x) => x.id)).toEqual(['ov-a']);
  });
  it('returns nothing for an empty query without calling the network', async () => {
    let n = 0;
    expect(await searchArt('  ', (async () => { n++; return new Response('{}'); }) as unknown as typeof fetch)).toEqual([]);
    expect(n).toBe(0);
  });
  it('relevant() checks title and tags', () => {
    const c = parseOpenverse(ov);
    expect(relevant(c, 'satellite').length).toBe(1);
  });
  it('builds a local query from the scene text', () => {
    expect(artQuery('Los satélites GPS orbitan a 20.200 km de altura').split(' ').length).toBeLessThanOrEqual(3);
    expect(artQuery('Los satélites GPS orbitan a 20.200 km de altura')).not.toMatch(/\d/);
  });
});

describe('sanitizeSvg', () => {
  const ok = '<svg viewBox="0 0 800 600"><circle cx="400" cy="300" r="120" fill="#e8442b"/><rect x="100" y="100" width="50" height="50" fill="#222"/></svg>';
  it('accepts a plain SVG and adds the namespace', () => {
    expect(sanitizeSvg(ok)).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(sanitizeSvg('```svg\n' + ok + '\n```')).not.toBeNull();
  });
  it('does not mistake the namespace URL for an external reference', () => {
    expect(sanitizeSvg(ok.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))).not.toBeNull();
  });
  it('rejects links even when a namespace is present', () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect fill="url(https://evil/x)" width="4" height="4"/><circle r="3" cx="4" cy="4"/></svg>')).toBeNull();
  });
  it.each([
    ['script', '<svg viewBox="0 0 8 8"><script>alert(1)</script><circle r="3" cx="4" cy="4" fill="#000"/></svg>'],
    ['handler', '<svg viewBox="0 0 8 8"><circle onclick="x()" r="3" cx="4" cy="4" fill="#000"/><rect x="1" y="1" width="2" height="2"/></svg>'],
    ['external', '<svg viewBox="0 0 8 8"><rect x="1" y="1" width="2" height="2" fill="url(https://evil/x)"/><circle r="3" cx="4" cy="4"/></svg>'],
    ['link', '<svg viewBox="0 0 8 8"><image href="https://evil/x.png"/><circle r="3" cx="4" cy="4" fill="#000"/></svg>'],
    ['not svg', '<div>hola</div> y más texto suficiente para pasar el largo mínimo del filtro'],
  ])('rejects %s', (_n, svg) => expect(sanitizeSvg(svg)).toBeNull());
});

describe('credits', () => {
  it('lists each CC BY credit once for the delivered scenes', () => {
    const art = { k1: { id: 'a'.repeat(16), kind: 'image', ext: 'png', title: 't', origin: 'web', credit: '«A», X (CC BY 4.0)' }, k2: { id: 'b'.repeat(16), kind: 'svg', ext: 'svg', title: 't', origin: 'ai', credit: '' } } as const;
    const keyOf = (t: string) => (t === 'uno' || t === 'dos' ? 'k1' : 'k2');
    expect(artCredits([{ text: 'uno' }, { text: 'dos' }, { text: 'tres' }], art as never, keyOf)).toEqual(['«A», X (CC BY 4.0)']);
  });
});

describe('scoreArt / searchArtPlan', () => {
  const mk = (o: Partial<ArtCandidate>): ArtCandidate => ({ id: 'x', title: 'Untitled', url: 'https://i/x.jpg', thumb: 'https://i/x.jpg', author: '', license: 'cc0', licenseLabel: 'CC0', page: 'https://p', provider: 'openverse', tags: [], ...o });
  it('prefers a title match over a tag match, and the specific query over a broader one', () => {
    const inTitle = scoreArt(mk({ title: 'Deforestation in the Amazon' }), ['deforestation amazon', 'forest']);
    const inTags = scoreArt(mk({ title: 'Aerial photo', tags: ['deforestation', 'amazon'] }), ['deforestation amazon', 'forest']);
    const later = scoreArt(mk({ title: 'Green forest' }), ['deforestation amazon', 'forest']);
    expect(inTitle).toBeGreaterThan(inTags);
    expect(inTitle).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(0);
  });
  it('penalizes tiny images and panoramas', () => {
    const q = ['forest'];
    const good = scoreArt(mk({ title: 'Forest', width: 2000, height: 3000 }), q);
    expect(scoreArt(mk({ title: 'Forest', width: 300, height: 200 }), q)).toBeLessThan(good);
    expect(scoreArt(mk({ title: 'Forest', width: 6000, height: 1000 }), q)).toBeLessThan(good);
  });
  it('falls back to a broader query when the specific one finds nothing', async () => {
    const f = (async (u: string) => {
      const q = decodeURIComponent(u.split('q=')[1] ?? '').split('&')[0]!;
      const results = q === 'forest' ? [{ id: 'f1', title: 'Forest path', url: 'https://i/f1.jpg', creator: 'A', license: 'cc0', filetype: 'jpg', width: 1600, height: 2400 }] : [];
      return u.includes('openverse') ? new Response(JSON.stringify({ results })) : new Response('x', { status: 500 });
    }) as unknown as typeof fetch;
    const r = await searchArtPlan(['xylophone rainforest deforestation', 'forest'], { fetcher: f });
    expect(r.map((c) => c.id)).toEqual(['ov-f1']);
  });
  it('merges duplicates and returns nothing without queries', async () => {
    let n = 0;
    expect(await searchArtPlan([' ', ''], { fetcher: (async () => { n++; return new Response('{}'); }) as unknown as typeof fetch })).toEqual([]);
    expect(n).toBe(0);
  });
});
