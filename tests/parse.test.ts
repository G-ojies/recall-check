import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseThing, understand, type Intent, type Memory } from '../src/host/parse.ts';

const known = new Set(['fisher price', 'fisher-price', 'black decker']);
const knows = (w: string) => known.has(w.toLowerCase());
const hear = (u: string, mem: Memory = {}) => understand(u, mem, knows);
const tool = (i: Intent) => ('tool' in i ? i : assert.fail(`expected a tool call, got ${JSON.stringify(i)}`));

test('parseThing: brand, name, model and year are pulled apart', () => {
  assert.deepEqual(parseThing('my Cosori air fryer model CP158-AF', knows), { kind: 'product', brand: 'Cosori', name: 'air fryer', model: 'CP158-AF', year: undefined });
  assert.deepEqual(parseThing('a 2020 Honda Civic', knows), { kind: 'vehicle', brand: 'Honda', name: 'Civic', model: undefined, year: 2020 });
  assert.deepEqual(parseThing('2019 Land Rover Discovery', knows), { kind: 'vehicle', brand: 'Land Rover', name: 'Discovery', model: undefined, year: 2019 });
});

test('parseThing: a two-word brand is kept whole when the recall data knows it', () => {
  const t = parseThing('Fisher-Price rock n play sleeper', knows);
  assert.equal(t.brand, 'Fisher-Price');
  assert.equal(parseThing('Fisher Price rock n play', knows).brand, 'Fisher Price');
  assert.equal(parseThing('Graco modes stroller', knows).brand, 'Graco');
});

test('parseThing: food and medicine are recognised from what they are', () => {
  assert.equal(parseThing('Good Farms organic spinach', knows).kind, 'food');
  assert.equal(parseThing('Tylenol extra strength caplets', knows).kind, 'medicine');
});

test('understand: ways of adding', () => {
  assert.deepEqual(tool(hear('Alexa, add my Graco stroller')).args, { kind: 'product', brand: 'Graco', name: 'stroller' });
  assert.deepEqual(tool(hear('I drive a 2020 Honda Civic')).args, { kind: 'vehicle', brand: 'Honda', name: 'Civic', year: 2020 });
  assert.deepEqual(tool(hear('we just bought a Ninja blender, model BL610')).args, { kind: 'product', brand: 'Ninja', name: 'blender', model: 'BL610' });
  assert.equal((tool(hear('add my Peloton treadmill to my list please')).args as { name: string }).name, 'treadmill');
});

test('understand: checking, listing, looking up', () => {
  for (const u of ['is anything I own recalled?', 'any new recalls', 'check my stuff', 'Is any of my stuff under recall']) assert.equal(tool(hear(u)).tool, 'check_my_items', u);
  for (const u of ['what are you watching', "what's on my list", 'show me my things']) assert.equal(tool(hear(u)).tool, 'list_items', u);
  assert.deepEqual(tool(hear('is the Fisher-Price Rock n Play recalled?')), { tool: 'search_recalls', args: { query: 'Fisher-Price Rock n Play' } });
  assert.deepEqual(tool(hear('any recalls on Boppy loungers')), { tool: 'search_recalls', args: { query: 'Boppy loungers' } });
});

test('understand: "it" means the item the conversation is about', () => {
  assert.deepEqual(tool(hear('what should I do about it', { lastItem: 'abc12345' })), { tool: 'get_recall_guidance', args: { item: 'abc12345' } });
  assert.deepEqual(tool(hear('what should I do about the stroller', { lastItem: 'abc12345' })), { tool: 'get_recall_guidance', args: { item: 'stroller' } });
  assert.deepEqual(tool(hear('I got the refund', { lastItem: 'abc12345' })), { tool: 'mark_recall_handled', args: { item: 'abc12345' } });
  assert.ok('ask' in hear('what should I do'));
});

test('understand: removal is asked first, and only a yes confirms it', () => {
  assert.deepEqual(tool(hear('stop watching the stroller')), { tool: 'remove_item', args: { item: 'stroller', confirmed: false } });
  assert.deepEqual(tool(hear('yes please', { pendingRemove: 'abc12345' })), { tool: 'remove_item', args: { item: 'abc12345', confirmed: true } });
  assert.ok('say' in hear('no, keep it', { pendingRemove: 'abc12345' }));
  assert.ok(!('tool' in hear('yes')), 'a yes with nothing pending removes nothing');
});

test('understand: an item without a brand prompts for it, and the answer completes the add', () => {
  const first = hear('add my stroller');
  assert.ok('ask' in first && first.remember);
  assert.match((first as { ask: string }).ask, /What brand is the stroller/);
  assert.deepEqual(tool(hear("it's Graco", { pendingAdd: (first as any).remember })).args, { name: 'stroller', kind: 'product', model: undefined, year: undefined, brand: 'Graco' });
});

test('understand: anything else gets a useful nudge, never a tool call', () => {
  for (const u of ['what is the weather', 'play some jazz', '']) assert.ok('say' in hear(u), u);
});
