// A long-lived Python worker that speaks one JSON object per line on stdin/stdout. Requests are served one at a
// time; the process starts on first use, answers a "ready" line when its model is loaded, stops itself when idle,
// and is replaced if it dies.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

interface Pending {
  resolve: (v: { ok: boolean; error?: string; [k: string]: unknown }) => void;
  timer: NodeJS.Timeout;
}
export type WorkerReply = { ok: boolean; error?: string; [k: string]: unknown };

export class PyWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private pending = new Map<string, Pending>();
  private buf = '';
  private idle: NodeJS.Timeout | null = null;
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  /** `launch` resolves the command to run (installing what is needed the first time). */
  constructor(private launch: () => Promise<{ cmd: string; args: string[]; env?: Record<string, string> }>, private o: { idleMs?: number; startMs?: number; label?: string } = {}) {}

  private async start(): Promise<void> {
    const { cmd, args, env } = await this.launch();
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...env } });
    this.child = child;
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err = (err + String(d)).slice(-1500)));
    const name = this.o.label ?? 'El motor';
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { child.kill(); reject(new Error(`${name} tardó demasiado en arrancar`)); }, this.o.startMs ?? 90_000);
      this.pending.set('ready', { resolve: () => { clearTimeout(t); resolve(); }, timer: t });
      child.on('error', (e) => { clearTimeout(t); reject(new Error(`No pude iniciar Python: ${e.message}`)); });
      child.on('close', (code) => {
        clearTimeout(t);
        if (this.child !== child) return; // stopped on purpose or already replaced: do not touch its successor's requests
        this.child = null;
        for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: `${name} se detuvo (${code}): ${err.slice(-300)}` }); this.pending.delete(id); }
        reject(new Error(`${name} se detuvo (${code}): ${err.slice(-300)}`));
      });
      child.stdout.on('data', (d: Buffer) => {
        this.buf += String(d);
        let i: number;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim();
          this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          try {
            const m = JSON.parse(line) as { ready?: boolean; id?: string; ok?: boolean; error?: string };
            const key = m.ready ? 'ready' : String(m.id);
            const p = this.pending.get(key);
            if (p) { clearTimeout(p.timer); this.pending.delete(key); p.resolve({ ...m, ok: m.ready ? true : !!m.ok }); }
          } catch {
            /* not protocol output */
          }
        }
      });
    });
  }

  private arm(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), this.o.idleMs ?? 5 * 60_000);
    this.idle.unref();
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle);
    this.child?.kill();
    this.child = null;
    this.starting = null;
  }

  /** Sends a request and waits for its reply (one at a time, in order). Throws when the worker reports a failure. */
  request(payload: Record<string, unknown>, timeoutMs = 120_000): Promise<WorkerReply> {
    const job = this.queue.then(async () => {
      if (!this.child) await (this.starting ??= this.start().finally(() => (this.starting = null)));
      const id = String(++this.seq);
      const res = await new Promise<WorkerReply>((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'La operación tardó demasiado' }); }, timeoutMs);
        this.pending.set(id, { resolve, timer });
        this.child!.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
      });
      this.arm();
      if (!res.ok) throw new Error(res.error ?? 'El motor no pudo completar la operación');
      return res;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
