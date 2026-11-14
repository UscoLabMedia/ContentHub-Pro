#!/usr/bin/env node
// Stand-in for the Piper executable used by tests (never downloads or runs the real binary).
import { appendFileSync, writeFileSync } from 'node:fs';
import { sineWav } from '../src/voice/wav.ts';
const a = process.argv.slice(2);
const flag = (n) => a[a.indexOf(n) + 1];
let text = '';
process.stdin.on('data', (d) => (text += d)).on('end', () => {
  const scale = Number(flag('--length_scale') ?? 1);
  writeFileSync(flag('--output_file'), sineWav(440, Math.max(0.5, text.trim().length / 15) * scale));
  appendFileSync(flag('--output_file') + '.calls', 'x');
});
