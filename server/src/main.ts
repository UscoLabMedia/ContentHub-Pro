// Local server (127.0.0.1 only). Holds the vault key and the API key in memory; the browser never sees them.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BudgetMeter, DEFAULT_BUDGET, Gateway, TaskQueue, Vault, createLlmClient, digestToPrompt, ingestFile,
  OUTPUT_SCHEMAS, type BudgetConfig, type LedgerEntry, type QueuedTask, type Task,
} from '@chp/core';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
// Data lives OUTSIDE the repo by default; the vault file is encrypted anyway.
const DATA_DIR = process.env.CHP_DATA_DIR ?? join(homedir(), '.contenthub-pro');
const VAULT_FILE = join(DATA_DIR, 'vault.enc');

interface Session {
  token: string;
  vault: Vault;
  meter: BudgetMeter;
  queue: TaskQueue;
  gateway?: Gateway;
}
let session: Session | null = null;

const storage = {
  read: () => readFile(VAULT_FILE, 'utf8').catch(() => null),
  write: async (t: string) => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(VAULT_FILE, t, { mode: 0o600 });
  },
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

async function unlock(password: string): Promise<Session> {
  const vault = await Vault.open(password, storage);
  const cfg = vault.get<BudgetConfig>('budget') ?? DEFAULT_BUDGET;
  const s: Session = {
    token: randomBytes(32).toString('hex'),
    vault,
    meter: new BudgetMeter(cfg, vault.get<LedgerEntry[]>('ledger') ?? []),
    queue: new TaskQueue(vault.get<QueuedTask[]>('queue') ?? []),
  };
  buildGateway(s);
  return s;
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

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', ORIGIN);
  res.setHeader('access-control-allow-headers', 'content-type,x-session');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/status' && req.method === 'GET')
      return json(res, 200, { vaultExists: (await storage.read()) !== null, unlocked: authed(req) });
    if (url.pathname === '/api/unlock' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (typeof password !== 'string' || password.length < 8) return json(res, 400, { error: 'Password must be at least 8 characters' });
      try {
        session = await unlock(password);
      } catch {
        return json(res, 401, { error: 'Wrong password' });
      }
      return json(res, 200, { token: session.token, hasKey: !!session.gateway });
    }
    if (!session || !authed(req)) return json(res, 401, { error: 'Locked' });
    const s = session;

    if (url.pathname === '/api/budget' && req.method === 'GET')
      return json(res, 200, { ...s.meter.status(), config: s.meter.cfg, queued: s.queue.items.map(({ id, task, resumeAt }) => ({ id, task, resumeAt })), hasKey: !!s.gateway });
    if (url.pathname === '/api/budget' && req.method === 'PUT') {
      const b = await readBody(req);
      const cfg: BudgetConfig = { ...s.meter.cfg, dailyLimitUsd: Number(b.dailyLimitUsd), weeklyLimitUsd: Number(b.weeklyLimitUsd) };
      if (!(cfg.dailyLimitUsd > 0) || !(cfg.weeklyLimitUsd >= cfg.dailyLimitUsd)) return json(res, 400, { error: 'Invalid limits' });
      s.meter.cfg = cfg;
      s.vault.set('budget', cfg);
      await s.vault.save();
      return json(res, 200, s.meter.status());
    }
    if (url.pathname === '/api/settings/key' && req.method === 'PUT') {
      const { key } = await readBody(req);
      if (typeof key !== 'string' || !key.startsWith('sk-ant-')) return json(res, 400, { error: 'Not an Anthropic API key' });
      s.vault.set('anthropicKey', key);
      await s.vault.save();
      buildGateway(s);
      return json(res, 200, { ok: true }); // write-only: the key is never returned
    }
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

// Resume queued tasks automatically once the budget window renews.
setInterval(() => void session?.gateway?.drainQueue().catch(console.error), 60_000);

server.listen(PORT, '127.0.0.1', () => console.log(`ContentHub server on http://127.0.0.1:${PORT}`));
