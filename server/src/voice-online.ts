// Online voices. Two services, both optional:
//   - Edge read-aloud (free, no key): through the unofficial msedge-tts library (MIT). It only talks to
//     speech.platform.bing.com. Microsoft may change or block this access, and its terms for commercial use are unclear.
//   - Azure AI Speech (official): a key from the person's own Azure account, kept encrypted in the vault.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  FALLBACK_VOICES, buildAzureSsml, joinWav, parseAzureVoices, parseEdgeVoices, pitchAttr, rateAttr, runFfmpeg, sineWav, wavInfo,
  type OnlineProvider, type OnlineVoice, type SpeechPiece, type SpokenWord, type VoiceTuning,
} from '@chp/core';

const UA = 'ContentHubPro/1.0 (personal content tool; voice)';
/** A stressed word is said a bit slower and higher (Edge has no <emphasis>, so we shape the piece itself). */
const EMPHASIS = { rate: 0.92, pitch: 2 };

// ---------------------------------------------------------------------------- Edge
interface EdgeLike {
  setMetadata(voice: string, format: OUTPUT_FORMAT, opts?: { wordBoundaryEnabled?: boolean }): Promise<void>;
  toStream(text: string, prosody?: { rate?: string; pitch?: string }): { audioStream: NodeJS.ReadableStream; metadataStream: NodeJS.ReadableStream | null };
  getVoices(): Promise<unknown[]>;
  close(): void;
}

const drain = (s: NodeJS.ReadableStream | null): Promise<Buffer[]> =>
  new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    if (!s) return resolve(out);
    s.on('data', (c: Buffer | string) => out.push(Buffer.from(c)));
    s.on('end', () => resolve(out));
    s.on('error', reject);
    s.on('close', () => resolve(out));
  });

/** WordBoundary events -> seconds. The service reports 100-nanosecond ticks. */
export function parseWordBoundaries(chunks: Buffer[]): SpokenWord[] {
  const words: SpokenWord[] = [];
  for (const c of chunks) {
    let json: unknown;
    try {
      json = JSON.parse(c.toString('utf8'));
    } catch {
      continue;
    }
    const items = (json as { Metadata?: { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string } } }[] }).Metadata ?? [];
    for (const m of items) {
      const d = m.Data;
      if (m.Type !== 'WordBoundary' || !d?.text?.Text || typeof d.Offset !== 'number') continue;
      words.push({ text: d.text.Text, from: d.Offset / 1e7, to: (d.Offset + (d.Duration ?? 0)) / 1e7 });
    }
  }
  return words;
}

export function edgeProvider(dataDir: string, make: () => EdgeLike = () => new MsEdgeTTS({ connectionTimeoutMs: 10_000, synthesisTimeoutMs: 45_000 }) as unknown as EdgeLike): OnlineProvider {
  let cached: { at: number; voices: OnlineVoice[] } | null = null;
  return {
    engine: 'edge',
    async list() {
      if (cached && Date.now() - cached.at < 3_600_000) return cached.voices;
      try {
        const c = make();
        const voices = parseEdgeVoices(await c.getVoices());
        c.close();
        if (voices.length) return (cached = { at: Date.now(), voices }).voices;
      } catch {
        /* offline or blocked: show the main Spanish voices anyway; synthesis will report the real problem */
      }
      return FALLBACK_VOICES;
    },
    async synth(voice: string, pieces: SpeechPiece[], tuning: VoiceTuning) {
      const tmp = join(dataDir, 'tts-cache', `edge-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
      await mkdir(join(dataDir, 'tts-cache'), { recursive: true });
      const clips: Uint8Array[] = [];
      const gaps: number[] = [];
      const times: { words: SpokenWord[]; clip: number }[] = [];
      const client = make();
      try {
        await client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
        for (const [i, p] of pieces.entries()) {
          if (!p.text) {
            if (gaps.length) gaps[gaps.length - 1] = (gaps[gaps.length - 1] ?? 0) + p.pauseAfterSec;
            continue;
          }
          const speed = p.emphasis ? Math.max(0.7, tuning.speed * EMPHASIS.rate) : tuning.speed;
          const pitch = Math.min(6, tuning.pitch + (p.emphasis ? EMPHASIS.pitch : 0));
          const { audioStream, metadataStream } = client.toStream(p.text, { rate: rateAttr(speed), pitch: pitchAttr(pitch) });
          const [audio, meta] = await Promise.all([drain(audioStream), drain(metadataStream)]);
          if (!audio.length) throw new Error('Edge no devolvió audio');
          const mp3 = `${tmp}-${i}.mp3`, wav = `${tmp}-${i}.wav`;
          await writeFile(mp3, Buffer.concat(audio));
          await runFfmpeg(['-y', '-i', mp3, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wav]);
          clips.push(new Uint8Array(await readFile(wav)));
          gaps.push(p.pauseAfterSec);
          times.push({ words: parseWordBoundaries(meta), clip: clips.length - 1 });
          await rm(mp3, { force: true });
          await rm(wav, { force: true });
        }
      } catch (e) {
        throw new Error(`No pude usar las voces de Edge (${e instanceof Error ? e.message : 'error'}). Puede que Microsoft haya cambiado o bloqueado ese acceso: prueba otra voz o Azure.`);
      } finally {
        client.close();
      }
      if (!clips.length) throw new Error('No hay texto para narrar');
      const { wav, starts } = joinWav(clips, gaps);
      const words = times.flatMap((t) => t.words.map((w) => ({ text: w.text, from: w.from + starts[t.clip]!, to: w.to + starts[t.clip]! })));
      return { wav, words: words.length ? words : undefined };
    },
  };
}

// ---------------------------------------------------------------------------- Azure
export interface AzureConfig {
  key: string;
  region: string;
}
export const validAzure = (c: { key?: unknown; region?: unknown }): c is AzureConfig =>
  typeof c.key === 'string' && /^[A-Za-z0-9]{20,100}$/.test(c.key) && typeof c.region === 'string' && /^[a-z0-9]{3,30}$/.test(c.region);

/** `base` lets tests point at a local fixture (CHP_AZURE_BASE); in normal use it is the region's own endpoint. */
export function azureProvider(cfg: AzureConfig, base = `https://${cfg.region}.tts.speech.microsoft.com`): OnlineProvider {
  const headers = { 'Ocp-Apim-Subscription-Key': cfg.key, 'User-Agent': UA };
  return {
    engine: 'azure',
    async list() {
      try {
        const r = await fetch(`${base}/cognitiveservices/voices/list`, { headers, signal: AbortSignal.timeout(12_000) });
        if (r.ok) {
          const voices = parseAzureVoices(await r.json());
          if (voices.length) return voices;
        }
      } catch {
        /* fall through */
      }
      return FALLBACK_VOICES;
    },
    async synth(voice: string, pieces: SpeechPiece[], tuning: VoiceTuning, styles: string[]) {
      const ssml = buildAzureSsml(voice, pieces, tuning, styles);
      const r = await fetch(`${base}/cognitiveservices/v1`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm' },
        body: ssml,
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status === 401 || r.status === 403) throw new Error('Azure rechazó la clave: revisa la clave y la región en los ajustes de la voz');
      if (r.status === 429) throw new Error('Azure alcanzó el límite de uso de tu capa gratuita; espera o revisa tu plan');
      if (!r.ok) throw new Error(`Azure respondió ${r.status}`);
      const wav = new Uint8Array(await r.arrayBuffer());
      wavInfo(wav); // throws if it is not audio
      return { wav }; // the REST service gives no word times: captions use the estimate
    },
  };
}

/** A stand-in used by tests and demos (CHP_ONLINE_FAKE=1): a tone and word times, no network. */
export function fakeEdgeProvider(): OnlineProvider {
  return {
    engine: 'edge',
    list: async () => FALLBACK_VOICES,
    async synth(_voice, pieces) {
      const clips: Uint8Array[] = [];
      const gaps: number[] = [];
      const words: { text: string; clip: number; from: number; to: number }[] = [];
      for (const p of pieces) {
        if (!p.text) continue;
        const toks = p.text.split(/\s+/);
        clips.push(new Uint8Array(sineWav(330, 0.3 * toks.length + 0.2, 24000)));
        gaps.push(p.pauseAfterSec);
        toks.forEach((t, k) => words.push({ text: t, clip: clips.length - 1, from: 0.1 + 0.3 * k, to: 0.1 + 0.3 * k + 0.25 }));
      }
      const { wav, starts } = joinWav(clips, gaps);
      return { wav, words: words.map((w) => ({ text: w.text, from: w.from + starts[w.clip]!, to: w.to + starts[w.clip]! })) };
    },
  };
}
