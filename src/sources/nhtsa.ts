/** US National Highway Traffic Safety Administration. Public, no key. Queried per vehicle, so results are cached on the household. */
import type { Recall } from '../types.ts';
import { clip } from '../text.ts';

export interface NhtsaRecall {
  NHTSACampaignNumber: string; Manufacturer?: string; ReportReceivedDate?: string; Component?: string; Summary?: string;
  Consequence?: string; Remedy?: string; parkIt?: boolean; parkOutSide?: boolean; ModelYear?: string; Make?: string; Model?: string;
}

/** NHTSA sends dd/mm/yyyy. */
const iso = (d?: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d ?? ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The system the recall is on, in plain words: "FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP" is said as "fuel system". */
export function sayPart(component: string): string {
  return (component.split(':')[0] ?? '').toLowerCase().replace(/,.*$/, '').replace(/\s+/g, ' ').trim() || 'vehicle';
}

export function fromNhtsa(r: NhtsaRecall): Recall | null {
  if (!r.NHTSACampaignNumber) return null;
  const part = title((r.Component ?? 'vehicle').split(':')[0]);
  // The summary opens with a list of every model and year covered. The defect is in the sentences after it.
  const sentences = (r.Summary ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
  const defect = (/\b(is recalling|are recalling|has decided)\b/i.test(sentences[0] ?? '') ? sentences.slice(1) : sentences).join(' ');
  const car = [r.ModelYear, title(r.Make ?? ''), title(r.Model ?? '')].filter(Boolean).join(' ');
  return {
    id: `nhtsa:${r.NHTSACampaignNumber}`, source: 'NHTSA', kind: 'vehicle', date: iso(r.ReportReceivedDate),
    title: `${car} recall: ${part}`,
    brandText: `${r.Make ?? ''} ${r.Manufacturer ?? ''}`, productText: `${r.Model ?? ''} ${r.Component ?? ''}`, models: [],
    hazard: clip(`${defect} ${r.Consequence ?? ''}`, 400) || clip(r.Summary ?? '', 400), part: sayPart(r.Component ?? ''), remedy: clip(r.Remedy ?? '', 500),
    remedyOptions: ['Repair'], contact: 'Your dealer, or the NHTSA hotline at 1-888-327-4236',
    url: `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(r.NHTSACampaignNumber)}`,
    urgent: Boolean(r.parkIt || r.parkOutSide),
  };
}

export async function fetchVehicleRecalls(make: string, model: string, year: number, signal?: AbortSignal): Promise<Recall[]> {
  const q = new URLSearchParams({ make, model, modelYear: String(year) });
  const res = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?${q}`, { signal });
  if (!res.ok) throw new Error(`NHTSA ${res.status}`);
  const rows = ((await res.json()) as { results?: NhtsaRecall[] }).results ?? [];
  return rows.map(fromNhtsa).filter((r): r is Recall => r !== null).sort((a, b) => b.date.localeCompare(a.date));
}
