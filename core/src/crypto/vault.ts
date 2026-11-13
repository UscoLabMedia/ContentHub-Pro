// Encrypted vault: PBKDF2-SHA256 -> AES-256-GCM via Web Crypto (Node >=20 and browsers).
// The password lives only in memory (#password); the blob on disk is useless without it.

const enc = new TextEncoder();
const dec = new TextDecoder();
const VERSION = 1;
export const DEFAULT_ITERATIONS = 600_000;

interface Blob {
  v: number;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(data: unknown, password: string, iter = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iter);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(`chp-v${VERSION}`) },
      key,
      enc.encode(JSON.stringify(data)),
    ),
  );
  const blob: Blob = { v: VERSION, kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  return JSON.stringify(blob);
}

export async function decryptJson<T = unknown>(blobText: string, password: string): Promise<T> {
  const blob = JSON.parse(blobText) as Blob;
  if (blob.v !== VERSION || blob.kdf !== 'PBKDF2-SHA256') throw new Error('Unsupported vault format');
  if (!(blob.iter >= 1000 && blob.iter <= 5_000_000)) throw new Error('Invalid vault parameters');
  const key = await deriveKey(password, unb64(blob.salt), blob.iter);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(blob.iv), additionalData: enc.encode(`chp-v${VERSION}`) },
      key,
      unb64(blob.ct),
    );
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    throw new Error('Wrong password or corrupted vault');
  }
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

/** In-memory key/value map persisted as a single encrypted blob. */
export class Vault implements KeyValueStore {
  #password: string;
  #data: Record<string, unknown>;
  #storage: BlobStorage;
  #iter: number;

  private constructor(password: string, data: Record<string, unknown>, storage: BlobStorage, iter: number) {
    this.#password = password;
    this.#data = data;
    this.#storage = storage;
    this.#iter = iter;
  }

  static async open(password: string, storage: BlobStorage, iter = DEFAULT_ITERATIONS): Promise<Vault> {
    const text = await storage.read();
    if (text === null) {
      const v = new Vault(password, {}, storage, iter);
      await v.save();
      return v;
    }
    return new Vault(password, await decryptJson<Record<string, unknown>>(text, password), storage, iter);
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
    await this.#storage.write(await encryptJson(this.#data, this.#password, this.#iter));
  }
}
