import { describe, expect, it } from 'vitest';
import { archiveLicense, brollCredit, brollCredits, parseArchive, parseCommonsVideo, parseNasa, parsePexels, parsePixabay, pickArchiveFile, pickNasaFile, pickPexelsFile, rankBroll, searchBroll, type BrollCandidate } from '../src/broll.ts';
import { creditCardText } from '../src/verification.ts';

const cand = (o: Partial<BrollCandidate>): BrollCandidate => ({ id: 'x', title: 'Satellite orbit', author: 'Ana', provider: 'commons', url: 'https://x/v.webm', thumb: '', page: '', durationSec: 10, width: 1920, height: 1080, license: 'cc0', licenseLabel: 'CC0', tags: [], ...o });

describe('parsers', () => {
  it('picks the Pexels file closest to 1080 px (mp4 only)', () => {
    const f = pickPexelsFile([{ file_type: 'video/mp4', width: 3840, height: 2160, link: 'uhd' }, { file_type: 'video/mp4', width: 1920, height: 1080, link: 'hd' }, { file_type: 'video/mp4', width: 640, height: 360, link: 'sd' }, { file_type: 'video/webm', width: 1920, height: 1080, link: 'webm' }]);
    expect(f?.link).toBe('hd');
    const r = parsePexels({ videos: [{ id: 7, url: 'https://p/7', image: 'https://i/7.jpg', duration: 12, user: { name: 'Luis' }, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://v/7.mp4' }] }, { id: 8, video_files: [] }] });
    expect(r.map((c) => c.id)).toEqual(['px-7']);
    expect(r[0]).toMatchObject({ provider: 'pexels', license: 'free', durationSec: 12, height: 1920 });
  });
  it('reads Pixabay hits and builds the thumbnail', () => {
    const r = parsePixabay({ hits: [{ id: 5, pageURL: 'https://pb/5', tags: 'ocean, waves, sea', duration: 9, picture_id: '123', user: 'Eva', videos: { large: { url: '', width: 0 }, medium: { url: 'https://v/m.mp4', width: 1280, height: 720 }, small: { url: 'https://v/s.mp4', width: 640, height: 360 } } }, { id: 6, videos: {} }] });
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ id: 'pb-5', title: 'ocean', url: 'https://v/m.mp4', thumb: 'https://i.vimeocdn.com/video/123_640x360.jpg', tags: ['ocean', 'waves', 'sea'] });
  });
  it('keeps free-license webm/ogg videos from Commons only', () => {
    const page = (id: number, lic: string, mime: string) => ({ pageid: id, title: `File:Clip${id}.webm`, imageinfo: [{ url: `https://u/${id}`, thumburl: `https://t/${id}`, descriptionurl: `https://d/${id}`, mime, width: 1280, height: 720, extmetadata: { LicenseShortName: { value: lic }, Artist: { value: '<a>Mia</a>' } } }] });
    const r = parseCommonsVideo({ query: { pages: { 1: page(1, 'CC BY 4.0', 'video/webm'), 2: page(2, 'CC BY-SA 4.0', 'video/webm'), 3: page(3, 'Public domain', 'video/ogg'), 4: page(4, 'CC0', 'image/png') } } });
    expect(r.map((c) => c.id).sort()).toEqual(['wc-1', 'wc-3']);
  });
  it('accepts only public domain, CC0 and plain CC BY on archive.org', () => {
    expect(archiveLicense('http://creativecommons.org/publicdomain/zero/1.0/')?.license).toBe('cc0');
    expect(archiveLicense('https://creativecommons.org/publicdomain/mark/1.0/')?.license).toBe('pdm');
    expect(archiveLicense('http://creativecommons.org/licenses/by/4.0/')).toEqual({ license: 'by', label: 'CC BY 4.0' });
    expect(archiveLicense('http://creativecommons.org/licenses/by-sa/4.0/')).toBeNull();
    expect(archiveLicense('http://creativecommons.org/licenses/by-nc/3.0/')).toBeNull();
    const r = parseArchive({ response: { docs: [{ identifier: 'abc', title: ['Mi video'], creator: 'Zoe', licenseurl: 'http://creativecommons.org/licenses/by/3.0/', runtime: '01:02:03' }, { identifier: 'def', licenseurl: 'http://example.com/all-rights' }] } });
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ id: 'ia-abc', title: 'Mi video', durationSec: 3723, resolve: 'archive', license: 'by' });
  });
  it('resolves archive and NASA files', () => {
    const files = { files: [{ name: 'a.ogv', format: 'Ogg Video', size: '900000' }, { name: 'tiny.mp4', format: '512Kb MPEG4', size: '300000' }, { name: 'mid.mp4', format: 'h.264', size: '5000000' }, { name: 'huge.mp4', format: 'h.264', size: '900000000' }, { name: 'big.mp4', format: 'MPEG4', size: '20000000' }] };
    expect(pickArchiveFile('abc', files)).toBe('https://archive.org/download/abc/mid.mp4');
    expect(pickArchiveFile('abc', { files: [] })).toBeNull();
    expect(pickNasaFile(['https://a/x~orig.mp4', 'https://a/x~medium.mp4', 'https://a/x.srt'])).toBe('https://a/x~medium.mp4');
    expect(pickNasaFile(['https://a/x.jpg'])).toBeNull();
    const n = parseNasa({ collection: { items: [{ href: 'https://a/collection.json', data: [{ nasa_id: 'N1', title: 'Launch', center: 'JSC' }], links: [{ href: 'https://a/t.jpg' }] }, { data: [] }] } });
    expect(n.length).toBe(1);
    expect(n[0]).toMatchObject({ id: 'na-N1', resolve: 'nasa', license: 'nasa', author: 'JSC' });
  });
});

describe('credits and ranking', () => {
  it('asks for credit for CC BY and NASA only', () => {
    expect(brollCredit(cand({ license: 'by', licenseLabel: 'CC BY 4.0' }))).toBe('«Satellite orbit», Ana (CC BY 4.0)');
    expect(brollCredit(cand({ license: 'nasa', provider: 'nasa' }))).toBe('NASA — «Satellite orbit»');
    expect(brollCredit(cand({ license: 'free', provider: 'pexels' }))).toBe('');
    expect(brollCredit(cand({}))).toBe('');
  });
  it('lists each credit once and shows it on the closing card', () => {
    const b = { k1: { id: 'a'.repeat(16), title: 't', author: '', provider: 'commons', durationSec: 5, credit: '«A», X (CC BY 4.0)' }, k2: { id: 'b'.repeat(16), title: 't', author: '', provider: 'pexels', durationSec: 5, credit: '' } } as const;
    const keyOf = (t: string) => (t === 'a' || t === 'b' ? 'k1' : 'k2');
    expect(brollCredits([{ text: 'a' }, { text: 'b' }, { text: 'c' }], b as never, keyOf)).toEqual(['«A», X (CC BY 4.0)']);
    expect(creditCardText({ sources: [], calcs: [], video: ['NASA — «Launch»'] })).toContain('Video:\nNASA — «Launch»');
  });
  it('mixes sources and prefers the right orientation', () => {
    const r = rankBroll([cand({ id: 'wc1', provider: 'commons' }), cand({ id: 'wc2', provider: 'commons' }), cand({ id: 'px1', provider: 'pexels', width: 1080, height: 1920 }), cand({ id: 'px2', provider: 'pexels', width: 1920, height: 1080 }), cand({ id: 'na1', provider: 'nasa', width: 0, height: 0 })], true);
    expect(r.map((c) => c.id).slice(0, 3)).toEqual(['px1', 'wc1', 'na1']);
    expect(r.findIndex((c) => c.id === 'px1')).toBeLessThan(r.findIndex((c) => c.id === 'px2'));
  });
});

describe('search', () => {
  const fake = (async (u: string) => {
    if (u.includes('commons.wikimedia')) return new Response(JSON.stringify({ query: { pages: { 1: { pageid: 1, title: 'File:Satellite launch.webm', imageinfo: [{ url: 'https://u/1', mime: 'video/webm', width: 1280, height: 720, extmetadata: { LicenseShortName: { value: 'CC0' } } }] }, 2: { pageid: 2, title: 'File:Cat.webm', imageinfo: [{ url: 'https://u/2', mime: 'video/webm', extmetadata: { LicenseShortName: { value: 'CC0' } } }] } } } }));
    if (u.includes('api.pexels.com')) return new Response(JSON.stringify({ videos: [{ id: 1, video_files: [{ file_type: 'video/mp4', width: 1080, height: 1920, link: 'https://v/1.mp4' }] }] }));
    return new Response('x', { status: 500 });
  }) as unknown as typeof fetch;
  it('uses the keyed source only with a key, drops loose matches and survives failing sources', async () => {
    const without = await searchBroll('satellite launch', { fetcher: fake });
    expect(without.map((c) => c.id)).toEqual(['wc-1']);
    const withKey = await searchBroll('satellite launch', { fetcher: fake, keys: { pexels: 'KEY' }, portrait: true });
    expect(withKey.map((c) => c.id)).toEqual(['px-1', 'wc-1']);
  });
  it('does nothing for an empty query', async () => {
    let n = 0;
    expect(await searchBroll('  ', { fetcher: (async () => { n++; return new Response('{}'); }) as unknown as typeof fetch })).toEqual([]);
    expect(n).toBe(0);
  });
});
