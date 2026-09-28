/** openFDA enforcement reports (food and drug recalls). Public, no key needed at this volume. https://open.fda.gov/apis/ */
import type { Kind, Recall } from '../types.ts';
import { clip, modelsIn } from '../text.ts';

export interface FdaRecall {
  recall_number: string; status?: string; classification?: string; product_type?: string; recalling_firm?: string;
  product_description?: string; reason_for_recall?: string; recall_initiation_date?: string; report_date?: string;
  code_info?: string; distribution_pattern?: string;
}

const iso = (d?: string) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '');

export function fromFda(r: FdaRecall, kind: Kind): Recall | null {
  const date = iso(r.recall_initiation_date) || iso(r.report_date);
  if (!r.recall_number || !date) return null;
  const what = clip(r.product_description ?? '', 160);
  return {
    id: `fda:${r.recall_number}`, source: 'FDA', kind, date,
    title: `${r.recalling_firm ?? 'A firm'} recalls ${what}`,
    brandText: `${r.recalling_firm ?? ''} ${r.product_description ?? ''}`,
    productText: r.product_description ?? '',
    models: modelsIn(r.code_info ?? ''),
    hazard: clip(r.reason_for_recall ?? '', 400),
    remedy: kind === 'food'
      ? 'Do not eat it. Throw it away or return it to the store where you bought it for a refund.'
      : 'Do not stop a prescribed medicine on your own. Ask your pharmacist or doctor about a replacement, and return the recalled product to the pharmacy.',
    remedyOptions: [], contact: r.recalling_firm ?? '',
    url: `https://www.accessdata.fda.gov/scripts/ires/index.cfm?action=Search.Search&recallNumber=${encodeURIComponent(r.recall_number)}`,
    urgent: r.classification === 'Class I',
  };
}

/** Ongoing recalls only, newest first. openFDA pages at most 1,000 rows and allows skip up to 25,000. */
export async function fetchFda(endpoint: 'food' | 'drug', since: string, signal?: AbortSignal, max = 5000): Promise<Recall[]> {
  const kind: Kind = endpoint === 'food' ? 'food' : 'medicine';
  const from = since.replace(/-/g, '');
  const out: Recall[] = [];
  for (let skip = 0; skip < max; skip += 1000) {
    const q = `search=status:Ongoing+AND+report_date:[${from}+TO+29991231]&sort=report_date:desc&limit=1000&skip=${skip}`;
    const res = await fetch(`https://api.fda.gov/${endpoint}/enforcement.json?${q}`, { signal });
    if (res.status === 404) break; // openFDA answers 404 when a search has no rows
    if (!res.ok) throw new Error(`openFDA ${endpoint} ${res.status}`);
    const rows = ((await res.json()) as { results?: FdaRecall[] }).results ?? [];
    for (const r of rows) { const n = fromFda(r, kind); if (n) out.push(n); }
    if (rows.length < 1000) break;
  }
  return out;
}
