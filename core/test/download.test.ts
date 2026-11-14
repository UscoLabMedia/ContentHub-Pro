import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { download } from '../src/util/proc.ts';

describe('download', () => {
  let dir = '';
  let server: Server;
  let port = 0;
  const hits: Record<string, number> = {};
  const body = Buffer.alloc(200_000, 7);
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chp-dl-'));
    server = createServer((req, res) => {
      const k = req.url!;
      hits[k] = (hits[k] ?? 0) + 1;
      if (k === '/stall' && hits[k] === 1) { res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 1000)); return; } // goes quiet
      if (k === '/short' && hits[k] === 1) { res.writeHead(200, { 'content-length': body.length }); res.end(body.subarray(0, 500)); return; } // ends early
      if (k === '/dead') { res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 10)); return; }
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
    }).listen(0);
    await new Promise((r) => server.once('listening', r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => { server.closeAllConnections(); server.close(); await rm(dir, { recursive: true, force: true }); });

  it('downloads a file and reports progress', async () => {
    const pcts: number[] = [];
    await download(`http://127.0.0.1:${port}/ok`, join(dir, 'ok.bin'), (p) => pcts.push(p));
    expect((await readFile(join(dir, 'ok.bin'))).length).toBe(body.length);
    expect(pcts.at(-1)).toBe(100);
  });
  it('retries when the transfer goes quiet, and when it ends early', async () => {
    await download(`http://127.0.0.1:${port}/stall`, join(dir, 'stall.bin'), undefined, { idleMs: 400 });
    expect((await readFile(join(dir, 'stall.bin'))).length).toBe(body.length);
    expect(hits['/stall']).toBe(2);
    await download(`http://127.0.0.1:${port}/short`, join(dir, 'short.bin'), undefined, { idleMs: 400 });
    expect((await readFile(join(dir, 'short.bin'))).length).toBe(body.length);
  });
  it('gives up with a clear message and leaves no partial file', async () => {
    await expect(download(`http://127.0.0.1:${port}/dead`, join(dir, 'dead.bin'), undefined, { idleMs: 300, retries: 1 })).rejects.toThrow(/sin datos/);
    expect((await readdir(dir)).filter((f) => f.startsWith('dead'))).toEqual([]);
    expect(hits['/dead']).toBe(2);
  });
});
