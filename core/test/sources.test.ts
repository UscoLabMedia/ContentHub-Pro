import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkLines, excerpt, fmtTime, parseSubtitles, plainSegments, runFfmpeg, toLines, toWav16k } from '../src/index.ts';

const SRT = `1
00:00:01,000 --> 00:00:09,500
Hola, bienvenidos al podcast.

2
00:00:10,000 --> 00:00:42,000
Hoy hablamos del café del <i>Huila</i>.

3
01:02:03,250 --> 01:02:10,000
Y cerramos con una historia.
`;

describe('subtitles and timed text', () => {
  it('parses SRT and strips markup', () => {
    const s = parseSubtitles(SRT);
    expect(s).toHaveLength(3);
    expect(s[1]).toMatchObject({ start: 10, end: 42, text: 'Hoy hablamos del café del Huila.' });
    expect(s[2]!.start).toBeCloseTo(3723.25);
  });
  it('parses WebVTT', () => {
    const v = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:03.000\nhola\n');
    expect(v[0]).toMatchObject({ start: 1, end: 3, text: 'hola' });
  });
  it('formats times and builds compact lines', () => {
    expect(fmtTime(75)).toBe('01:15');
    expect(fmtTime(3723)).toBe('1:02:03');
    const lines = toLines(parseSubtitles(SRT), 30);
    expect(lines[0]).toMatch(/^\[00:01\] Hola.*café del Huila\.$/);
    expect(lines.at(-1)).toMatch(/^\[1:02:03\]/);
  });
  it('chunks without splitting lines, and excerpts by time', () => {
    const chunks = chunkLines(['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)], 110);
    expect(chunks).toHaveLength(2);
    expect(excerpt(parseSubtitles(SRT), 9, 11)).toContain('Hoy hablamos');
    expect(plainSegments('uno\n\ndos  dos')).toHaveLength(2);
  });
});

describe('ffmpeg (bundled with Remotion)', () => {
  it('converts audio to 16 kHz mono WAV', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chp-'));
    const src = join(dir, 'in.mp3');
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', src]).catch(async () => {
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', join(dir, 'in.wav')]);
    });
    const input = statSync(src, { throwIfNoEntry: false }) ? src : join(dir, 'in.wav');
    const out = join(dir, 'out.wav');
    await toWav16k(input, out);
    const bytes = statSync(out).size;
    expect(bytes).toBeGreaterThan(2 * 16000 * 2 * 0.9); // ~2 s * 16k samples * 2 bytes
    expect(readFileSync(out).subarray(0, 4).toString()).toBe('RIFF');
    void spawnSync;
  }, 60_000);
});
