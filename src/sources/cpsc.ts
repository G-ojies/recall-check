/** US Consumer Product Safety Commission. Public, no key. https://www.saferproducts.gov/RestWebServices */
import type { Recall } from '../types.ts';
import { clip, modelsIn, normModel } from '../text.ts';

interface Named { Name?: string | null }
export interface CpscRecall {
  RecallID: number; RecallNumber: string; RecallDate: string | null; Description?: string | null; URL?: string | null; Title?: string | null;
  ConsumerContact?: string | null;
  Products?: { Name?: string | null; Description?: string | null; Model?: string | null; Type?: string | null }[];
  Manufacturers?: Named[]; Retailers?: Named[]; Importers?: Named[]; Distributors?: Named[];
  Hazards?: Named[]; Remedies?: Named[]; RemedyOptions?: { Option?: string | null }[];
}

const names = (xs?: Named[]) => (xs ?? []).map((x) => x.Name ?? '').filter(Boolean);

export function fromCpsc(r: CpscRecall): Recall | null {
  if (!r.RecallNumber || !r.RecallDate) return null;
  const products = r.Products ?? [];
  const productText = [...products.map((p) => `${p.Name ?? ''} ${p.Type ?? ''}`), clip(r.Description ?? '', 600)].join(' ');
  const listed = products.map((p) => p.Model ?? '').filter(Boolean).flatMap((m) => m.split(/[,;]|\band\b/)).map(normModel).filter((m) => m.length >= 3);
  const hazard = names(r.Hazards).join(' ');
  // some records repeat the hazard in the remedy field; an empty remedy is more honest than a wrong one
  const remedy = names(r.Remedies).filter((t) => !hazard.includes(t.trim())).join(' ');
  return {
    id: `cpsc:${r.RecallNumber}`, source: 'CPSC', kind: 'product', date: r.RecallDate.slice(0, 10),
    title: r.Title ?? products[0]?.Name ?? 'Product recall',
    // the title leads with the recalling firm, and retailers are often the only place a store brand is named
    brandText: [r.Title ?? '', ...names(r.Manufacturers), ...names(r.Importers), ...names(r.Distributors), ...names(r.Retailers)].join(' '),
    productText,
    models: [...new Set([...listed, ...modelsIn(r.Description ?? '')])],
    hazard: clip(hazard, 400), remedy: clip(remedy, 500),
    remedyOptions: (r.RemedyOptions ?? []).map((o) => o.Option ?? '').filter(Boolean),
    contact: clip(r.ConsumerContact ?? '', 300), url: r.URL ?? 'https://www.cpsc.gov/Recalls',
    urgent: /death|fatal|fire|burn|electrocut|suffocat|strangul|drown|entrap/i.test(`${r.Title ?? ''} ${hazard}`),
  };
}

export async function fetchCpsc(since: string, signal?: AbortSignal): Promise<Recall[]> {
  const res = await fetch(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${since}`, { signal, headers: { 'user-agent': 'recall-check/0.1' } });
  if (!res.ok) throw new Error(`CPSC ${res.status}`);
  return ((await res.json()) as CpscRecall[]).map(fromCpsc).filter((r): r is Recall => r !== null);
}
