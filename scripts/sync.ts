/** Download the recall data and write data/recalls.json.gz. Run at build time and on a schedule. */
import { buildSnapshot, readSnapshot, writeSnapshot } from '../src/data.ts';

const path = process.env.RECALL_DATA ?? 'data/recalls.json.gz';
const since = process.env.RECALL_SINCE ?? `${new Date().getUTCFullYear() - 10}-01-01`;
const t0 = Date.now();
const snap = await buildSnapshot(since, await readSnapshot(path));
for (const [k, v] of Object.entries(snap.counts)) console.log(`${k.padEnd(10)} ${v}`);
for (const e of snap.errors) console.error(`failed: ${e}`);
if (!snap.recalls.length) { console.error('no recalls fetched; keeping the previous file'); process.exit(1); }
await writeSnapshot(path, snap);
console.log(`wrote ${snap.recalls.length} recalls to ${path} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
