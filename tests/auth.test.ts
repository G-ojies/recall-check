import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, parseTokens } from '../src/auth.ts';

const req = (authorization?: string) => ({ headers: { authorization } });

test('auth: a listed token maps to its household', () => {
  const env = { ACCESS_TOKENS: 'aaa:alice, bbb:bob' };
  assert.deepEqual(identify(req('Bearer bbb'), env), { ok: true, userId: 'bob' });
  assert.deepEqual(identify(req('bearer aaa'), env), { ok: true, userId: 'alice' });
});

test('auth: missing, wrong and empty tokens are refused', () => {
  const env = { ACCESS_TOKENS: 'aaa:alice' };
  for (const h of [undefined, '', 'Bearer ', 'Bearer nope', 'Basic aaa', 'aaa']) assert.equal(identify(req(h), env).ok, false);
  assert.equal(identify(req('Bearer anything'), {}).ok, false, 'no tokens configured means nobody gets in');
});

test('auth: open mode is opt-in', () => {
  assert.deepEqual(identify(req(), { AUTH_MODE: 'open' }), { ok: true, userId: 'demo' });
  assert.deepEqual(parseTokens('t1:u1,t2'), [['t1', 'u1'], ['t2', 'default']]);
});
