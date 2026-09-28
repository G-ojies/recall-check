/**
 * The HTTP application. MCP over Streamable HTTP at POST /mcp, stateless: each request gets its own server
 * and transport, so any instance can answer any request and nothing is lost on a restart.
 *
 * Two things start it: src/serve.ts, a process that listens on a port, and src/vercel.ts, a serverless function.
 */
import express, { type Express, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { RecallIndex } from './match.ts';
import { RecallCheck } from './service.ts';
import { storeFromEnv } from './store.ts';
import { buildServer, PUBLIC_TOOLS, SERVER_INFO } from './mcp.ts';
import { buildSnapshot, readSnapshot, writeSnapshot, type Snapshot } from './data.ts';
import { challenge, identify, simToken } from './auth.ts';
import { OAuth, accessUser, oauthFromEnv, oauthRouter } from './oauth.ts';
import { Host } from './host/host.ts';

export interface AppOptions {
  /** where this server is reached from outside: the OAuth issuer, and the address in the metadata */
  publicUrl: string;
  /** where the simulator finds the MCP endpoint */
  mcpUrl: string;
  /** runs work that outlives the answer: a vehicle lookup finishing, a stale copy being renewed */
  afterAnswer?: (work: Promise<unknown>) => void;
  /** a directory of files to serve, for a host that does not serve them itself */
  staticDir?: string;
  /** false where the file system cannot be written to */
  saveData?: boolean;
  /** the recall data itself (gzipped JSON), for a host where reading a file beside the code is not dependable */
  seed?: Uint8Array;
}

export interface App { http: Express; refresh: () => Promise<void>; dataAge: () => number; recalls: () => number; store: string }

export async function createApp(opts: AppOptions): Promise<App> {
  const DATA = process.env.RECALL_DATA ?? 'data/recalls.json.gz';
  /** a copy of the recall data kept in the repository, so a fresh host answers from its first request */
  const SEEDS = [process.env.RECALL_SEED, join(process.cwd(), 'seed/recalls.json.gz'), fileURLToPath(new URL('../seed/recalls.json.gz', import.meta.url))].filter((p): p is string => !!p);
  const SINCE = process.env.RECALL_SINCE ?? `${new Date().getUTCFullYear() - 10}-01-01`;
  process.env.PUBLIC_URL = opts.publicUrl;

  // The simulator signs its own household tokens. Without a configured secret one is made up for this process.
  process.env.SIM_SECRET ??= randomBytes(32).toString('base64url');
  // Same for account linking: set OAUTH_SECRET in production, or every restart signs people out.
  process.env.OAUTH_SECRET ??= randomBytes(32).toString('base64url');

  const index = new RecallIndex();
  let snapshot: Snapshot | null = opts.saveData === false ? null : await readSnapshot(DATA);
  if (!snapshot && opts.seed) snapshot = JSON.parse(gunzipSync(opts.seed).toString('utf8')) as Snapshot;
  for (const seed of SEEDS) snapshot ??= await readSnapshot(seed);
  if (snapshot) index.load(snapshot.recalls);
  const store = storeFromEnv();
  const app = new RecallCheck(index, store);
  const oauth = new OAuth(oauthFromEnv(opts.publicUrl), store);
  const afterAnswer = opts.afterAnswer ?? ((work) => { void work; });
  const later = (work: Promise<unknown>) => afterAnswer(work.catch((e) => console.error('[idle]', e)));

  async function refresh() {
    try {
      const next = await buildSnapshot(SINCE, snapshot);
      if (!next.recalls.length) return;
      snapshot = next; index.load(next.recalls);
      if (opts.saveData !== false) await writeSnapshot(DATA, next);
      console.log(`[data] ${index.size} recalls${next.errors.length ? `, failed: ${next.errors.join('; ')}` : ''}`);
    } catch (e) { console.error('[data] refresh failed', e); }
  }

  const hits = new Map<string, { n: number; from: number }>();
  function allow(who: string, perMinute = 40) {
    const now = Date.now(), h = hits.get(who);
    if (hits.size > 10_000) hits.clear();
    if (!h || now - h.from > 60_000) { hits.set(who, { n: 1, from: now }); return true; }
    return ++h.n <= perMinute;
  }

  const http = express();
  http.disable('x-powered-by');
  http.set('trust proxy', 1); // one proxy in front (the host's load balancer), so req.ip is the visitor
  http.use(express.json({ limit: '256kb' }));
  http.use(oauthRouter(oauth, allow));

  http.get('/health', (_req, res) => {
    res.json({ ok: index.size > 0, server: SERVER_INFO, recalls: index.size, dataBuiltAt: snapshot?.builtAt ?? null, counts: snapshot?.counts ?? {}, sourceErrors: snapshot?.errors ?? [], store: store.kind });
  });

  /** True when the request calls a tool that works on a household. A service token may only call the ones that do not. */
  function needsUser(body: unknown): boolean {
    return (Array.isArray(body) ? body : [body]).some((m) => m?.method === 'tools/call' && !PUBLIC_TOOLS.includes(m?.params?.name));
  }

  http.post('/mcp', async (req: Request, res: Response) => {
    const started = process.hrtime.bigint();
    const who = identify(req);
    // Alexa+ starts account linking when it sees a 401. It ignores the challenge header; other MCP clients follow it.
    const refuse = (header: string) => { res.status(401).set('WWW-Authenticate', header).json({ error: 'unauthorized', message: 'Access token required to use this tool.' }); };
    if (!who.ok) { refuse(who.challenge); return; }
    if (who.service && needsUser(req.body)) { refuse(challenge()); return; }
    const server = buildServer(app, who.userId, later);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const call = req.body?.method === 'tools/call' ? `tools/call ${req.body?.params?.name}` : req.body?.method;
      console.log(`[mcp] ${call} ${res.statusCode} ${ms.toFixed(1)} ms`);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp]', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });

  if ((process.env.SIMULATOR ?? 'on') !== 'off') {
    const host = new Host(opts.mcpUrl, (h) => simToken(h, process.env.SIM_SECRET!), (w) => index.knowsBrand(w), store);
    const household = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null);

    http.post('/sim/turn', async (req: Request, res: Response) => {
      const id = household(req.body?.household), text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
      if (!id || !text) { res.status(400).json({ error: 'household and text are required' }); return; }
      if (!allow(req.ip ?? 'unknown')) { res.status(429).json({ error: 'Too many requests. Wait a minute.' }); return; }
      // a linked browser sends its access token; the conversation is then kept per account, not per browser
      const bearer = typeof req.body?.token === 'string' ? req.body.token : undefined;
      const linked = bearer ? accessUser(bearer, process.env.OAUTH_SECRET) : null;
      if (bearer && !linked) { res.status(401).json({ error: 'The link to your account has expired.', relink: true }); return; }
      try { res.json(await (linked ? host.turn(createHash('sha256').update(linked).digest('base64url').slice(0, 32), text, bearer) : host.turn(id, text))); }
      catch (e) { console.error('[sim]', e); res.status(500).json({ error: 'The simulator could not reach the add-on.' }); }
    });
    http.post('/sim/reset', async (req: Request, res: Response) => { const id = household(req.body?.household); if (id) await host.reset(id); res.json({ ok: true }); });
    http.get('/sim/info', (_req, res) => { res.json({ brain: host.brain, recalls: index.size, dataBuiltAt: snapshot?.builtAt ?? null, counts: snapshot?.counts ?? {} }); });
    if (opts.staticDir) http.use(express.static(opts.staticDir, { extensions: ['html'], maxAge: '5m' }));
  }

  // Stateless server: there is no stream to open and no session to end.
  const notAllowed = (_req: Request, res: Response) => { res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }); };
  http.get('/mcp', notAllowed);
  http.delete('/mcp', notAllowed);

  return { http, refresh, dataAge: () => Date.now() - Date.parse(snapshot?.builtAt ?? '1970-01-01'), recalls: () => index.size, store: store.kind };
}
