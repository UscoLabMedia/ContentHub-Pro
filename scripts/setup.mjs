// One-command setup on any PC: `npm run setup`
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node ${process.versions.node} is too old. Install Node 22 (see .nvmrc).`);
  process.exit(1);
}
const install = existsSync('package-lock.json') ? ['ci'] : ['install'];
if (spawnSync('npm', install, { stdio: 'inherit' }).status !== 0) process.exit(1);
if (spawnSync('npm', ['run', 'verify'], { stdio: 'inherit' }).status !== 0) process.exit(1);

console.log(`
Setup OK. Next:
  Open the app:   npm start   (or double-click ContentHub.bat / ContentHub.command / ContentHub.sh)
  Make changes:   npm run dev:all
  Claude Code skills (once per PC):
       Ponytail  -> enabled by .claude/settings.json (accept the plugin prompt)
       Remotion  -> npx skills add remotion-dev/skills
  Your encrypted vault lives in ~/.contenthub-pro/vault.enc (copy it to use the same data on another PC).
`);
