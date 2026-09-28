/**
 * Recall Check as a serverless function on Vercel. The pages in public/ are served by Vercel itself; this
 * answers /mcp, /oauth, /sim, /health and the metadata.
 *
 * There is no process to keep a timer in, so the recall data is the copy in seed/, which a scheduled GitHub
 * workflow renews (.github/workflows/data.yml). Lists and accounts need Redis: the file system here is temporary.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.ts';

const host = process.env.PUBLIC_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? 'localhost'}`;
const PUBLIC_URL = host.replace(/\/+$/, '');
process.env.HOUSEHOLD_DIR ??= '/tmp/recall-check'; // used only when Redis is not configured

/** Vercel's request context lets work go on after the answer has been sent. */
function afterAnswer(work: Promise<unknown>) {
  const ctx = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[Symbol.for('@vercel/request-context')];
  ctx?.get?.()?.waitUntil?.(work);
}

const ready = createApp({ publicUrl: PUBLIC_URL, mcpUrl: `${PUBLIC_URL}/mcp`, afterAnswer, saveData: false });

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  (await ready).http(req, res);
}
