/**
 * Authentication for Alexa+: a small OAuth 2.1 authorization server, built to Amazon's two pages on the subject
 * (mcp-toolkit-authentication and mcp-toolkit-account-linking).
 *
 *   Service level: the client credentials grant. Alexa+ uses this token to initialize, list tools and call tools
 *     that need no user. Scope mcp:service, one hour, never a refresh token.
 *   User level (account linking): the authorization code grant with PKCE, S256 only. A refresh token comes with
 *     every access token. Clients are registered statically; there is no dynamic registration.
 *
 * Both take the `resource` parameter and refuse a token meant for any other server.
 *
 * An account is an email address and a password. It owns one household, and the household id is the subject of
 * every token, so the list a person builds by voice follows them to any device they link.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express, { Router, type Request, type Response } from 'express';
import type { KV } from './store.ts';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const CODE_TTL = 300, ACCESS_TTL = 3600, REFRESH_TTL = 90 * 24 * 3600;
export const USER_SCOPES = ['mcp:tools', 'mcp:resources'], SERVICE_SCOPE = 'mcp:service';
export const SIMULATOR_CLIENT = 'recall-check-simulator';

export interface OAuthClient { id: string; secret?: string; redirectUris: string[] }
export interface OAuthConfig { issuer: string; secret: string; clients: OAuthClient[] }

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');
const sha256 = (v: string) => createHash('sha256').update(v).digest();
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const seconds = (now: () => number) => Math.floor(now() / 1000);

// ---- signed tokens (JWT, HS256) ----

export interface Claims { typ: 'code' | 'at'; sub: string; cid: string; exp: number; jti: string; iss: string; scope?: string; aud?: string; ruri?: string; cc?: string }

const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const signature = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function sign(claims: Claims, secret: string): string {
  const body = `${HEADER}.${b64(JSON.stringify(claims))}`;
  return `${body}.${signature(body, secret)}`;
}

/** The claims, or null when the token is malformed, forged, expired or of the wrong kind. */
export function verify(token: string, typ: Claims['typ'], secret: string, now: () => number = Date.now): Claims | null {
  const [h, p, s, extra] = token.split('.');
  if (!h || !p || !s || extra !== undefined || h !== HEADER || !same(s, signature(`${h}.${p}`, secret))) return null;
  try {
    const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Claims;
    return c.typ === typ && typeof c.sub === 'string' && c.exp > seconds(now) ? c : null;
  } catch { return null; }
}

export type Caller = { userId: string; service: false } | { userId: string; service: true };

/** Who an access token stands for: a linked household, or Alexa+ itself with no user. */
export function accessCaller(token: string, secret: string | undefined, now: () => number = Date.now): Caller | null {
  const c = secret ? verify(token, 'at', secret, now) : null;
  if (!c) return null;
  return c.scope === SERVICE_SCOPE ? { userId: `service:${c.cid}`, service: true } : { userId: `acct:${c.sub}`, service: false };
}

/** The household behind a user-level access token. */
export function accessUser(token: string, secret: string | undefined, now: () => number = Date.now): string | null {
  const c = accessCaller(token, secret, now);
  return c && !c.service ? c.userId : null;
}

// ---- configuration ----

export function oauthFromEnv(issuer: string, env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const clients: OAuthClient[] = [{ id: SIMULATOR_CLIENT, redirectUris: [`${issuer}/link`] }];
  if (env.OAUTH_CLIENT_ID) clients.push({
    id: env.OAUTH_CLIENT_ID, ...(env.OAUTH_CLIENT_SECRET ? { secret: env.OAUTH_CLIENT_SECRET } : {}),
    redirectUris: (env.OAUTH_REDIRECT_URIS ?? '').split(',').map((u) => u.trim()).filter(Boolean),
  });
  return { issuer, secret: env.OAUTH_SECRET!, clients };
}

export const resourceMetadata = (c: OAuthConfig) => ({
  resource: `${c.issuer}/mcp`, authorization_servers: [c.issuer], bearer_methods_supported: ['header'], scopes_supported: USER_SCOPES, resource_name: 'Recall Check',
});

export const serverMetadata = (c: OAuthConfig) => ({
  issuer: c.issuer, authorization_endpoint: `${c.issuer}/oauth/authorize`, token_endpoint: `${c.issuer}/oauth/token`,
  response_types_supported: ['code'], grant_types_supported: ['client_credentials', 'authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'], scopes_supported: USER_SCOPES,
});

// ---- accounts ----

interface Account { email: string; salt: string; hash: string; household: string; createdAt: string }

export class AccountError extends Error {}

const cleanEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const accountKey = (email: string) => `account:${sha256(email).toString('hex')}`;
const hashPassword = async (password: string, salt: Buffer) => (await scryptAsync(password.normalize('NFKC'), salt, 32)).toString('base64url');

export class Accounts {
  constructor(private kv: KV, private now: () => number = Date.now) {}

  async create(emailIn: unknown, password: unknown): Promise<string> {
    const email = cleanEmail(emailIn);
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw new AccountError('Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new AccountError('Choose a password of at least 8 characters.');
    if (await this.kv.read(accountKey(email))) throw new AccountError('There is already an account with that email address. Sign in instead.');
    const salt = randomBytes(16);
    const account: Account = { email, salt: b64(salt), hash: await hashPassword(password, salt), household: b64(randomBytes(18)), createdAt: new Date(this.now()).toISOString() };
    await this.kv.write(accountKey(email), JSON.stringify(account));
    return account.household;
  }

  async signIn(emailIn: unknown, password: unknown): Promise<string> {
    const raw = await this.kv.read(accountKey(cleanEmail(emailIn)));
    const account = raw ? (JSON.parse(raw) as Account) : null;
    // hash even when there is no such account, so the time taken does not say which addresses exist
    const hash = await hashPassword(typeof password === 'string' ? password.slice(0, 200) : '', Buffer.from(account?.salt ?? 'AAAAAAAAAAAAAAAAAAAAAA', 'base64url'));
    if (!account || !same(hash, account.hash)) throw new AccountError('That email address and password do not match.');
    return account.household;
  }
}

// ---- the flow ----

export class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

interface AuthRequest { client: OAuthClient; redirectUri: string; challenge: string; scope: string; state?: string }
export interface TokenResponse { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token?: string; scope: string }

export class OAuth {
  readonly accounts: Accounts;
  constructor(readonly config: OAuthConfig, private kv: KV, private now: () => number = Date.now) { this.accounts = new Accounts(kv, now); }

  get resource() { return `${this.config.issuer}/mcp`; }
  /** `resource` names the server a token is for. Alexa+ always sends it; a client that leaves it out means this one. */
  private forThisServer(resource: string) { return !resource || resource === this.resource; }

  /**
   * Checks an authorization request. An unknown client or redirect address is reported on the page and never
   * redirected to; every other mistake goes back to the client as an error, as the specification requires.
   */
  check(q: Record<string, unknown>): AuthRequest {
    const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '');
    const client = this.config.clients.find((c) => c.id === str('client_id'));
    if (!client) throw new OAuthError('unknown_client', 'This app is not registered with Recall Check.');
    const redirectUri = str('redirect_uri');
    if (!client.redirectUris.includes(redirectUri)) throw new OAuthError('bad_redirect', 'This app asked to return to an address that is not registered.');
    const back = (code: string, message: string) => Object.assign(new OAuthError(code, message), { redirectUri, state: str('state') });
    if (str('response_type') !== 'code') throw back('unsupported_response_type', 'Only the authorization code flow is supported.');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(str('code_challenge')) || str('code_challenge_method') !== 'S256') throw back('invalid_request', 'PKCE with the S256 method is required.');
    if (!this.forThisServer(str('resource'))) throw back('invalid_target', 'The resource is not this server.');
    const asked = str('scope').split(/\s+/).filter(Boolean);
    if (asked.includes(SERVICE_SCOPE)) throw back('invalid_scope', 'The service scope is not available to users.');
    // scopes this server does not know (openid, for one) are left out, as the specification allows
    const scope = asked.filter((s) => USER_SCOPES.includes(s)).join(' ') || USER_SCOPES[0];
    return { client, redirectUri, challenge: str('code_challenge'), scope, ...(str('state') ? { state: str('state') } : {}) };
  }

  /** The address to send the browser back to, carrying a code that works once, for five minutes. */
  grant(req: AuthRequest, household: string): string {
    const code = sign({ typ: 'code', sub: household, cid: req.client.id, ruri: req.redirectUri, cc: req.challenge, scope: req.scope, exp: seconds(this.now) + CODE_TTL, jti: b64(randomBytes(12)), iss: this.config.issuer }, this.config.secret);
    const to = new URL(req.redirectUri);
    to.searchParams.set('code', code);
    if (req.state) to.searchParams.set('state', req.state);
    return to.toString();
  }

  private client(id: string, secret: string | undefined): OAuthClient {
    const client = this.config.clients.find((c) => c.id === id);
    if (!client || (client.secret ? !secret || !same(secret, client.secret) : false)) throw new OAuthError('invalid_client', 'The client is unknown or its secret is wrong.', 401);
    return client;
  }

  private access(sub: string, clientId: string, scope: string) {
    return sign({ typ: 'at', sub, cid: clientId, scope, aud: this.resource, exp: seconds(this.now) + ACCESS_TTL, jti: b64(randomBytes(12)), iss: this.config.issuer }, this.config.secret);
  }

  private async issue(household: string, clientId: string, scope: string): Promise<TokenResponse> {
    const refresh = `rt_${b64(randomBytes(32))}`;
    await this.kv.write(`oauth:rt:${sha256(refresh).toString('hex')}`, JSON.stringify({ sub: household, cid: clientId, scope }), REFRESH_TTL);
    return { access_token: this.access(household, clientId, scope), token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope };
  }

  async token(body: Record<string, unknown>, basic?: { id: string; secret: string }): Promise<TokenResponse> {
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
    const client = this.client(basic?.id ?? str('client_id'), basic?.secret ?? (str('client_secret') || undefined));

    if (str('grant_type') === 'client_credentials') {
      if (!client.secret) throw new OAuthError('invalid_client', 'This client has no secret, so it cannot act as a service.', 401);
      if (!str('scope') || !str('resource')) throw new OAuthError('invalid_request', 'Both scope and resource are required.');
      if (str('scope') !== SERVICE_SCOPE) throw new OAuthError('invalid_scope', `Only ${SERVICE_SCOPE} is issued to a service.`);
      if (!this.forThisServer(str('resource'))) throw new OAuthError('access_denied', 'The resource is not this server.', 403);
      return { access_token: this.access(`service:${client.id}`, client.id, SERVICE_SCOPE), token_type: 'Bearer', expires_in: ACCESS_TTL, scope: SERVICE_SCOPE };
    }

    if (str('grant_type') === 'authorization_code') {
      if (!this.forThisServer(str('resource'))) throw new OAuthError('invalid_target', 'The resource is not this server.');
      const c = verify(str('code'), 'code', this.config.secret, this.now);
      if (!c || c.cid !== client.id || c.ruri !== str('redirect_uri')) throw new OAuthError('invalid_grant', 'The code is not valid for this client.');
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(str('code_verifier')) || !same(b64(sha256(str('code_verifier'))), c.cc ?? '')) throw new OAuthError('invalid_grant', 'The code verifier does not match.');
      const used = `oauth:code:${c.jti}`;
      if (await this.kv.read(used)) throw new OAuthError('invalid_grant', 'The code has already been used.');
      await this.kv.write(used, '1', CODE_TTL);
      return this.issue(c.sub, client.id, c.scope ?? USER_SCOPES[0]);
    }

    if (str('grant_type') === 'refresh_token') {
      const key = `oauth:rt:${sha256(str('refresh_token')).toString('hex')}`;
      const raw = await this.kv.read(key);
      const held = raw ? (JSON.parse(raw) as { sub: string; cid: string; scope?: string }) : null;
      if (!held || held.cid !== client.id) throw new OAuthError('invalid_grant', 'The refresh token is not valid.');
      await this.kv.remove(key); // each refresh token works once; the reply carries the next one
      return this.issue(held.sub, client.id, held.scope ?? USER_SCOPES[0]);
    }

    throw new OAuthError('unsupported_grant_type', 'Use client_credentials, authorization_code or refresh_token.');
  }
}

// ---- HTTP ----

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAGE_STYLE = `:root{color-scheme:light dark;font-family:"Amazon Ember","Inter","Segoe UI",system-ui,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f5f8;color:#111827;line-height:1.5;padding:16px}
main{width:100%;max-width:400px;background:#fff;border:1px solid #d9dee7;border-radius:14px;padding:28px}
h1{font-size:1.35rem;margin:0 0 4px}p{margin:0 0 16px;color:#5b6577}label{display:block;font-weight:600;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;font:inherit;padding:11px 12px;border:1px solid #b9c1cf;border-radius:10px;background:transparent;color:inherit}
button{font:inherit;font-weight:600;width:100%;margin-top:18px;padding:12px;border-radius:10px;border:1px solid #0a6cff;background:#0a6cff;color:#fff;cursor:pointer}
button.second{background:transparent;color:#0a6cff;margin-top:10px}.error{color:#c2261c;font-weight:600}.small{font-size:.85rem;margin:18px 0 0}a{color:#0a6cff}
@media (prefers-color-scheme:dark){body{background:#0c1018;color:#e8ecf3}main{background:#131926;border-color:#232b3a}p{color:#98a3b7}input{border-color:#3a4558}
button{background:#5aa2ff;border-color:#5aa2ff;color:#06101f}button.second,a{color:#5aa2ff}.error{color:#ff6b5e}}`;

const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Link Recall Check</title><style>${PAGE_STYLE}</style></head><body><main>${body}</main></body></html>`;

function form(q: Record<string, unknown>, error = ''): string {
  const keep = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']
    .filter((k) => typeof q[k] === 'string').map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] as string)}">`).join('');
  return page(`<h1>Link Recall Check</h1><p>Sign in, or create an account, so your list follows you to every device.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/oauth/authorize">${keep}
<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required value="${esc(typeof q.email === 'string' ? q.email : '')}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="8" required>
<button type="submit" name="mode" value="signin">Sign in and link</button>
<button type="submit" name="mode" value="signup" class="second">Create an account and link</button></form>
<p class="small">Recall Check stores your email address and the list of things you own. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>`);
}

export function oauthRouter(oauth: OAuth, allow: (ip: string, perMinute: number) => boolean): Router {
  const r = Router();
  const secure = (res: Response) => res.set({ 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer' });

  r.get('/.well-known/oauth-protected-resource', (_req, res) => { res.json(resourceMetadata(oauth.config)); });
  r.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => { res.json(resourceMetadata(oauth.config)); });
  r.get('/.well-known/oauth-authorization-server', (_req, res) => { res.json(serverMetadata(oauth.config)); });

  const refuse = (res: Response, e: unknown) => {
    const err = e as OAuthError & { redirectUri?: string; state?: string };
    if (err instanceof OAuthError && err.redirectUri) {
      const to = new URL(err.redirectUri);
      to.searchParams.set('error', err.code); to.searchParams.set('error_description', err.message);
      if (err.state) to.searchParams.set('state', err.state);
      res.redirect(303, to.toString()); return;
    }
    if (!(e instanceof OAuthError)) console.error('[oauth]', e);
    secure(res).status(400).type('html').send(page(`<h1>This link cannot be completed</h1><p>${esc(e instanceof OAuthError ? e.message : 'Something went wrong on our side. Please try again.')}</p>`));
  };

  r.get('/oauth/authorize', (req: Request, res: Response) => {
    try { oauth.check(req.query); secure(res).type('html').send(form(req.query)); }
    catch (e) { refuse(res, e); }
  });

  r.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '8kb' }), async (req: Request, res: Response) => {
    let request;
    try { request = oauth.check(req.body); } catch (e) { refuse(res, e); return; }
    if (!allow(`oauth:${req.ip ?? 'unknown'}`, 10)) { secure(res).status(429).type('html').send(form(req.body, 'Too many attempts. Wait a minute and try again.')); return; }
    try {
      const household = req.body.mode === 'signup' ? await oauth.accounts.create(req.body.email, req.body.password) : await oauth.accounts.signIn(req.body.email, req.body.password);
      secure(res).redirect(303, oauth.grant(request, household));
    } catch (e) {
      if (!(e instanceof AccountError)) { refuse(res, e); return; }
      secure(res).status(400).type('html').send(form(req.body, e.message));
    }
  });

  r.post('/oauth/token', express.urlencoded({ extended: false, limit: '8kb' }), async (req: Request, res: Response) => {
    res.set({ 'cache-control': 'no-store', pragma: 'no-cache' });
    if (!allow(`token:${req.ip ?? 'unknown'}`, 60)) { res.status(429).json({ error: 'slow_down', error_description: 'Too many requests.' }); return; }
    try {
      const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
      const [id, ...rest] = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':') : [];
      res.json(await oauth.token(req.body ?? {}, id ? { id: decodeURIComponent(id), secret: decodeURIComponent(rest.join(':')) } : undefined));
    } catch (e) {
      if (e instanceof OAuthError) { res.status(e.status).json({ error: e.code, error_description: e.message }); return; }
      console.error('[oauth]', e);
      res.status(500).json({ error: 'server_error', error_description: 'Something went wrong. Please try again.' });
    }
  });

  return r;
}
