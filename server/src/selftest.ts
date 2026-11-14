// "Probar que todo funciona": real checks of every capability on THIS computer, with a clear ✓ / ✗ and the reason.
// Quick mode only looks (no big downloads, no AI call). Full mode really uses each piece: it downloads the
// voice and transcription engines if missing, calls the AI once, and renders a 1-second video.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  SAMPLE_TEXT, Vault, claudeCodeStatus, createClaudeCodeClient, fetchRadar, piperAssetUrl, pdfToText,
  run, runFfmpeg, toWav16k, transcribe, wavInfo, type BlobStorage, type Tts,
} from '@chp/core';
import { renderFile, renderStatus, renderStill, startRender } from './render.ts';

export type Status = 'pending' | 'running' | 'ok' | 'warn' | 'fail' | 'skip';
export interface CheckResult {
  id: string;
  label: string;
  group: string;
  status: Status;
  detail: string;
  ms?: number;
}

interface Ctx {
  dataDir: string;
  root: string;
  full: boolean;
  tts: Tts;
  shared: { sampleWav?: string };
}
class Warn extends Error {}
class Skip extends Error {}

const head = async (url: string): Promise<number> => {
  const r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': 'contenthub-pro' }, signal: AbortSignal.timeout(12_000) }).catch(() => null);
  return r?.status ?? 0;
};
const reach = (code: number) => (code >= 200 && code < 400 ? 'responde' : code ? `HTTP ${code}` : 'sin conexión o bloqueado');

const MIN_PDF = (() => {
  const stream = 'BT /F1 18 Tf 20 50 Td (Hola ContentHub) Tj ET';
  return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n`;
})();

interface Check {
  id: string;
  label: string;
  group: string;
  run: (c: Ctx) => Promise<string>;
}

export const CHECKS: Check[] = [
  { id: 'node', label: 'Node.js', group: 'Sistema', run: async () => {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error(`Node ${process.versions.node} es muy antiguo (se necesita 20 o superior)`);
    return `Node ${process.versions.node} en ${process.platform}/${process.arch}`;
  } },
  { id: 'disk', label: 'Carpeta de datos (escritura)', group: 'Sistema', run: async (c) => {
    const f = join(c.dataDir, '.write-test');
    await mkdir(c.dataDir, { recursive: true });
    await writeFile(f, 'ok');
    await rm(f);
    return c.dataDir;
  } },
  { id: 'vault', label: 'Cifrado de la bóveda y clave de recuperación', group: 'Sistema', run: async () => {
    let disk: string | null = null;
    const st: BlobStorage = { read: async () => disk, write: async (t) => void (disk = t) };
    const { vault, recoveryKey } = await Vault.create('contrasena-de-prueba', st, 1000);
    vault.set('x', 1);
    await vault.save();
    if ((await Vault.open('contrasena-de-prueba', st)).get('x') !== 1) throw new Error('No se pudo reabrir con la contraseña');
    if ((await Vault.openWithRecovery(recoveryKey, st)).get('x') !== 1) throw new Error('No se pudo reabrir con la clave de recuperación');
    return 'AES-256-GCM: contraseña y clave de recuperación funcionan';
  } },
  { id: 'git', label: 'Git (actualizaciones automáticas)', group: 'Sistema', run: async (c) => {
    const v = (await run('git', ['--version']).catch(() => '')).trim();
    if (!v) throw new Warn('Git no está instalado: la app funciona, pero no se actualizará sola');
    const remote = (await run('git', ['remote', 'get-url', 'origin'], { cwd: c.root }).catch(() => '')).trim();
    if (!remote) throw new Warn(`${v}; esta carpeta no es un clon de GitHub (no se actualizará sola)`);
    return `${v}; origen ${remote}`;
  } },

  { id: 'claude', label: 'Claude Code instalado y con sesión', group: 'IA', run: async () => {
    const s = await claudeCodeStatus();
    if (!s.installed) throw new Error('Claude Code no está instalado (ContentHub.bat lo instala; o: npm install -g @anthropic-ai/claude-code)');
    if (!s.loggedIn) throw new Warn('Falta iniciar sesión: Ajustes → Conectar con Claude Code');
    return 'Conectado a tu cuenta de Claude';
  } },
  { id: 'claude-ai', label: 'La IA responde (1 consulta mínima)', group: 'IA', run: async (c) => {
    if (!c.full) throw new Skip('Solo en la prueba completa (gasta una consulta mínima)');
    const r = await createClaudeCodeClient().complete({ model: 'claude-haiku-5-5', effort: 'low', maxTokens: 100, system: 'Responde con el JSON pedido.', user: 'ok=true', schema: z.object({ ok: z.boolean() }) });
    return `Respuesta válida (${r.usage.output_tokens} tokens de salida)`;
  } },

  { id: 'radar', label: 'Fuentes de datos de tendencias', group: 'Datos', run: async () => {
    const r = await fetchRadar({ geo: 'CO', region: 'Huila' });
    const line = r.reports.map((x) => `${x.id}: ${x.status === 'ok' ? `${x.count} datos` : `ERROR ${x.error}`}`).join(' · ');
    if (r.reports.every((x) => x.status === 'error')) throw new Error(`Ninguna fuente respondió (${line})`);
    if (r.reports.some((x) => x.status === 'error')) throw new Warn(line);
    return line;
  } },

  { id: 'ffmpeg', label: 'Audio/video: ffmpeg (incluido en Remotion)', group: 'Video', run: async (c) => {
    const dir = await mkdtemp(join(tmpdir(), 'chp-ff-'));
    try {
      const src = join(dir, 'in.wav');
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', src]);
      const out = join(dir, 'out.wav');
      await toWav16k(src, out);
      const info = wavInfo(await readFile(out));
      if (info.sampleRate !== 16000) throw new Error(`Salida inesperada: ${info.sampleRate} Hz`);
      return 'Convierte audio a 16 kHz mono';
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } },
  { id: 'render', label: 'Render de video (Remotion)', group: 'Video', run: async (c) => {
    if (!c.full) throw new Skip('Solo en la prueba completa (la primera vez descarga un navegador de render)');
    const job = await startRender({ preset: 'tiktok', scenes: [{ text: 'Prueba', durationSec: 1 }] }, 'draft', c.dataDir, c.root);
    for (let i = 0; i < 600; i++) {
      const j = renderStatus(c.dataDir, job.id);
      if (j?.status === 'done') {
        const size = (await stat(renderFile(c.dataDir, job.id))).size;
        await rm(renderFile(c.dataDir, job.id), { force: true });
        return `Video de prueba generado (${Math.round(size / 1024)} KB)`;
      }
      if (j?.status === 'error') throw new Error(j.error ?? 'El render falló');
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('El render tardó demasiado (más de 10 minutos)');
  } },

  { id: 'thumbnail', label: 'Miniatura (imagen 1280×720)', group: 'Video', run: async (c) => {
    if (!c.full) throw new Skip('Solo en la prueba completa');
    const out = join(c.dataDir, 'selftest-thumb.png');
    await renderStill({ title: 'Prueba de miniatura', theme: { bg: '#0f172a', fg: '#f8fafc', accent: '#6366f1' } }, out, c.dataDir, c.root);
    const size = (await stat(out)).size;
    await rm(out, { force: true });
    return `PNG generado (${Math.round(size / 1024)} KB)`;
  } },
  { id: 'sapi', label: 'Voz: voces de Windows (sin descarga)', group: 'Voz', run: async (c) => {
    if (process.platform !== 'win32') throw new Skip('Solo existe en Windows');
    const v = (await c.tts.list()).find((x) => x.engine === 'sapi');
    if (!v) throw new Warn('No hay voces en español instaladas en Windows (Configuración → Hora e idioma → Voz)');
    if (!c.full) return `Voces disponibles; ejemplo: ${v.label}`;
    const n = await c.tts.synth(v.id, SAMPLE_TEXT, 1);
    c.shared.sampleWav = n.file;
    return `${v.label}: ${n.durationSec.toFixed(1)} s de audio`;
  } },
  { id: 'piper', label: 'Voz: Piper (voces neuronales gratis)', group: 'Voz', run: async (c) => {
    const bin = piperAssetUrl();
    const urls = [
      bin && ['motor Piper (GitHub)', bin],
      ['voz Davefx (Hugging Face)', 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json'],
      ['voz básica (GitHub)', 'https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-es-mls_9972-low.tar.gz'],
    ].filter(Boolean) as [string, string][];
    const reach_ = await Promise.all(urls.map(async ([n, u]) => `${n}: ${reach(await head(u))}`));
    if (!c.full) {
      if (!bin) throw new Warn(`Piper no tiene versión para ${process.platform}/${process.arch}`);
      if (reach_.some((x) => /sin conexión|HTTP/.test(x))) throw new Warn(`${reach_.join(' · ')} — con algo bloqueado, solo funcionarán las voces que sí respondan`);
      return reach_.join(' · ');
    }
    let lastErr = '';
    for (const id of ['es_ES-davefx-medium', 'es-mls_9972-low']) {
      try {
        const n = await c.tts.synth(id, SAMPLE_TEXT, 1);
        c.shared.sampleWav = n.file;
        return `Voz «${id}»: ${n.durationSec.toFixed(1)} s de audio generados en tu equipo`;
      } catch (e) {
        lastErr = `${id}: ${e instanceof Error ? e.message : e}`;
      }
    }
    throw new Error(`${lastErr} (${reach_.join(' · ')})`);
  } },
  { id: 'whisper', label: 'Transcripción local (whisper.cpp)', group: 'Archivos', run: async (c) => {
    if (process.platform !== 'win32') throw new Skip('La descarga automática es solo para Windows; en otros sistemas instala whisper-cli');
    const net = `GitHub ${reach(await head('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'))} · modelo ${reach(await head('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin'))}`;
    if (!c.full) return net;
    if (!c.shared.sampleWav) throw new Warn(`Sin audio de prueba (falló la voz); ${net}`);
    const segs = await transcribe({ dataDir: c.dataDir, inputPath: c.shared.sampleWav, quality: 'fast' });
    const text = segs.map((s) => s.text).join(' ');
    if (!/bienvenid|contenthub|muestra/i.test(text)) throw new Warn(`Transcribió pero distinto de lo esperado: «${text.slice(0, 80)}»`);
    return `Voz → texto correcto: «${text.slice(0, 70)}»`;
  } },
  { id: 'pdf', label: 'Lectura de PDF (local)', group: 'Archivos', run: async () => {
    const t = await pdfToText(new TextEncoder().encode(MIN_PDF));
    if (!/Hola ContentHub/.test(t)) throw new Error(`No leyó el texto del PDF (obtuvo: «${t.slice(0, 40)}»)`);
    return 'Extrae el texto de un PDF de prueba';
  } },
  { id: 'ocr', label: 'Lectura de capturas (OCR)', group: 'Archivos', run: async (c) => {
    if (!c.full) throw new Skip('Solo en la prueba completa (la primera vez descarga los datos de idioma)');
    const { createWorker } = await import('tesseract.js');
    const w = await createWorker(['spa', 'eng']);
    await w.terminate();
    return 'Motor de OCR iniciado con datos de español';
  } },
];

export interface RunOptions {
  dataDir: string;
  root: string;
  full: boolean;
  tts: Tts;
  only?: string[];
  onUpdate?: (r: CheckResult[]) => void;
}

export async function runSelfTest(o: RunOptions): Promise<CheckResult[]> {
  const list = CHECKS.filter((c) => !o.only || o.only.includes(c.id));
  const results: CheckResult[] = list.map((c) => ({ id: c.id, label: c.label, group: c.group, status: 'pending', detail: '' }));
  const ctx: Ctx = { dataDir: o.dataDir, root: o.root, full: o.full, tts: o.tts, shared: {} };
  const push = () => o.onUpdate?.(results.map((r) => ({ ...r })));
  push();
  for (const [i, c] of list.entries()) {
    const r = results[i]!;
    r.status = 'running';
    push();
    const t0 = Date.now();
    try {
      r.detail = await c.run(ctx);
      r.status = 'ok';
    } catch (e) {
      r.detail = e instanceof Error ? e.message : String(e);
      r.status = e instanceof Skip ? 'skip' : e instanceof Warn ? 'warn' : 'fail';
    }
    r.ms = Date.now() - t0;
    push();
  }
  return results;
}

