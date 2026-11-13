// `npm run dev:all`: server + Vite together with hot reload, for making changes. Opens http://localhost:5173
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const node = process.execPath;
const procs = [
  spawn(node, [join(root, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'server/src/main.ts'], { cwd: root, stdio: 'inherit' }),
  spawn(node, [join(root, 'node_modules/vite/bin/vite.js'), '--open'], { cwd: join(root, 'app'), stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, stop);
procs.forEach((p) => p.on('exit', stop));
