/** Account linking, against Amazon's requirements: authorization code with PKCE (S256), static clients, a refresh token every time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ACCESS_TTL, CODE_TTL, OAuth, OAuthError, accessCaller, accessUser, resourceMetadata, serverMetadata, sign, verify, type OAuthConfig } from '../src/oauth.ts';
import { identify } from '../src/auth.ts';
import { MemoryStore } from '../src/store.ts';

const ISSUER = 'https://recall.example', SECRET = 'test-secret', BACK = 'https://alexa.example/callback';
const config: OAuthConfig = { issuer: ISSUER, secret: SECRET, clients: [{ id: 'alexa', secret: 's3cret', redirectUris: [BACK] }, { id: 'public', redirectUris: [BACK] }] };
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const ask = (over: Record<string, unknown> = {}) => ({ response_type: 'code', client_id: 'alexa', redirect_uri: BACK, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'xyz', ...over });

function made() {
  let t = Date.parse('2026-10-01T00:00:00Z');
  const now = () => t;
  const oauth = new OAuth(config, new MemoryStore(now), now);
  const code = (household = 'house-1', over: Record<string, unknown> = {}) => new URL(oauth.grant(oauth.check(ask(over)), household)).searchParams.get('code')!;
  const exchange = (c: string, over: Record<string, unknown> = {}) => oauth.token({ grant_type: 'authorization_code', code: c, redirect_uri: BACK, client_id: 'alexa', client_secret: 's3cret', code_verifier: VERIFIER, ...over });
  return { oauth, now, code, exchange, wait: (s: number) => { t += s * 1000; } };
}
const refused = (code: string) => (e: unknown) => e instanceof OAuthError && e.code === code;

test('linking: a code and its verifier become an access token and a refresh token', async () => {
  const { oauth, code, exchange, now } = made();
  const back = new URL(oauth.grant(oauth.check(ask()), 'house-1'));
  assert.equal(back.origin + back.pathname, BACK);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const t = await exchange(code());
  assert.equal(t.token_type, 'Bearer');
  assert.equal(t.expires_in, ACCESS_TTL);
  assert.ok(t.refresh_token, 'Amazon requires a refresh token with every access token');
  assert.equal(accessUser(t.access_token, SECRET, now), 'acct:house-1');
});

test('linking: the access token opens the MCP endpoint, and a refusal says where to get one', async () => {
  const { exchange, code } = made();
  const { access_token } = await exchange(code());
  const env = { OAUTH_SECRET: SECRET, PUBLIC_URL: ISSUER };
  // identify() reads the clock itself, so this token is checked against real time: issue one that is valid now
  const live = sign({ typ: 'at', sub: 'house-1', cid: 'alexa', exp: Math.floor(Date.now() / 1000) + 60, jti: 'j', iss: ISSUER }, SECRET);
  assert.deepEqual(identify({ headers: { authorization: `Bearer ${live}` } }, env), { ok: true, userId: 'acct:house-1' });
  assert.equal(identify({ headers: { authorization: `Bearer ${access_token}x` } }, env).ok, false);
  const no = identify({ headers: {} }, env);
  assert.ok(!no.ok && no.challenge.includes(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`));
});

test('PKCE is required, and only S256', () => {
  const { oauth } = made();
  for (const over of [{ code_challenge: undefined }, { code_challenge_method: 'plain' }, { code_challenge_method: undefined }, { code_challenge: 'short' }])
    assert.throws(() => oauth.check(ask(over)), refused('invalid_request'));
  assert.throws(() => oauth.check(ask({ response_type: 'token' })), refused('unsupported_response_type'));
});

test('an unknown client or return address is never redirected to', () => {
  const { oauth } = made();
  for (const over of [{ client_id: 'nobody' }, { redirect_uri: 'https://evil.example/callback' }, { redirect_uri: `${BACK}/extra` }, { redirect_uri: undefined }])
    assert.throws(() => oauth.check(ask(over)), (e: unknown) => e instanceof OAuthError && !('redirectUri' in e));
  // a mistake by a known client does go back to it, with the state it sent
  assert.throws(() => oauth.check(ask({ response_type: 'token' })), (e: any) => e.redirectUri === BACK && e.state === 'xyz');
});

test('a code works once, for five minutes, for the client and verifier it was issued to', async () => {
  const { code, exchange, wait } = made();
  const once = code();
  await exchange(once);
  await assert.rejects(exchange(once), refused('invalid_grant'), 'second use');
  await assert.rejects(exchange(code(), { code_verifier: 'w'.repeat(64) }), refused('invalid_grant'), 'wrong verifier');
  await assert.rejects(exchange(code(), { code_verifier: undefined }), refused('invalid_grant'), 'no verifier');
  await assert.rejects(exchange(code(), { redirect_uri: 'https://alexa.example/other' }), refused('invalid_grant'), 'other return address');
  await assert.rejects(exchange(code(), { client_id: 'public', client_secret: undefined }), refused('invalid_grant'), 'other client');
  await assert.rejects(exchange(code(), { client_secret: 'wrong' }), refused('invalid_client'), 'wrong secret');
  await assert.rejects(exchange(code(), { client_secret: undefined }), refused('invalid_client'), 'secret left out');
  const late = code(); wait(CODE_TTL + 1);
  await assert.rejects(exchange(late), refused('invalid_grant'), 'expired');
});

test('a refresh token works once and hands over the next one', async () => {
  const { oauth, code, exchange, now, wait } = made();
  const first = await exchange(code());
  wait(ACCESS_TTL + 1);
  assert.equal(accessUser(first.access_token, SECRET, now), null, 'the access token has expired');
  const renew = (refresh_token: string, client_id = 'alexa', client_secret: string | undefined = 's3cret') => oauth.token({ grant_type: 'refresh_token', refresh_token, client_id, client_secret });
  const second = await renew(first.refresh_token!);
  assert.equal(accessUser(second.access_token, SECRET, now), 'acct:house-1');
  assert.notEqual(second.refresh_token, first.refresh_token);
  await assert.rejects(renew(first.refresh_token!), refused('invalid_grant'), 'the old one is spent');
  await assert.rejects(renew(second.refresh_token!, 'public', undefined), refused('invalid_grant'), 'another client cannot use it');
  await assert.rejects(renew('rt_made-up'), refused('invalid_grant'));
  await assert.rejects(oauth.token({ grant_type: 'password', client_id: 'alexa', client_secret: 's3cret' }), refused('unsupported_grant_type'));
});

test('tokens: forged, altered, expired and wrong-kind tokens are refused', () => {
  const now = () => Date.parse('2026-10-01T00:00:00Z');
  const claims = { typ: 'at' as const, sub: 'h', cid: 'alexa', exp: Math.floor(now() / 1000) + 60, jti: 'j', iss: ISSUER };
  const good = sign(claims, SECRET);
  assert.equal(verify(good, 'at', SECRET, now)?.sub, 'h');
  assert.equal(verify(good, 'code', SECRET, now), null, 'an access token is not a code');
  assert.equal(verify(good, 'at', 'other-secret', now), null);
  assert.equal(verify(sign({ ...claims, exp: Math.floor(now() / 1000) - 1 }, SECRET), 'at', SECRET, now), null);
  const [h, , s] = good.split('.');
  const swapped = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString('base64url')}.${s}`;
  assert.equal(verify(swapped, 'at', SECRET, now), null);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${good.split('.')[1]}.`;
  assert.equal(verify(none, 'at', SECRET, now), null, 'alg none is not accepted');
  for (const junk of ['', 'a.b', 'a.b.c.d', 'not a token']) assert.equal(verify(junk, 'at', SECRET, now), null);
  assert.equal(accessUser(good, undefined, now), null, 'no secret configured means no token is valid');
});

test('accounts: sign up once, sign in with the same password, and nothing else', async () => {
  const { oauth } = made();
  const house = await oauth.accounts.create(' Ada@Example.com ', 'correct horse');
  assert.equal(await oauth.accounts.signIn('ada@example.com', 'correct horse'), house, 'the address is not case sensitive');
  const says = (m: RegExp) => (e: unknown) => e instanceof Error && m.test(e.message);
  await assert.rejects(oauth.accounts.signIn('ada@example.com', 'wrong horse'), says(/do not match/));
  await assert.rejects(oauth.accounts.signIn('nobody@example.com', 'correct horse'), says(/do not match/), 'the same answer whether or not the account exists');
  await assert.rejects(oauth.accounts.create('ada@example.com', 'another password'), says(/already an account/));
  await assert.rejects(oauth.accounts.create('not-an-address', 'correct horse'), says(/valid email/));
  await assert.rejects(oauth.accounts.create('bob@example.com', 'short'), says(/at least 8/));
  assert.notEqual(await oauth.accounts.create('bob@example.com', 'correct horse'), house, 'each account has its own household');
});

test('metadata: the resource names its authorization server, which offers only what is supported', () => {
  assert.deepEqual(resourceMetadata(config).authorization_servers, [ISSUER]);
  assert.equal(resourceMetadata(config).resource, `${ISSUER}/mcp`);
  const m = serverMetadata(config);
  assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(m.grant_types_supported, ['client_credentials', 'authorization_code', 'refresh_token']);
  assert.deepEqual(m.scopes_supported, ['mcp:tools', 'mcp:resources'], 'the service scope is reserved, not offered');
  assert.ok(!('registration_endpoint' in m), 'no dynamic client registration');
});

test('service level: client credentials give a one-hour token with the service scope and no refresh token', async () => {
  const { oauth, now } = made();
  const ask = (over: Record<string, unknown> = {}, basic: { id: string; secret: string } | undefined = { id: 'alexa', secret: 's3cret' }) =>
    oauth.token({ grant_type: 'client_credentials', scope: 'mcp:service', resource: `${ISSUER}/mcp`, ...over }, basic);
  const t = await ask();
  assert.deepEqual({ ...t, access_token: '' }, { access_token: '', token_type: 'Bearer', expires_in: 3600, scope: 'mcp:service' });
  assert.ok(!('refresh_token' in t), 'Amazon forbids a refresh token here');
  assert.deepEqual(accessCaller(t.access_token, SECRET, now), { userId: 'service:alexa', service: true });
  assert.equal(accessUser(t.access_token, SECRET, now), null, 'a service token is nobody\'s household');
  assert.equal((await ask({ client_id: 'alexa', client_secret: 's3cret' }, undefined)).scope, 'mcp:service', 'credentials in the body work too');

  await assert.rejects(ask({}, { id: 'alexa', secret: 'wrong' }), (e: any) => e.code === 'invalid_client' && e.status === 401);
  await assert.rejects(ask({}, { id: 'public', secret: '' }), (e: any) => e.code === 'invalid_client' && e.status === 401, 'a client without a secret cannot be a service');
  await assert.rejects(ask({ scope: 'mcp:tools' }), (e: any) => e.code === 'invalid_scope' && e.status === 400, 'user scopes come only from account linking');
  await assert.rejects(ask({ scope: undefined }), (e: any) => e.code === 'invalid_request' && e.status === 400);
  await assert.rejects(ask({ resource: undefined }), (e: any) => e.code === 'invalid_request' && e.status === 400);
  await assert.rejects(ask({ resource: 'https://other.example/mcp' }), (e: any) => e.code === 'access_denied' && e.status === 403);
});

test('the resource parameter: a code or token for another server is refused', async () => {
  const { oauth, code, exchange } = made();
  assert.throws(() => oauth.check(ask({ resource: 'https://other.example/mcp' })), (e: any) => e.code === 'invalid_target' && e.redirectUri === BACK);
  assert.equal(oauth.check(ask({ resource: `${ISSUER}/mcp` })).client.id, 'alexa');
  await assert.rejects(exchange(code(), { resource: 'https://other.example/mcp' }), refused('invalid_target'));
  assert.ok((await exchange(code(), { resource: `${ISSUER}/mcp` })).access_token);
});

test('scopes: users get user scopes, unknown ones are dropped, the service scope is refused', async () => {
  const { oauth, code, exchange } = made();
  assert.equal(oauth.check(ask({ scope: 'openid mcp:tools mcp:resources' })).scope, 'mcp:tools mcp:resources');
  assert.equal(oauth.check(ask({ scope: undefined })).scope, 'mcp:tools');
  assert.throws(() => oauth.check(ask({ scope: 'mcp:tools mcp:service' })), refused('invalid_scope'));
  const first = await exchange(code('house-1', { scope: 'mcp:tools mcp:resources' }));
  assert.equal(first.scope, 'mcp:tools mcp:resources');
  const next = await oauth.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'alexa', client_secret: 's3cret' });
  assert.equal(next.scope, 'mcp:tools mcp:resources', 'a refresh keeps the scope and needs no resource parameter');
});

test('a service token is recognised as a service, never as a household', () => {
  const live = sign({ typ: 'at', sub: 'service:alexa', cid: 'alexa', scope: 'mcp:service', exp: Math.floor(Date.now() / 1000) + 60, jti: 'j', iss: ISSUER }, SECRET);
  assert.deepEqual(identify({ headers: { authorization: `Bearer ${live}` } }, { OAUTH_SECRET: SECRET }), { ok: true, userId: 'service:alexa', service: true });
});
