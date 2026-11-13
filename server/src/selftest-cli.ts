// `npm run selftest [-- --full] [-- --only=node,vault]`: prints the same checks the app shows.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tts } from '@chp/core';
import { runSelfTest } from './selftest.ts';

const dataDir = process.env.CHP_DATA_DIR ?? join(homedir(), '.contenthub-pro');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const full = process.argv.includes('--full');
const ICON = { ok: '✔', warn: '!', fail: '✘', skip: '–', pending: '·', running: '…' } as const;

const results = await runSelfTest({
  dataDir, root: fileURLToPath(new URL('../..', import.meta.url)), full, only, tts: new Tts(dataDir, process.env.CHP_PIPER_BIN),
  onUpdate: () => {},
});
console.log(`\nPrueba ${full ? 'COMPLETA' : 'rápida'} de ContentHub Pro\n`);
for (const r of results) console.log(`${ICON[r.status]} [${r.group}] ${r.label}\n    ${r.detail}${r.ms ? `  (${(r.ms / 1000).toFixed(1)} s)` : ''}`);
const bad = results.filter((r) => r.status === 'fail').length;
console.log(`\n${results.filter((r) => r.status === 'ok').length} correctas · ${results.filter((r) => r.status === 'warn').length} avisos · ${bad} fallos · ${results.filter((r) => r.status === 'skip').length} omitidas`);
process.exit(bad ? 1 : 0);
