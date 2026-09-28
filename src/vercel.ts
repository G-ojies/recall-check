/**
 * Recall Check as a serverless function on Vercel. `npm run build` bundles it into dist/, with the pages in
 * public/ built in, and index.js at the root hands it to the platform.
 *
 * There is no process to keep a timer in, so the recall data is the copy in seed/, built into the bundle, which
 * a scheduled GitHub workflow renews (.github/workflows/data.yml). Lists and accounts need Redis: the file
 * system here is temporary.
 */
import seed from '../seed/recalls.json.gz';
import pages from 'virtual:pages';
import { createApp } from './http.ts';

const host = process.env.PUBLIC_URL ?? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? 'localhost'}`;
const PUBLIC_URL = host.replace(/\/+$/, '');
process.env.HOUSEHOLD_DIR ??= '/tmp/recall-check'; // used only when Redis is not configured

/** Vercel's request context lets work go on after the answer has been sent. */
function afterAnswer(work: Promise<unknown>) {
  const ctx = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[Symbol.for('@vercel/request-context')];
  ctx?.get?.()?.waitUntil?.(work);
}

export const app = (await createApp({ publicUrl: PUBLIC_URL, mcpUrl: `${PUBLIC_URL}/mcp`, afterAnswer, saveData: false, seed, pages })).http;
