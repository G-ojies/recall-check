import { readSnapshot } from '../src/data.ts';
import { RecallIndex } from '../src/match.ts';
import type { Item, Kind } from '../src/types.ts';
const s = await readSnapshot('data/recalls.json.gz');
const t0 = performance.now(); const ix = new RecallIndex(s!.recalls); console.log('index', ix.size, 'built in', (performance.now() - t0).toFixed(0), 'ms');
const it = (kind: Kind, brand: string, name: string, model?: string): Item => ({ id: 'x', kind, brand, name, model, addedAt: '' });
const probes: Item[] = [
  it('product', 'Fisher-Price', 'Rock n Play sleeper'), it('product', 'Peloton', 'treadmill'), it('product', 'Peloton', 'bike'),
  it('product', 'Ninja', 'air fryer'), it('product', 'Cosori', 'air fryer'), it('product', 'Cosori', 'air fryer', 'CP158-AF'),
  it('product', 'Cosori', 'air fryer', 'ZZ999-XX'), it('product', 'IKEA', 'dresser'), it('product', 'Graco', 'stroller'),
  it('product', 'Apple', 'laptop'), it('product', 'Samsung', 'phone'), it('product', 'Onewheel', 'skateboard'),
  it('product', 'Boppy', 'lounger'), it('product', 'Anker', 'power bank'), it('product', 'Lego', 'bricks'),
  it('food', 'Boars Head', 'liverwurst'), it('food', 'Jif', 'peanut butter'), it('medicine', 'Tylenol', 'acetaminophen'),
];
for (const p of probes) {
  const t = performance.now(); const m = ix.matchItem(p); const ms = (performance.now() - t).toFixed(2);
  console.log(`\n${p.kind} | ${p.brand} ${p.name} ${p.model ?? ''} -> ${m.length} (${ms} ms)`);
  for (const x of m.slice(0, 4)) console.log(`   [${x.confidence}] ${x.recall.date} ${x.recall.title.slice(0, 110)}`);
}
console.log('\nsearch:', ix.search('Fisher-Price Rock n Play').map((r) => r.title.slice(0, 80)));
