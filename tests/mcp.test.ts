/** The tools, called the way a host calls them: through an MCP client over a linked transport. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, toKind } from '../src/mcp.ts';
import { app } from './helpers.ts';

async function connect(userId = 'u', made = app()) {
  const server = buildServer(made.service, userId);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { said: (r.content as { text: string }[])[0].text, data: r.structuredContent as Record<string, any>, isError: Boolean(r.isError) };
  };
  return { client, call, made };
}

test('tools: seven, each with a description, an input schema and an output schema', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['add_item', 'check_my_items', 'get_recall_guidance', 'list_items', 'mark_recall_handled', 'remove_item', 'search_recalls']);
  for (const t of tools) {
    assert.ok((t.description ?? '').length > 40, `${t.name} needs a description that says when to call it`);
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.outputSchema, `${t.name} declares what it returns`);
  }
  assert.equal(tools.find((t) => t.name === 'remove_item')!.annotations?.destructiveHint, true);
  assert.equal(tools.find((t) => t.name === 'check_my_items')!.annotations?.readOnlyHint, true);
});

test('a whole conversation: add, hear the recall, ask what to do, mark it done', async () => {
  const { call } = await connect();
  const added = await call('add_item', { kind: 'appliance', brand: 'Acme', name: 'air fryer', model: 'AF-100' });
  assert.match(added.said, /^Added your Acme air fryer, model AF-100\. Your Acme air fryer is recalled\. Stop using it now\./);
  assert.equal(added.data.matches[0].confidence, 'confirmed');

  const what = await call('get_recall_guidance', { item: 'the air fryer' });
  assert.match(what.said, /free replacement/);
  assert.equal(what.data.card.url, 'https://www.cpsc.gov/Recalls/2023/acme');

  const done = await call('mark_recall_handled', { item: 'air fryer' });
  assert.match(done.said, /^Done\./);
  assert.match((await call('check_my_items')).said, /found no recalls/);
});

test('what is spoken never carries an id, a web address or JSON', async () => {
  const { call } = await connect();
  await call('add_item', { kind: 'product', brand: 'Acme', name: 'air fryer' });
  await call('add_item', { kind: 'car', brand: 'Honda', name: 'Civic', year: 2020 });
  const said = [
    (await call('check_my_items')).said, (await call('list_items')).said, (await call('get_recall_guidance', { item: 'Honda' })).said,
    (await call('search_recalls', { query: 'Acme stroller' })).said, (await call('remove_item', { item: 'Civic' })).said,
  ].join(' ');
  assert.doesNotMatch(said, /https?:|cpsc:|nhtsa:|fda:|[{}\[\]|]|\b[0-9a-f]{8}\b/);
});

test('remove asks first and acts only on a yes', async () => {
  const { call } = await connect();
  await call('add_item', { kind: 'product', brand: 'Acme', name: 'stroller' });
  const ask = await call('remove_item', { item: 'the stroller' });
  assert.match(ask.said, /^Do you want me to stop watching your Acme stroller\?/);
  assert.equal((await call('list_items')).data.items.length, 1, 'nothing removed yet');
  const yes = await call('remove_item', { item: 'the stroller', confirmed: true });
  assert.match(yes.said, /^Removed/);
  assert.equal((await call('list_items')).data.items.length, 0);
});

test('mistakes come back as something Alexa can say, flagged as errors', async () => {
  const { call } = await connect();
  const noYear = await call('add_item', { kind: 'vehicle', brand: 'Honda', name: 'Civic' });
  assert.equal(noYear.isError, true);
  assert.match(noYear.said, /model year/);
  const odd = await call('add_item', { kind: 'spaceship', brand: 'Acme', name: 'rocket' });
  assert.equal(odd.isError, true);
  assert.match(odd.said, /product, a vehicle, food or medicine/);
  const missing = await call('get_recall_guidance', { item: 'the toaster' });
  assert.equal(missing.isError, true);
  assert.doesNotMatch([noYear.said, odd.said, missing.said].join(' '), /MCP error|-32\d{3}|enum/);
});

test('the words people use for kinds are understood', () => {
  assert.equal(toKind('Car'), 'vehicle');
  assert.equal(toKind('trucks'), 'vehicle');
  assert.equal(toKind('medication'), 'medicine');
  assert.equal(toKind('groceries'), 'food');
  assert.equal(toKind('toy'), 'product');
  assert.throws(() => toKind('house'));
});

test('one household cannot see another through the tools', async () => {
  const made = app();
  const alice = await connect('alice', made), bob = await connect('bob', made);
  await alice.call('add_item', { kind: 'product', brand: 'Acme', name: 'stroller' });
  assert.equal((await bob.call('list_items')).data.items.length, 0);
  assert.equal((await bob.call('remove_item', { item: 'stroller', confirmed: true })).isError, true);
  assert.equal((await alice.call('list_items')).data.items.length, 1);
});
