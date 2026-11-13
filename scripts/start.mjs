// One-click launcher (used by ContentHub.bat / .command / .sh and `npm start`):
// install deps if needed -> update from GitHub (best effort) -> build UI if stale -> start -> open browser.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1'); // Windows drive fix
const PORT = Number(process.env.PORT ?? 8787);
const URL_ = `http://127.0.0.1:${PORT}`;
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win && cmd === npm, ...opts });
const say = (m) => console.log(`\n▶ ${m}`);

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node ${process.versions.node} is too old. Install Node 22 LTS from https://nodejs.org and run again.`);
  process.exit(1);
}

async function alive() {
  try {
    return (await fetch(`${URL_}/api/status`)).ok;
  } catch {
    return false;
  }
}

function open(url) {
  if (process.env.CHP_NO_OPEN) return;
  const [cmd, args] = win ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* printing the URL below is enough */
  }
}

if (await alive()) {
  console.log(`ContentHub Pro is already running at ${URL_}`);
  open(URL_);
  process.exit(0);
}

let changed = false;
if (!process.env.CHP_NO_UPDATE && existsSync(join(root, '.git'))) {
  say('Buscando actualizaciones…');
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (dirty.status === 0 && dirty.stdout.trim() === '') {
    const before = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout;
    const pull = spawnSync('git', ['pull', '--ff-only', '--quiet'], { cwd: root, stdio: 'inherit', timeout: 30_000 });
    changed = pull.status === 0 && spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout !== before;
  } else console.log('Hay cambios locales sin guardar: no actualizo.');
}

if (!existsSync(join(root, 'node_modules')) || changed) {
  say('Instalando dependencias (solo la primera vez o tras una actualización)…');
  if (run(npm, [existsSync(join(root, 'package-lock.json')) ? 'ci' : 'install']).status !== 0) process.exit(1);
}

const newest = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
    const p = join(dir, e.name);
    return Math.max(m, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }, 0);
const dist = join(root, 'app', 'dist', 'index.html');
if (!existsSync(dist) || changed || newest(join(root, 'app', 'src')) > statSync(dist).mtimeMs) {
  say('Preparando la interfaz…');
  if (run(npm, ['run', 'build', '-w', 'app']).status !== 0) process.exit(1);
}

say('Iniciando ContentHub Pro…');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const server = spawn(process.execPath, [tsx, 'server/src/main.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(PORT) } });
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill());

for (let i = 0; i < 60 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));
console.log(`\n✔ Listo: ${URL_}   (cierra esta ventana o pulsa Ctrl+C para detener)`);
open(URL_);
