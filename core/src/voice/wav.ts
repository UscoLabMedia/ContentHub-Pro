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
