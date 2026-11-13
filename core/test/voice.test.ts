import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPER_VOICES, SAMPLE_TEXT, Tts, piperAssetUrl, sineWav, wavInfo } from '../src/index.ts';

describe('wav helpers', () => {
  it('reads duration, rate and handles a streamed (bogus-size) header', () => {
    const w = sineWav(440, 2, 22050);
    expect(wavInfo(w)).toMatchObject({ sampleRate: 22050, channels: 1, bits: 16 });
    expect(wavInfo(w).durationSec).toBeCloseTo(2, 2);
    const streamed = Buffer.from(w);
    streamed.writeUInt32LE(0xffffffff, 40);
    expect(wavInfo(streamed).durationSec).toBeCloseTo(2, 2);
    expect(() => wavInfo(Buffer.from('nope'))).toThrow();
  });
});

describe('catalog', () => {
  it('lists Spanish voices with unique ids and a download source each', () => {
    const ids = PIPER_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of PIPER_VOICES) expect(Boolean(v.hf) !== Boolean(v.gh)).toBe(true);
    expect(PIPER_VOICES.some((v) => v.gh)).toBe(true); // at least one GitHub-hosted fallback
    expect(piperAssetUrl() ?? 'unsupported-os').toMatch(/rhasspy\/piper\/releases\/download\/2023\.11\.14-2\/|unsupported-os/);
  });
});

describe.skipIf(process.platform === 'win32')('Tts with a fake Piper', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'chp-tts-'));
    const bin = fileURLToPath(new URL('./fake-piper.mjs', import.meta.url));
    chmodSync(bin, 0o755);
    const v = PIPER_VOICES[0]!;
    const vd = join(dir, 'voices', v.id);
    mkdirSync(vd, { recursive: true });
    writeFileSync(join(vd, `${v.id}.onnx`), 'stub');
    writeFileSync(join(vd, `${v.id}.onnx.json`), '{}');
    return { dir, tts: new Tts(dir, bin), voice: v };
  };

  it('lists installed voices, synthesizes, and serves repeats from the cache', async () => {
    const { tts, voice } = setup();
    const list = await tts.list();
    expect(list.find((x) => x.id === voice.id)?.installed).toBe(true);
    expect(list.find((x) => x.id === PIPER_VOICES[1]!.id)?.installed).toBe(false);

    const a = await tts.synth(voice.id, SAMPLE_TEXT, 1);
    expect(a.durationSec).toBeGreaterThan(1);
    const b = await tts.synth(voice.id, SAMPLE_TEXT, 1);
    expect(b.file).toBe(a.file);
    expect(readFileSync(`${a.file}.calls`, 'utf8')).toBe('x'); // engine ran once
    const fast = await tts.synth(voice.id, SAMPLE_TEXT, 1.5);
    expect(fast.durationSec).toBeLessThan(a.durationSec); // speed changes length
    expect(existsSync(fast.file)).toBe(true);
  });
  it('rejects unknown voices and empty text', async () => {
    const { tts } = setup();
    await expect(tts.synth('nope', 'hola', 1)).rejects.toThrow(/desconocida/);
    await expect(tts.synth(PIPER_VOICES[0]!.id, '   ', 1)).rejects.toThrow(/texto/);
  });
});
