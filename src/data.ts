/** Loading and refreshing the recall index. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Recall } from './types.ts';
import { fetchCpsc } from './sources/cpsc.ts';
import { fetchFda } from './sources/fda.ts';

/** Government endpoints drop connections now and then; one more try after a pause clears most of it. */
async function retry<T>(job: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await job(); }
    catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
}

export interface Snapshot { builtAt: string; since: string; counts: Record<string, number>; errors: string[]; recalls: Recall[] }

export async function readSnapshot(path: string): Promise<Snapshot | null> {
  try { return JSON.parse(gunzipSync(await readFile(path)).toString('utf8')) as Snapshot; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}

export async function writeSnapshot(path: string, s: Snapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, gzipSync(JSON.stringify(s)));
  await rename(`${path}.tmp`, path);
}

/**
 * Pull every source. A source that fails is reported and its rows are carried over from the previous
 * snapshot, so one agency being down never empties the index.
 */
export async function buildSnapshot(since: string, previous: Snapshot | null, timeoutMs = 120_000): Promise<Snapshot> {
  const jobs: [string, () => Promise<Recall[]>][] = [
    ['CPSC', () => fetchCpsc(since, AbortSignal.timeout(timeoutMs))],
    ['FDA food', () => fetchFda('food', since, AbortSignal.timeout(timeoutMs))],
    ['FDA drug', () => fetchFda('drug', since, AbortSignal.timeout(timeoutMs))],
  ];
  const kept = (name: string) => (previous?.recalls ?? []).filter((r) => (name === 'CPSC' ? r.source === 'CPSC' : r.source === 'FDA' && r.kind === (name === 'FDA food' ? 'food' : 'medicine')));
  const recalls: Recall[] = [], counts: Record<string, number> = {}, errors: string[] = [];
  await Promise.all(jobs.map(async ([name, job]) => {
    let rows: Recall[];
    try { rows = await retry(job); if (!rows.length) throw new Error('returned no rows'); }
    catch (e) { errors.push(`${name}: ${(e as Error).message}`); rows = kept(name); }
    counts[name] = rows.length; recalls.push(...rows);
  }));
  return { builtAt: new Date().toISOString(), since, counts, errors, recalls };
}
