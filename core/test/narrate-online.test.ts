import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PIPER_VOICES, Tts, wavInfo } from '../src/voice/index.ts';
import { readFile } from 'node:fs/promises';
import { withSpokenTimes, wordTimings } from '../src/style.ts';
import { sfxEvents, DEFAULT_SFX } from '../src/sfx.ts';
import { DEFAULT_STYLE } from '../src/style.ts';
import { narrateScenes } from '../../server/src/render.ts';
import { fakeEdgeProvider, parseWordBoundaries } from '../../server/src/voice-online.ts';

describe('narration with an online voice', () => {
  let dir = '';
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'chp-narr-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('shows plain text, stretches the scene to the voice and passes real word times', async () => {
    const tts = new Tts(dir, undefined, () => [fakeEdgeProvider()]);
    const { spec } = await narrateScenes(
      { preset: 'tiktok', scenes: [{ text: 'El GPS usa *24* satélites [pausa 1s] en órbita', durationSec: 2 }, { text: 'Fuentes', durationSec: 3, card: true }] },
      { tts, voiceId: 'edge:es-CO-GonzaloNeural', speed: 1, pitch: 1, style: '', audioUrl: (h) => `http://127.0.0.1:8800/api/audio/${h}.wav?s=${'a'.repeat(64)}` },
    );
    const sc = spec.scenes[0]!;
    expect(sc.text).toBe('El GPS usa 24 satélites en órbita'); // marks never reach the screen
    expect(sc.wordTimes).toHaveLength(sc.text.split(' ').length);
    expect(sc.durationSec).toBeGreaterThan(2);
    expect(sc.speechSec).toBeGreaterThan(2); // includes the 1 s pause
    for (let i = 1; i < sc.wordTimes!.length; i++) expect(sc.wordTimes![i]!.from).toBeGreaterThanOrEqual(sc.wordTimes![i - 1]!.from);
    expect(spec.scenes[1]!.text).toBe('Fuentes'); // the credits card is untouched
    expect(spec.scenes[1]!.wordTimes).toBeUndefined();
  });

  it('uses the real times for captions and caption sounds, and the estimate when they do not match', () => {
    const est = wordTimings('uno dos tres', 0.15, 3);
    const real = withSpokenTimes(est, [{ from: 0.2, to: 0.4 }, { from: 1.5, to: 1.9 }, { from: 2.5, to: 2.9 }]);
    expect(real.map((w) => w.from)).toEqual([0.2, 1.5, 2.5]);
    expect(withSpokenTimes(est, [{ from: 0, to: 1 }])).toEqual(est);
    const cfg = { ...DEFAULT_SFX, enabled: true, hero: 'none', art: 'none', sceneChange: { ...DEFAULT_SFX.sceneChange, sound: 'none' }, captions: { ...DEFAULT_SFX.captions, mode: 'word' as const } };
    const ev = sfxEvents([{ text: 'uno dos tres', durationSec: 4, speechSec: 3, wordTimes: [{ from: 0.2, to: 0.4 }, { from: 1.5, to: 1.9 }, { from: 2.5, to: 2.9 }] }], DEFAULT_STYLE, cfg);
    expect(ev.map((e) => e.t)).toEqual([0.2, 1.5, 2.5]);
  });

  it('reads word boundaries (100-nanosecond ticks) from the service metadata', () => {
    const chunk = Buffer.from(JSON.stringify({ Metadata: [{ Type: 'WordBoundary', Data: { Offset: 1_000_000, Duration: 3_000_000, text: { Text: 'Hola', Length: 4, BoundaryType: 'WordBoundary' } } }, { Type: 'SessionEnd', Data: {} }] }));
    expect(parseWordBoundaries([chunk, Buffer.from('not json')])).toEqual([{ text: 'Hola', from: 0.1, to: 0.4 }]);
  });

  it.skipIf(process.platform === 'win32')('shifts the pitch of a local voice and joins pieces with real pauses', async () => {
    const d = await mkdtemp(join(tmpdir(), 'chp-local-'));
    const bin = fileURLToPath(new URL('./fake-piper.mjs', import.meta.url));
    chmodSync(bin, 0o755);
    const v = PIPER_VOICES[0]!;
    mkdirSync(join(d, 'voices', v.id), { recursive: true });
    writeFileSync(join(d, 'voices', v.id, `${v.id}.onnx`), 'stub');
    writeFileSync(join(d, 'voices', v.id, `${v.id}.onnx.json`), '{}');
    const tts = new Tts(d, bin);
    const plain = await tts.synth(v.id, 'Una frase de prueba larga', { speed: 1 });
    const paused = await tts.synth(v.id, 'Una frase [pausa 2s] de prueba larga', { speed: 1 });
    expect(paused.durationSec).toBeGreaterThan(plain.durationSec + 1.5); // the pause is real silence
    const high = await tts.synth(v.id, 'Una frase de prueba larga', { speed: 1, pitch: 3 });
    expect(Math.abs(high.durationSec - plain.durationSec)).toBeLessThan(0.15); // pitch changes, length does not
    expect(wavInfo(await readFile(high.file)).sampleRate).toBe(wavInfo(await readFile(plain.file)).sampleRate);
    expect(high.hash).not.toBe(plain.hash);
    await rm(d, { recursive: true, force: true });
  });
});
