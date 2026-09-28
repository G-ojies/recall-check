/**
 * Who is calling. Two modes, chosen by AUTH_MODE:
 *   token (default): a bearer token listed in ACCESS_TOKENS as "token:userId,token:userId".
 *   open: no token needed, every caller is the household named by DEMO_USER. For local work and the public demo only.
 * OAuth 2.1 account linking replaces `token` for the Alexa+ listing; see docs/ALEXA-ONBOARDING.md.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export type Identity = { ok: true; userId: string } | { ok: false; challenge: string };

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function parseTokens(spec: string): [string, string][] {
  return spec.split(',').map((p) => p.trim()).filter(Boolean).map((p) => { const i = p.indexOf(':'); return (i > 0 ? [p.slice(0, i), p.slice(i + 1)] : [p, 'default']) as [string, string]; });
}

/**
 * The simulator signs a token for each browser's household, so visitors to the public demo get separate lists
 * without an account. Format: sim.<household>.<hmac>. Only valid when SIM_SECRET is set.
 */
export function simToken(household: string, secret: string): string {
  return `sim.${household}.${createHmac('sha256', secret).update(household).digest('base64url')}`;
}
function simUser(token: string, secret: string | undefined): string | null {
  const m = /^sim\.([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]+)$/.exec(token);
  return m && secret && same(token, simToken(m[1], secret)) ? `sim:${m[1]}` : null;
}

export function identify(req: Pick<Request, 'headers'>, env: NodeJS.ProcessEnv = process.env): Identity {
  if ((env.AUTH_MODE ?? 'token') === 'open') return { ok: true, userId: env.DEMO_USER ?? 'demo' };
  const header = req.headers.authorization ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? '';
  let userId: string | null = simUser(token, env.SIM_SECRET);
  // compare against every token so the time taken does not reveal which one matched
  for (const [t, u] of parseTokens(env.ACCESS_TOKENS ?? '')) if (token && same(token, t)) userId = u;
  return userId ? { ok: true, userId } : { ok: false, challenge: 'Bearer realm="recall-check"' };
}
