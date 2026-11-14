// The ONLY file in the project allowed to talk to Claude (SDK or CLI). Enforced by scripts/check-rules.mjs.
// Two interchangeable engines behind one interface:
//   - createClaudeCodeClient: uses YOUR logged-in Claude Code account (no API key)
//   - createLlmClient:        uses an Anthropic API key
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z, type ZodType } from 'zod';
import type { Effort, ModelId, Usage } from '../models.ts';

export interface LlmRequest {
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  system: string;
  user: string;
  schema: ZodType;
  /** Allow web search and page fetching (Claude Code engine only). */
  research?: boolean;
}

export interface LlmResponse {
  parsed: unknown;
  usage: Usage;
  stopReason: string | null;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ---------------------------------------------------------------- API-key engine
export function createLlmClient(apiKey: string): LlmClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete(req) {
      if (req.research) throw new Error('La búsqueda web de fuentes necesita el motor «Mi cuenta de Claude Code» (Ajustes → Motor de IA).');
      const r = await client.messages.parse({
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
        output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
      });
      return { parsed: r.parsed_output, usage: r.usage, stopReason: r.stop_reason };
    },
  };
}

// ---------------------------------------------------------------- Claude Code account engine
const CLI_MODEL: Record<ModelId, string> = {
  'claude-haiku-5-5': 'haiku',
  'claude-sonnet-5-5': 'sonnet',
  'claude-opus-5-5': 'opus',
};
const WIN = process.platform === 'win32';

/** Quote one argument for cmd.exe (needed because `claude` may be a .cmd shim on Windows). */
const winQuote = (a: string) => `"${a.replace(/["%^&|<>]/g, "'")}"`;

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the Claude Code CLI with the user's own login. Prompt goes through stdin (no length/quoting limits). */
export function runClaude(args: string[], stdin = '', opts: { command?: string[]; timeoutMs?: number } = {}): Promise<CliResult> {
  const [cmd, ...pre] = opts.command ?? ['claude'];
  // Empty working dir: the CLI must not load this repo's CLAUDE.md/hooks (that would waste tokens).
  const cwd = join(tmpdir(), 'contenthub-claude');
  mkdirSync(cwd, { recursive: true });
  return new Promise((resolve, reject) => {
    const all = [...pre, ...args];
    const child = WIN && !opts.command
      ? spawn([cmd!, ...all.map(winQuote)].join(' '), { cwd, shell: true, windowsHide: true })
      : spawn(cmd!, all, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 300_000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Claude Code ("${cmd}"): ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

export async function claudeCodeStatus(opts: { command?: string[] } = {}): Promise<{ installed: boolean; loggedIn: boolean }> {
  try {
    const r = await runClaude(['auth', 'status'], '', { ...opts, timeoutMs: 20_000 });
    if (r.code !== 0 && !r.stdout.trim()) return { installed: true, loggedIn: false };
    const parsed = JSON.parse(r.stdout) as { loggedIn?: boolean };
    return { installed: true, loggedIn: !!parsed.loggedIn };
  } catch (e) {
    return { installed: !/Could not start/.test((e as Error).message), loggedIn: false };
  }
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

export function createClaudeCodeClient(opts: { command?: string[]; timeoutMs?: number } = {}): LlmClient {
  return {
    async complete(req) {
      const schemaText = JSON.stringify(z.toJSONSchema(req.schema));
      const system = `${req.system}\n\nResponde UNICAMENTE con un objeto JSON valido que cumpla el esquema que recibiras. Sin texto extra ni bloques de codigo.`;
      let user = `ESQUEMA JSON:\n${schemaText}\n\nDATOS:\n${req.user}`;
      let lastErr = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runClaude(
          [
            '-p', '--output-format', 'json', '--model', CLI_MODEL[req.model], '--effort', req.effort,
            ...(req.research ? ['--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch'] : ['--tools', '']),
            '--no-session-persistence', '--system-prompt', system,
          ],
          user,
          req.research ? { ...opts, timeoutMs: 600_000 } : opts,
        );
        let out: { is_error?: boolean; result?: string; structured_output?: unknown; usage?: Usage; stop_reason?: string };
        try {
          out = JSON.parse(r.stdout);
        } catch {
          throw new Error(`Claude Code failed: ${(r.stderr || r.stdout).slice(0, 300) || `exit ${r.code}`}`);
        }
        if (out.is_error) {
          const msg = String(out.result ?? 'unknown error');
          const e = new Error(/login|auth/i.test(msg) ? `Claude Code is not signed in: ${msg}` : `Claude Code error: ${msg}`);
          if (/rate|limit|overload/i.test(msg)) (e as Error & { status?: number }).status = 429;
          throw e;
        }
        try {
          const parsed = req.schema.parse(out.structured_output ?? extractJson(String(out.result ?? '')));
          return { parsed, usage: out.usage ?? { input_tokens: 0, output_tokens: 0 }, stopReason: out.stop_reason ?? 'end_turn' };
        } catch (e) {
          lastErr = (e as Error).message.slice(0, 200);
          user += `\n\nTu respuesta anterior no cumplio el esquema (${lastErr}). Devuelve solo el JSON corregido.`;
        }
      }
      throw new Error(`Claude Code did not return valid JSON: ${lastErr}`);
    },
  };
}
