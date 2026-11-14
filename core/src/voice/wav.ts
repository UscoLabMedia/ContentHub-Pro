// Minimal WAV helpers (no dependencies).
export interface WavInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  durationSec: number;
}

export function wavInfo(buf: Uint8Array): WavInfo {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let off = 12;
  let fmt: { sampleRate: number; channels: number; bits: number; byteRate: number } | null = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    let size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), byteRate: b.readUInt32LE(body + 8), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt');
      if (size === 0 || size > b.length - body) size = b.length - body; // streamed files may carry a bogus size
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits, durationSec: size / fmt.byteRate };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** 16-bit mono sine wave, used by self-tests and fake engines. */
export function sineWav(freq: number, sec: number, rate = 22050): Buffer {
  const n = Math.round(sec * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** PCM samples of a 16-bit WAV (mono or stereo), for joining pieces. */
export function readPcm16(buf: Uint8Array): { rate: number; channels: number; data: Buffer } {
  const info = wavInfo(buf);
  if (info.bits !== 16) throw new Error('Only 16-bit WAV can be joined');
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    let size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'data') {
      if (size === 0 || size > b.length - body) size = b.length - body;
      return { rate: info.sampleRate, channels: info.channels, data: b.subarray(body, body + size) };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

export function wavFromPcm16(rate: number, channels: number, data: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2 * channels, 28);
  h.writeUInt16LE(2 * channels, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Joins WAV pieces (same format) with `gapsSec[i]` of silence after piece i. Also returns where each piece starts. */
export function joinWav(parts: Uint8Array[], gapsSec: number[]): { wav: Buffer; starts: number[] } {
  if (!parts.length) throw new Error('Nothing to join');
  const pcm = parts.map(readPcm16);
  const { rate, channels } = pcm[0]!;
  if (pcm.some((p) => p.rate !== rate || p.channels !== channels)) throw new Error('The pieces have different audio formats');
  const chunks: Buffer[] = [];
  const starts: number[] = [];
  let t = 0;
  pcm.forEach((p, i) => {
    starts.push(t);
    chunks.push(p.data);
    t += p.data.length / (rate * 2 * channels);
    const gap = Math.max(0, gapsSec[i] ?? 0);
    if (gap > 0) {
      const frames = Math.round(gap * rate);
      chunks.push(Buffer.alloc(frames * 2 * channels));
      t += frames / rate;
    }
  });
  return { wav: wavFromPcm16(rate, channels, Buffer.concat(chunks)), starts };
}
