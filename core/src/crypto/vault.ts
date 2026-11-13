// Encrypted vault with envelope encryption.
//   data  --AES-256-GCM--> random data key (DEK)
//   DEK   wrapped twice:  by the password (PBKDF2) and by a one-time RECOVERY KEY (shown once at creation).
// Forgot the password? The recovery key opens the vault and lets you set a new password.
// Lost both? The data is unrecoverable by design (there is no backdoor and no server that can reset it).

const enc = new TextEncoder();
const dec = new TextDecoder();
const AAD_DATA = enc.encode('chp-v2-data');
const AAD_WRAP = enc.encode('chp-v2-wrap');
export const DEFAULT_ITERATIONS = 600_000;
const AUDIO_CHUNK = 4 * 1024 * 1024;
const RECOVERY_ITERATIONS = 100_000; // recovery key already has 128 bits of entropy

interface Wrap {
  salt: string;
  iter: number;
  iv: string;
  ct: string;
}
interface Blob {
  v: 2;
  pw: Wrap;
  rec: Wrap;
  iv: string;
  ct: string;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function kek(secret: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrapDek(dek: Uint8Array<ArrayBuffer>, secret: string, iter: number): Promise<Wrap> {
  const salt = rand(16);
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_WRAP }, await kek(secret, salt, iter), dek));
  return { salt: b64(salt), iter, iv: b64(iv), ct: b64(ct) };
}

async function unwrapDek(w: Wrap, secret: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!(w.iter >= 1000 && w.iter <= 5_000_000)) throw new Error('Invalid vault parameters');
  try {
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv), additionalData: AAD_WRAP }, await kek(secret, unb64(w.salt), w.iter), unb64(w.ct));
    return new Uint8Array(raw);
  } catch {
    throw new Error('Wrong password or recovery key');
  }
}

const dataKey = (dek: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt', 'decrypt']);

// --- recovery key: 128 random bits, Crockford base32, grouped for humans -------------------
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryKey(): string {
  const bytes = rand(16);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  bits = bits.padEnd(130, '0');
  let out = '';
  for (let i = 0; i < 130; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{1,4}/g)!.join('-');
}

export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
}

export interface BlobStorage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

export class Vault implements KeyValueStore {
  #dek: Uint8Array<ArrayBuffer>;
  #data: Record<string, unknown>;
  #storage: BlobStorage;
  #pw: Wrap;
  #rec: Wrap;

  private constructor(dek: Uint8Array<ArrayBuffer>, data: Record<string, unknown>, storage: BlobStorage, pw: Wrap, rec: Wrap) {
    this.#dek = dek;
    this.#data = data;
    this.#storage = storage;
    this.#pw = pw;
    this.#rec = rec;
  }

  static async exists(storage: BlobStorage): Promise<boolean> {
    return (await storage.read()) !== null;
  }

  /** Creates a new vault. The returned recovery key is shown ONCE; it is never stored in plain text. */
  static async create(password: string, storage: BlobStorage, iter = DEFAULT_ITERATIONS): Promise<{ vault: Vault; recoveryKey: string }> {
    if (await Vault.exists(storage)) throw new Error('A vault already exists');
    const dek = rand(32);
    const recoveryKey = generateRecoveryKey();
    const vault = new Vault(dek, {}, storage, await wrapDek(dek, password, iter), await wrapDek(dek, normalizeRecoveryKey(recoveryKey), RECOVERY_ITERATIONS));
    await vault.save();
    return { vault, recoveryKey };
  }

  private static async load(storage: BlobStorage, secret: string, via: 'pw' | 'rec'): Promise<Vault> {
    const text = await storage.read();
    if (text === null) throw new Error('No vault found');
    const blob = JSON.parse(text) as Blob;
    if (blob.v !== 2) throw new Error('Unsupported vault format');
    const dek = await unwrapDek(via === 'pw' ? blob.pw : blob.rec, secret);
    let data: Record<string, unknown>;
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: AAD_DATA }, await dataKey(dek), unb64(blob.ct));
      data = JSON.parse(dec.decode(pt));
    } catch {
      throw new Error('Vault data is corrupted');
    }
    return new Vault(dek, data, storage, blob.pw, blob.rec);
  }

  static open(password: string, storage: BlobStorage): Promise<Vault> {
    return Vault.load(storage, password, 'pw');
  }

  static openWithRecovery(recoveryKey: string, storage: BlobStorage): Promise<Vault> {
    return Vault.load(storage, normalizeRecoveryKey(recoveryKey), 'rec');
  }

  get<T>(key: string): T | undefined {
    return this.#data[key] as T | undefined;
  }
  set(key: string, value: unknown): void {
    this.#data[key] = value;
  }
  delete(key: string): void {
    delete this.#data[key];
  }

  async save(): Promise<void> {
    const iv = rand(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD_DATA }, await dataKey(this.#dek), enc.encode(JSON.stringify(this.#data))));
    const blob: Blob = { v: 2, pw: this.#pw, rec: this.#rec, iv: b64(iv), ct: b64(ct) };
    await this.#storage.write(JSON.stringify(blob));
  }

  /**
   * Encrypts arbitrary bytes (e.g. a review copy of an audio file) with the vault's data key, in 4 MB chunks.
   * Each chunk is bound to its position and to "is last", so reordering or truncating is detected.
   */
  async sealBytes(data: Uint8Array): Promise<Uint8Array> {
    const key = await dataKey(this.#dek);
    const out: Uint8Array[] = [enc.encode('CHPA1')];
    for (let off = 0, n = 0; off < data.length || n === 0; off += AUDIO_CHUNK, n++) {
      const iv = rand(12);
      const last = off + AUDIO_CHUNK >= data.length ? 1 : 0;
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`chp-audio|${n}|${last}`) }, key, new Uint8Array(data.subarray(off, off + AUDIO_CHUNK))));
      const len = new Uint8Array(4);
      new DataView(len.buffer).setUint32(0, ct.length, true);
      out.push(iv, len, ct);
    }
    return Buffer.concat(out);
  }

  async openBytes(sealed: Uint8Array): Promise<Uint8Array> {
    const b = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
    if (b.subarray(0, 5).toString('ascii') !== 'CHPA1') throw new Error('Not an encrypted audio file');
    const key = await dataKey(this.#dek);
    const out: Uint8Array[] = [];
    let off = 5;
    for (let n = 0; off < b.length; n++) {
      const iv = new Uint8Array(b.subarray(off, off + 12));
      const len = b.readUInt32LE(off + 12);
      const ct = new Uint8Array(b.subarray(off + 16, off + 16 + len));
      if (ct.length !== len) throw new Error('Encrypted audio is truncated');
      off += 16 + len;
      const last = off >= b.length ? 1 : 0;
      try {
        out.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`chp-audio|${n}|${last}`) }, key, ct)));
      } catch {
        throw new Error('Encrypted audio is corrupted or incomplete');
      }
    }
    return Buffer.concat(out);
  }

  /** Works after opening with either the password or the recovery key. */
  async changePassword(newPassword: string, iter = DEFAULT_ITERATIONS): Promise<void> {
    this.#pw = await wrapDek(this.#dek, newPassword, iter);
    await this.save();
  }

  /** Issues a fresh recovery key and invalidates the old one. Show it once. */
  async rotateRecoveryKey(): Promise<string> {
    const recoveryKey = generateRecoveryKey();
    this.#rec = await wrapDek(this.#dek, normalizeRecoveryKey(recoveryKey), RECOVERY_ITERATIONS);
    await this.save();
    return recoveryKey;
  }
}
