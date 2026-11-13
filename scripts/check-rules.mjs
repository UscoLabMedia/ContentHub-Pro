// Enforces the mandatory rules from CLAUDE.md. Run by `npm run check` and CI.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'out', 'coverage', '.git']);
const problems = [];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

for (const file of walk(root)) {
  const rel = relative(root, file);
  if (!/\.(ts|tsx|mjs|js|json|md)$/.test(rel) || rel === 'package-lock.json') continue;
  const text = readFileSync(file, 'utf8');

  // Rule 1: only core/src/ai/client.ts may use the Anthropic SDK.
  if (/\.(ts|tsx|mjs|js)$/.test(rel) && /(from\s+|require\(\s*|import\(\s*)['"]@anthropic-ai\/sdk/.test(text) && rel !== 'core/src/ai/client.ts')
    problems.push(`${rel}: imports @anthropic-ai/sdk outside core/src/ai/client.ts (use the gateway)`);

  // Security: no API keys in the repo.
  if (/sk-ant-[A-Za-z0-9_-]{20,}/.test(text)) problems.push(`${rel}: looks like a real Anthropic API key`);

  // Rule 8: no 4K presets/dimensions in presets.
  if (rel === 'core/src/presets.ts' && /(3840|2160)/.test(text)) problems.push(`${rel}: 4K is not allowed (max 1080p)`);
}

try {
  const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n');
  for (const f of tracked) if (/\.enc$/.test(f)) problems.push(`${f}: encrypted vault must never be committed`);
} catch {
  // not a git checkout (e.g. exported archive): skip
}

if (problems.length) {
  console.error('Rule violations:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('check-rules: OK');
