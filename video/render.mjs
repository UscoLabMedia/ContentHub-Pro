// Usage: node render.mjs <spec.json> [draft|final] [out.mp4]   (run through tsx; see server/src/render.ts)
// Local render: costs CPU, zero AI tokens. draft = half size (540p), final = native preset size (max 1080p).
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { PRESETS, renderScale } from '@chp/core/presets';

const [specPath, quality = 'draft', outArg] = process.argv.slice(2);
if (!specPath || !['draft', 'final', 'still'].includes(quality)) {
  console.error('Usage: render <spec.json> [draft|final|still] [out]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const preset = quality === 'still' ? null : PRESETS[spec.preset];
if (quality !== 'still' && !preset) {
  console.error(`Unknown preset "${spec.preset}". Valid: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(1);
}
mkdirSync('out', { recursive: true });
const out = resolve(outArg ?? `out/${spec.preset}-${quality}.mp4`);
// Run Remotion's CLI with this same Node (no npx/.cmd shims, so it behaves the same on Windows).
const cli = join(dirname(createRequire(import.meta.url).resolve('@remotion/cli')), '..', 'remotion-cli.js');
// quality "still" renders the Thumbnail composition to a PNG (props = { title, subtitle, theme }).
const args = quality === 'still' ? [cli, 'still', 'src/index.ts', 'Thumbnail', out, `--props=${resolve(specPath)}`, '--image-format=png'] : [
  cli, 'render', 'src/index.ts', 'Piece', out,
  `--props=${resolve(specPath)}`,
  `--scale=${renderScale(preset, quality)}`,
  `--crf=${quality === 'final' ? 18 : 28}`,
];
if (process.env.CHROME_PATH) args.push(`--browser-executable=${process.env.CHROME_PATH}`);
process.exit(spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 1);
