import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sayCheck, sayItemMatches, sayMatch, sayWhatToDo, words } from '../src/speech.ts';
import { CIVIC_RECALL } from './helpers.ts';
import type { Match } from '../src/types.ts';
import { RECALLS } from './helpers.ts';

const item = { id: 'i1', kind: 'product' as const, brand: 'Acme', name: 'air fryer', addedAt: '' };
const m = (confidence: Match['confidence'], n = 0): Match => ({ item: { ...item, id: `i${n}` }, recall: { ...RECALLS[0], id: `cpsc:${n}` }, confidence, why: '' });

test('speech: nothing read aloud contains a web address or a recall number', () => {
  const all = [sayMatch(m('confirmed')), sayWhatToDo(RECALLS[0], item), sayCheck([m('likely')], 1, new Set(['i0|cpsc:0']))].join(' ');
  assert.doesNotMatch(all, /https?:|www\.|cpsc:/i);
});

test('speech: certainty follows confidence', () => {
  assert.match(sayMatch(m('confirmed')), /^Your Acme air fryer is recalled\./);
  assert.match(sayMatch(m('likely')), /probably affected/);
  assert.match(sayMatch(m('possible')), /may cover/);
});

test('speech: an urgent recall says to stop using it', () => {
  assert.match(sayMatch(m('confirmed')), /Stop using it now\./);
  assert.match(sayWhatToDo(RECALLS[0], item), /^Stop using your Acme air fryer now\./);
});

test('speech: several recalls on one item are said as one thought', () => {
  const said = sayItemMatches([m('likely', 1), { ...m('likely', 1), recall: { ...RECALLS[0], id: 'cpsc:9' } }]);
  assert.match(said, /^Your Acme air fryer is probably affected by 2 recalls\. Stop using it now\./);
});

test('speech: a vehicle names the part, not the list of every model covered', () => {
  const car = { id: 'c1', kind: 'vehicle' as const, brand: 'Honda', name: 'Civic', year: 2020, addedAt: '' };
  const said = sayMatch({ item: car, recall: { ...CIVIC_RECALL, part: 'fuel pump' }, confidence: 'likely', why: '' });
  assert.match(said, /^Your 2020 Honda Civic has a recall on the fuel pump, from March 2021\. The fuel pump may fail\./);
  assert.match(sayWhatToDo({ ...CIVIC_RECALL, urgent: true }, car), /^Do not drive your 2020 Honda Civic until it is fixed\./);
});

test('speech: an answer takes under thirty seconds to say, however many recalls there are', () => {
  const long = 'The lithium-ion battery inside the unit can overheat during charging or normal use, which poses fire and burn hazards to anyone nearby and to property.';
  const many = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ ...m('likely', n), recall: { ...RECALLS[0], id: `cpsc:${n}`, hazard: long } }));
  const said = sayCheck(many, 7, new Set(many.map((x) => `${x.item.id}|${x.recall.id}`)));
  assert.ok(words(said) <= 75, `${words(said)} words`);
  assert.match(said, /more items are affected\. The full list is in the Alexa app\./);
  assert.doesNotMatch(said, /go on/);
});

test('speech: the remedy is the sentence that says what to do', () => {
  const r = { ...RECALLS[0], remedy: 'Children can be pulled under the machine. Consumers should stop using it and contact Acme for a full refund.' };
  assert.match(sayWhatToDo(r, item), /now\. Consumers should stop using it and contact Acme for a full refund\./);
});

test('speech: with no remedy text, the options on offer are still said', () => {
  assert.match(sayWhatToDo({ ...RECALLS[0], remedy: '', remedyOptions: ['Refund', 'Repair'] }, item), /Contact the company to arrange a refund or free repair\./);
});

test('speech: remedies are said as things a person can ask for', () => {
  assert.match(sayWhatToDo(RECALLS[0], item), /The remedy on offer is a replacement\./);
  assert.match(sayWhatToDo({ ...RECALLS[0], remedyOptions: ['Refund', 'Repair'] }, item), /a refund or free repair\./);
});

test('speech: empty list and clean result', () => {
  assert.match(sayCheck([], 0, new Set()), /have not told me/);
  assert.match(sayCheck([], 3, new Set()), /checked 3 items and found no recalls/);
});

