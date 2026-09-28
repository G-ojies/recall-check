import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelsIn, normModel, tokens } from '../src/text.ts';
import { RecallIndex } from '../src/match.ts';
import type { Item, Kind } from '../src/types.ts';
import { RECALLS } from './helpers.ts';

const ix = new RecallIndex(RECALLS);
const own = (brand: string, name: string, model?: string, kind: Kind = 'product'): Item => ({ id: 'i1', kind, brand, name, model, addedAt: '' });
const ids = (i: Item) => ix.matchItem(i).map((m) => `${m.recall.id}:${m.confidence}`);

test('text: plurals, case and punctuation do not matter', () => {
  assert.deepEqual(tokens('Air Fryers'), tokens('air fryer'));
  assert.deepEqual(tokens("Rock 'n Play"), tokens('rock n play'));
  assert.deepEqual(tokens('Fisher-Price'), ['fisher', 'price']);
});

test('text: model numbers compare without dashes, spaces or case', () => {
  assert.equal(normModel('yd-001'), normModel('YD 001'));
  assert.deepEqual(modelsIn('Model No.: YD-001 and CP158-AF, made in 2023'), ['YD001', 'CP158AF']);
});

test('match: brand and product, no model given, is likely', () => {
  assert.deepEqual(ids(own('Acme', 'air fryer')), ['cpsc:1:likely']);
});

test('match: a model number named by the recall is confirmed', () => {
  assert.deepEqual(ids(own('Acme', 'air fryer', 'af-100')), ['cpsc:1:confirmed']);
});

test('match: a model number the recall does not list is only possible', () => {
  assert.deepEqual(ids(own('Acme', 'air fryer', 'AF999')), ['cpsc:1:possible']);
});

test('match: the brand alone is never enough', () => {
  assert.deepEqual(ids(own('Acme', 'blender')), []);
});

test('match: the product alone is never enough', () => {
  assert.deepEqual(ids(own('Globex', 'air fryer')), []);
});

test('match: a brand mentioned only in the description is not the maker', () => {
  // the Zenith heater recall mentions an Acme power cord
  assert.deepEqual(ids(own('Acme', 'space heater')), []);
});

test('match: food is not matched against product recalls and the reverse', () => {
  assert.deepEqual(ids(own('Good Farms', 'spinach', undefined, 'food')), ['fda:F-1:likely']);
  assert.deepEqual(ids(own('Good Farms', 'spinach', undefined, 'product')), []);
});

test('match: an item with no usable words matches nothing', () => {
  assert.deepEqual(ids(own('the', 'product')), []);
});

test('match: a recall listed twice is indexed once', () => {
  assert.equal(new RecallIndex([...RECALLS, ...RECALLS]).size, RECALLS.length);
});

test('search: finds by words, newest first on a tie', () => {
  assert.deepEqual(ix.search('Acme stroller').map((r) => r.id)[0], 'cpsc:2');
  assert.deepEqual(ix.search('nothing like this exists'), []);
});

test('knowsBrand: a word from the headline is not taken for part of the maker', () => {
  const r = (id: string, brandText: string) => ({ ...RECALLS[0], id, brandText, productText: 'thing' });
  const data = new RecallIndex([
    r('a', 'Cosori Air Fryers Recalled by Atekcity'), r('b', 'Ninja Air Fryers Recalled'), r('c', 'Acme Air Purifiers Recalled'), r('d', 'Zenith Air Conditioners Recalled'),
    r('e', 'Fisher-Price Recalls Sleepers'), r('f', 'Fisher-Price Recalls Soothers'), r('g', 'Best Price Mattress Recalls Beds'),
  ]);
  assert.equal(data.knowsBrand('Cosori'), true);
  assert.equal(data.knowsBrand('Cosori air'), false, '"air" is used by many makers, so it starts the product name');
  assert.equal(data.knowsBrand('Fisher Price'), true, '"price" is mostly Fisher-Price, so it ends the maker name');
  assert.equal(data.knowsBrand('Nobody Known'), false);
});
