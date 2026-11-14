// Voice profiles (a person's voice sample + consent) and the engine that applies a profile to speech.
// The sample is the most sensitive thing in the app: it is stored ENCRYPTED in the vault folder (like interview audio),
// decrypted only into a temporary file while a clip is being converted, and deleted with the profile.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CLONE_ENGINES, SAMPLE_MAX_SEC, SAMPLE_MIN_SEC, cloneVoiceId, isCloneEngine, isCloneVoiceId, normalizeProfileName, readPcm16, runFfmpeg, validateConsent, wavInfo,
  type CloneEngine, type CloneEngineId, type ConsentInput, type Vault, type VoiceInfo, type VoiceProfile,
} from '@chp/core';
import { ensureVenv, type Report } from './pyenv.ts';
import { PyWorker } from './pyworker.ts';

const VERSION = 1;
const PACKAGES = ['voiceclonnx==0.0.3a3'];
export const CLONE_SIZE_MB = 160;

export class ProfileError extends Error {}

export const cloneDir = (dataDir: string): string => join(dataDir, 'voiceclone');
const printsDir = (dataDir: string): string => join(dataDir, 'voiceprints');
const sealed = (dataDir: string, id: string): string => join(printsDir(dataDir), `${id}.enc`);
const readyFile = (dir: string): string => join(dir, 'ready.json');
const tmpName = (dir: string, ext: string): string => join(dir, `tmp-${randomBytes(6).toString('hex')}.${ext}`);

/** A readable sample: 6 to 30 s, not silent. Returns the WAV (24 kHz mono, 16-bit) and its length. */
export async function prepareSample(input: Uint8Array, workDir: string): Promise<{ wav: Uint8Array; sec: number }> {
  await mkdir(workDir, { recursive: true });
  const src = tmpName(workDir, 'in'), out = tmpName(workDir, 'wav');
  await writeFile(src, input);
  try {
    const base = ['-y', '-i', src, '-vn', '-t', String(SAMPLE_MAX_SEC)];
    const tail = ['-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', out];
    try {
      await runFfmpeg([...base, '-af', 'highpass=f=70', ...tail]); // removes rumble from the room
    } catch {
      await runFfmpeg([...base, ...tail]);
    }
    const wav = new Uint8Array(await readFile(out));
    const sec = wavInfo(wav).durationSec;
    if (sec < SAMPLE_MIN_SEC) throw new ProfileError(`La muestra dura ${sec.toFixed(1)} s: necesita al menos ${SAMPLE_MIN_SEC} s de voz`);
    const pcm = readPcm16(wav).data;
    let sum = 0;
    const n = pcm.length >> 1;
    for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; }
    if (Math.sqrt(sum / Math.max(1, n)) < 0.004) throw new ProfileError('En la muestra casi no se oye nada: graba más cerca del micrófono o sube el volumen');
    return { wav, sec };
  } catch (e) {
    if (e instanceof ProfileError) throw e;
    throw new ProfileError('No pude leer ese audio: usa un archivo de audio o video (mp3, wav, m4a, ogg, mp4…)');
  } finally {
    await rm(src, { force: true });
    await rm(out, { force: true });
  }
}

export class VoiceProfiles {
  constructor(private dataDir: string, private vault: () => Vault | null) {}

  list(): VoiceProfile[] {
    return this.vault()?.get<VoiceProfile[]>('voiceProfiles') ?? [];
  }
  get(id: string): VoiceProfile | undefined {
    return this.list().find((p) => p.id === id);
  }

  private async save(list: VoiceProfile[]): Promise<void> {
    const v = this.vault();
    if (!v) throw new ProfileError('La bóveda está cerrada');
    v.set('voiceProfiles', list);
    await v.save();
  }

  private checkBase(base: unknown): string {
    if (typeof base !== 'string' || !/^[A-Za-z0-9:_.\- ]{3,90}$/.test(base) || isCloneVoiceId(base)) throw new ProfileError('Elige una voz base válida (no puede ser otra voz clonada)');
    return base;
  }

  async create(o: { name: unknown; base: unknown; engine: unknown; consent: Partial<ConsentInput>; bytes: Uint8Array }): Promise<VoiceProfile> {
    const v = this.vault();
    if (!v) throw new ProfileError('La bóveda está cerrada');
    const bad = validateConsent(o.consent);
    if (bad) throw new ProfileError(bad); // checked first: nothing is read or stored without consent
    const engine = typeof o.engine === 'string' && isCloneEngine(o.engine) ? o.engine : 'openvoice';
    const base = this.checkBase(o.base);
    const { wav, sec } = await prepareSample(o.bytes, join(this.dataDir, 'tmp'));
    const id = randomBytes(8).toString('hex');
    await mkdir(printsDir(this.dataDir), { recursive: true });
    await writeFile(sealed(this.dataDir, id), await v.sealBytes(wav));
    const c = o.consent as ConsentInput;
    const profile: VoiceProfile = { id, name: normalizeProfileName(o.name), base, engine, sampleSec: Math.round(sec * 10) / 10, createdAt: new Date().toISOString(), consent: { kind: c.kind, person: c.kind === 'own' ? (c.person ?? '').trim().slice(0, 80) : c.person!.trim().slice(0, 80), purpose: c.purpose!.trim().slice(0, 200), confirmedAt: new Date().toISOString() } };
    await this.save([...this.list(), profile]);
    return profile;
  }

  async update(id: string, patch: { name?: unknown; base?: unknown; engine?: unknown }): Promise<VoiceProfile> {
    const cur = this.get(id);
    if (!cur) throw new ProfileError('Esa voz ya no existe');
    const next: VoiceProfile = { ...cur };
    if (patch.name !== undefined) next.name = normalizeProfileName(patch.name);
    if (patch.base !== undefined) next.base = this.checkBase(patch.base);
    if (patch.engine !== undefined && typeof patch.engine === 'string' && isCloneEngine(patch.engine)) next.engine = patch.engine;
    await this.save(this.list().map((p) => (p.id === id ? next : p)));
    return next;
  }

  /** Deletes the sample, the profile and every narration made with it. */
  async remove(id: string): Promise<void> {
    if (!this.get(id)) return;
    await rm(sealed(this.dataDir, id), { force: true });
    await this.save(this.list().filter((p) => p.id !== id));
    const cache = join(this.dataDir, 'tts-cache');
    for (const f of await readdir(cache).catch(() => [] as string[])) {
      if (!f.endsWith('.clone')) continue;
      if ((await readFile(join(cache, f), 'utf8').catch(() => '')).trim() === id) {
        const stem = f.slice(0, -'.clone'.length);
        await Promise.all([`${stem}.wav`, `${stem}.json`, f].map((x) => rm(join(cache, x), { force: true })));
      }
    }
  }

  /** Runs `fn` with a temporary decrypted copy of the sample, which is always deleted afterwards. */
  async withSample<T>(id: string, fn: (wavPath: string) => Promise<T>): Promise<T> {
    const v = this.vault();
    if (!v || !existsSync(sealed(this.dataDir, id))) throw new ProfileError('No encuentro la muestra de esa voz');
    const tmp = join(this.dataDir, 'tmp');
    await mkdir(tmp, { recursive: true });
    const file = tmpName(tmp, 'wav');
    try {
      await writeFile(file, await v.openBytes(new Uint8Array(await readFile(sealed(this.dataDir, id)))));
      return await fn(file);
    } finally {
      await rm(file, { force: true });
    }
  }
}

/** A download problem is said in plain words; anything else is shown as it came. */
export function friendlyCloneError(m: string): string {
  return /huggingface|hf_hub|Connection|resolve|offline|timed out|MaxRetry|Proxy|Forbidden|SSL|Errno|network|HTTPSConn/i.test(m)
    ? 'No pude descargar los modelos de voz (se bajan una sola vez desde Hugging Face). Revisa tu conexión a internet e inténtalo de nuevo.'
    : m;
}

export class VoiceCloneEngine implements CloneEngine {
  private worker: PyWorker;
  private report: Report = () => {};

  constructor(private dataDir: string, private root: string, private profiles: VoiceProfiles, idleMs = 5 * 60_000, workerPath = join(root, 'server', 'py', 'voiceclone_worker.py')) {
    this.worker = new PyWorker(async () => {
      const dir = cloneDir(this.dataDir);
      let ok = false;
      try { ok = JSON.parse(await readFile(readyFile(dir), 'utf8')).version === VERSION; } catch { /* first install */ }
      const { python } = ok ? { python: (await import('./pyenv.ts')).venvPython(join(dir, 'venv')) } : await ensureVenv(dir, dir, PACKAGES, this.report);
      if (!ok) await writeFile(readyFile(dir), JSON.stringify({ version: VERSION, at: new Date().toISOString() }));
      return { cmd: python, args: [workerPath], env: { HF_HOME: join(dir, 'hf'), HF_HUB_DISABLE_TELEMETRY: '1' } };
    }, { idleMs, startMs: 120_000, label: 'El motor de clonación' });
  }

  private marker(engine: CloneEngineId): string {
    return join(cloneDir(this.dataDir), `models-${engine}.ok`);
  }
  modelsReady(engine: CloneEngineId): boolean {
    return existsSync(this.marker(engine));
  }

  voices(): VoiceInfo[] {
    return this.profiles.list().map((p) => ({ id: cloneVoiceId(p.id), label: `${p.name} · voz clonada`, engine: 'clone' as const, lang: 'es', quality: 'neural' as const, sizeMB: CLONE_SIZE_MB, installed: this.modelsReady(p.engine) }));
  }
  profile(id: string): VoiceProfile | undefined {
    return this.profiles.get(id);
  }
  stop(): void {
    this.worker.stop();
  }

  async convert(profileId: string, srcFile: string, outFile: string, report: Report): Promise<void> {
    const p = this.profiles.get(profileId);
    if (!p) throw new Error('Esa voz clonada ya no existe');
    this.report = report;
    try {
      if (!this.modelsReady(p.engine)) {
        report(10, 'Descargando los modelos de voz (una sola vez)');
        await this.worker.request({ op: 'warmup', engine: p.engine }, 20 * 60_000);
        await writeFile(this.marker(p.engine), new Date().toISOString());
      }
      report(60, 'Aplicando tu voz');
      await mkdir(join(outFile, '..'), { recursive: true });
      await this.profiles.withSample(profileId, (ref) => this.worker.request({ engine: p.engine, source: srcFile, reference: ref, out: outFile }, 5 * 60_000));
      await writeFile(outFile.replace(/\.wav$/, '.clone'), profileId); // lets deleting the profile also delete what it narrated
    } catch (e) {
      throw new Error(friendlyCloneError(e instanceof Error ? e.message : String(e)));
    }
  }
}

export { CLONE_ENGINES };
