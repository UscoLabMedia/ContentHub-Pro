// Local server (127.0.0.1 only). Holds the vault key and API keys in memory; the browser never sees them.
// Also serves the built app (app/dist) so one process = the whole product (see scripts/start.mjs).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BudgetMeter, DEFAULT_BUDGET, Gateway, TaskQueue, Vault, createAccountSpend, createLlmClient, ingestFile, digestToPrompt,
  OUTPUT_SCHEMAS, type BudgetConfig, type LedgerEntry, type QueuedTask, type Task,
} from '@chp/core';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173'; // Vite dev server; same-origin in production
const DATA_DIR = process.env.CHP_DATA_DIR ?? join(homedir(), '.contenthub-pro'); // outside the repo
const VAULT_FILE = join(DATA_DIR, 'vault.enc');
const DIST = fileURLToPath(new URL('../../app/dist', import.meta.url));
const MIN_PASSWORD = 8;

interface Session {
  token: string;
  vault: Vault;
  meter: BudgetMeter;
  queue: TaskQueue;
  gateway?: Gateway;
  lastSync?: number;
  syncError?: string;
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

function buildGateway(s: Session): void {
  const key = s.vault.get<string>('anthropicKey');
  if (!key) return void (s.gateway = undefined);
  const persist = async () => {
    s.vault.set('ledger', s.meter.ledger);
    s.vault.set('queue', s.queue.items);
    await s.vault.save();
  };
  s.gateway = new Gateway({ llm: createLlmClient(key), meter: s.meter, queue: s.queue, store: s.vault, persist });
}

function startSession(vault: Vault): Session {
  const s: Session = {
    token: randomBytes(32).toString('hex'),
    vault,
    meter: new BudgetMeter(vault.get<BudgetConfig>('budget') ?? DEFAULT_BUDGET, vault.get<LedgerEntry[]>('ledger') ?? []),
    queue: new TaskQueue(vault.get<QueuedTask[]>('queue') ?? []),
  };
  buildGateway(s);
  void syncAccount(s);
  failures = 0;
  return (session = s);
}

/** Pull real account spend (Admin API) so the budget follows the whole Claude account. */
async function syncAccount(s: Session): Promise<void> {
  const key = s.vault.get<string>('adminKey');
  if (!key) return;
  try {
    const spend = createAccountSpend(key);
    const now = Date.now();
    for (const kind of ['day', 'week'] as const) s.meter.setExternal(kind, await spend(s.meter.windowStart(kind), now));
    s.lastSync = now;
    s.syncError = undefined;
  } catch (e) {
    s.syncError = e instanceof Error ? e.message : 'Account sync failed';
  }
}

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

const budgetView = (s: Session) => ({
  ...s.meter.status(),
  config: s.meter.cfg,
  queued: s.queue.items.map(({ id, task, resumeAt }) => ({ id, task, resumeAt })),
  hasKey: !!s.gateway,
  accountLinked: !!s.vault.get<string>('adminKey'),
  lastSync: s.lastSync ?? null,
  syncError: s.syncError ?? null,
});

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', ORIGIN);
  res.setHeader('access-control-allow-headers', 'content-type,x-session');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && (await serveStatic(url.pathname, res))) return;
    return json(res, 404, { error: 'Not found' });
  }
  try {
    if (url.pathname === '/api/status' && req.method === 'GET')
      return json(res, 200, { vaultExists: await Vault.exists(storage), unlocked: authed(req) });

    // --- unauthenticated entry points: create / unlock / recover ---
    if (url.pathname === '/api/create' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) return json(res, 400, { error: `Password must be at least ${MIN_PASSWORD} characters` });
      if (await Vault.exists(storage)) return json(res, 409, { error: 'A vault already exists' });
      const { vault, recoveryKey } = await Vault.create(password, storage);
      return json(res, 200, { token: startSession(vault).token, recoveryKey }); // shown ONCE
    }
    if ((url.pathname === '/api/unlock' || url.pathname === '/api/recover') && req.method === 'POST') {
      const wait = guardAttempt();
      if (wait) return json(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} s` });
      const body = await readBody(req);
      try {
        if (url.pathname === '/api/unlock') {
          return json(res, 200, { token: startSession(await Vault.open(String(body.password), storage)).token });
        }
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

    if (url.pathname === '/api/budget' && req.method === 'GET') return json(res, 200, budgetView(s));
    if (url.pathname === '/api/budget' && req.method === 'PUT') {
      const b = await readBody(req);
      const cfg: BudgetConfig = { ...s.meter.cfg, dailyLimitUsd: Number(b.dailyLimitUsd), weeklyLimitUsd: Number(b.weeklyLimitUsd) };
      if (!(cfg.dailyLimitUsd > 0) || !(cfg.weeklyLimitUsd >= cfg.dailyLimitUsd)) return json(res, 400, { error: 'Invalid limits' });
      s.meter.cfg = cfg;
      s.vault.set('budget', cfg);
      await s.vault.save();
      return json(res, 200, budgetView(s));
    }
    if (url.pathname === '/api/budget/sync' && req.method === 'POST') {
      await syncAccount(s);
      return json(res, 200, budgetView(s));
    }
    if (url.pathname === '/api/project' && req.method === 'GET') return json(res, 200, { project: s.vault.get('project') ?? null });
    if (url.pathname === '/api/project' && req.method === 'PUT') {
      s.vault.set('project', (await readBody(req)).project);
      await s.vault.save();
      return json(res, 200, { ok: true });
    }
    // Write-only secrets: never returned by any endpoint.
    if (url.pathname === '/api/settings/key' && req.method === 'PUT') {
      const { key } = await readBody(req);
      if (typeof key !== 'string' || !key.startsWith('sk-ant-')) return json(res, 400, { error: 'Not an Anthropic API key' });
      s.vault.set('anthropicKey', key);
      await s.vault.save();
      buildGateway(s);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings/admin-key' && req.method === 'PUT') {
      const { key } = await readBody(req);
      if (typeof key !== 'string' || !key.startsWith('sk-ant-admin')) return json(res, 400, { error: 'Not an Admin API key (sk-ant-admin...)' });
      s.vault.set('adminKey', key);
      await s.vault.save();
      await syncAccount(s);
      return json(res, 200, budgetView(s));
    }
    if (url.pathname === '/api/settings/password' && req.method === 'PUT') {
      const { newPassword } = await readBody(req);
      if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) return json(res, 400, { error: `Password must be at least ${MIN_PASSWORD} characters` });
      await s.vault.changePassword(newPassword);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings/recovery-key' && req.method === 'POST')
      return json(res, 200, { recoveryKey: await s.vault.rotateRecoveryKey() }); // shown ONCE; old key stops working

    if (url.pathname.startsWith('/api/ai/') && req.method === 'POST') {
      const task = url.pathname.slice('/api/ai/'.length) as Task;
      if (!(task in OUTPUT_SCHEMAS)) return json(res, 404, { error: 'Unknown task' });
      if (!s.gateway) return json(res, 409, { error: 'Add your API key first' });
      return json(res, 200, await s.gateway.run(task, (await readBody(req)).input));
    }
    if (url.pathname === '/api/ingest' && req.method === 'POST') {
      const { name, dataBase64 } = await readBody(req);
      const digest = await ingestFile({ name: String(name), bytes: new Uint8Array(Buffer.from(String(dataBase64), 'base64')) });
      return json(res, 200, { digest, prompt: digestToPrompt(digest) });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e instanceof Error ? e.message : 'Server error' });
  }
});

// Resume queued tasks when a window renews; refresh account spend every 10 min.
setInterval(() => void session?.gateway?.drainQueue().catch(console.error), 60_000);
setInterval(() => void (session && syncAccount(session)), 10 * 60_000);

server.listen(PORT, '127.0.0.1', () => console.log(`ContentHub Pro on http://127.0.0.1:${PORT}`));
