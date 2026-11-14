import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Tts, sineWav } from '../src/voice/index.ts';
import { KOKORO_VOICES, KokoroEngine, kokoroDir } from '../../server/src/kokoro.ts';

const python = (() => { try { return execSync('command -v python3', { encoding: 'utf8' }).trim(); } catch { return ''; } })();

// A stand-in worker that speaks the same line protocol as server/py/kokoro_worker.py (no model needed).
const FAKE = `
import json, sys, struct, wave
real = sys.stdout; sys.stdout = sys.stderr
def reply(o): real.write(json.dumps(o) + "\\n"); real.flush()
reply({"ready": True, "voices": ["ef_dora"]})
for line in sys.stdin:
    r = json.loads(line)
    if r["text"].startswith("fail"): reply({"id": r["id"], "ok": False, "error": "boom"}); continue
    n = int(24000 * (0.5 + 0.05 * len(r["text"]) / r["speed"]))
    w = wave.open(r["out"], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
    w.writeframes(b"".join(struct.pack("<h", 3000 if (i // 40) % 2 else -3000) for i in range(n))); w.close()
    reply({"id": r["id"], "ok": True, "seconds": n / 24000})
`;

describe.skipIf(!python || process.platform === 'win32')('Kokoro engine (protocol, with a stand-in worker)', () => {
  let dir = '';
  let engine: KokoroEngine;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chp-kok-'));
    const k = kokoroDir(dir);
    mkdirSync(join(k, 'venv', 'bin'), { recursive: true });
    symlinkSync(python, join(k, 'venv', 'bin', 'python'));
    writeFileSync(join(k, 'kokoro-int8.onnx'), 'x');
    writeFileSync(join(k, 'voices.bin'), 'x');
    writeFileSync(join(k, 'ready.json'), JSON.stringify({ version: 1 }));
    const worker = join(dir, 'fake_worker.py');
    writeFileSync(worker, FAKE);
    chmodSync(worker, 0o755);
    engine = new KokoroEngine(dir, dir, 60_000, worker);
  });
  afterAll(async () => { engine.stop(); await rm(dir, { recursive: true, force: true }); });

  it('lists the Spanish voices as local and installed', () => {
    const v = engine.voices();
    expect(v.map((x) => x.id)).toEqual(KOKORO_VOICES.map((x) => `kokoro:${x.key}`));
    expect(v.every((x) => x.engine === 'kokoro' && x.installed && x.lang === 'es')).toBe(true);
  });
  it('narrates through Tts, caches, and honors speed, pauses and pitch', async () => {
    const tts = new Tts(dir, undefined, () => [], engine);
    const a = await tts.synth('kokoro:ef_dora', 'Hola mundo, esto es una prueba', 1);
    expect(a.durationSec).toBeGreaterThan(0.5);
    expect((await tts.synth('kokoro:ef_dora', 'Hola mundo, esto es una prueba', 1)).hash).toBe(a.hash);
    const fast = await tts.synth('kokoro:ef_dora', 'Hola mundo, esto es una prueba', 1.5);
    expect(fast.durationSec).toBeLessThan(a.durationSec);
    const paused = await tts.synth('kokoro:ef_dora', 'Hola mundo [pausa 2s] esto es una prueba', 1);
    expect(paused.durationSec).toBeGreaterThan(a.durationSec + 1.5);
    const high = await tts.synth('kokoro:ef_dora', 'Hola mundo, esto es una prueba', { speed: 1, pitch: 3 });
    expect(Math.abs(high.durationSec - a.durationSec)).toBeLessThan(0.2);
    expect((await readFile(a.file)).subarray(0, 4).toString()).toBe('RIFF');
  });
  it('serves several requests in order and reports a failure without dying', async () => {
    const dest = (n: string) => join(dir, `q-${n}.wav`);
    const results = await Promise.allSettled([engine.synth('ef_dora', 'uno', 1, dest('1'), () => {}), engine.synth('ef_dora', 'fail aquí', 1, dest('2'), () => {}), engine.synth('em_alex', 'tres', 1, dest('3'), () => {})]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((results[1] as PromiseRejectedResult).reason.message).toContain('boom');
    await expect(engine.synth('nope', 'x', 1, dest('4'), () => {})).rejects.toThrow(/desconocida/);
  });
  it('starts again after the worker stops', async () => {
    engine.stop();
    await engine.synth('ef_dora', 'otra vez', 1, join(dir, 'again.wav'), () => {});
    expect(sineWav(440, 0.1).length).toBeGreaterThan(0); // (keeps the helper import honest)
  });
});
