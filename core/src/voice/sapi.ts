// Windows built-in voices (System.Speech): free, zero download, works offline. Windows only.
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../util/proc.ts';

const ps = (script: string, env: Record<string, string> = {}) =>
  run('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env });

export interface SapiVoice {
  name: string;
  culture: string;
}

export async function listSapi(): Promise<SapiVoice[]> {
  if (process.platform !== 'win32') return [];
  const out = await ps("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }");
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().split('|'))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0])
    .map(([name, culture]) => ({ name, culture }))
    .filter((v) => v.culture.toLowerCase().startsWith('es'));
}

export async function synthSapi(name: string, text: string, outWav: string, speed: number): Promise<void> {
  const txt = join(tmpdir(), `chp-${randomBytes(6).toString('hex')}.txt`);
  await writeFile(txt, text, 'utf8');
  await mkdir(dirname(outWav), { recursive: true });
  try {
    await ps(
      "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:CHP_VOICE); $s.Rate = [int]$env:CHP_RATE; $s.SetOutputToWaveFile($env:CHP_OUT); $s.Speak([IO.File]::ReadAllText($env:CHP_TXT, [Text.Encoding]::UTF8)); $s.Dispose()",
      { CHP_VOICE: name, CHP_RATE: String(Math.max(-10, Math.min(10, Math.round((speed - 1) * 10)))), CHP_OUT: outWav, CHP_TXT: txt },
    );
  } finally {
    await rm(txt, { force: true });
  }
}
