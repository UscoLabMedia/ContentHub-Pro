// Voice generation: pick a voice, hear a sample, narrate scenes. Everything runs locally and free.
//   - Piper (MIT)           neural voices, downloaded on demand        https://github.com/rhasspy/piper
//   - Windows built-in      System.Speech voices, nothing to download
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PIPER_VOICES, type PiperVoice } from './catalog.ts';
import { ensurePiper, ensureVoice, findPiper, synthPiper, voiceInstalled, type Report } from './piper.ts';
import { listSapi, synthSapi } from './sapi.ts';
import { joinWav, wavInfo } from './wav.ts';
import { parseMarkup, stripMarkup, hasMarkup, type SpeechPiece, type SpokenWord } from './markup.ts';
import { cloneVoiceId, isCloneVoiceId, profileIdOf, type CloneEngine } from './clone.ts';
import { DEFAULT_TUNING, isDefaultTuning, normalizeTuning, type OnlineVoice, type VoiceTuning } from './online.ts';
import { runFfmpeg } from '../sources/whisper.ts';

export * from './catalog.ts';
export * from './wav.ts';
export * from './markup.ts';
export * from './online.ts';
export * from './clone.ts';
export { piperAssetUrl } from './piper.ts';

export interface VoiceInfo {
  id: string;
  label: string;
  engine: 'piper' | 'sapi' | 'edge' | 'azure' | 'kokoro' | 'clone';
  lang: string;
  quality: 'low' | 'medium' | 'high' | 'system' | 'neural';
  /** Online voices: Azure speaking styles the voice supports. */
  styles?: string[];
  gender?: 'Male' | 'Female' | '';
  sizeMB?: number;
  installed: boolean;
}

export interface Narration {
  file: string;
  hash: string;
  durationSec: number;
  /** When the voice reports when each word is spoken (Edge): seconds from the start of the clip. */
  words?: SpokenWord[];
}

/** A local engine installed on demand (Kokoro): lists its voices and writes a WAV file for a piece of text. */
export interface LocalEngine {
  voices(): VoiceInfo[];
  synth(voiceKey: string, text: string, speed: number, file: string, report: Report): Promise<void>;
}

/** An online service that speaks the pieces of a line. The server implements it (network, keys). */
export interface OnlineProvider {
  engine: 'edge' | 'azure';
  /** Never throws: an empty list when the service cannot be reached. */
  list(): Promise<OnlineVoice[]>;
  synth(voice: string, pieces: SpeechPiece[], tuning: VoiceTuning, styles: string[]): Promise<{ wav: Uint8Array; words?: SpokenWord[] }>;
}

const ONLINE_LABEL = { edge: 'Edge · en línea, gratis', azure: 'Azure · en línea, oficial' } as const;

export class Tts {
  /** `piperBin` lets you use your own Piper build (also how tests inject a fake engine). `online` are the online services. */
  constructor(private dataDir: string, private piperBin?: string, private online: () => OnlineProvider[] = () => [], private local?: LocalEngine, private clones?: CloneEngine) {}

  cacheFile(hash: string): string {
    return join(this.dataDir, 'tts-cache', `${hash}.wav`);
  }

  async list(): Promise<VoiceInfo[]> {
    const piperReady = !!(this.piperBin ?? (await findPiper(this.dataDir)));
    const piper = PIPER_VOICES.map<VoiceInfo>((v) => ({
      id: v.id, label: v.label, engine: 'piper', lang: v.lang, quality: v.quality, sizeMB: v.sizeMB,
      installed: piperReady && voiceInstalled(this.dataDir, v),
    }));
    const sapi = await listSapi().catch(() => []);
    const online = (await Promise.all(this.online().map(async (p) => (await p.list()).map<VoiceInfo>((v) => ({
      id: `${p.engine}:${v.name}`, label: `${v.label} · ${ONLINE_LABEL[p.engine]}`, engine: p.engine, lang: v.locale, quality: 'neural', installed: true, styles: v.styles, gender: v.gender,
    }))))).flat();
    return [
      ...online,
      ...(this.local?.voices() ?? []),
      ...(this.clones?.voices() ?? []),
      ...sapi.map<VoiceInfo>((v) => ({ id: `sapi:${v.name}`, label: `${v.name} · Windows (sin descarga)`, engine: 'sapi', lang: v.culture, quality: 'system', installed: true })),
      ...piper,
    ];
  }

  /** Synthesizes `text` (cached on disk by voice + tuning + text, so repeats are instant and free). `tuning` may be just the speed. */
  async synth(voiceId: string, text: string, tuningIn: number | Partial<VoiceTuning>, report: Report = () => {}): Promise<Narration> {
    const raw = text.replace(/\s+/g, ' ').trim();
    if (!stripMarkup(raw)) throw new Error('No hay texto para narrar');
    const t = normalizeTuning(tuningIn);
    const prof = isCloneVoiceId(voiceId) ? this.clones?.profile(profileIdOf(voiceId)) : undefined;
    if (isCloneVoiceId(voiceId) && !prof) throw new Error('Esa voz clonada ya no existe: elige otra voz');
    // Same cache key as before for plain text at default tuning, so narration made earlier is still reused.
    const idPart = prof ? `${voiceId}~${prof.base}~${prof.engine}` : voiceId; // another base voice or engine is another clip
    const key = !hasMarkup(raw) && t.pitch === 0 && t.style === '' ? `${idPart}|${t.speed}|${raw}` : `${idPart}|${t.speed}|${t.pitch}|${t.style}|${raw}`;
    const hash = createHash('sha1').update(key).digest('hex');
    const file = this.cacheFile(hash);
    const meta = file.replace(/\.wav$/, '.json');
    if (!existsSync(file)) {
      const pieces = parseMarkup(raw);
      await mkdir(join(this.dataDir, 'tts-cache'), { recursive: true });
      if (prof) {
        // Cloned voice: the base voice says it (cached as usual), then the converter changes the timbre. Timing is kept, so word times carry over.
        if (isCloneVoiceId(prof.base)) throw new Error('La voz base de una voz clonada no puede ser otra voz clonada');
        const base = await this.synth(prof.base, raw, t, (p, l) => report(Math.round(p * 0.6), l));
        report(65, 'Aplicando tu voz');
        await this.clones!.convert(profileIdOf(voiceId), base.file, file, (p, l) => report(65 + Math.round(p * 0.3), l));
        if (base.words?.length) await writeFile(meta, JSON.stringify(base.words));
        const dur = wavInfo(await readFile(file)).durationSec;
        if (!(dur > 0.2)) throw new Error('La voz clonada salió vacía');
        report(100, 'Listo');
        return { file, hash, durationSec: dur, words: base.words };
      }
      const simple = pieces.length === 1 && !!pieces[0]!.text && !pieces[0]!.emphasis && !(pieces[0]!.pauseAfterSec > 0) && t.pitch === 0;
      if (simple && !/^(edge|azure):/.test(voiceId)) {
        await this.localClip(voiceId, pieces[0]!.text, t.speed, file, report); // plain text on a local voice: one direct call
      } else {
        const out = await this.render(voiceId, pieces, t, report);
        await writeFile(file, out.wav);
        if (out.words?.length) await writeFile(meta, JSON.stringify(out.words));
      }
    }
    const durationSec = wavInfo(await readFile(file)).durationSec;
    if (!(durationSec > 0.2)) throw new Error('La voz generada salió vacía');
    const words = existsSync(meta) ? (JSON.parse(await readFile(meta, 'utf8')) as SpokenWord[]) : undefined;
    report(100, 'Listo');
    return { file, hash, durationSec, words };
  }

  private async render(voiceId: string, pieces: SpeechPiece[], t: VoiceTuning, report: Report): Promise<{ wav: Uint8Array; words?: SpokenWord[] }> {
    const online = voiceId.match(/^(edge|azure):(.+)$/);
    if (online) {
      const provider = this.online().find((p) => p.engine === online[1]);
      if (!provider) throw new Error(online[1] === 'azure' ? 'Falta la clave de Azure: guárdala en los ajustes de la voz' : 'El servicio de Edge no está disponible');
      report(30, 'Generando voz en línea');
      const styles = (await provider.list()).find((v) => v.name === online[2])?.styles ?? [];
      return provider.synth(online[2]!, pieces, t, styles);
    }
    // Local engines: one clip per piece (a stressed word is said a little slower), joined with real silences; pitch is shifted afterwards.
    const clips: Uint8Array[] = [];
    const gaps: number[] = [];
    const tmp = join(this.dataDir, 'tts-cache', `tmp-${createHash('sha1').update(`${voiceId}${Date.now()}${Math.random()}`).digest('hex').slice(0, 10)}`);
    await mkdir(join(this.dataDir, 'tts-cache'), { recursive: true });
    try {
      for (const [i, p] of pieces.entries()) {
        if (p.text) {
          const f = `${tmp}-${i}.wav`;
          await this.localClip(voiceId, p.text, p.emphasis ? Math.max(0.7, t.speed * 0.9) : t.speed, f, report);
          clips.push(new Uint8Array(await readFile(f)));
          gaps.push(p.pauseAfterSec);
        } else if (clips.length) gaps[gaps.length - 1] = (gaps[gaps.length - 1] ?? 0) + p.pauseAfterSec;
      }
    } finally {
      await Promise.all(pieces.map((_, i) => import('node:fs/promises').then((m) => m.rm(`${tmp}-${i}.wav`, { force: true }))));
    }
    if (!clips.length) throw new Error('No hay texto para narrar');
    let wav: Uint8Array = clips.length === 1 && !(gaps[0]! > 0) ? clips[0]! : joinWav(clips, gaps).wav;
    if (t.pitch !== 0) wav = await this.shiftPitch(wav, t.pitch, tmp);
    return { wav };
  }

  private async localClip(voiceId: string, text: string, speed: number, file: string, report: Report): Promise<void> {
    if (voiceId.startsWith('sapi:')) {
      report(20, 'Generando voz');
      await synthSapi(voiceId.slice(5), text, file, speed);
      return;
    }
    const k = voiceId.match(/^kokoro:(.+)$/);
    if (k) {
      if (!this.local) throw new Error('Las voces de Kokoro no están disponibles en este equipo');
      await this.local.synth(k[1]!, text, speed, file, report);
      return;
    }
    const voice: PiperVoice | undefined = PIPER_VOICES.find((v) => v.id === voiceId);
    if (!voice) throw new Error(`Voz desconocida: ${voiceId}`);
    const exe = this.piperBin ?? (await ensurePiper(this.dataDir, report));
    const model = await ensureVoice(this.dataDir, voice, report);
    report(90, 'Generando voz');
    await synthPiper(exe, model, text, file, speed);
  }

  /** Raises or lowers the pitch keeping the speed (resample, then change the tempo back). Fine for a few semitones. */
  private async shiftPitch(wav: Uint8Array, semitones: number, tmp: string): Promise<Uint8Array> {
    const info = wavInfo(wav);
    const f = Math.pow(2, semitones / 12);
    const src = `${tmp}-pitch-in.wav`, out = `${tmp}-pitch-out.wav`;
    await writeFile(src, wav);
    try {
      await runFfmpeg(['-y', '-i', src, '-af', `asetrate=${Math.round(info.sampleRate * f)},aresample=${info.sampleRate},atempo=${(1 / f).toFixed(5)}`, '-c:a', 'pcm_s16le', out]);
      return new Uint8Array(await readFile(out));
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(src, { force: true });
      await rm(out, { force: true });
    }
  }
}

export { DEFAULT_TUNING, isDefaultTuning, cloneVoiceId };
