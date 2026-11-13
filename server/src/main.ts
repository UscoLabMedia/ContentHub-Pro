// Local server (127.0.0.1 only). Holds the vault key and secrets in memory; the browser never sees them.
// Also serves the built app (app/dist) so one process = the whole product (see scripts/start.mjs).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  Gateway, Tts, Vault, VideoSpec, claudeCodeStatus, toReviewLines, usableBlock, type ReviewBlock, createClaudeCodeClient, createLlmClient, digestToPrompt, fetchRadar, ingestFile, radarLines,
  OUTPUT_SCHEMAS, type LlmClient, type Quality, type Task,
} from '@chp/core';
import { audioPath, classify, dropAudio, excerptFor, ideasFor, processSource, toView, type SourceRecord } from './sources.ts';
import { isRenderId, renderFile, renderStatus, startRender } from './render.ts';
import { runSelfTest, type CheckResult } from './selftest.ts';
import { getPackage, isPackageId, packageDir, startPackage, type PackageRequest } from './deliverables.ts';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173'; // Vite dev server; same-origin in production
const DATA_DIR = process.env.CHP_DATA_DIR ?? join(homedir(), '.contenthub-pro'); // outside the repo
const VAULT_FILE = join(DATA_DIR, 'vault.enc');
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'app', 'dist');
const MIN_PASSWORD = 8;
const MAX_UPLOAD = 4 * 1024 ** 3;

const tts = new Tts(DATA_DIR, process.env.CHP_PIPER_BIN);
let radarCache: { at: number; data: Awaited<ReturnType<typeof fetchRadar>> } | null = null;

interface VoiceJob {
  id: string;
  status: 'working' | 'done' | 'error';
  progress: number;
  label: string;
  error?: string;
  hash?: string;
  durationSec?: number;
}
const voiceJobs = new Map<string, VoiceJob>();
const selftest: { running: boolean; full: boolean; results: CheckResult[] } = { running: false, full: false, results: [] };

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

/** Serves a file with HTTP Range support (needed for seeking in <video>/<audio>). */
async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, download?: string): Promise<void> {
  const size = (await stat(file)).size;
  const head: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes' };
  if (download) head['content-disposition'] = `attachment; filename="${download}"`;
  const range = String(req.headers.range ?? '').match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return void res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return void createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...head, 'content-length': size });
  createReadStream(file).pipe(res);
}

/** Decrypted review audio kept in memory only (never written back to disk in clear). */
const audioCache = new Map<string, Buffer>();
const dropCached = (id: string) => audioCache.delete(id);

function sendBytes(req: IncomingMessage, res: ServerResponse, buf: Buffer, type: string): void {
  const size = buf.length;
  const range = String(req.headers.range ?? '').match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return void res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return void res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
  res.end(buf);
}

const tokenOk = (t: string): boolean => !!session && t.length === session.token.length && timingSafeEqual(Buffer.from(t), Buffer.from(session.token));

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

    // Videos/audio are played by <video>/<audio> (and fetched by the render browser), which can't send headers:
    // these two read-only routes accept the session token as ?s=.
    const fm = url.pathname.match(/^\/api\/render\/([a-f0-9]{16})\/file$/);
    const am = url.pathname.match(/^\/api\/audio\/([a-f0-9]{40})\.wav$/);
    const dm = url.pathname.match(/^\/api\/deliverable\/([a-f0-9]{16})\/([a-z0-9][a-z0-9._-]{0,80})$/);
    const rm2 = url.pathname.match(/^\/api\/sources\/([a-f0-9]{16})\/audio$/);
    if (rm2 && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const rec = session!.sources.get(rm2[1]!);
      const file = rec ? audioPath(DATA_DIR, rec) : null;
      if (!rec || !file || !existsSync(file)) return json(res, 404, { error: 'No hay audio para revisar (ya se borró o no se guardó)' });
      let buf = audioCache.get(rec.id);
      if (!buf) {
        buf = Buffer.from(await session!.vault.openBytes(new Uint8Array(await readFile(file))));
        if (audioCache.size >= 2) audioCache.delete(audioCache.keys().next().value!);
        audioCache.set(rec.id, buf);
      }
      return sendBytes(req, res, buf, 'audio/mpeg');
    }
    if (dm && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const file = join(packageDir(DATA_DIR, dm[1]!), dm[2]!);
      if (!existsSync(file)) return json(res, 404, { error: 'Not found' });
      const ext = extname(file);
      const type = ext === '.png' ? 'image/png' : ext === '.wav' ? 'audio/wav' : ext === '.srt' ? 'application/x-subrip; charset=utf-8' : 'text/plain; charset=utf-8';
      return sendFile(req, res, file, type, url.searchParams.get('dl') ? dm[2]! : undefined);
    }
    if ((fm || am) && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const file = fm ? renderFile(DATA_DIR, fm[1]!) : tts.cacheFile(am![1]!);
      if (!existsSync(file)) return json(res, 404, { error: 'Not found' });
      const friendly = (url.searchParams.get('name') ?? '').match(/^[a-z0-9][a-z0-9._-]{0,80}\.mp4$/)?.[0];
      return sendFile(req, res, file, fm ? 'video/mp4' : 'audio/wav', fm && url.searchParams.get('dl') ? (friendly ?? `contenthub-${fm[1]}.mp4`) : undefined);
    }

    if (!session || !authed(req)) return json(res, 401, { error: 'Locked' });
    const s = session;

    // --- self-test: real checks of every capability on this computer ---
    if (url.pathname === '/api/selftest' && req.method === 'GET') return json(res, 200, selftest);
    if (url.pathname === '/api/selftest' && req.method === 'POST') {
      if (selftest.running) return json(res, 409, { error: 'Ya hay una prueba en curso' });
      const full = (await readBody(req)).full === true;
      Object.assign(selftest, { running: true, full, results: [] });
      runSelfTest({ dataDir: DATA_DIR, root: ROOT, full, tts, onUpdate: (r) => (selftest.results = r) })
        .then((r) => (selftest.results = r))
        .catch(() => {})
        .finally(() => (selftest.running = false));
      return json(res, 200, selftest);
    }

    // --- voices (free, local): list, audition, narrate ---
    if (url.pathname === '/api/voices' && req.method === 'GET') return json(res, 200, { voices: await tts.list() });
    if (url.pathname === '/api/voice/synth' && req.method === 'POST') {
      const b = await readBody(req);
      const text = String(b.text ?? '').slice(0, 800);
      if (!text.trim() || typeof b.voiceId !== 'string') return json(res, 400, { error: 'Falta la voz o el texto' });
      if ([...voiceJobs.values()].some((j) => j.status === 'working')) return json(res, 409, { error: 'Ya se está generando una voz; espera un momento' });
      const job: VoiceJob = { id: randomBytes(8).toString('hex'), status: 'working', progress: 1, label: 'En cola' };
      voiceJobs.set(job.id, job);
      tts.synth(b.voiceId, text, Number(b.speed) || 1, (p, l) => Object.assign(job, { progress: p, label: l }))
        .then((n) => Object.assign(job, { status: 'done', progress: 100, hash: n.hash, durationSec: n.durationSec }))
        .catch((e: unknown) => Object.assign(job, { status: 'error', error: e instanceof Error ? e.message : String(e) }));
      return json(res, 200, job);
    }
    const vm = url.pathname.match(/^\/api\/voice\/([a-f0-9]{16})$/);
    if (vm && req.method === 'GET') return voiceJobs.has(vm[1]!) ? json(res, 200, voiceJobs.get(vm[1]!)) : json(res, 404, { error: 'Not found' });

    // --- topic radar: real public data, every item with its source ---
    if (url.pathname === '/api/radar' && req.method === 'POST') {
      const force = (await readBody(req)).refresh === true;
      if (!radarCache || force || Date.now() - radarCache.at > 30 * 60_000) radarCache = { at: Date.now(), data: await fetchRadar({ geo: 'CO', region: 'Huila' }) };
      return json(res, 200, { ...radarCache.data, lines: radarLines(radarCache.data.items) });
    }

    // --- deliverables: the person ticks what to produce ---
    if (url.pathname === '/api/deliverables' && req.method === 'POST') {
      const b = await readBody(req);
      const base = VideoSpec.safeParse({ preset: 'youtube_long', scenes: (b.scenes ?? []).map((x: { text: string; durationSec: number }) => ({ text: x.text, durationSec: x.durationSec })), theme: b.theme });
      if (!base.success || !Array.isArray(b.items)) return json(res, 400, { error: 'Solicitud de entregables inválida' });
      const voice = b.voice && typeof b.voice.id === 'string' ? b.voice : null;
      const request: PackageRequest = {
        items: b.items, scenes: base.data.scenes.map(({ text, durationSec }) => ({ text, durationSec })), theme: base.data.theme,
        shorts: Array.isArray(b.shorts) ? b.shorts.map((r: { from: number; to: number }) => ({ from: Number(r.from), to: Number(r.to) })) : [],
        title: String(b.title ?? '').slice(0, 120), subtitle: b.subtitle ? String(b.subtitle).slice(0, 60) : undefined,
        summary: String(b.summary ?? '').slice(0, 3000),
        sources: Array.isArray(b.sources) ? b.sources.slice(0, 30).map((x: { source: string; url?: string; metric?: string }) => ({ source: String(x.source).slice(0, 120), url: x.url ? String(x.url).slice(0, 300) : undefined, metric: x.metric ? String(x.metric).slice(0, 60) : undefined })) : [],
        hashtags: Array.isArray(b.hashtags) ? b.hashtags.slice(0, 20).map((h: unknown) => String(h).slice(0, 40)) : [],
        extra: Array.isArray(b.extra) ? b.extra.slice(0, 10).map((h: unknown) => String(h).slice(0, 300)) : undefined,
      };
      try {
        return json(res, 200, await startPackage(request, { dataDir: DATA_DIR, root: ROOT, narration: voice ? {
          tts, voiceId: voice.id, speed: Number(voice.speed) || 1,
          audioUrl: (hash) => `http://127.0.0.1:${PORT}/api/audio/${hash}.wav?s=${s.token}`,
        } : undefined }));
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No se pudieron iniciar los entregables' });
      }
    }
    const pm = url.pathname.match(/^\/api\/deliverables\/([a-f0-9]{16})$/);
    if (pm && req.method === 'GET') {
      const j = isPackageId(pm[1]!) ? getPackage(pm[1]!) : null;
      return j ? json(res, 200, j) : json(res, 404, { error: 'Not found' });
    }

    // --- video rendering (local, zero tokens) ---
    if (url.pathname === '/api/render' && req.method === 'POST') {
      const b = await readBody(req);
      const spec = VideoSpec.safeParse(b.spec);
      if (!spec.success || (b.quality !== 'draft' && b.quality !== 'final')) return json(res, 400, { error: 'Especificación de video inválida' });
      // The client never supplies audio URLs; the server adds them itself when narration is requested.
      const clean = { ...spec.data, scenes: spec.data.scenes.map(({ text, durationSec }) => ({ text, durationSec })) };
      const voice = b.voice && typeof b.voice.id === 'string' ? b.voice : null;
      try {
        return json(res, 200, await startRender(clean, b.quality, DATA_DIR, ROOT, voice ? {
          tts, voiceId: voice.id, speed: Number(voice.speed) || 1,
          audioUrl: (hash) => `http://127.0.0.1:${PORT}/api/audio/${hash}.wav?s=${s.token}`,
        } : undefined));
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No se pudo iniciar el render' });
      }
    }
    const rm = url.pathname.match(/^\/api\/render\/([a-f0-9]{16})$/);
    if (rm && req.method === 'GET') {
      const j = isRenderId(rm[1]!) ? renderStatus(DATA_DIR, rm[1]!) : null;
      return j ? json(res, 200, j) : json(res, 404, { error: 'Render not found' });
    }

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
      void processSource(rec, file, DATA_DIR, quality, () => saveSources(s), (b) => s.vault.sealBytes(b));
      return json(res, 200, { id });
    }
    const m = url.pathname.match(/^\/api\/sources\/([a-f0-9]+)(?:\/(ideas|excerpt|lines|review|audio))?$/);
    if (m) {
      const rec = s.sources.get(m[1]!);
      if (!rec) return json(res, 404, { error: 'Source not found' });
      if (!m[2] && req.method === 'GET') return json(res, 200, { source: toView(rec) });
      if (!m[2] && req.method === 'DELETE') {
        await dropAudio(DATA_DIR, rec);
        dropCached(rec.id);
        s.sources.delete(rec.id);
        await saveSources(s);
        return json(res, 200, { ok: true });
      }
      if (m[2] === 'excerpt' && req.method === 'GET')
        return json(res, 200, { text: excerptFor(rec, Number(url.searchParams.get('start') ?? 0), Number(url.searchParams.get('end') ?? 0)) });
      if (m[2] === 'lines' && req.method === 'GET')
        return json(res, 200, { lines: toReviewLines(rec.segments), hasAudio: !!rec.audio, selection: rec.selection ?? [], reviewed: !!rec.reviewed });
      if (m[2] === 'audio' && req.method === 'DELETE') {
        await dropAudio(DATA_DIR, rec);
        dropCached(rec.id);
        await saveSources(s);
        return json(res, 200, { ok: true });
      }
      if (m[2] === 'review' && req.method === 'PUT') {
        const b = await readBody(req);
        const blocks: ReviewBlock[] = Array.isArray(b.blocks) ? b.blocks.slice(0, 200).map((x: Partial<ReviewBlock>) => ({
          startSec: Number(x.startSec), endSec: Number(x.endSec), text: String(x.text ?? '').slice(0, 5000),
          status: x.status === 'corrected' || x.status === 'unclear' ? x.status : 'ok',
        })) : [];
        if (blocks.some((x) => !Number.isFinite(x.startSec) || !Number.isFinite(x.endSec) || x.endSec < x.startSec)) return json(res, 400, { error: 'Tramos inválidos' });
        rec.selection = blocks;
        if (b.finish === true) {
          rec.reviewed = true;
          await dropAudio(DATA_DIR, rec); // the temporary listening copy ends with the review
          dropCached(rec.id);
        }
        await saveSources(s);
        return json(res, 200, { ok: true, usable: blocks.filter(usableBlock).length, unclear: blocks.filter((x) => !usableBlock(x)).length });
      }
      if (m[2] === 'ideas' && req.method === 'POST') {
        if (rec.status !== 'ready') return json(res, 409, { error: 'El archivo aún se está procesando' });
        if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes (cuenta de Claude Code o clave de API)' });
        const scope = (await readBody(req)).scope === 'selection' ? 'selection' : 'all';
        try {
          return json(res, 200, await ideasFor(s.gateway, rec, scope));
        } catch (e) {
          if (e instanceof Error && /tramos confirmados/.test(e.message)) return json(res, 409, { error: e.message });
          throw e;
        }
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
