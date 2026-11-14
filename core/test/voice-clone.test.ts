import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Vault, type BlobStorage } from '../src/crypto/vault.ts';
import { SAMPLE_MAX_SEC, SAMPLE_MIN_SEC, Tts, cloneVoiceId, isCloneVoiceId, normalizeProfileName, sineWav, syntheticVoiceNotice, validateConsent, wavInfo, type CloneEngine, type OnlineProvider, type VoiceProfile } from '../src/voice/index.ts';
import { ProfileError, VoiceProfiles, friendlyCloneError, prepareSample } from '../../server/src/voiceclone.ts';

describe('consent rules', () => {
  const ok = { kind: 'own' as const, person: '', purpose: 'Narrar mis videos de café', confirmed: true };
  it('needs the box, a purpose, and a name when it is someone else', () => {
    expect(validateConsent(ok)).toBeNull();
    expect(validateConsent({ ...ok, confirmed: false })).toMatch(/casilla/);
    expect(validateConsent({ ...ok, purpose: 'x' })).toMatch(/para qué/);
    expect(validateConsent({ ...ok, kind: 'permission', person: '' })).toMatch(/nombre/);
    expect(validateConsent({ ...ok, kind: 'permission', person: 'Ana Pérez' })).toBeNull();
    expect(validateConsent({ ...ok, kind: undefined })).toMatch(/propia voz/);
    expect(validateConsent({})).not.toBeNull();
  });
  it('writes the synthetic-voice notice for the description', () => {
    const base = { consent: { kind: 'own' as const, person: '', purpose: 'p', confirmedAt: '' } };
    expect(syntheticVoiceNotice(base)).toMatch(/voz del autor/);
    expect(syntheticVoiceNotice({ consent: { ...base.consent, kind: 'permission', person: 'Ana' } })).toContain('permiso de Ana');
    expect(isCloneVoiceId(cloneVoiceId('a'.repeat(16)))).toBe(true);
    expect(isCloneVoiceId('clone:../x')).toBe(false);
    expect(normalizeProfileName('  Mi   voz\n bonita ')).toBe('Mi voz bonita');
    expect(normalizeProfileName('')).toBe('Mi voz');
  });
});

describe('Tts with a cloned voice (stand-in converter)', () => {
  let dir = '';
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'chp-clone-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
  const profile: VoiceProfile = { id: 'a'.repeat(16), name: 'Mi voz', base: 'edge:es-CO-GonzaloNeural', engine: 'openvoice', sampleSec: 12, createdAt: '', consent: { kind: 'own', person: '', purpose: 'p', confirmedAt: '' } };
  const baseCalls: string[] = [];
  const edge: OnlineProvider = {
    engine: 'edge',
    list: async () => [],
    synth: async (voice) => { baseCalls.push(voice); return { wav: sineWav(300, 1.5, 24000), words: [{ text: 'Hola', from: 0.1, to: 0.5 }] }; },
  };
  const converted: string[] = [];
  const engine: CloneEngine = {
    voices: () => [{ id: cloneVoiceId(profile.id), label: 'Mi voz · voz clonada', engine: 'clone', lang: 'es', quality: 'neural', installed: true }],
    profile: (id) => (id === profile.id ? profile : undefined),
    convert: async (_id, src, out) => { converted.push(src); await writeFile(out, await readFile(src)); },
  };

  it('has the base voice speak, converts it, keeps word times and caches', async () => {
    const tts = new Tts(dir, undefined, () => [edge], undefined, engine);
    expect((await tts.list()).some((v) => v.id === cloneVoiceId(profile.id) && v.engine === 'clone')).toBe(true);
    const a = await tts.synth(cloneVoiceId(profile.id), 'Hola *mundo* [pausa 1s] fin', { speed: 1.1, pitch: 1 });
    expect(a.durationSec).toBeGreaterThan(1.4);
    expect(a.words).toEqual([{ text: 'Hola', from: 0.1, to: 0.5 }]);
    expect(baseCalls).toEqual(['es-CO-GonzaloNeural']);
    expect(converted).toHaveLength(1);
    const b = await tts.synth(cloneVoiceId(profile.id), 'Hola *mundo* [pausa 1s] fin', { speed: 1.1, pitch: 1 });
    expect(b.hash).toBe(a.hash);
    expect(converted).toHaveLength(1); // cached: neither the base voice nor the converter ran again
  });
  it('is another clip when the base voice or the engine changes, and refuses a clone as base', async () => {
    const tts = new Tts(dir, undefined, () => [edge], undefined, engine);
    const a = await tts.synth(cloneVoiceId(profile.id), 'Otro texto', 1);
    profile.engine = 'facodec';
    const b = await tts.synth(cloneVoiceId(profile.id), 'Otro texto', 1);
    expect(b.hash).not.toBe(a.hash);
    profile.engine = 'openvoice';
    profile.base = cloneVoiceId('b'.repeat(16));
    await expect(tts.synth(cloneVoiceId(profile.id), 'Tercer texto', 1)).rejects.toThrow(/otra voz clonada/);
    profile.base = 'edge:es-CO-GonzaloNeural';
    await expect(tts.synth(cloneVoiceId('c'.repeat(16)), 'Texto', 1)).rejects.toThrow(/ya no existe/);
  });
});

describe('download problems', () => {
  it('are explained in plain words, other errors are kept', () => {
    for (const m of ['ProxyError: 403 Forbidden', 'ConnectionError: HTTPSConnectionPool(host=huggingface.co)', 'OSError: [Errno -3] Temporary failure in name resolution']) expect(friendlyCloneError(m)).toMatch(/descargar los modelos/);
    expect(friendlyCloneError('ValueError: audio demasiado corto')).toBe('ValueError: audio demasiado corto');
  });
});

describe('voice profiles (sample stored encrypted)', () => {
  let dir = '';
  let vault: Vault;
  let profiles: VoiceProfiles;
  const speechLike = (sec: number, rate = 16000) => Buffer.from(sineWav(220, sec, rate)); // a tone is enough: the checks are about length and level
  const consent = { kind: 'own' as const, person: '', purpose: 'Narrar mis videos', confirmed: true };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chp-prof-'));
    let disk: string | null = null;
    const storage: BlobStorage = { read: async () => disk, write: async (t) => void (disk = t) };
    vault = (await Vault.create('una-clave-larga-1', storage, 1000)).vault;
    profiles = new VoiceProfiles(dir, () => vault);
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('refuses without consent, before storing anything', async () => {
    await expect(profiles.create({ name: 'x', base: 'kokoro:em_alex', engine: 'openvoice', consent: { ...consent, confirmed: false }, bytes: speechLike(10) })).rejects.toThrow(/casilla/);
    expect(profiles.list()).toEqual([]);
    expect(existsSync(join(dir, 'voiceprints'))).toBe(false);
  });
  it('checks the sample: length, level and format', async () => {
    await expect(prepareSample(speechLike(3), join(dir, 'tmp'))).rejects.toThrow(new RegExp(`al menos ${SAMPLE_MIN_SEC} s`));
    const silence = Buffer.concat([Buffer.from(sineWav(220, 0.01, 16000)).subarray(0, 44), Buffer.alloc(16000 * 2 * 10)]); // a WAV header + 10 s of silence
    await expect(prepareSample(silence, join(dir, 'tmp'))).rejects.toThrow(ProfileError);
    await expect(prepareSample(Buffer.from('esto no es audio'), join(dir, 'tmp'))).rejects.toThrow(/No pude leer/);
    const ok = await prepareSample(speechLike(40), join(dir, 'tmp'));
    expect(ok.sec).toBeLessThanOrEqual(SAMPLE_MAX_SEC + 0.1); // long samples are cut
    expect(wavInfo(ok.wav).sampleRate).toBe(24000);
  }, 30_000);
  it('stores the sample encrypted, decrypts it only for a moment, and deletes everything with the profile', async () => {
    const p = await profiles.create({ name: '  Mi   voz ', base: 'kokoro:em_alex', engine: 'facodec', consent, bytes: speechLike(12) });
    expect(p).toMatchObject({ name: 'Mi voz', base: 'kokoro:em_alex', engine: 'facodec', consent: { kind: 'own', purpose: 'Narrar mis videos' } });
    expect(profiles.get(p.id)?.sampleSec).toBeGreaterThan(11);
    const enc = join(dir, 'voiceprints', `${p.id}.enc`);
    const raw = readFileSync(enc);
    expect(raw.subarray(0, 4).toString()).not.toBe('RIFF'); // not plain audio
    let seen = '';
    await profiles.withSample(p.id, async (path) => { seen = path; expect(wavInfo(new Uint8Array(await readFile(path))).sampleRate).toBe(24000); });
    expect(existsSync(seen)).toBe(false); // the plain copy is gone
    expect((await readdir(join(dir, 'tmp'))).filter((f) => f.startsWith('tmp-'))).toEqual([]);

    // a narration made with this voice leaves a marker, and deleting the profile removes it
    await import('node:fs/promises').then((m) => m.mkdir(join(dir, 'tts-cache'), { recursive: true }));
    for (const ext of ['wav', 'json', 'clone']) await writeFile(join(dir, 'tts-cache', `abc.${ext}`), ext === 'clone' ? p.id : 'x');
    await writeFile(join(dir, 'tts-cache', 'other.wav'), 'x');
    await profiles.remove(p.id);
    expect(existsSync(enc)).toBe(false);
    expect(profiles.get(p.id)).toBeUndefined();
    expect(await readdir(join(dir, 'tts-cache'))).toEqual(['other.wav']);
  });
  it('lets you rename and change the base voice, never to another clone', async () => {
    const p = await profiles.create({ name: 'A', base: 'kokoro:em_alex', engine: 'openvoice', consent: { ...consent, kind: 'permission', person: 'Ana Pérez' }, bytes: speechLike(12) });
    expect(p.consent.person).toBe('Ana Pérez');
    expect((await profiles.update(p.id, { name: 'Ana', base: 'azure:es-MX-JorgeNeural', engine: 'knnvc' }))).toMatchObject({ name: 'Ana', base: 'azure:es-MX-JorgeNeural', engine: 'knnvc' });
    await expect(profiles.update(p.id, { base: cloneVoiceId('d'.repeat(16)) })).rejects.toThrow(/voz base válida/);
    await expect(profiles.update('e'.repeat(16), { name: 'x' })).rejects.toThrow(/ya no existe/);
    await profiles.remove(p.id);
  });
});
