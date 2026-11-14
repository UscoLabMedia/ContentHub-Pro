// Voice generation: pick a voice, hear a sample, narrate scenes. Everything runs locally and free.
//   - Piper (MIT)           neural voices, downloaded on demand        https://github.com/rhasspy/piper
//   - Windows built-in      System.Speech voices, nothing to download
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PIPER_VOICES, type PiperVoice } from './catalog.ts';
import { ensurePiper, ensureVoice, findPiper, synthPiper, voiceInstalled, type Report } from './piper.ts';
import { listSapi, synthSapi } from './sapi.ts';
import { wavInfo } from './wav.ts';

export * from './catalog.ts';
export * from './wav.ts';
export { piperAssetUrl } from './piper.ts';

export interface VoiceInfo {
  id: string;
  label: string;
  engine: 'piper' | 'sapi';
  lang: string;
  quality: 'low' | 'medium' | 'high' | 'system';
  sizeMB?: number;
  installed: boolean;
}

export interface Narration {
  file: string;
  hash: string;
  durationSec: number;
}

export class Tts {
  /** `piperBin` lets you use your own Piper build (also how tests inject a fake engine). */
  constructor(private dataDir: string, private piperBin?: string) {}

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
    return [
      ...sapi.map<VoiceInfo>((v) => ({ id: `sapi:${v.name}`, label: `${v.name} · Windows (sin descarga)`, engine: 'sapi', lang: v.culture, quality: 'system', installed: true })),
      ...piper,
    ];
  }

  /** Synthesizes `text` (cached on disk by voice+speed+text, so repeats are instant and free). */
  async synth(voiceId: string, text: string, speed: number, report: Report = () => {}): Promise<Narration> {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('No hay texto para narrar');
    const sp = Math.min(1.5, Math.max(0.7, speed || 1));
    const hash = createHash('sha1').update(`${voiceId}|${sp}|${clean}`).digest('hex');
    const file = this.cacheFile(hash);
    if (!existsSync(file)) {
      if (voiceId.startsWith('sapi:')) {
        report(20, 'Generando voz');
        await synthSapi(voiceId.slice(5), clean, file, sp);
      } else {
        const voice: PiperVoice | undefined = PIPER_VOICES.find((v) => v.id === voiceId);
        if (!voice) throw new Error(`Voz desconocida: ${voiceId}`);
        const exe = this.piperBin ?? (await ensurePiper(this.dataDir, report));
        const model = await ensureVoice(this.dataDir, voice, report);
        report(90, 'Generando voz');
        await synthPiper(exe, model, clean, file, sp);
      }
    }
    const durationSec = wavInfo(await readFile(file)).durationSec;
    if (!(durationSec > 0.2)) throw new Error('La voz generada salió vacía');
    report(100, 'Listo');
    return { file, hash, durationSec };
  }
}
