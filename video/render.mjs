// Usage: npm run render -w video -- <spec.json> [draft|final] [out.mp4]
// Local render: costs CPU, zero AI tokens. draft = half size (540p), final = native preset size (max 1080p).
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PRESETS, renderScale } from '@chp/core/presets';

const [specPath, quality = 'draft', outArg] = process.argv.slice(2);
if (!specPath || !['draft', 'final'].includes(quality)) {
  console.error('Usage: render <spec.json> [draft|final] [out.mp4]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const preset = PRESETS[spec.preset];
if (!preset) {
  console.error(`Unknown preset "${spec.preset}". Valid: ${Object.keys(PRESETS).join(', ')}`);
  process.exit(1);
}
mkdirSync('out', { recursive: true });
const out = outArg ?? `out/${spec.preset}-${quality}.mp4`;
const args = [
  'remotion', 'render', 'src/index.ts', 'Piece', out,
  `--props=${specPath}`,
  `--scale=${renderScale(preset, quality)}`,
  `--crf=${quality === 'final' ? 18 : 28}`,
];
if (process.env.CHROME_PATH) args.push(`--browser-executable=${process.env.CHROME_PATH}`);
process.exit(spawnSync('npx', args, { stdio: 'inherit' }).status ?? 1);
