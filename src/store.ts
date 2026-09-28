/**
 * Storage. Households and accounts are small JSON values under string keys, kept in one of three places:
 * memory (tests), one file per key on disk (a single instance), or Redis over REST (any number of instances).
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { Household } from './types.ts';

export const emptyHousehold = (): Household => ({ items: [], handled: {}, seen: {}, vehicleRecalls: {} });

export interface Store {
  get(userId: string): Promise<Household>;
  put(userId: string, h: Household): Promise<void>;
}

/** Plain values under a key, for accounts and refresh tokens. `ttlSeconds` is honoured where the backend can. */
export interface KV {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, ttlSeconds?: number): Promise<void>;
  remove(key: string): Promise<void>;
}

abstract class KeyedStore implements Store, KV {
  abstract read(key: string): Promise<string | null>;
  abstract write(key: string, value: string, ttlSeconds?: number): Promise<void>;
  abstract remove(key: string): Promise<void>;
  async get(userId: string) { const s = await this.read(`household:${userId}`); return s ? { ...emptyHousehold(), ...(JSON.parse(s) as Household) } : emptyHousehold(); }
  async put(userId: string, h: Household) { await this.write(`household:${userId}`, JSON.stringify(h)); }
}

export class MemoryStore extends KeyedStore {
  private m = new Map<string, { value: string; until: number }>();
  constructor(private now: () => number = Date.now) { super(); }
  async read(key: string) { const e = this.m.get(key); if (e && e.until < this.now()) { this.m.delete(key); return null; } return e?.value ?? null; }
  async write(key: string, value: string, ttlSeconds?: number) { this.m.set(key, { value, until: ttlSeconds ? this.now() + ttlSeconds * 1000 : Infinity }); }
  async remove(key: string) { this.m.delete(key); }
}

export class FileStore extends KeyedStore {
  constructor(private dir: string) { super(); }
  /** keys come from tokens and email addresses, so they are hashed before they become file names */
  private path(key: string) { return join(this.dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`); }
  async read(key: string) {
    let raw: string;
    try { raw = await readFile(this.path(key), 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    const { value, until } = JSON.parse(raw) as { value: string; until?: number };
    if (until && until < Date.now()) { await this.remove(key); return null; }
    return value;
  }
  async write(key: string, value: string, ttlSeconds?: number) {
    await mkdir(this.dir, { recursive: true });
    // two writes to one key can overlap (an answer, and a vehicle lookup finishing behind it), so each has its own file
    const tmp = `${this.path(key)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify({ value, ...(ttlSeconds ? { until: Date.now() + ttlSeconds * 1000 } : {}) }));
    await rename(tmp, this.path(key)); // a crash mid-write leaves the old file intact
  }
  async remove(key: string) { await unlink(this.path(key)).catch((e) => { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }); }
}

/** Redis through the Upstash REST API: one HTTPS request per command, no connection to keep open. */
export class RedisStore extends KeyedStore {
  constructor(private url: string, private token: string, private prefix = 'rc:', private fetcher: typeof fetch = fetch) { super(); }
  private async run(command: (string | number)[]): Promise<unknown> {
    const res = await this.fetcher(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(4000) });
    const body = (await res.json()) as { result?: unknown; error?: string };
    if (!res.ok || body.error) throw new Error(`redis: ${body.error ?? res.status}`);
    return body.result;
  }
  async read(key: string) { return ((await this.run(['GET', this.prefix + key])) as string | null) ?? null; }
  async write(key: string, value: string, ttlSeconds?: number) { await this.run(ttlSeconds ? ['SET', this.prefix + key, value, 'EX', Math.ceil(ttlSeconds)] : ['SET', this.prefix + key, value]); }
  async remove(key: string) { await this.run(['DEL', this.prefix + key]); }
}

/** Redis when its address is configured, files otherwise. */
export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): KeyedStore & { kind: string } {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return Object.assign(new RedisStore(url, token), { kind: 'redis' });
  return Object.assign(new FileStore(env.HOUSEHOLD_DIR ?? 'data/households'), { kind: 'file' });
}
