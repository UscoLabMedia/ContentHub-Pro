// Local server (127.0.0.1 only). Holds the vault key and secrets in memory; the browser never sees them.
// Also serves the built app (app/dist) so one process = the whole product (see scripts/start.mjs).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm as removeFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  Gateway, Tts, Vault, VideoSpec, claudeCodeStatus, claudeWorkDir, creditCardText, creditsFrom, gate, CLONE_ENGINES, SAMPLE_TIPS, SAMPLE_MAX_SEC, SAMPLE_MIN_SEC, isCloneVoiceId, profileIdOf, syntheticVoiceNotice, normalizeTuning, type OnlineProvider, brollCredits, searchBroll, PROVIDER_LABEL, PRESETS, type BrollCandidate, type BrollRef, type BrollKeys, normalizeSfx, mixSfx, sfxEvents, synthSfx, toWav16, isSfxId, isAmbientId, DEFAULT_STYLE, musicCredits, musicQuery, normalizeMix, searchMusic, isMood, MOODS, type MusicMix, type MusicRef, textKey, artCredits, artQuery, licenseOf, searchArt, sanitizeSvg, type ArtRef, type SceneCheck, toReviewLines, usableBlock, type ReviewBlock, createClaudeCodeClient, createLlmClient, digestToPrompt, fetchRadar, ingestFile, radarLines,
  OUTPUT_SCHEMAS, slug, validateOriginal, textForRange, segmentsIn, matchBeatWords, type SceneOriginal, archiveProject, cleanName, createProject, currentData, currentId, deleteProject, duplicateProject, exportEnvelope, getProjectData, importProject, isProjectId, listProjects, openProject, renameProject, saveProjectData, type FileRefs, carouselGate, slidesFromScenes, toSlideSpecs, validateSlides, type LlmClient, type Quality, type SlideDraft, type SlideSpec, type Task,
} from '@chp/core';
import { audioPath, classify, dropAudio, excerptFor, ideasFor, processSource, toView, type SourceRecord } from './sources.ts';
import { isRenderId, renderCarouselSlide, renderFile, renderFrame, renderStatus, startRender } from './render.ts';
import { runSelfTest, type CheckResult } from './selftest.ts';
import { freeResearchScenes, researchScenes } from './research.ts';
import { analyzeReference } from './reference.ts';
import { brollExists, brollPath, brollUrl, downloadBroll } from './broll.ts';
import { validateConsent } from '@chp/core';
import { KokoroEngine } from './kokoro.ts';
import { ProfileError, VoiceCloneEngine, VoiceProfiles } from './voiceclone.ts';
import { azureProvider, edgeProvider, fakeEdgeProvider, validAzure, type AzureConfig } from './voice-online.ts';
import { buildSfxTrack, sfxTrackPath } from './sfx.ts';
import { downloadMusic, musicExists, musicPath, musicUrl, saveOwnMusic } from './music.ts';
import { ART_MIME, artExists, artPath, artUrl, downloadArt, saveDrawn } from './art.ts';
import { checkMany } from './verify.ts';
import { cutClip, dropOriginal, hasOriginal, keepOriginal } from './original.ts';
import { getPackage, isPackageId, packageDir, startPackage, type PackageRequest } from './deliverables.ts';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173'; // Vite dev server; same-origin in production
const DATA_DIR = process.env.CHP_DATA_DIR ?? join(homedir(), '.contenthub-pro'); // outside the repo
const VAULT_FILE = join(DATA_DIR, 'vault.enc');
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = join(ROOT, 'app', 'dist');
const MIN_PASSWORD = 8;
const MAX_UPLOAD = 4 * 1024 ** 3;

/** The online services available right now: Edge always, Azure when the person saved a key (kept in the encrypted vault). */
const edgeSvc = process.env.CHP_ONLINE_FAKE === '1' ? fakeEdgeProvider() : edgeProvider(DATA_DIR);
const azureConfig = (): AzureConfig | null => {
  const c = session?.vault.get<AzureConfig>('azureSpeech');
  return c && validAzure(c) ? c : null;
};
const onlineProviders = (): OnlineProvider[] => {
  const a = azureConfig();
  return [edgeSvc, ...(a ? [azureProvider(a, process.env.CHP_AZURE_BASE)] : [])];
};
const kokoro = new KokoroEngine(DATA_DIR, ROOT);
const voiceProfiles = new VoiceProfiles(DATA_DIR, () => session?.vault ?? null);
const cloneEngine = new VoiceCloneEngine(DATA_DIR, ROOT, voiceProfiles, undefined, process.env.CHP_CLONE_WORKER); // CHP_CLONE_WORKER: a stand-in worker for tests
const tts = new Tts(DATA_DIR, process.env.CHP_PIPER_BIN, onlineProviders, kokoro, cloneEngine);
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
interface VerifyJob {
  id: string;
  status: 'working' | 'done' | 'error';
  progress: number;
  label: string;
  error?: string;
  checks?: SceneCheck[];
}
const verifyJobs = new Map<string, VerifyJob>();
/** Contact sheets of recent references, in memory only (for the optional "refine with AI" step). */
const sheets = new Map<string, Buffer>();
const capSheets = new Map<string, Buffer>();
/** Verification checks the person has saved in the project (keyed by scene text). */
const projectChecks = (s: { vault: Vault }): Record<string, SceneCheck> => (currentData(s.vault) as { verification?: Record<string, SceneCheck> } | undefined)?.verification ?? {};
/** Illustrations the person chose, keyed by scene text (saved in the project). */
/** Fonts the person uploaded (encrypted on disk; metadata in the vault). */
interface FontRec { id: string; name: string; ext: 'ttf' | 'otf' | 'woff' | 'woff2' }
const FONT_MIME: Record<FontRec['ext'], string> = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
const fontsOf = (s: { vault: Vault }): FontRec[] => s.vault.get<FontRec[]>('fonts') ?? [];
const fontFile = (id: string) => join(DATA_DIR, 'fonts', `${id}.enc`);
function sniffFont(b: Uint8Array): FontRec['ext'] | null {
  const t = Buffer.from(b.subarray(0, 4)).toString('latin1');
  if (t === 'wOF2') return 'woff2';
  if (t === 'wOFF') return 'woff';
  if (t === 'OTTO') return 'otf';
  if (t === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'ttf';
  return null;
}
/** The uploaded font a style uses, as a URL the local render browser can load (client-sent URLs are never trusted). */
const userFontsFor = (style: { captions?: { font: string } } | undefined, s: { vault: Vault; token: string }): { family: string; url: string }[] | undefined => {
  const f = style?.captions?.font;
  const m = f?.match(/^user:([a-f0-9]{16})$/);
  const rec = m ? fontsOf(s).find((x) => x.id === m[1]) : undefined;
  return rec && existsSync(fontFile(rec.id)) ? [{ family: `user-${rec.id}`, url: `http://127.0.0.1:${PORT}/api/font/${rec.id}?s=${s.token}` }] : undefined;
};
const projectArt = (s: { vault: Vault }): Record<string, ArtRef> => (currentData(s.vault) as { art?: Record<string, ArtRef> } | undefined)?.art ?? {};
/** Adds each scene's illustration URL (served by this server, only to the local render). Client-sent art is never trusted. */
const withArt = <T extends { text: string; durationSec: number }>(scenes: T[], s: { vault: Vault; token: string }): (T & { art?: { url: string; kind: 'image' | 'svg' } })[] => {
  const art = projectArt(s);
  return scenes.map((sc) => {
    const a = art[textKey(sc.text)];
    return a && artExists(DATA_DIR, a) ? { ...sc, art: { url: artUrl(PORT, s.token, a), kind: a.kind } } : sc;
  });
};
/** The sound-effects plan saved in the project (null when switched off). */
const sfxFor = (s: { vault: Vault; token: string }): { config: ReturnType<typeof normalizeSfx>; url: (hash: string) => string } | undefined => {
  const config = normalizeSfx((currentData(s.vault) as { sfx?: Partial<ReturnType<typeof normalizeSfx>> } | undefined)?.sfx);
  return config.enabled ? { config, url: (hash) => `http://127.0.0.1:${PORT}/api/sfx/${hash}.wav?s=${s.token}` } : undefined;
};
/** B-roll chosen per scene wording (saved in the project) and the free API keys (write-only, kept in the vault). */
const projectBroll = (s: { vault: Vault }): Record<string, BrollRef> => (currentData(s.vault) as { broll?: Record<string, BrollRef> } | undefined)?.broll ?? {};
const brollKeys = (s: { vault: Vault }): BrollKeys => s.vault.get<BrollKeys>('brollKeys') ?? {};
/** Adds each scene's B-roll URL (served by this server to the local render only). */
const withBroll = <T extends { text: string; durationSec: number }>(scenes: T[], s: { vault: Vault; token: string }): (T & { broll?: { url: string; durationSec: number } })[] => {
  const all = projectBroll(s);
  return scenes.map((sc) => {
    const b = all[textKey(sc.text)];
    return b && brollExists(DATA_DIR, b.id) ? { ...sc, broll: { url: brollUrl(PORT, s.token, b.id), durationSec: b.durationSec } } : sc;
  });
};
/** Background music chosen in the project (a track + its mix). */
const projectMusic = (s: { vault: Vault }): { track: MusicRef | null; mix?: Partial<MusicMix> } => (currentData(s.vault) as { music?: { track: MusicRef | null; mix?: Partial<MusicMix> } } | undefined)?.music ?? { track: null };
const musicFor = (s: { vault: Vault; token: string }): { url: string } & MusicMix | undefined => {
  const m = projectMusic(s);
  return m.track && musicExists(DATA_DIR, m.track.id) ? { url: musicUrl(PORT, s.token, m.track.id), ...normalizeMix(m.mix) } : undefined;
};
const creditsWithArt = (scenes: { text: string }[], s: { vault: Vault }) => ({ ...creditsFrom(scenes, projectChecks(s)), images: artCredits(scenes, projectArt(s), textKey), music: musicFor(s as { vault: Vault; token: string }) ? musicCredits(projectMusic(s).track) : [], video: brollCredits(scenes, projectBroll(s), textKey) });
/** Slides sent by the app (text + the scene wording they came from), bounded. Art and B-roll are looked up here, never taken from the client. */
const parseSlides = (raw: unknown, fallback: { text: string }[]): SlideDraft[] =>
  Array.isArray(raw) ? raw.slice(0, 40).map((x: { text?: unknown; origin?: unknown }) => ({ text: String(x?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), origin: typeof x?.origin === 'string' ? x.origin.slice(0, 300) : undefined })) : slidesFromScenes(fallback);
const slideMedia = (drafts: SlideDraft[], s: { vault: Vault; token: string }, sourcesText?: string): SlideSpec[] =>
  toSlideSpecs(withBroll(withArt(drafts.map((d) => ({ text: d.origin ?? d.text, durationSec: 3, slideText: d.text })), s), s).map((x) => ({ text: x.slideText, art: x.art, broll: x.broll })), sourcesText);
/** Cuts the person's own audio for a scene (their real voice, only trimmed). The browser never sends audio, only which part of which file. */
const originalCutter = (s: { vault: Vault; sources: Map<string, SourceRecord> }) => async (o: SceneOriginal, text?: string) => {
  const rec = s.sources.get(o.sourceId);
  if (!rec || !hasOriginal(DATA_DIR, rec.id)) throw new Error('El audio original de un fragmento ya no está guardado. Vuelve a subir ese archivo.');
  const bad = validateOriginal(o, rec.durationSec);
  if (bad) throw new Error(bad);
  return cutClip({ dataDir: DATA_DIR, unseal: (b) => s.vault.openBytes(b), cacheFile: (h) => tts.cacheFile(h), original: o, segments: rec.segments, text });
};
/** The key words chosen for each scene (saved in the project by scene wording); only words that really are in the text are used. */
const withBeats = <T extends { text: string }>(scenes: T[], s: { vault: Vault }): (T & { beatWords?: string[] })[] => {
  const all = (currentData(s.vault) as { beats?: Record<string, string[]> } | undefined)?.beats ?? {};
  return scenes.map((sc) => {
    const w = all[textKey(sc.text)];
    const words = Array.isArray(w) ? matchBeatWords(sc.text, w.map(String)) : [];
    return words.length ? { ...sc, beatWords: words } : sc;
  });
};
/** Keeps each scene's `original` (which part of which file) through the steps that rebuild scenes from text only. */
const withOriginal = <T extends { text: string; durationSec: number }>(scenes: T[], input: { original?: SceneOriginal }[]): (T & { original?: SceneOriginal })[] =>
  scenes.map((sc, i) => (input[i]?.original ? { ...sc, original: input[i]!.original } : sc));
const originalsError = (scenes: { original?: SceneOriginal }[], s: { sources: Map<string, SourceRecord> }): string | null => {
  for (const sc of scenes) {
    if (!sc.original) continue;
    const rec = s.sources.get(sc.original.sourceId);
    if (!rec || !hasOriginal(DATA_DIR, rec.id)) return 'El audio original de un fragmento ya no está guardado. Vuelve a subir ese archivo.';
    const bad = validateOriginal(sc.original, rec.durationSec);
    if (bad) return bad;
  }
  return null;
};
/** Who narrates: the person's own audio when any scene has `original` (no synthetic voice at all), otherwise the chosen voice, otherwise nobody. */
const narrationFor = (s: { token: string; vault: Vault; sources: Map<string, SourceRecord> }, scenes: { original?: SceneOriginal }[], voice: { id: string; speed?: unknown; pitch?: unknown; style?: unknown } | null) => {
  const audioUrl = (hash: string) => `http://127.0.0.1:${PORT}/api/audio/${hash}.wav?s=${s.token}`;
  if (scenes.some((x) => x.original)) return { original: originalCutter(s), audioUrl };
  return voice ? { tts, voiceId: voice.id, speed: Number(voice.speed) || 1, pitch: Number(voice.pitch) || 0, style: typeof voice.style === 'string' ? voice.style : '', audioUrl } : undefined;
};
const pendingMessage = (n: number) => `Hay ${n} escena(s) sin verificar. Verifica sus fuentes o márcalas como opinión en el paso de producción.`;
/** Removes from disk the files only a deleted project used (illustrations, B-roll, music, renders, delivered packages). */
const removeFiles = async (o: FileRefs): Promise<void> => {
  // The ids come from project data the browser saved: only well-formed ids and known extensions ever reach the disk.
  const hex = (i: string) => /^[a-f0-9]{16}$/.test(i);
  const ext = (e: string): e is 'svg' | 'png' | 'jpg' | 'webp' => ['svg', 'png', 'jpg', 'webp'].includes(e);
  const gone = [
    ...o.art.flatMap((a) => (hex(a.id) && ext(a.ext) ? [artPath(DATA_DIR, { id: a.id, ext: a.ext })] : [])),
    ...o.broll.filter(hex).map((i) => brollPath(DATA_DIR, i)),
    ...o.music.filter(hex).map((i) => musicPath(DATA_DIR, i)),
    ...o.renders.filter(hex).map((i) => renderFile(DATA_DIR, i)),
  ];
  await Promise.all(gone.map((f) => removeFile(f, { force: true }).catch(() => {})));
  await Promise.all(o.packages.filter(hex).map((i) => removeFile(packageDir(DATA_DIR, i), { recursive: true, force: true }).catch(() => {})));
};
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
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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
    const pv = url.pathname.match(/^\/api\/preview\/([a-f0-9]{16})\.png$/);
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
    const brm = url.pathname.match(/^\/api\/broll\/([a-f0-9]{16})\.mp4$/);
    if (brm && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      return brollExists(DATA_DIR, brm[1]!) ? sendFile(req, res, brollPath(DATA_DIR, brm[1]!), 'video/mp4') : json(res, 404, { error: 'Not found' });
    }
    const sfxm = url.pathname.match(/^\/api\/sfx\/([a-z0-9-]{3,40})\.wav$/);
    if (sfxm && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const name = sfxm[1]!;
      let body: Uint8Array | null = null;
      if (isSfxId(name) || isAmbientId(name)) body = toWav16(synthSfx(name)); // a library sound, for listening
      else if (/^[a-f0-9]{16}$/.test(name) && existsSync(sfxTrackPath(DATA_DIR, name))) body = await readFile(sfxTrackPath(DATA_DIR, name)); // a built track
      if (!body) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': body.length, 'cache-control': 'private, max-age=3600' });
      return void res.end(Buffer.from(body));
    }
    const musm = url.pathname.match(/^\/api\/music\/([a-f0-9]{16})\.mp3$/);
    if (musm && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      return musicExists(DATA_DIR, musm[1]!) ? sendFile(req, res, musicPath(DATA_DIR, musm[1]!), 'audio/mpeg') : json(res, 404, { error: 'Not found' });
    }
    const fontm = url.pathname.match(/^\/api\/font\/([a-f0-9]{16})$/);
    if (fontm && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const rec = fontsOf(session!).find((x) => x.id === fontm[1]);
      if (!rec || !existsSync(fontFile(rec.id))) return json(res, 404, { error: 'Not found' });
      const body = Buffer.from(await session!.vault.openBytes(new Uint8Array(await readFile(fontFile(rec.id)))));
      res.writeHead(200, { 'content-type': FONT_MIME[rec.ext], 'content-length': body.length, 'access-control-allow-origin': '*', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      return void res.end(body);
    }
    const artm = url.pathname.match(/^\/api\/art\/([a-f0-9]{16})\.(png|jpg|webp|svg)$/);
    if (artm && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const ref = { id: artm[1]!, ext: artm[2] as ArtRef['ext'] };
      if (!artExists(DATA_DIR, ref)) return json(res, 404, { error: 'Not found' });
      const body = await readFile(artPath(DATA_DIR, ref));
      res.writeHead(200, { 'content-type': ART_MIME[ref.ext], 'content-length': body.length, 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' });
      return void res.end(body);
    }
    if (pv && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const file = join(DATA_DIR, 'renders', `${pv[1]}.png`);
      return existsSync(file) ? sendFile(req, res, file, 'image/png') : json(res, 404, { error: 'Not found' });
    }
    if (dm && req.method === 'GET') {
      if (!tokenOk(String(url.searchParams.get('s') ?? ''))) return json(res, 401, { error: 'Locked' });
      const file = join(packageDir(DATA_DIR, dm[1]!), dm[2]!);
      if (!existsSync(file)) return json(res, 404, { error: 'Not found' });
      const ext = extname(file);
      const type = ext === '.png' ? 'image/png' : ext === '.wav' ? 'audio/wav' : ext === '.srt' ? 'application/x-subrip; charset=utf-8' : ext === '.zip' ? 'application/zip' : 'text/plain; charset=utf-8';
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
      tts.synth(b.voiceId, text, normalizeTuning({ speed: Number(b.speed) || 1, pitch: Number(b.pitch) || 0, style: typeof b.style === 'string' ? b.style : '' }), (p, l) => Object.assign(job, { progress: p, label: l }))
        .then((n) => Object.assign(job, { status: 'done', progress: 100, hash: n.hash, durationSec: n.durationSec }))
        .catch((e: unknown) => Object.assign(job, { status: 'error', error: e instanceof Error ? e.message : String(e) }));
      return json(res, 200, job);
    }
    // cloned voices: a sample + consent, applied on top of any base voice
    if (url.pathname === '/api/voice/clones' && req.method === 'GET') {
      return json(res, 200, { profiles: voiceProfiles.list(), engines: CLONE_ENGINES, tips: SAMPLE_TIPS, limits: { minSec: SAMPLE_MIN_SEC, maxSec: SAMPLE_MAX_SEC }, installed: cloneEngine.modelsReady('openvoice') });
    }
    if (url.pathname === '/api/voice/clones' && req.method === 'POST') {
      if (Number(req.headers['content-length'] ?? 0) > 80 * 1024 * 1024) return json(res, 413, { error: 'El archivo es demasiado grande (máx. 80 MB)' });
      const q = (k: string, n: number) => String(url.searchParams.get(k) ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
      const consent = { kind: q('kind', 12) as 'own' | 'permission', person: q('person', 80), purpose: q('purpose', 200), confirmed: url.searchParams.get('confirmed') === '1' };
      const early = validateConsent(consent); // before reading a single byte of audio
      if (early) return json(res, 400, { error: early });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 80 * 1024 * 1024) return json(res, 413, { error: 'El archivo es demasiado grande (máx. 80 MB)' });
        chunks.push(c as Buffer);
      }
      try {
        return json(res, 200, { profile: await voiceProfiles.create({ name: q('name', 40), base: q('base', 90), engine: q('engine', 20), consent, bytes: Buffer.concat(chunks) }) });
      } catch (e) {
        return json(res, e instanceof ProfileError ? 400 : 500, { error: e instanceof Error ? e.message : 'No pude crear la voz' });
      }
    }
    const cm = url.pathname.match(/^\/api\/voice\/clones\/([a-f0-9]{16})$/);
    if (cm && req.method === 'PATCH') {
      try {
        return json(res, 200, { profile: await voiceProfiles.update(cm[1]!, await readBody(req)) });
      } catch (e) {
        return json(res, e instanceof ProfileError ? 400 : 500, { error: e instanceof Error ? e.message : 'No pude cambiar la voz' });
      }
    }
    if (cm && req.method === 'DELETE') {
      await voiceProfiles.remove(cm[1]!);
      return json(res, 200, { ok: true });
    }

    // online voices: Edge needs nothing; Azure uses the person's own key (write-only, stored encrypted)
    if (url.pathname === '/api/voice/online' && req.method === 'GET') {
      const a = azureConfig();
      return json(res, 200, { edge: true, azure: { configured: !!a, region: a?.region ?? '' } });
    }
    if (url.pathname === '/api/voice/online/azure' && req.method === 'PUT') {
      const b = await readBody(req);
      const cfg = { key: String(b.key ?? '').trim(), region: String(b.region ?? '').trim().toLowerCase() };
      if (!validAzure(cfg)) return json(res, 400, { error: 'La clave o la región de Azure no parecen válidas (la región es algo como eastus o brazilsouth)' });
      s.vault.set('azureSpeech', cfg);
      await s.vault.save();
      return json(res, 200, { configured: true, region: cfg.region });
    }
    if (url.pathname === '/api/voice/online/azure' && req.method === 'DELETE') {
      s.vault.set('azureSpeech', null);
      await s.vault.save();
      return json(res, 200, { configured: false, region: '' });
    }
    const vm = url.pathname.match(/^\/api\/voice\/([a-f0-9]{16})$/);
    if (vm && req.method === 'GET') return voiceJobs.has(vm[1]!) ? json(res, 200, voiceJobs.get(vm[1]!)) : json(res, 404, { error: 'Not found' });

    // --- topic radar: real public data, every item with its source ---
    if (url.pathname === '/api/radar' && req.method === 'POST') {
      const force = (await readBody(req)).refresh === true;
      if (!radarCache || force || Date.now() - radarCache.at > 30 * 60_000) radarCache = { at: Date.now(), data: await fetchRadar({ geo: 'CO', region: 'Huila' }) };
      return json(res, 200, { ...radarCache.data, lines: radarLines(radarCache.data.items) });
    }

    // --- source verification (documentary mode) ---
    if (url.pathname === '/api/verify/check' && req.method === 'POST') {
      const b = await readBody(req);
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map((x: { url: string; claim: string; quote?: string }) => ({ url: String(x.url).slice(0, 500), claim: String(x.claim).slice(0, 600), quote: x.quote ? String(x.quote).slice(0, 600) : undefined }));
      return json(res, 200, { results: await checkMany(items) });
    }
    if (url.pathname === '/api/verify/free' && req.method === 'POST') {
      // Free search: public APIs + local check, no AI and no plan usage.
      const b = await readBody(req);
      const scenes = Array.isArray(b.scenes) ? b.scenes.slice(0, 80).map((x: { text: string }) => ({ text: String(x.text).slice(0, 600) })).filter((x: { text: string }) => x.text.trim()) : [];
      if (!scenes.length) return json(res, 400, { error: 'No hay escenas para buscar' });
      if ([...verifyJobs.values()].some((j) => j.status === 'working')) return json(res, 409, { error: 'Ya se están buscando fuentes; espera a que termine' });
      const job: VerifyJob = { id: randomBytes(8).toString('hex'), status: 'working', progress: 1, label: 'Empezando' };
      verifyJobs.set(job.id, job);
      freeResearchScenes(scenes, (p, l) => Object.assign(job, { progress: p, label: l }))
        .then((checks) => Object.assign(job, { status: 'done', progress: 100, checks }))
        .catch((e: unknown) => Object.assign(job, { status: 'error', error: e instanceof Error ? e.message : String(e) }));
      return json(res, 200, job);
    }
    if (url.pathname === '/api/verify/research' && req.method === 'POST') {
      const b = await readBody(req);
      const scenes = Array.isArray(b.scenes) ? b.scenes.slice(0, 80).map((x: { text: string }) => ({ text: String(x.text).slice(0, 600) })).filter((x: { text: string }) => x.text.trim()) : [];
      if (!scenes.length) return json(res, 400, { error: 'No hay escenas para verificar' });
      if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes (la búsqueda web necesita «Mi cuenta de Claude Code»)' });
      if ([...verifyJobs.values()].some((j) => j.status === 'working')) return json(res, 409, { error: 'Ya se están buscando fuentes; espera a que termine' });
      const job: VerifyJob = { id: randomBytes(8).toString('hex'), status: 'working', progress: 1, label: 'Empezando' };
      verifyJobs.set(job.id, job);
      researchScenes(s.gateway, scenes, (p, l) => Object.assign(job, { progress: p, label: l }))
        .then((checks) => Object.assign(job, { status: 'done', progress: 100, checks }))
        .catch((e: unknown) => Object.assign(job, { status: 'error', error: e instanceof Error ? e.message : String(e) }));
      return json(res, 200, job);
    }
    const vj = url.pathname.match(/^\/api\/verify\/([a-f0-9]{16})$/);
    if (vj && req.method === 'GET') return verifyJobs.has(vj[1]!) ? json(res, 200, verifyJobs.get(vj[1]!)) : json(res, 404, { error: 'Not found' });

    // --- visual style: preview frame and palette from a reference ---
    if (url.pathname === '/api/preview/frame' && req.method === 'POST') {
      const b = await readBody(req);
      const spec = VideoSpec.safeParse(b.spec);
      if (!spec.success) return json(res, 400, { error: 'Vista previa inválida' });
      const id = randomBytes(8).toString('hex');
      try {
        await renderFrame({ ...spec.data, fonts: userFontsFor(spec.data.style, s), scenes: withBroll(withArt(spec.data.scenes.slice(0, 1).map(({ text, durationSec }) => ({ text, durationSec })), s), s).map((x) => ({ ...x, speechSec: Math.min(x.durationSec - 0.5, 4) })) }, join(DATA_DIR, 'renders', `${id}.png`), DATA_DIR, ROOT);
        return json(res, 200, { url: `/api/preview/${id}.png` });
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No se pudo generar la vista previa' });
      }
    }
    if (url.pathname === '/api/carousel/preview' && req.method === 'POST') {
      const b = await readBody(req);
      const style = VideoSpec.shape.style.safeParse(b.style);
      const drafts = parseSlides(b.slides, []);
      const index = Math.max(0, Math.min(drafts.length - 1, Number(b.index) || 0));
      const bad = validateSlides(drafts);
      if (!style.success || bad) return json(res, 400, { error: bad ?? 'Vista previa inválida' });
      const id = randomBytes(8).toString('hex');
      try {
        await renderCarouselSlide({ slides: slideMedia(drafts, s), style: style.data, fonts: userFontsFor(style.data, s) }, index, join(DATA_DIR, 'renders', `${id}.png`), DATA_DIR, ROOT);
        return json(res, 200, { url: `/api/preview/${id}.png` });
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No se pudo generar la vista previa' });
      }
    }
    if (url.pathname === '/api/style/reference' && req.method === 'PUT') {
      const name = basename(String(url.searchParams.get('name') ?? 'referencia'));
      if (!/\.(png|jpe?g|webp|gif|mp4|mov|mkv|webm)$/i.test(name)) return json(res, 400, { error: 'Sube una imagen o un video (png, jpg, webp, mp4, mov, webm)' });
      if (Number(req.headers['content-length'] ?? 0) > 300 * 1024 * 1024) return json(res, 413, { error: 'Archivo demasiado grande (máx. 300 MB)' });
      const tmp = join(DATA_DIR, 'tmp');
      await mkdir(tmp, { recursive: true });
      const id = randomBytes(6).toString('hex');
      const file = join(tmp, `ref-${id}${extname(name).toLowerCase()}`);
      try {
        await pipeline(req, createWriteStream(file));
        const an = await analyzeReference(file, tmp, id);
        if (an.sheet) {
          if (sheets.size >= 3) sheets.delete(sheets.keys().next().value!);
          sheets.set(id, an.sheet);
        }
        if (an.capSheet) {
          if (capSheets.size >= 3) capSheets.delete(capSheets.keys().next().value!);
          capSheets.set(id, an.capSheet);
        }
        return json(res, 200, { id, palette: an.palette, fingerprint: an.fingerprint ?? null, hasSheet: !!an.sheet, captions: an.captions ?? null, hasCapSheet: !!an.capSheet });
      } catch {
        return json(res, 422, { error: 'No pude leer ese archivo como imagen o video' });
      } finally {
        await removeFile(file, { force: true });
      }
    }

    if (url.pathname === '/api/style/reference/ai' && req.method === 'POST') {
      // One small AI query: a single contact-sheet image. Cached by the sheet's hash, so the same reference never costs twice.
      const id = String((await readBody(req)).id ?? '');
      const sheet = sheets.get(id);
      if (!sheet) return json(res, 404, { error: 'Esa referencia ya no está disponible; vuelve a subirla' });
      if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes' });
      const file = join(claudeWorkDir(), `sheet-${id}.png`);
      await writeFile(file, sheet);
      try {
        return json(res, 200, await s.gateway.run('styleFromSheet', `HOJA ${createHash('sha1').update(sheet).digest('hex')}`, { images: [file] }));
      } finally {
        await removeFile(file, { force: true });
      }
    }

    if (url.pathname === '/api/style/reference/subtitles-ai' && req.method === 'POST') {
      // One small AI query: crops of the caption band. Cached by the sheet's hash.
      const id = String((await readBody(req)).id ?? '');
      const sheet = capSheets.get(id);
      if (!sheet) return json(res, 404, { error: 'Esa referencia ya no está disponible; vuelve a subirla' });
      if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes' });
      const file = join(claudeWorkDir(), `subs-${id}.png`);
      await writeFile(file, sheet);
      try {
        return json(res, 200, await s.gateway.run('subtitleFromSheet', `HOJA ${createHash('sha1').update(sheet).digest('hex')}`, { images: [file] }));
      } finally {
        await removeFile(file, { force: true });
      }
    }

    // --- B-roll: free stock video (keys are write-only; nothing ever returns them) ---
    if (url.pathname === '/api/broll/keys' && req.method === 'GET') {
      const k = brollKeys(s);
      return json(res, 200, { pexels: !!k.pexels, pixabay: !!k.pixabay });
    }
    if (url.pathname === '/api/broll/keys' && req.method === 'PUT') {
      const b = await readBody(req);
      const next: BrollKeys = { ...brollKeys(s) };
      for (const name of ['pexels', 'pixabay'] as const) {
        if (typeof b[name] !== 'string') continue;
        const v = b[name].trim();
        if (!v) delete next[name];
        else if (/^[A-Za-z0-9_-]{10,120}$/.test(v)) next[name] = v;
        else return json(res, 400, { error: `La clave de ${PROVIDER_LABEL[name]} no parece válida` });
      }
      s.vault.set('brollKeys', next);
      await s.vault.save();
      return json(res, 200, { pexels: !!next.pexels, pixabay: !!next.pixabay });
    }
    if (url.pathname === '/api/broll/search' && req.method === 'POST') {
      const b = await readBody(req);
      const q = String(b.query ?? '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().slice(0, 80);
      // Test seam: CHP_BROLL_TEST_URL replaces the public providers with a local fixture (never set in normal use).
      const test = process.env.CHP_BROLL_TEST_URL;
      const candidates = test ? ((await (await fetch(`${test}?q=${encodeURIComponent(q)}`)).json()) as BrollCandidate[]) : await searchBroll(q, { keys: brollKeys(s), portrait: b.portrait !== false });
      return json(res, 200, { query: q, candidates });
    }
    if (url.pathname === '/api/broll/use' && req.method === 'POST') {
      const c = (await readBody(req)).candidate as BrollCandidate | undefined;
      if (!c || typeof c.url !== 'string' || typeof c.id !== 'string' || !(c.provider in PROVIDER_LABEL) || !['cc0', 'pdm', 'by', 'free', 'nasa'].includes(String(c.license))) return json(res, 400, { error: 'Video inválido o sin una licencia permitida' });
      try {
        return json(res, 200, { broll: await downloadBroll(DATA_DIR, { ...c, title: String(c.title ?? ''), author: String(c.author ?? ''), licenseLabel: String(c.licenseLabel ?? '').slice(0, 30) }) });
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No pude descargar el video' });
      }
    }

    // --- sound effects: hear the plan on the project's timeline without rendering ---
    if (url.pathname === '/api/sfx/preview' && req.method === 'POST') {
      const b = await readBody(req);
      const scenes = (Array.isArray(b.scenes) ? b.scenes : []).slice(0, 60).map((x: { text: unknown; durationSec: unknown }) => ({ text: String(x.text ?? '').slice(0, 400), durationSec: Math.min(60, Math.max(1, Number(x.durationSec) || 3)) }));
      const style = VideoSpec.shape.style.safeParse(b.style);
      const config = normalizeSfx({ ...(b.config ?? {}), enabled: true });
      const arted = withArt(scenes, s); // illustrations the person chose also trigger their sound
      const hash = await buildSfxTrack(DATA_DIR, arted, style.success ? (style.data as never) : DEFAULT_STYLE, config);
      return hash ? json(res, 200, { hash }) : json(res, 200, { hash: null });
    }

    // --- background music: free search, own files, mood hint ---
    if (url.pathname === '/api/music/mood' && req.method === 'POST') {
      const b = await readBody(req);
      const fallback = { mood: 'documental', hint: '', ai: false };
      if (!s.gateway) return json(res, 200, fallback);
      try {
        const r = await s.gateway.run('musicMood', `TEMA: ${String(b.topic ?? '').slice(0, 160)}\nGUION: ${String(b.script ?? '').slice(0, 500)}\nESTILO: ${String(b.style ?? '').slice(0, 40)}`);
        return json(res, 200, { mood: r.data.mood, hint: r.data.hint, ai: true });
      } catch {
        return json(res, 200, fallback);
      }
    }
    if (url.pathname === '/api/music/search' && req.method === 'POST') {
      const b = await readBody(req);
      const mood = isMood(String(b.mood)) ? (b.mood as (typeof MOODS)[number]['id']) : 'documental';
      const q = musicQuery(mood, String(b.hint ?? '').replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 30));
      // Test seam: CHP_MUSIC_TEST_URL replaces Openverse with a local fixture (never set in normal use).
      const test = process.env.CHP_MUSIC_TEST_URL;
      return json(res, 200, { query: q, candidates: test ? ((await (await fetch(`${test}?q=${encodeURIComponent(q)}`)).json()) as unknown[]) : await searchMusic(q) });
    }
    if (url.pathname === '/api/music/use' && req.method === 'POST') {
      const c = (await readBody(req)).candidate ?? {};
      const license = licenseOf(c.license === 'by' ? 'cc by' : String(c.license ?? ''));
      if (!license || typeof c.url !== 'string') return json(res, 400, { error: 'Esa pista no tiene una licencia permitida' });
      try {
        return json(res, 200, { music: await downloadMusic(DATA_DIR, { url: c.url, title: String(c.title ?? ''), artist: String(c.artist ?? ''), durationSec: Number(c.durationSec) || 0, license, licenseLabel: String(c.licenseLabel ?? '').slice(0, 30) }) });
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No pude descargar la pista' });
      }
    }
    if (url.pathname === '/api/music/own' && req.method === 'PUT') {
      if (Number(req.headers['content-length'] ?? 0) > 60 * 1024 * 1024) return json(res, 413, { error: 'El archivo es demasiado grande (máx. 60 MB)' });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 60 * 1024 * 1024) return json(res, 413, { error: 'El archivo es demasiado grande (máx. 60 MB)' });
        chunks.push(c as Buffer);
      }
      const clean = (k: string, n: number) => String(url.searchParams.get(k) ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
      try {
        return json(res, 200, { music: await saveOwnMusic(DATA_DIR, Buffer.concat(chunks), { title: clean('title', 100) || basename(clean('name', 100)).replace(/\.[a-z0-9]+$/i, ''), artist: clean('artist', 80), credit: clean('credit', 160) }) });
      } catch (e) {
        return json(res, 422, { error: e instanceof Error ? e.message : 'No pude leer ese audio' });
      }
    }

    // --- the person's own subtitle fonts (stored encrypted, never versioned) ---
    if (url.pathname === '/api/fonts' && req.method === 'GET') return json(res, 200, { fonts: fontsOf(s).map(({ id, name }) => ({ id, name })) });
    if (url.pathname === '/api/fonts' && req.method === 'PUT') {
      const name = basename(String(url.searchParams.get('name') ?? 'fuente')).replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 40) || 'Mi fuente';
      if (Number(req.headers['content-length'] ?? 0) > 4 * 1024 * 1024) return json(res, 413, { error: 'La fuente es demasiado grande (máx. 4 MB)' });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 4 * 1024 * 1024) return json(res, 413, { error: 'La fuente es demasiado grande (máx. 4 MB)' });
        chunks.push(c as Buffer);
      }
      const bytes = Buffer.concat(chunks);
      const ext = sniffFont(bytes);
      if (!ext) return json(res, 400, { error: 'Sube un archivo de fuente (.ttf, .otf, .woff o .woff2)' });
      const id = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
      await mkdir(join(DATA_DIR, 'fonts'), { recursive: true });
      await writeFile(fontFile(id), await s.vault.sealBytes(new Uint8Array(bytes)));
      s.vault.set('fonts', [...fontsOf(s).filter((x) => x.id !== id), { id, name, ext }]);
      await s.vault.save();
      return json(res, 200, { id, name });
    }
    const fdel = url.pathname.match(/^\/api\/fonts\/([a-f0-9]{16})$/);
    if (fdel && req.method === 'DELETE') {
      s.vault.set('fonts', fontsOf(s).filter((x) => x.id !== fdel[1]));
      await s.vault.save();
      await removeFile(fontFile(fdel[1]!), { force: true });
      return json(res, 200, { ok: true });
    }

    // --- scene illustrations: free web search first, a drawn SVG only when nothing fits ---
    if (url.pathname === '/api/art/queries' && req.method === 'POST') {
      const b = await readBody(req);
      const scenes: { text: string }[] = Array.isArray(b.scenes) ? b.scenes.slice(0, 40).map((x: { text: unknown }) => ({ text: String(x.text ?? '').slice(0, 400) })) : [];
      const local = scenes.map((x) => ({ key: textKey(x.text), query: artQuery(x.text), draw: '' }));
      if (!s.gateway || !scenes.length) return json(res, 200, { items: local, ai: false });
      try {
        // One cheap query for the whole script (cached): English search terms per scene.
        const st = b.style && typeof b.style === 'object' ? `ESTILO ${String(b.style.name ?? '').slice(0, 40)}|fondo ${String(b.style.background ?? '').slice(0, 12)}` : 'ESTILO libre';
        const r = await s.gateway.run('artQueries', `${st}\n${scenes.map((x) => `${textKey(x.text)}|${x.text}`).join('\n')}`);
        const got = new Map(r.data.scenes.map((x) => [x.key, x]));
        return json(res, 200, { items: local.map((l) => ({ ...l, ...(got.get(l.key)?.query ? { query: got.get(l.key)!.query, draw: got.get(l.key)!.draw } : {}) })), ai: true });
      } catch {
        return json(res, 200, { items: local, ai: false });
      }
    }
    if (url.pathname === '/api/art/search' && req.method === 'POST') {
      const q = String((await readBody(req)).query ?? '').slice(0, 80);
      // Test seam: CHP_ART_TEST_URL replaces the public providers with a local fixture (never set in normal use).
      const test = process.env.CHP_ART_TEST_URL;
      return json(res, 200, { candidates: test ? ((await (await fetch(`${test}?q=${encodeURIComponent(q)}`)).json()) as unknown[]) : await searchArt(q) });
    }
    if (url.pathname === '/api/art/use' && req.method === 'POST') {
      const c = (await readBody(req)).candidate ?? {};
      const license = licenseOf(c.license === 'by' ? 'cc by' : String(c.license ?? ''));
      if (!license || typeof c.url !== 'string') return json(res, 400, { error: 'Esa imagen no tiene una licencia permitida' });
      try {
        return json(res, 200, { art: await downloadArt(DATA_DIR, { url: c.url, title: String(c.title ?? '').slice(0, 120), author: String(c.author ?? '').slice(0, 80), license, licenseLabel: String(c.licenseLabel ?? '').slice(0, 30), page: String(c.page ?? '').slice(0, 300) }) });
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No pude descargar la imagen' });
      }
    }
    if (url.pathname === '/api/art/draw' && req.method === 'POST') {
      const b = await readBody(req);
      if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes' });
      const p = b.palette ?? {};
      const hex = (v: unknown) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : '#888888');
      const desc = String(b.desc ?? '').slice(0, 200);
      if (!desc.trim()) return json(res, 400, { error: 'Falta qué dibujar' });
      const r = await s.gateway.run('drawIllustration', `DIBUJA: ${desc}\nPALETA: ${hex(p.fg)} ${hex(p.accent)} ${hex(p.accent2)} ${hex(p.bg)}`);
      const svg = sanitizeSvg(r.data.svg);
      if (!svg) return json(res, 422, { error: 'El dibujo no fue válido; inténtalo de nuevo' });
      return json(res, 200, { art: await saveDrawn(DATA_DIR, svg, desc) });
    }

    // --- beats: key words with a zoom hit and a click (one small AI query for the whole script) ---
    if (url.pathname === '/api/beats/propose' && req.method === 'POST') {
      const b = await readBody(req);
      const texts: string[] = Array.isArray(b.scenes) ? b.scenes.slice(0, 60).map((x: { text?: unknown }) => String(x?.text ?? '').slice(0, 400)).filter((t: string) => t.trim()) : [];
      if (!texts.length) return json(res, 400, { error: 'No hay escenas' });
      if (!s.gateway) return json(res, 409, { error: 'Elige un motor de IA en Ajustes' });
      try {
        const r = await s.gateway.run('beatWords', texts.map((t) => `${textKey(t)}|${t}`).join('\n'));
        const got = new Map(r.data.scenes.map((x) => [x.key, x.words]));
        return json(res, 200, { items: texts.map((t) => ({ key: textKey(t), words: matchBeatWords(t, got.get(textKey(t)) ?? []) })) });
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No se pudieron proponer las palabras' });
      }
    }

    // --- fragments of the person's own audio: listen to a cut before using it ---
    if (url.pathname === '/api/fragments/preview' && req.method === 'POST') {
      const b = await readBody(req);
      const original: SceneOriginal = { sourceId: String(b.sourceId ?? ''), startSec: Number(b.startSec), endSec: Number(b.endSec), trimSilence: b.trimSilence === true, fadeMs: Number.isFinite(Number(b.fadeMs)) ? Number(b.fadeMs) : undefined };
      try {
        const c = await originalCutter(s)(original);
        return json(res, 200, { url: `/api/audio/${c.hash}.wav`, durationSec: c.durationSec });
      } catch (e) {
        return json(res, 409, { error: e instanceof Error ? e.message : 'No se pudo preparar el fragmento' });
      }
    }

    // --- deliverables: the person ticks what to produce ---
    if (url.pathname === '/api/deliverables' && req.method === 'POST') {
      const b = await readBody(req);
      const base = VideoSpec.safeParse({ preset: 'youtube_long', scenes: (b.scenes ?? []).map((x: { text: string; durationSec: number; original?: SceneOriginal }) => ({ text: x.text, durationSec: x.durationSec, original: x.original })), theme: b.theme, style: b.style });
      if (!base.success || !Array.isArray(b.items)) return json(res, 400, { error: 'Solicitud de entregables inválida' });
      const oerr = originalsError(base.data.scenes, s);
      if (oerr) return json(res, 409, { error: oerr });
      const voice = b.voice && typeof b.voice.id === 'string' ? b.voice : null;
      const baseScenes = base.data.scenes.map(({ text, durationSec }) => ({ text, durationSec }));
      const g = gate(baseScenes, projectChecks(s));
      if (!g.ok) return json(res, 409, { error: pendingMessage(g.pending.length) });
      const credits = creditsWithArt(baseScenes, s);
      const card = credits.sources.length || credits.images.length || credits.music.length || credits.video.length ? { text: creditCardText(credits), durationSec: 6 } : undefined;
      let slides: SlideSpec[] | undefined;
      if (b.items.includes('carousel')) {
        const drafts = parseSlides(b.slides, baseScenes);
        const bad = validateSlides(drafts, card ? 1 : 0);
        if (bad) return json(res, 400, { error: bad });
        const pend = carouselGate(drafts, projectChecks(s));
        if (pend.length) return json(res, 409, { error: `La(s) lámina(s) ${pend.map((i) => i + 1).join(', ')} tienen cifras o datos sin verificar (texto editado o dividido). Verifica sus fuentes o quita las cifras.` });
        slides = slideMedia(drafts, s, card?.text);
      }
      const request: PackageRequest = {
        card, slides,
        items: b.items, scenes: withBeats(withOriginal(withBroll(withArt(baseScenes, s), s), base.data.scenes), s), theme: base.data.theme, style: base.data.style, fonts: userFontsFor(base.data.style, s), music: musicFor(s),
        shorts: Array.isArray(b.shorts) ? b.shorts.map((r: { from: number; to: number }) => ({ from: Number(r.from), to: Number(r.to) })) : [],
        title: String(b.title ?? '').slice(0, 120), subtitle: b.subtitle ? String(b.subtitle).slice(0, 60) : undefined,
        summary: String(b.summary ?? '').slice(0, 3000),
        sources: Array.isArray(b.sources) ? b.sources.slice(0, 30).map((x: { source: string; url?: string; metric?: string }) => ({ source: String(x.source).slice(0, 120), url: x.url ? String(x.url).slice(0, 300) : undefined, metric: x.metric ? String(x.metric).slice(0, 60) : undefined })) : [],
        hashtags: Array.isArray(b.hashtags) ? b.hashtags.slice(0, 20).map((h: unknown) => String(h).slice(0, 40)) : [],
        extra: Array.isArray(b.extra) ? b.extra.slice(0, 10).map((h: unknown) => String(h).slice(0, 300)) : undefined,
      };
      request.sources = [...request.sources, ...credits.sources.map((x) => ({ source: x.title, url: x.url }))];
      if (credits.calcs.length) request.extra = [...(request.extra ?? []), 'Cálculos propios:', ...credits.calcs.map((c) => `- ${c}`)];
      if (credits.images.length) request.extra = [...(request.extra ?? []), 'Imágenes:', ...credits.images.map((c) => `- ${c}`)];
      if (voice && isCloneVoiceId(String(voice.id))) {
        const prof = voiceProfiles.get(profileIdOf(String(voice.id)));
        if (prof) request.extra = [...(request.extra ?? []), syntheticVoiceNotice(prof)];
      }
      if (credits.music.length) request.extra = [...(request.extra ?? []), 'Música:', ...credits.music.map((c) => `- ${c}`)];
      if (credits.video.length) request.extra = [...(request.extra ?? []), 'Video:', ...credits.video.map((c) => `- ${c}`)];
      try {
        return json(res, 200, await startPackage(request, { dataDir: DATA_DIR, root: ROOT, narration: narrationFor(s, base.data.scenes, voice), extras: { sfx: sfxFor(s) } }));
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
      const oerr = originalsError(spec.data.scenes, s);
      if (oerr) return json(res, 409, { error: oerr });
      // The client never supplies audio URLs; the server adds them itself when narration is requested.
      const baseScenes = spec.data.scenes.map(({ text, durationSec }) => ({ text, durationSec }));
      const g = gate(baseScenes, projectChecks(s));
      if (!g.ok) return json(res, 409, { error: pendingMessage(g.pending.length) });
      const credits = creditsWithArt(baseScenes, s);
      const artScenes = withBeats(withOriginal(withBroll(withArt(baseScenes, s), s), spec.data.scenes), s);
      const clean = { ...spec.data, fonts: userFontsFor(spec.data.style, s), music: musicFor(s), scenes: credits.sources.length || credits.images.length || credits.music.length || credits.video.length ? [...artScenes, { text: creditCardText(credits), durationSec: 6, card: true }] : artScenes };
      const voice = b.voice && typeof b.voice.id === 'string' ? b.voice : null;
      try {
        return json(res, 200, await startRender(clean, b.quality, DATA_DIR, ROOT, narrationFor(s, spec.data.scenes, voice), { sfx: sfxFor(s) }));
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
    if (url.pathname === '/api/project' && req.method === 'GET') return json(res, 200, { id: currentId(s.vault), project: currentData(s.vault) ?? null });
    if (url.pathname === '/api/project' && req.method === 'PUT') {
      const b = await readBody(req);
      const id = typeof b.id === 'string' ? b.id : currentId(s.vault);
      if (!saveProjectData(s.vault, id, b.project ?? {})) return json(res, 404, { error: 'El proyecto ya no existe' });
      await s.vault.save();
      return json(res, 200, { ok: true });
    }

    // --- project manager: several projects in the same vault ---
    if (url.pathname === '/api/projects' && req.method === 'GET') return json(res, 200, listProjects(s.vault));
    if (url.pathname === '/api/projects' && req.method === 'POST') {
      const b = await readBody(req);
      try {
        const m = createProject(s.vault, String(b.name ?? ''), typeof b.template === 'string' && b.template ? b.template : undefined);
        await s.vault.save();
        return json(res, 200, m);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'No se pudo crear el proyecto' });
      }
    }
    if (url.pathname === '/api/projects/import' && req.method === 'POST') {
      try {
        const m = importProject(s.vault, String((await readBody(req)).json ?? ''));
        await s.vault.save();
        return json(res, 200, m);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'No se pudo importar el proyecto' });
      }
    }
    const prj = url.pathname.match(/^\/api\/projects\/([a-f0-9]{16})(?:\/(open|duplicate|export))?$/);
    if (prj) {
      const id = prj[1]!;
      const action = prj[2];
      const meta = listProjects(s.vault).items.find((p) => p.id === id);
      if (!meta || !isProjectId(id)) return json(res, 404, { error: 'El proyecto ya no existe' });
      try {
        if (!action && req.method === 'GET') return json(res, 200, { id, project: getProjectData(s.vault, id) ?? null });
        if (action === 'export' && req.method === 'GET') {
          const body = Buffer.from(exportEnvelope(meta.name, getProjectData(s.vault, id) ?? {}));
          res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${slug(meta.name)}.contenthub.json"`, 'content-length': body.length });
          return void res.end(body);
        }
        if (action === 'open' && req.method === 'POST') {
          openProject(s.vault, id);
          await s.vault.save();
          return json(res, 200, { current: id });
        }
        if (action === 'duplicate' && req.method === 'POST') {
          const m = duplicateProject(s.vault, id, (await readBody(req)).name);
          await s.vault.save();
          return json(res, 200, m);
        }
        if (!action && req.method === 'PATCH') {
          const b = await readBody(req);
          if (typeof b.name === 'string') renameProject(s.vault, id, b.name);
          if (typeof b.archived === 'boolean') archiveProject(s.vault, id, b.archived);
          await s.vault.save();
          return json(res, 200, { ok: true });
        }
        if (!action && req.method === 'DELETE') {
          if (cleanName((await readBody(req)).confirm) !== meta.name) return json(res, 400, { error: 'Escribe el nombre exacto del proyecto para confirmar' });
          const r = deleteProject(s.vault, id);
          await s.vault.save();
          await removeFiles(r.orphans);
          return json(res, 200, { current: r.current });
        }
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'No se pudo completar la acción' });
      }
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
      void processSource(rec, file, DATA_DIR, quality, () => saveSources(s), (b) => s.vault.sealBytes(b), (id, f) => keepOriginal(DATA_DIR, id, f, (b) => s.vault.sealBytes(b)));
      return json(res, 200, { id });
    }
    const m = url.pathname.match(/^\/api\/sources\/([a-f0-9]+)(?:\/(ideas|excerpt|lines|review|audio|text))?$/);
    if (m) {
      const rec = s.sources.get(m[1]!);
      if (!rec) return json(res, 404, { error: 'Source not found' });
      if (!m[2] && req.method === 'GET') return json(res, 200, { source: toView(rec) });
      if (!m[2] && req.method === 'DELETE') {
        await dropAudio(DATA_DIR, rec);
        await dropOriginal(DATA_DIR, rec.id); // the kept original goes with the source
        dropCached(rec.id);
        s.sources.delete(rec.id);
        await saveSources(s);
        return json(res, 200, { ok: true });
      }
      if (m[2] === 'excerpt' && req.method === 'GET')
        return json(res, 200, { text: excerptFor(rec, Number(url.searchParams.get('start') ?? 0), Number(url.searchParams.get('end') ?? 0)) });
      if (m[2] === 'text' && req.method === 'GET') {
        const a = Number(url.searchParams.get('start') ?? 0);
        const b = Number(url.searchParams.get('end') ?? 0);
        return json(res, 200, { text: textForRange(rec.segments, a, b), segs: segmentsIn(rec.segments, a, b).slice(0, 600).map(({ start, end, text }) => ({ start, end, text })), durationSec: rec.durationSec, hasOriginal: hasOriginal(DATA_DIR, rec.id) });
      }
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
