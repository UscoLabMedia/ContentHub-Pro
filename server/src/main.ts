// Local server (127.0.0.1 only). Holds the vault key and secrets in memory; the browser never sees them.
// Also serves the built app (app/dist) so one process = the whole product (see scripts/start.mjs).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  Gateway, Vault, claudeCodeStatus, createClaudeCodeClient, createLlmClient, digestToPrompt, excerpt, ingestFile,
  OUTPUT_SCHEMAS, type LlmClient, type Quality, type Task,
} from '@chp/core';
import { classify, ideasFor, processSource, toView, type SourceRecord } from './sources.ts';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173'; // Vite dev server; same-origin in production
const DATA_DIR = process.env.CHP_DATA_DIR ?? join(homedir(), '.contenthub-pro'); // outside the repo
const VAULT_FILE = join(DATA_DIR, 'vault.enc');
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'app', 'dist');
const MIN_PASSWORD = 8;
const MAX_UPLOAD = 4 * 1024 ** 3;

type Engine = 'claude-code' | 'api';
interface Session {
  token: string;
  vault: Vault;
  gateway?: Gateway;
  sources: Map<string, SourceRecord>;
}
let session: Session | null = null;

const storage = {
  read: () => readFile(VAULT_FILE, 'utf8').catch(() => null),
  write: async (t: string) => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(VAULT_FILE, t, { mode: 0o600 });
  },
};

// --- brute-force throttle for unlock/recover -------------------------------------------------
let failures = 0;
let lockedUntil = 0;
const guardAttempt = (): number => Math.max(0, lockedUntil - Date.now());
const failAttempt = () => {
  failures++;
  if (failures >= 5) lockedUntil = Date.now() + Math.min(15 * 60_000, 2 ** (failures - 5) * 15_000);
};

// --- AI engine: your Claude Code account (default) or an API key -------------------------------
const engineOf = (s: Session): Engine => s.vault.get<Engine>('engine') ?? (s.vault.get<string>('anthropicKey') ? 'api' : 'claude-code');

function buildGateway(s: Session): void {
  const key = s.vault.get<string>('anthropicKey');
  const engine = engineOf(s);
  let llm: LlmClient | undefined;
  if (engine === 'claude-code') llm = createClaudeCodeClient();
  else if (key) llm = createLlmClient(key);
  s.gateway = llm ? new Gateway({ llm, store: s.vault, persist: () => s.vault.save() }) : undefined;
}

function startSession(vault: Vault): Session {
  const sources = new Map<string, SourceRecord>();
  for (const r of Object.values(vault.get<Record<string, SourceRecord>>('sources') ?? {})) {
    if (r.status === 'processing') Object.assign(r, { status: 'error', error: 'Se interrumpió al cerrar la app', label: 'Error' });
    sources.set(r.id, r);
  }
  const s: Session = { token: randomBytes(32).toString('hex'), vault, sources };
  buildGateway(s);
  failures = 0;
  return (session = s);
}

const saveSources = async (s: Session) => {
  s.vault.set('sources', Object.fromEntries(s.sources));
  await s.vault.save();
};

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = async (req: IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 25_000_000) throw new Error('Body too large');
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};
const authed = (req: IncomingMessage): boolean => {
  const h = String(req.headers['x-session'] ?? '');
  if (!session || h.length !== session.token.length) return false;
  return timingSafeEqual(Buffer.from(h), Buffer.from(session.token));
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};
async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  if (!existsSync(DIST)) return false;
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, rel || 'index.html');
  if (!file.startsWith(DIST)) return false; // path traversal guard
  if (!existsSync(file) || extname(file) === '') file = join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
  return true;
}

/** Opens a terminal in the project folder running Claude Code (so you can edit the app with it). */
function openClaudeTerminal(): { ok: boolean; hint?: string } {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', 'Claude Code', '/D', ROOT, 'cmd', '/k', 'claude'], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      const script = `tell application "Terminal" to do script "cd '${ROOT.replace(/'/g, "'\\''")}' && claude"`;
      spawn('osascript', ['-e', script, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
    } else return { ok: false, hint: `Abre una terminal en ${ROOT} y ejecuta: claude` };
    return { ok: true };
  } catch (e) {
    return { ok: false, hint: e instanceof Error ? e.message : String(e) };
  }
}

function repoName(): string | null {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout.trim().match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1] ?? null) : null;
}

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', ORIGIN);
  res.setHeader('access-control-allow-headers', 'content-type,x-session');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && (await serveStatic(url.pathname, res))) return;
    return json(res, 404, { error: 'Not found' });
  }
  try {
    if (url.pathname === '/api/status' && req.method === 'GET')
      return json(res, 200, { vaultExists: await Vault.exists(storage), unlocked: authed(req) });

    // --- unauthenticated entry points: create / import / unlock / recover ---
    if (url.pathname === '/api/create' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) return json(res, 400, { error: `Password must be at least ${MIN_PASSWORD} characters` });
      if (await Vault.exists(storage)) return json(res, 409, { error: 'A vault already exists' });
      const { vault, recoveryKey } = await Vault.create(password, storage);
      return json(res, 200, { token: startSession(vault).token, recoveryKey }); // shown ONCE
    }
    if (url.pathname === '/api/vault/import' && req.method === 'POST') {
      // Bring your encrypted vault from another PC. Only allowed when no vault exists (never overwrites).
      if (await Vault.exists(storage)) return json(res, 409, { error: 'A vault already exists on this PC' });
      const b = await readBody(req);
      if (b?.v !== 2 || !b.pw || !b.rec || typeof b.iv !== 'string' || typeof b.ct !== 'string') return json(res, 400, { error: 'Not a ContentHub vault file' });
      await storage.write(JSON.stringify(b));
      return json(res, 200, { ok: true });
    }
    if ((url.pathname === '/api/unlock' || url.pathname === '/api/recover') && req.method === 'POST') {
      const wait = guardAttempt();
      if (wait) return json(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} s` });
      const body = await readBody(req);
      try {
        if (url.pathname === '/api/unlock') return json(res, 200, { token: startSession(await Vault.open(String(body.password), storage)).token });
        if (typeof body.newPassword !== 'string' || body.newPassword.length < MIN_PASSWORD) return json(res, 400, { error: `New password must be at least ${MIN_PASSWORD} characters` });
        const vault = await Vault.openWithRecovery(String(body.recoveryKey), storage);
        await vault.changePassword(body.newPassword);
        return json(res, 200, { token: startSession(vault).token });
      } catch (e) {
        failAttempt();
        return json(res, 401, { error: e instanceof Error ? e.message : 'Denied' });
      }
    }

    if (!session || !authed(req)) return json(res, 401, { error: 'Locked' });
    const s = session;

    // --- AI engine ---
    if (url.pathname === '/api/engine' && req.method === 'GET')
      return json(res, 200, { engine: engineOf(s), hasKey: !!s.vault.get('anthropicKey'), ready: !!s.gateway, claude: await claudeCodeStatus() });
    if (url.pathname === '/api/engine' && req.method === 'PUT') {
      const { engine } = await readBody(req);
      if (engine !== 'claude-code' && engine !== 'api') return json(res, 400, { error: 'Unknown engine' });
      s.vault.set('engine', engine);
      await s.vault.save();
      buildGateway(s);
      return json(res, 200, { engine, ready: !!s.gateway });
    }
    if (url.pathname === '/api/engine/login' && req.method === 'POST') {
      // Starts Claude Code's own browser sign-in (we never see your credentials).
      const cmd = process.platform === 'win32' ? { c: 'cmd.exe', a: ['/c', 'start', 'Claude Code login', 'cmd', '/k', 'claude auth login'] } : { c: 'claude', a: ['auth', 'login'] };
      spawn(cmd.c, cmd.a, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings/key' && req.method === 'PUT') {
      const { key } = await readBody(req);
      if (typeof key !== 'string' || !key.startsWith('sk-ant-')) return json(res, 400, { error: 'Not an Anthropic API key' });
      s.vault.set('anthropicKey', key); // write-only: never returned by any endpoint
      await s.vault.save();
      buildGateway(s);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings/password' && req.method === 'PUT') {
      const { newPassword } = await readBody(req);
      if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) return json(res, 400, { error: `Password must be at least ${MIN_PASSWORD} characters` });
      await s.vault.changePassword(newPassword);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings/recovery-key' && req.method === 'POST')
      return json(res, 200, { recoveryKey: await s.vault.rotateRecoveryKey() }); // shown ONCE; old key stops working
    if (url.pathname === '/api/vault/export' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="contenthub-vault.enc"' });
      return void res.end((await storage.read()) ?? '');
    }

    // --- project, AI tasks, metrics ---
    if (url.pathname === '/api/project' && req.method === 'GET') return json(res, 200, { project: s.vault.get('project') ?? null });
    if (url.pathname === '/api/project' && req.method === 'PUT') {
      s.vault.set('project', (await readBody(req)).project);
      await s.vault.save();
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/ai/') && req.method === 'POST') {
      const task = url.pathname.slice('/api/ai/'.length) as Task;
      if (!(task in OUTPUT_SCHEMAS)) return json(res, 404, { error: 'Unknown task' });
      if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes (cuenta de Claude Code o clave de API)' });
      return json(res, 200, await s.gateway.run(task, (await readBody(req)).input));
    }
    if (url.pathname === '/api/ingest' && req.method === 'POST') {
      const { name, dataBase64 } = await readBody(req);
      const digest = await ingestFile({ name: String(name), bytes: new Uint8Array(Buffer.from(String(dataBase64), 'base64')) });
      return json(res, 200, { digest, prompt: digestToPrompt(digest) });
    }

    // --- sources: audio / video / text -> transcript -> ideas ---
    if (url.pathname === '/api/sources' && req.method === 'GET') return json(res, 200, { sources: [...s.sources.values()].map(toView).sort((a, b) => b.createdAt - a.createdAt) });
    if (url.pathname === '/api/sources/upload' && req.method === 'PUT') {
      const name = basename(String(url.searchParams.get('name') ?? 'archivo')).replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '_');
      const kind = classify(name);
      if (!kind) return json(res, 400, { error: 'Tipo de archivo no compatible (audio, video, txt, md, srt, vtt, pdf)' });
      if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) return json(res, 413, { error: 'Archivo demasiado grande' });
      const id = randomBytes(8).toString('hex');
      const dir = join(DATA_DIR, 'sources', id);
      await mkdir(dir, { recursive: true });
      const file = join(dir, name);
      await pipeline(req, createWriteStream(file));
      const rec: SourceRecord = { id, name, kind, createdAt: Date.now(), status: 'processing', progress: 1, label: 'En cola', durationSec: 0, timed: false, words: 0, segments: [] };
      s.sources.set(id, rec);
      const quality: Quality = url.searchParams.get('quality') === 'better' ? 'better' : 'fast';
      void processSource(rec, file, DATA_DIR, quality, () => saveSources(s));
      return json(res, 200, { id });
    }
    const m = url.pathname.match(/^\/api\/sources\/([a-f0-9]+)(?:\/(ideas|excerpt))?$/);
    if (m) {
      const rec = s.sources.get(m[1]!);
      if (!rec) return json(res, 404, { error: 'Source not found' });
      if (!m[2] && req.method === 'GET') return json(res, 200, { source: toView(rec) });
      if (!m[2] && req.method === 'DELETE') {
        s.sources.delete(rec.id);
        await saveSources(s);
        return json(res, 200, { ok: true });
      }
      if (m[2] === 'excerpt' && req.method === 'GET')
        return json(res, 200, { text: excerpt(rec.segments, Number(url.searchParams.get('start') ?? 0), Number(url.searchParams.get('end') ?? 0)) });
      if (m[2] === 'ideas' && req.method === 'POST') {
        if (rec.status !== 'ready') return json(res, 409, { error: 'El archivo aún se está procesando' });
        if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes (cuenta de Claude Code o clave de API)' });
        return json(res, 200, await ideasFor(s.gateway, rec));
      }
    }

    // --- developer shortcuts ---
    if (url.pathname === '/api/dev/info' && req.method === 'GET') return json(res, 200, { root: ROOT, repo: repoName(), webUrl: 'https://claude.ai/code' });
    if (url.pathname === '/api/dev/claude-code' && req.method === 'POST') return json(res, 200, openClaudeTerminal());

    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e instanceof Error ? e.message : 'Server error' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`ContentHub Pro on http://127.0.0.1:${PORT}`));
