import { describe, expect, it } from 'vitest';
import { analyzeFrames, detectCuts, estimateMotion, styleFromFingerprint, STYLES, type GrayFrame } from '../src/index.ts';

const W = 96, H = 54;
/** Deterministic textured scene; `seed` changes the picture, the transform moves/zooms it. */
const scene = (seed: number, tx = 0, ty = 0, s = 1): GrayFrame => {
  const g = new Uint8Array(W * H);
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = cx + (x - cx - tx) / s, v = cy + (y - cy - ty) / s;
    g[y * W + x] = Math.max(0, Math.min(255, 128 + 70 * Math.sin(u / (3 + seed % 3) + seed) * Math.cos(v / (4 + seed % 2) - seed) + 40 * Math.sin((u + v) / 7 + seed * 2)));
  }
  return { w: W, h: H, gray: g };
};
const sequence = (seed: number, n: number, step: (i: number) => [number, number, number]) => Array.from({ length: n }, (_, i) => { const [tx, ty, s] = step(i); return scene(seed, tx, ty, s); });

describe('cuts', () => {
  it('finds the frame where a different scene starts, and none inside a smooth movement', () => {
    const a = sequence(1, 6, (i) => [i * 0.5, 0, 1]);
    const b = sequence(4, 6, (i) => [i * 0.5, 0, 1]);
    expect(detectCuts([...a, ...b])).toEqual([6]);
    expect(detectCuts(a)).toEqual([]);
  });
});

describe('camera motion', () => {
  it('measures a pan and a zoom between two frames', () => {
    const pan = estimateMotion(scene(3), scene(3, 2, 0));
    expect(pan.reliable).toBe(true);
    expect(pan.dx).toBeGreaterThan(0.015);
    const zin = estimateMotion(scene(3), scene(3, 0, 0, 1.03));
    expect(zin.zoom).toBeGreaterThan(0.01);
    const zout = estimateMotion(scene(3), scene(3, 0, 0, 0.97));
    expect(zout.zoom).toBeLessThan(-0.01);
  });
  it('classifies each shot and builds the pattern, pacing and strength', () => {
    const fps = 4;
    const frames = [
      ...sequence(1, 12, (i) => [0, 0, 1 + i * 0.012]),   // shot 1: zoom in
      ...sequence(5, 12, (i) => [-i * 0.6, 0, 1]),         // shot 2: content moving left
      ...sequence(9, 12, () => [0, 0, 1]),                 // shot 3: static
    ];
    const fp = analyzeFrames(frames, fps);
    expect(fp.shots.count).toBe(3);
    expect(fp.shots.avgSec).toBeCloseTo(3, 0);
    expect(fp.camera.pattern).toEqual(['zoomIn', 'panL', 'still']);
    expect(fp.camera.motion).toBeGreaterThan(0.15);
    const style = styleFromFingerprint(fp, STYLES[0]!);
    expect(style).toMatchObject({ id: 'custom', cameraPattern: ['zoomIn', 'panL', 'still'], pace: 3 });
    expect(style.motion).toBe(fp.camera.motion);
  });
  it('a single static shot gives no pattern', () => {
    const fp = analyzeFrames(sequence(2, 10, () => [0, 0, 1]), 4);
    expect(fp.shots.count).toBe(1);
    expect(styleFromFingerprint(fp).cameraPattern).toBeUndefined();
  });
});

describe('layout', () => {
  it('detects text-like detail at the bottom', () => {
    const frames = Array.from({ length: 6 }, (_, k) => {
      const g = new Uint8Array(W * H).fill(30);
      for (let y = Math.floor(H * 0.8); y < Math.floor(H * 0.9); y++) for (let x = 8; x < W - 8; x++) g[y * W + x] = (x + k) % 4 < 2 ? 240 : 20;
      return { w: W, h: H, gray: g };
    });
    expect(analyzeFrames(frames, 4).layout.subtitle).toBe('bottom');
  });
});
