/**
 * Matching an owned item to recalls.
 *
 * A false alarm costs trust and a missed recall costs safety, so a match is never reported on the brand alone:
 * the recall has to name the maker AND the kind of thing. The model number then decides how sure we are.
 */
import type { Confidence, Item, Match, Recall } from './types.ts';
import { normModel, tokenSet, tokens } from './text.ts';

interface Indexed { recall: Recall; brand: Set<string>; product: Set<string>; all: Set<string> }

export class RecallIndex {
  private rows: Indexed[] = [];
  private byToken = new Map<string, number[]>();
  private byId = new Map<string, Recall>();
  builtAt = new Date(0).toISOString();

  constructor(recalls: Recall[] = []) { this.load(recalls); }

  load(recalls: Recall[]) {
    this.rows = []; this.byToken = new Map(); this.byId = new Map();
    for (const recall of recalls) {
      if (this.byId.has(recall.id)) continue;
      const brand = tokenSet(recall.brandText), product = tokenSet(`${recall.title} ${recall.productText}`);
      const all = new Set([...brand, ...product]);
      const i = this.rows.push({ recall, brand, product, all }) - 1;
      this.byId.set(recall.id, recall);
      for (const t of all) { const l = this.byToken.get(t); if (l) l.push(i); else this.byToken.set(t, [i]); }
    }
    this.builtAt = new Date().toISOString();
  }

  get size() { return this.rows.length; }
  get(id: string) { return this.byId.get(id) ?? null; }

  /** True when some recall names all of these words as its maker. Used to tell where a brand ends in "Fisher Price rock n play". */
  knowsBrand(words: string): boolean {
    const t = tokens(words);
    const makers = this.candidates(t).filter((r) => t.every((x) => r.brand.has(x))).length;
    if (t.length < 2 || !makers) return makers > 0;
    // A recall's maker text also carries its headline, so "Cosori air" is found there too. The last word belongs
    // to the maker's name only if a large share of the recalls that use it are this maker's: "price" is, "air" is not.
    const last = t[t.length - 1];
    const uses = (this.byToken.get(last) ?? []).filter((i) => this.rows[i].brand.has(last)).length;
    return makers / uses >= 0.4;
  }

  /** Recalls that mention every one of these tokens. */
  private candidates(required: string[]): Indexed[] {
    if (!required.length) return [];
    const lists = required.map((t) => this.byToken.get(t) ?? []).sort((a, b) => a.length - b.length);
    if (!lists[0].length) return [];
    const rest = lists.slice(1).map((l) => new Set(l));
    return lists[0].filter((i) => rest.every((s) => s.has(i))).map((i) => this.rows[i]);
  }

  matchItem(item: Item): Match[] {
    const brand = tokens(item.brand), name = tokens(item.name);
    if (!brand.length || !name.length) return [];
    const model = item.model ? normModel(item.model) : '';
    const out: Match[] = [];
    for (const row of this.candidates(brand)) {
      if (row.recall.kind !== item.kind) continue;
      // the maker has to be named as the maker, not merely mentioned in the description
      if (!brand.every((t) => row.brand.has(t))) continue;
      const hit = name.filter((t) => row.product.has(t)).length;
      if (!hit) continue;
      const cover = hit / name.length;
      const listed = row.recall.models;
      const modelHit = model.length >= 3 && listed.some((m) => m === model || (model.length >= 5 && (m.includes(model) || model.includes(m))));
      let confidence: Confidence, why: string;
      if (modelHit) { confidence = 'confirmed'; why = `The recall names model ${item.model}.`; }
      else if (cover === 1 && !(model && listed.length)) { confidence = 'likely'; why = `The recall covers ${item.brand} ${item.name} and you have not given a model number to compare.`; }
      else if (cover === 1) { confidence = 'possible'; why = `The recall covers ${item.brand} ${item.name}, but it lists other model numbers than ${item.model}.`; }
      else if (cover >= 0.5) { confidence = 'possible'; why = `The recall is for a similar ${item.brand} product.`; }
      else continue;
      if (confidence !== 'possible' && !model && listed.length === 0) why = `The recall covers ${item.brand} ${item.name}.`;
      out.push({ item, recall: row.recall, confidence, why });
    }
    return out.sort(byImportance);
  }

  /** Free search for something the household does not own yet ("is the Acme crib recalled?"). */
  search(query: string, limit = 5): Recall[] {
    const q = tokens(query);
    if (!q.length) return [];
    const score = new Map<number, number>();
    for (const t of q) for (const i of this.byToken.get(t) ?? []) score.set(i, (score.get(i) ?? 0) + 1);
    const need = Math.max(1, Math.ceil(q.length * 0.6));
    return [...score].filter(([, s]) => s >= need)
      .sort((a, b) => b[1] - a[1] || this.rows[b[0]].recall.date.localeCompare(this.rows[a[0]].recall.date))
      .slice(0, limit).map(([i]) => this.rows[i].recall);
  }
}

const RANK: Record<Confidence, number> = { confirmed: 0, likely: 1, possible: 2 };
export function byImportance(a: Match, b: Match): number {
  return RANK[a.confidence] - RANK[b.confidence] || Number(b.recall.urgent) - Number(a.recall.urgent) || b.recall.date.localeCompare(a.recall.date);
}

/** Every recall found on NHTSA for a make, model and year applies to "certain" vehicles of that kind; only the VIN settles it. */
export function vehicleMatches(item: Item, recalls: Recall[]): Match[] {
  return recalls.map((recall) => ({
    item, recall, confidence: 'likely' as const,
    why: `It applies to some ${item.year ?? ''} ${item.brand} ${item.name} vehicles. Your VIN confirms whether yours is one of them.`.replace(/\s+/g, ' '),
  }));
}
