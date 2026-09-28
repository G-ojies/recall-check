/**
 * The simulated Alexa+ host. It plays the part the real assistant plays: it hears an utterance, decides which
 * tool to call, calls it over MCP (a real client, over HTTP, against the same endpoint Alexa+ would use),
 * and speaks the result. Every tool call is timed, because the platform's limit is 500 ms.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { understand, type Memory } from './parse.ts';
import { llmFromEnv, runLlmTurn, type ChatMessage, type LlmConfig } from './llm.ts';

export interface TraceStep { tool: string; args: Record<string, unknown>; ms: number; ok: boolean }
export interface Card { kind: 'recall' | 'items' | 'note'; title: string; text?: string; url?: string; agency?: string; date?: string; urgent?: boolean; confidence?: string; item?: string; remedy?: string; items?: string[] }
export interface Turn { speech: string; cards: Card[]; trace: TraceStep[]; brain: 'rules' | 'model'; totalMs: number }

interface Session { memory: Memory; history: ChatMessage[]; touched: number }

type Data = Record<string, any>;

export class Host {
  private sessions = new Map<string, Session>();
  constructor(
    private mcpUrl: string, private tokenFor: (household: string) => string,
    private knowsBrand: (words: string) => boolean, private llm: LlmConfig | null = llmFromEnv(),
  ) {}

  get brain(): 'rules' | 'model' { return this.llm ? 'model' : 'rules'; }

  private session(id: string): Session {
    const now = Date.now();
    if (this.sessions.size > 5000) for (const [k, s] of this.sessions) if (now - s.touched > 3600_000) this.sessions.delete(k);
    let s = this.sessions.get(id);
    if (!s) { s = { memory: {}, history: [], touched: now }; this.sessions.set(id, s); }
    s.touched = now;
    return s;
  }

  private async connect(household: string, bearer?: string): Promise<Client> {
    const client = new Client({ name: 'Alexa+ simulator', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${bearer ?? this.tokenFor(household)}` } } }));
    return client;
  }

  /** `bearer` is the access token of a linked account; without one the browser's own household is used. */
  async turn(household: string, utterance: string, bearer?: string): Promise<Turn> {
    const t0 = performance.now();
    const s = this.session(household);
    const trace: TraceStep[] = [], cards: Card[] = [];
    const client = await this.connect(household, bearer);
    const call = async (tool: string, args: Record<string, unknown>) => {
      const c0 = performance.now();
      const r = await client.callTool({ name: tool, arguments: args });
      trace.push({ tool, args, ms: Math.round((performance.now() - c0) * 10) / 10, ok: !r.isError });
      const data = (r.structuredContent ?? {}) as Data;
      this.remember(s.memory, tool, data, Boolean(r.isError));
      cards.push(...cardsFrom(tool, data));
      return { said: ((r.content as { text?: string }[] | undefined)?.[0]?.text ?? '').trim(), data };
    };
    try {
      let speech: string, brain: Turn['brain'] = 'rules';
      if (this.llm) {
        try {
          const { tools } = await client.listTools();
          const out = await runLlmTurn(this.llm, s.history, utterance, tools, async (n, a) => (await call(n, a)).said, client.getInstructions() ?? '');
          s.history = out.history; speech = out.speech; brain = 'model';
        } catch (e) {
          console.error('[host] model failed, using rules:', (e as Error).message);
          trace.length = 0; cards.length = 0;
          speech = await this.byRules(s, utterance, call);
        }
      } else speech = await this.byRules(s, utterance, call);
      return { speech, cards: dedupe(cards).slice(0, 5), trace, brain, totalMs: Math.round(performance.now() - t0) };
    } finally { await client.close().catch(() => {}); }
  }

  private async byRules(s: Session, utterance: string, call: (tool: string, args: Record<string, unknown>) => Promise<{ said: string }>): Promise<string> {
    const intent = understand(utterance, s.memory, this.knowsBrand);
    // a pending question is answered by this utterance or dropped by it
    s.memory.pendingAdd = undefined; s.memory.pendingRemove = undefined;
    if ('say' in intent) return intent.say;
    if ('ask' in intent) { s.memory.pendingAdd = intent.remember; return intent.ask; }
    return (await call(intent.tool, intent.args)).said;
  }

  private remember(mem: Memory, tool: string, data: Data, failed: boolean) {
    if (failed) return;
    const item = data.item ?? data.needsConfirmation ?? data.matches?.[0]?.item;
    if (item?.id && tool !== 'remove_item') mem.lastItem = item.id;
    if (tool === 'remove_item') { mem.pendingRemove = data.needsConfirmation?.id; if (data.removed && mem.lastItem === data.removed.id) mem.lastItem = undefined; }
  }

  reset(household: string) { this.sessions.delete(household); }
}

function cardsFrom(tool: string, d: Data): Card[] {
  const out: Card[] = [];
  const fromRecall = (r: Data, extra: Partial<Card> = {}): Card => ({ kind: 'recall', title: r.title, text: r.hazard, remedy: r.remedy, url: r.url, agency: r.agency, date: r.date, urgent: r.urgent, ...extra });
  for (const m of (d.matches ?? []) as Data[]) out.push(fromRecall(m.recall, { confidence: m.confidence, item: m.item.spoken }));
  if (d.recall) out.push(fromRecall(d.recall));
  for (const r of (d.recalls ?? []) as Data[]) out.push(fromRecall(r));
  for (const r of (d.handled ?? []) as Data[]) out.push({ kind: 'note', title: 'Marked as dealt with', text: r.title });
  if (tool === 'list_items' && d.items?.length) out.push({ kind: 'items', title: 'Watching', items: (d.items as Data[]).map((i) => i.spoken) });
  return out;
}

function dedupe(cards: Card[]): Card[] {
  const seen = new Set<string>();
  return cards.filter((c) => { const k = `${c.kind}|${c.title}|${c.item ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
