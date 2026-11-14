import { describe, expect, it } from 'vitest';
import { checkableUrl, creditCardText, creditsFrom, gate, isPrivateAddress, numbersIn, pageSupports, sceneStatus, textKey, type SceneCheck } from '../src/index.ts';

const src = (over = {}) => ({ title: 'GPS.gov', url: 'https://www.gps.gov/systems/gps/space/', check: 'found' as const, ...over });
const check = (text: string, over: Partial<SceneCheck> = {}): SceneCheck => ({ textKey: textKey(text), claims: [{ text, sources: [src()] }], ...over });

describe('scene status and gate', () => {
  it('verified needs every claim backed by a found (or person-confirmed) source', () => {
    expect(sceneStatus(undefined)).toBe('pending');
    expect(sceneStatus({ textKey: 'x', claims: [] })).toBe('pending');
    expect(sceneStatus({ textKey: 'x', opinion: true, claims: [] })).toBe('opinion');
    expect(sceneStatus(check('a'))).toBe('verified');
    expect(sceneStatus({ textKey: 'x', claims: [{ text: 'a', sources: [src({ check: 'not-found' })] }] })).toBe('pending');
    expect(sceneStatus({ textKey: 'x', claims: [{ text: 'a', sources: [src({ check: 'not-found', manual: true })] }] })).toBe('verified');
    expect(sceneStatus({ textKey: 'x', claims: [{ text: 'a', sources: [src()] }, { text: 'b', sources: [] }] })).toBe('pending');
  });
  it('the gate lists pending scenes and editing a scene invalidates its check', () => {
    const scenes = [{ text: 'Hay 24 satélites' }, { text: '¡Suscríbete!' }, { text: 'Órbita de 20.200 km' }];
    const checks = { [textKey(scenes[0]!.text)]: check(scenes[0]!.text), [textKey(scenes[1]!.text)]: { textKey: 'k', opinion: true, claims: [] } };
    const g = gate(scenes, checks);
    expect(g).toMatchObject({ ok: false, verified: 1, opinion: 1, pending: [2] });
    expect(gate([{ text: 'Hay 25 satélites' }, scenes[1]!, scenes[2]!], checks).pending).toEqual([0, 2]);
    expect(textKey('Hay  24   satélites')).toBe(textKey('hay 24 satelites')); // spacing/accents don't matter
  });
});

describe('credits', () => {
  it('collects unique verified sources and own calculations only', () => {
    const scenes = [{ text: 'A' }, { text: 'B' }, { text: 'C' }];
    const checks: Record<string, SceneCheck> = {
      [textKey('A')]: { textKey: 'a', claims: [{ text: 'A', sources: [src(), src({ title: 'Otra', url: 'https://x.org/' })], calc: '1 µs ≈ 300 m (cálculo propio)' }] },
      [textKey('B')]: { textKey: 'b', claims: [{ text: 'B', sources: [src()] }] },
      [textKey('C')]: { textKey: 'c', claims: [{ text: 'C', sources: [src({ url: 'https://nope.com', check: 'not-found' })] }] },
    };
    const c = creditsFrom(scenes, checks);
    expect(c.sources.map((s) => s.url)).toEqual(['https://www.gps.gov/systems/gps/space/', 'https://x.org/']);
    expect(c.calcs).toEqual(['1 µs ≈ 300 m (cálculo propio)']);
    expect(creditCardText(c)).toBe('Fuentes\nGPS.gov\nOtra');
    expect(creditCardText({ sources: Array.from({ length: 9 }, (_, i) => ({ title: `S${i}`, url: `u${i}` })), calcs: [] })).toContain('y 2 más');
  });
});

describe('local page check', () => {
  const page = 'El segmento espacial del GPS consta de 24 satélites operativos a una altitud de 20.200 km. La órbita dura 12 horas.';
  it('reads numbers across formats', () => {
    expect(numbersIn('altura de 20,200 km y 24 satélites')).toEqual(['20200', '24']);
    expect(numbersIn('un 5 por ciento')).toEqual([]); // single digits are too weak to prove anything
  });
  it('finds a quote ignoring case, accents and spacing', () => {
    expect(pageSupports(page, 'x', 'CONSTA de 24  satelites operativos').found).toBe(true);
    expect(pageSupports(page, 'x', 'consta de 31 satélites operativos').found).toBe(false);
  });
  it('without a quote: all numbers must be on the page with most of the key words', () => {
    expect(pageSupports(page, 'Los satélites orbitan a 20.200 km de altitud').found).toBe(true);
    expect(pageSupports(page, 'Los satélites orbitan a 36.000 km de altitud').found).toBe(false);
    expect(pageSupports('Receta de cocina con 20.200 gramos de sal', 'Los satélites orbitan a 20.200 km de altitud').found).toBe(false);
  });
  it('returns a snippet around the evidence', () => {
    expect(pageSupports(page, 'x', 'consta de 24 satélites operativos').snippet).toContain('24 satélites');
  });
});

describe('SSRF guard', () => {
  it('rejects loopback, private, link-local and metadata addresses and non-http URLs', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.1', '192.168.1.9', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '999.1.1.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
    expect(checkableUrl('https://www.gps.gov/x')).not.toBeNull();
    for (const u of ['file:///etc/passwd', 'ftp://x.com', 'https://user:pw@x.com/', 'not a url']) expect(checkableUrl(u)).toBeNull();
  });
});
