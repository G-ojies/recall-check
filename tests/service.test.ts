import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError, findItem } from '../src/service.ts';
import { sayCheck } from '../src/speech.ts';
import { app } from './helpers.ts';

test('add: a recalled item is reported at once', async () => {
  const { service } = app();
  const r = await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'air fryer', model: 'AF100' });
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].confidence, 'confirmed');
});

test('add: the same item twice is kept once', async () => {
  const { service } = app();
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'Air Fryers' });
  const again = await service.addItem('u', { kind: 'product', brand: 'acme', name: 'air fryer' });
  assert.equal(again.duplicate, true);
  assert.equal((await service.listItems('u')).length, 1);
});

test('add: brand and name are both required, and a vehicle needs its year', async () => {
  const { service } = app();
  await assert.rejects(service.addItem('u', { kind: 'product', brand: '  ', name: 'stroller' }), UserError);
  await assert.rejects(service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic' }), UserError);
});

test('households are separate', async () => {
  const { service } = app();
  await service.addItem('alice', { kind: 'product', brand: 'Acme', name: 'stroller' });
  assert.equal((await service.listItems('bob')).length, 0);
  assert.equal((await service.checkAll('bob')).matches.length, 0);
});

test('check: a recall is new once, then known', async () => {
  const { service, index } = app({ recalls: [] });
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'stroller' });
  assert.equal((await service.checkAll('u')).matches.length, 0);
  const { RECALLS } = await import('./helpers.ts');
  index.load(RECALLS); // the agency publishes a recall
  const first = await service.checkAll('u');
  assert.equal(first.fresh.size, 1);
  assert.match(sayCheck(first.matches, first.items.length, first.fresh), /^I found 1 new recall/);
  const second = await service.checkAll('u');
  assert.equal(second.matches.length, 1);
  assert.equal(second.fresh.size, 0);
  assert.match(sayCheck(second.matches, second.items.length, second.fresh), /^Nothing new/);
});

test('handled: a recall the owner dealt with is not reported again', async () => {
  const { service } = app();
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'air fryer' });
  const done = await service.markHandled('u', 'the air fryer');
  assert.equal(done!.handled.length, 1);
  assert.equal((await service.checkAll('u')).matches.length, 0);
});

test('vehicle: looked up when added, answered from the copy afterwards', async () => {
  let calls = 0;
  const { service } = app({ vehicle: async () => { calls += 1; const { CIVIC_RECALL } = await import('./helpers.ts'); return [CIVIC_RECALL]; } });
  const added = await service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 });
  assert.equal(added.matches.length, 1);
  assert.equal(added.matches[0].confidence, 'likely');
  const check = await service.checkAll('u');
  assert.equal(check.matches.length, 1);
  assert.equal(calls, 1, 'checking must not call NHTSA');
  assert.equal(check.stale.length, 0);
});

test('vehicle: a copy older than a day is flagged for refresh, and the answer still comes from the copy', async () => {
  let now = new Date('2026-09-28T10:00:00Z');
  const { service } = app({ now: () => now });
  await service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 });
  now = new Date('2026-09-30T10:00:00Z');
  const check = await service.checkAll('u');
  assert.equal(check.stale.length, 1);
  assert.equal(check.matches.length, 1);
});

test('vehicle: the agency being down does not fail the add', async () => {
  const { service } = app({ vehicle: async () => { throw new Error('NHTSA 503'); } });
  const r = await service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 });
  assert.equal(r.vehicleChecked, false);
  assert.equal((await service.listItems('u')).length, 1);
});

test('vehicle: a slow agency does not hold up the answer, and the recalls arrive afterwards', async () => {
  const { CIVIC_RECALL } = await import('./helpers.ts');
  const { service } = app({ vehicle: () => new Promise((r) => setTimeout(() => r([CIVIC_RECALL]), 120)) });
  const t0 = performance.now();
  const r = await service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 }, 30);
  assert.ok(performance.now() - t0 < 100, 'answered inside the budget');
  assert.equal(r.vehicleChecked, false);
  assert.equal((await service.listItems('u')).length, 1, 'the item is saved before the lookup ends');
  await r.pending;
  const check = await service.checkAll('u');
  assert.equal(check.matches.length, 1);
  assert.equal(check.fresh.size, 1, 'the owner has not heard about it yet, so it is new');
});

test('vehicle: removing it while the lookup runs does not bring it back', async () => {
  const { CIVIC_RECALL } = await import('./helpers.ts');
  const { service, store } = app({ vehicle: () => new Promise((r) => setTimeout(() => r([CIVIC_RECALL]), 60)) });
  const r = await service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 }, 10);
  await service.removeItem('u', 'Civic');
  await r.pending;
  const h = await store.get('u');
  assert.equal(h.items.length, 0);
  assert.deepEqual(h.vehicleRecalls, {});
});

test('remove: by the words a person would use', async () => {
  const { service } = app();
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'stroller' });
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'air fryer' });
  assert.equal((await service.removeItem('u', 'the stroller'))?.name, 'stroller');
  assert.equal(await service.removeItem('u', 'the toaster'), null);
  assert.equal((await service.listItems('u')).length, 1);
});

test('findItem: refuses to guess between two equally good candidates', async () => {
  const { service } = app();
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'stroller' });
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'air fryer' });
  assert.equal(findItem(await service.listItems('u'), 'the Acme'), null);
});

test('vehicle: "no recalls" is never said about a vehicle that has not been checked', async () => {
  const { service } = app({ vehicle: async () => { throw new Error('NHTSA 503'); } });
  await service.addItem('u', { kind: 'product', brand: 'Acme', name: 'stroller' }); // has a recall
  await service.markHandled('u', 'stroller');
  await service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 });
  const check = await service.checkAll('u');
  assert.deepEqual(check.unchecked.map((i) => i.name), ['Civic']);
  const said = sayCheck(check.matches, check.items.length, check.fresh, check.unchecked);
  assert.equal(said, 'I checked 1 item and found no recalls so far. I am still checking your 2020 Honda Civic. Ask me again in a moment.');
  assert.doesNotMatch(said, /Good news/);

  const only = app({ vehicle: async () => { throw new Error('NHTSA 503'); } });
  await only.service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 });
  const alone = await only.service.checkAll('u');
  assert.match(sayCheck(alone.matches, alone.items.length, alone.fresh, alone.unchecked), /^Nothing to report yet\. I am still checking your 2020 Honda Civic\./);
});

test('vehicle: once the agency has answered, an empty answer is a real "no recalls"', async () => {
  const { service } = app({ vehicle: async () => [] });
  await service.addItem('u', { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 });
  const check = await service.checkAll('u');
  assert.equal(check.unchecked.length, 0);
  assert.match(sayCheck(check.matches, check.items.length, check.fresh, check.unchecked), /^Good news\. I checked 1 item and found no recalls\.$/);
});
