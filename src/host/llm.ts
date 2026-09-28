/**
 * The simulator's language-model brain. Any OpenAI-compatible chat endpoint with tool calling works
 * (set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL). It stands in for Alexa+, which makes these choices in production.
 */
export interface ToolSpec { name: string; description?: string; inputSchema: unknown }
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export interface LlmConfig { baseUrl: string; apiKey: string; model: string }

export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  if (!env.LLM_API_KEY || !env.LLM_MODEL) return null;
  return { baseUrl: (env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''), apiKey: env.LLM_API_KEY, model: env.LLM_MODEL };
}

export const PERSONA = [
  'You are Alexa, speaking aloud on a smart speaker. You have the Recall Check add-on.',
  'Use its tools for anything about recalls or the things the user owns. Do not answer recall questions from memory.',
  'When a tool returns text, say it to the user as written. It is already phrased for speech. You may drop a sentence, never add facts.',
  'Never read out web addresses, ids or recall numbers. Keep replies under 80 words. No lists, no markdown.',
  'Before removing an item, call remove_item with confirmed false, ask the user, and only call it with confirmed true after they say yes.',
  'If the user names an item without a brand, ask for the brand instead of guessing.',
].join(' ');

export async function runLlmTurn(
  cfg: LlmConfig, history: ChatMessage[], utterance: string, tools: ToolSpec[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<string>, serverInstructions = '', fetcher: typeof fetch = fetch,
): Promise<{ speech: string; history: ChatMessage[] }> {
  const messages: ChatMessage[] = [...history, { role: 'user', content: utterance }];
  const body = (msgs: ChatMessage[]) => JSON.stringify({
    model: cfg.model, temperature: 0.2, max_tokens: 400,
    messages: [{ role: 'system', content: `${PERSONA}\n\nAbout the add-on: ${serverInstructions}` }, ...msgs],
    tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema } })),
  });
  for (let step = 0; step < 5; step++) {
    const res = await fetcher(`${cfg.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }, body: body(messages), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`model endpoint answered ${res.status}`);
    const msg = ((await res.json()) as { choices: { message: ChatMessage }[] }).choices[0]?.message;
    if (!msg) throw new Error('model endpoint sent no message');
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) return { speech: (msg.content ?? '').trim() || 'Sorry, I have nothing to say to that.', history: messages.slice(-16) };
    for (const c of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>; } catch { /* the tool will reject it */ }
      messages.push({ role: 'tool', tool_call_id: c.id, content: await callTool(c.function.name, args) });
    }
  }
  return { speech: 'Sorry, that took me too many steps. Please ask again.', history: messages.slice(-16) };
}
