// Opens the pages cited as sources and looks for the claimed figures/quotes. Free, local, no AI.
import { lookup } from 'node:dns/promises';
import { checkableUrl, decode, isPrivateAddress, pageSupports, pdfToText, type CheckResult } from '@chp/core';

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export interface PageResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** CHP_VERIFY_ALLOW_LOCAL=1 lets tests read pages from 127.0.0.1; it must never be set for normal use. */
const allowLocal = () => process.env.CHP_VERIFY_ALLOW_LOCAL === '1';

async function assertPublic(host: string): Promise<void> {
  if (allowLocal()) return;
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('No se pudo resolver el sitio');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('Dirección no permitida');
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const htmlToText = (html: string) => decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

/** Fetches a public page (redirects re-validated, size capped) and returns its readable text. */
export async function fetchPageText(rawUrl: string): Promise<PageResult> {
  let url = checkableUrl(rawUrl);
  if (!url) return { ok: false, error: 'Enlace no válido' };
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(url.hostname);
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'ContentHubPro/1.0 (source check)', accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.1' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = checkableUrl(new URL(res.headers.get('location')!, url).toString());
        if (!next) return { ok: false, error: 'Redirección no válida' };
        url = next;
        continue;
      }
      if (!res.ok) return { ok: false, error: `El sitio respondió ${res.status}` };
      const type = res.headers.get('content-type') ?? '';
      const bytes = await readCapped(res);
      if (/pdf/i.test(type) || url.pathname.toLowerCase().endsWith('.pdf')) return { ok: true, text: await pdfToText(new Uint8Array(bytes)) };
      if (/html|text|xml|json/i.test(type) || !type) return { ok: true, text: htmlToText(Buffer.from(bytes).toString('utf8')) };
      return { ok: false, error: `Tipo de contenido no legible (${type.split(';')[0]})` };
    }
    return { ok: false, error: 'Demasiadas redirecciones' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo abrir' };
  }
}

export interface CheckItem {
  url: string;
  claim: string;
  quote?: string;
}
export interface CheckOutcome {
  check: CheckResult;
  snippet?: string;
  error?: string;
}

export async function checkSource(item: CheckItem): Promise<CheckOutcome> {
  const page = await fetchPageText(item.url);
  if (!page.ok || !page.text) return { check: 'unreachable', error: page.error };
  const r = pageSupports(page.text, item.claim, item.quote);
  return r.found ? { check: 'found', snippet: r.snippet } : { check: 'not-found' };
}

/** Checks many sources, a few at a time; pages cited twice are opened once. */
export async function checkMany(items: CheckItem[], concurrency = 4): Promise<CheckOutcome[]> {
  const pages = new Map<string, Promise<PageResult>>();
  const open = (u: string) => (pages.has(u) ? pages.get(u)! : (pages.set(u, fetchPageText(u)), pages.get(u)!));
  const out: CheckOutcome[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        const it = items[i]!;
        const page = await open(it.url);
        if (!page.ok || !page.text) out[i] = { check: 'unreachable', error: page.error };
        else {
          const r = pageSupports(page.text, it.claim, it.quote);
          out[i] = r.found ? { check: 'found', snippet: r.snippet } : { check: 'not-found' };
        }
      }
    }),
  );
  return out;
}
