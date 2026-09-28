/**
 * HTTP entry point. MCP over Streamable HTTP at POST /mcp, stateless: each request gets its own server
 * and transport, so any instance can answer any request and nothing is lost on a restart.
 */
import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { RecallIndex } from './match.ts';
import { RecallCheck } from './service.ts';
import { FileStore } from './store.ts';
import { buildServer, SERVER_INFO } from './mcp.ts';
import { buildSnapshot, readSnapshot, writeSnapshot, type Snapshot } from './data.ts';
import { identify, simToken } from './auth.ts';
import { Host } from './host/host.ts';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.RECALL_DATA ?? 'data/recalls.json.gz';
const SINCE = process.env.RECALL_SINCE ?? `${new Date().getUTCFullYear() - 10}-01-01`;
const REFRESH_MS = Number(process.env.RECALL_REFRESH_HOURS ?? 6) * 3600 * 1000;

// The simulator signs its own household tokens. Without a configured secret one is made up for this process.
process.env.SIM_SECRET ??= randomBytes(32).toString('base64url');
const SIM_ON = (process.env.SIMULATOR ?? 'on') !== 'off';

const index = new RecallIndex();
let snapshot: Snapshot | null = await readSnapshot(DATA);
if (snapshot) index.load(snapshot.recalls);
const app = new RecallCheck(index, new FileStore(process.env.HOUSEHOLD_DIR ?? 'data/households'));

async function refresh() {
  try {
    const next = await buildSnapshot(SINCE, snapshot);
    if (!next.recalls.length) return;
    snapshot = next; index.load(next.recalls);
    await writeSnapshot(DATA, next);
    console.log(`[data] ${index.size} recalls${next.errors.length ? `, failed: ${next.errors.join('; ')}` : ''}`);
  } catch (e) { console.error('[data] refresh failed', e); }
}

const http = express();
http.disable('x-powered-by');
http.use(express.json({ limit: '256kb' }));

http.get('/health', (_req, res) => {
  res.json({ ok: index.size > 0, server: SERVER_INFO, recalls: index.size, dataBuiltAt: snapshot?.builtAt ?? null, counts: snapshot?.counts ?? {}, sourceErrors: snapshot?.errors ?? [] });
});

http.post('/mcp', async (req: Request, res: Response) => {
  const started = process.hrtime.bigint();
  const who = identify(req);
  if (!who.ok) { res.status(401).set('WWW-Authenticate', who.challenge).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }); return; }
  const server = buildServer(app, who.userId, (work) => { void work.catch((e) => console.error('[idle]', e)); });
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

if (SIM_ON) {
  const host = new Host(`http://127.0.0.1:${PORT}/mcp`, (h) => simToken(h, process.env.SIM_SECRET!), (w) => index.knowsBrand(w));
  const hits = new Map<string, { n: number; from: number }>();
  const allow = (ip: string, perMinute = 40) => {
    const now = Date.now(), h = hits.get(ip);
    if (hits.size > 10_000) hits.clear();
    if (!h || now - h.from > 60_000) { hits.set(ip, { n: 1, from: now }); return true; }
    return ++h.n <= perMinute;
  };
  const household = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null);

  http.post('/sim/turn', async (req: Request, res: Response) => {
    const id = household(req.body?.household), text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
    if (!id || !text) { res.status(400).json({ error: 'household and text are required' }); return; }
    if (!allow(req.ip ?? 'unknown')) { res.status(429).json({ error: 'Too many requests. Wait a minute.' }); return; }
    try { res.json(await host.turn(id, text)); }
    catch (e) { console.error('[sim]', e); res.status(500).json({ error: 'The simulator could not reach the add-on.' }); }
  });
  http.post('/sim/reset', (req: Request, res: Response) => { const id = household(req.body?.household); if (id) host.reset(id); res.json({ ok: true }); });
  http.get('/sim/info', (_req, res) => { res.json({ brain: host.brain, recalls: index.size, dataBuiltAt: snapshot?.builtAt ?? null, counts: snapshot?.counts ?? {} }); });
  http.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { extensions: ['html'], maxAge: '5m' }));
}

// Stateless server: there is no stream to open and no session to end.
const notAllowed = (_req: Request, res: Response) => { res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }); };
http.get('/mcp', notAllowed);
http.delete('/mcp', notAllowed);

http.listen(PORT, () => {
  console.log(`recall-check listening on :${PORT}, ${index.size} recalls loaded`);
  if (!index.size || Date.now() - Date.parse(snapshot?.builtAt ?? '1970-01-01') > REFRESH_MS) void refresh();
  setInterval(() => void refresh(), REFRESH_MS).unref();
});
