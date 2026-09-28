import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, MemoryStore, RedisStore, storeFromEnv } from '../src/store.ts';

test('store: files keep households and values, and forget a value when its time is up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rc-store-'));
  try {
    const s = new FileStore(dir);
    assert.deepEqual((await s.get('nobody')).items, []);
    const h = await s.get('u'); h.items.push({ id: 'a1', kind: 'product', brand: 'Acme', name: 'stroller', addedAt: '2026-10-01T00:00:00Z' });
    await s.put('u', h);
    assert.equal((await new FileStore(dir).get('u')).items[0].name, 'stroller', 'a second instance reads what the first wrote');
    await s.write('k', 'v', -1);
    assert.equal(await s.read('k'), null);
    await s.write('k', 'v'); await s.remove('k'); await s.remove('k');
    assert.equal(await s.read('k'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('store: memory forgets a value when its time is up', async () => {
  let t = 0;
  const s = new MemoryStore(() => t);
  await s.write('k', 'v', 10);
  assert.equal(await s.read('k'), 'v');
  t = 10_001;
  assert.equal(await s.read('k'), null);
});

test('store: redis commands are prefixed, carry the expiry, and report failures', async () => {
  const sent: unknown[] = [];
  const reply = (body: unknown, ok = true) => (async (_url: unknown, init: { body: string }) => { sent.push(JSON.parse(init.body)); return { ok, status: ok ? 200 : 401, json: async () => body }; }) as unknown as typeof fetch;
  const s = new RedisStore('https://redis.example', 'token', 'rc:', reply({ result: null }));
  assert.equal(await s.read('household:u'), null);
  await s.write('oauth:code:j', '1', 300);
  await s.write('account:x', '{}');
  await s.remove('oauth:rt:y');
  assert.deepEqual(sent, [['GET', 'rc:household:u'], ['SET', 'rc:oauth:code:j', '1', 'EX', 300], ['SET', 'rc:account:x', '{}'], ['DEL', 'rc:oauth:rt:y']]);
  await assert.rejects(new RedisStore('https://redis.example', 'bad', 'rc:', reply({ error: 'WRONGPASS' }, false)).read('k'), /WRONGPASS/);
});

test('store: redis is used only when both its address and its token are set', () => {
  assert.equal(storeFromEnv({}).kind, 'file');
  assert.equal(storeFromEnv({ KV_REST_API_URL: 'https://redis.example' }).kind, 'file');
  assert.equal(storeFromEnv({ KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 't' }).kind, 'redis');
  assert.equal(storeFromEnv({ UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 't' }).kind, 'redis');
});
