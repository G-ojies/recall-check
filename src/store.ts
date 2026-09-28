/** Household storage. One JSON file per household on disk, or memory only when no directory is given (tests). */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Household } from './types.ts';

export const emptyHousehold = (): Household => ({ items: [], handled: {}, seen: {}, vehicleRecalls: {} });

export interface Store {
  get(userId: string): Promise<Household>;
  put(userId: string, h: Household): Promise<void>;
}

export class MemoryStore implements Store {
  private m = new Map<string, string>();
  async get(userId: string) { const s = this.m.get(userId); return s ? (JSON.parse(s) as Household) : emptyHousehold(); }
  async put(userId: string, h: Household) { this.m.set(userId, JSON.stringify(h)); }
}

export class FileStore implements Store {
  constructor(private dir: string) {}
  /** the user id comes from a token, so it is hashed before it becomes a file name */
  private path(userId: string) { return join(this.dir, `${createHash('sha256').update(userId).digest('hex').slice(0, 32)}.json`); }
  async get(userId: string) {
    try { return { ...emptyHousehold(), ...(JSON.parse(await readFile(this.path(userId), 'utf8')) as Household) }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyHousehold(); throw e; }
  }
  async put(userId: string, h: Household) {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path(userId)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(h));
    await rename(tmp, this.path(userId)); // a crash mid-write leaves the old file intact
  }
}
