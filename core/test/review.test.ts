import { describe, expect, it } from 'vitest';
import { attachConfidence, blocksToLines, lineIdsInRange, mergeLines, reviewFlags, toReviewLines, usableBlock, Vault, type BlobStorage, type Segment } from '../src/index.ts';

const seg = (start: number, end: number, text: string, conf?: number): Segment => ({ start, end, text, conf });

describe('review flags', () => {
  it('flags numbers, proper names and low confidence — and leaves plain speech alone', () => {
    expect(reviewFlags('el precio subió 300 por ciento')).toContain('cifra');
    expect(reviewFlags('vendieron tres mil sacos')).toContain('cifra');
    expect(reviewFlags('la finca de Pitalito produce más café')).toContain('nombre propio');
    expect(reviewFlags('Hola a todos, bienvenidos al podcast')).not.toContain('nombre propio');
    expect(reviewFlags('hablamos del café del huila', 0.5)).toContain('baja confianza');
    expect(reviewFlags('hablamos del café del huila', 0.95)).toEqual([]);
  });
});

describe('review lines and blocks', () => {
  const segs = [seg(0, 8, 'Bienvenidos al podcast.'), seg(8, 16, 'Hoy en Pitalito hablamos de café.'), seg(16, 40, 'Son 300 hectáreas.', 0.4), seg(40, 50, 'Gracias por escuchar.')];
  it('groups segments into ~20 s lines and carries the lowest confidence', () => {
    const lines = toReviewLines(segs, 20);
    expect(lines.map((l) => [l.start, l.end])).toEqual([[0, 16], [16, 40], [40, 50]]);
    expect(lines[1]!.flags).toEqual(expect.arrayContaining(['cifra', 'baja confianza']));
    expect(lines.map((l) => l.id)).toEqual([0, 1, 2]);
  });
  it('merges consecutive selected lines into one passage and keeps gaps separate', () => {
    const lines = toReviewLines(segs, 20);
    const blocks = mergeLines(lines, [0, 1, 2]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ startSec: 0, endSec: 50, lineIds: [0, 1, 2] });
    const gap = mergeLines(lines, [0, 2]);
    expect(gap.map((b) => b.lineIds)).toEqual([[0], [2]]);
    expect(lineIdsInRange(lines, 10, 20)).toEqual([0, 1]);
  });
  it('only confirmed or corrected passages reach the AI', () => {
    const blocks = [
      { startSec: 0, endSec: 10, text: 'Bienvenidos.', status: 'ok' as const },
      { startSec: 20, endSec: 30, text: 'Son 3.000 hectáreas.', status: 'corrected' as const },
      { startSec: 40, endSec: 50, text: '', status: 'unclear' as const },
    ];
    expect(blocks.map(usableBlock)).toEqual([true, true, false]);
    expect(blocksToLines(blocks)).toEqual(['[00:00] Bienvenidos.', '[00:20] Son 3.000 hectáreas.']);
  });
});

describe('whisper confidence', () => {
  it('averages token probabilities per segment and ignores special tokens and bad JSON', () => {
    const segs = [seg(0, 2, 'a'), seg(2, 4, 'b')];
    const json = JSON.stringify({ transcription: [
      { offsets: { from: 0, to: 2000 }, tokens: [{ text: '[_BEG_]', p: 0.1 }, { text: ' a', p: 0.9 }, { text: ' b', p: 0.7 }] },
      { offsets: { from: 2000, to: 4000 }, tokens: [{ text: ' c', p: 0.3 }] },
    ] });
    attachConfidence(segs, json);
    expect(segs[0]!.conf).toBeCloseTo(0.8);
    expect(segs[1]!.conf).toBeCloseTo(0.3);
    const none = [seg(0, 1, 'x')];
    attachConfidence(none, 'not json');
    expect(none[0]!.conf).toBeUndefined();
  });
});

describe('encrypted audio copy', () => {
  const mem = (): BlobStorage => { let d: string | null = null; return { read: async () => d, write: async (t) => void (d = t) }; };
  it('round-trips big data, hides the content, and detects tampering or truncation', async () => {
    const { vault } = await Vault.create('pw-long-enough', mem(), 1000);
    const data = new Uint8Array(9 * 1024 * 1024).map((_, i) => (i * 31) % 251); // 3 chunks
    data.set(new TextEncoder().encode('ID3-plain-header'), 0);
    const sealed = await vault.sealBytes(data);
    expect(Buffer.from(sealed).includes(Buffer.from('ID3-plain-header'))).toBe(false);
    expect(Buffer.from(await vault.openBytes(sealed)).equals(Buffer.from(data))).toBe(true);

    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 20]! ^= 1;
    await expect(vault.openBytes(flipped)).rejects.toThrow(/corrupted/);
    // dropping the last chunk must not silently succeed
    const firstTwo = Buffer.from(sealed).subarray(0, 5 + 2 * (16 + 4 * 1024 * 1024 + 16));
    await expect(vault.openBytes(firstTwo)).rejects.toThrow();
    const small = await vault.sealBytes(new Uint8Array(0));
    expect((await vault.openBytes(small)).length).toBe(0);
  });
});
