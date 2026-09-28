/** What Recall Check can do, independent of how it is called (MCP tool, test, simulator). */
import { randomUUID } from 'node:crypto';
import type { Household, Item, Kind, Match, Recall } from './types.ts';
import { RecallIndex, byImportance, vehicleMatches } from './match.ts';
import type { Store } from './store.ts';
import { fetchVehicleRecalls } from './sources/nhtsa.ts';
import { normModel, tokens } from './text.ts';

export const MAX_ITEMS = 100;
const VEHICLE_TTL_MS = 24 * 3600 * 1000;

export type VehicleLookup = (make: string, model: string, year: number) => Promise<Recall[]>;

export interface NewItem { kind: Kind; brand: string; name: string; model?: string; year?: number }

export class RecallCheck {
  constructor(
    readonly index: RecallIndex, private store: Store,
    private lookupVehicle: VehicleLookup = (make, model, year) => fetchVehicleRecalls(make, model, year, AbortSignal.timeout(8000)),
    private now: () => Date = () => new Date(),
  ) {}

  private matchesFor(h: Household, item: Item): Match[] {
    const handled = new Set(h.handled[item.id] ?? []);
    const found = item.kind === 'vehicle' ? vehicleMatches(item, h.vehicleRecalls[item.id]?.recalls ?? []) : this.index.matchItem(item);
    return found.filter((m) => !handled.has(m.recall.id));
  }

  /** Vehicles are looked up once when added and again when the copy is a day old. Never on the answer path. */
  private async refreshVehicle(h: Household, item: Item): Promise<boolean> {
    if (item.kind !== 'vehicle' || !item.year) return false;
    try {
      h.vehicleRecalls[item.id] = { fetchedAt: this.now().toISOString(), recalls: await this.lookupVehicle(item.brand, item.name, item.year) };
      return true;
    } catch { return false; } // NHTSA down: keep whatever we had
  }

  /**
   * A vehicle lookup gets `budgetMs` to answer. If the agency is slower than that the item is saved, the caller is
   * told the check is still running, and `pending` resolves once the recalls have been stored.
   */
  async addItem(userId: string, input: NewItem, budgetMs = 250): Promise<{ item: Item; matches: Match[]; duplicate: boolean; vehicleChecked: boolean; pending: Promise<void> | null }> {
    const h = await this.store.get(userId);
    const brand = input.brand.trim(), name = input.name.trim();
    if (!tokens(brand).length || !tokens(name).length) throw new UserError('I need both the brand and what it is. For example: Graco stroller.');
    if (input.kind === 'vehicle' && !input.year) throw new UserError('I need the model year to check a vehicle. For example: 2020 Honda Civic.');
    const same = h.items.find((i) => i.kind === input.kind && sameText(i.brand, brand) && sameText(i.name, name) && normModel(i.model ?? '') === normModel(input.model ?? '') && (i.year ?? 0) === (input.year ?? 0));
    if (same) return { item: same, matches: this.matchesFor(h, same), duplicate: true, vehicleChecked: Boolean(h.vehicleRecalls[same.id]), pending: null };
    if (h.items.length >= MAX_ITEMS) throw new UserError(`Your list is full at ${MAX_ITEMS} items. Remove one first.`);
    const item: Item = { id: randomUUID().slice(0, 8), kind: input.kind, brand, name, ...(input.model?.trim() ? { model: input.model.trim() } : {}), ...(input.year ? { year: input.year } : {}), addedAt: this.now().toISOString() };
    h.items.push(item);
    let vehicleChecked = false, pending: Promise<void> | null = null;
    if (item.kind === 'vehicle') {
      const lookup = this.refreshVehicle(h, item);
      let timer: NodeJS.Timeout | undefined;
      const inTime = await Promise.race([lookup, new Promise<null>((r) => { timer = setTimeout(() => r(null), budgetMs); })]);
      clearTimeout(timer);
      if (inTime === null) {
        await this.store.put(userId, h); // save the item now, without recalls
        pending = lookup.then(async (ok) => { if (ok) await this.storeVehicle(userId, item.id, h.vehicleRecalls[item.id]); });
        return { item, matches: [], duplicate: false, vehicleChecked: false, pending };
      }
      vehicleChecked = inTime;
    }
    const matches = this.matchesFor(h, item);
    h.seen[item.id] = matches.map((m) => m.recall.id);
    await this.store.put(userId, h);
    return { item, matches, duplicate: false, vehicleChecked, pending };
  }

  /** Write one vehicle's recalls into the household as it is now, so a change made while the lookup ran is kept. */
  private async storeVehicle(userId: string, itemId: string, found: Household['vehicleRecalls'][string] | undefined): Promise<void> {
    if (!found) return;
    const h = await this.store.get(userId);
    if (!h.items.some((i) => i.id === itemId)) return; // removed in the meantime
    h.vehicleRecalls[itemId] = found;
    await this.store.put(userId, h);
  }

  async listItems(userId: string): Promise<Item[]> { return (await this.store.get(userId)).items; }

  async removeItem(userId: string, ref: string): Promise<Item | null> {
    const h = await this.store.get(userId);
    const item = findItem(h.items, ref);
    if (!item) return null;
    h.items = h.items.filter((i) => i.id !== item.id);
    delete h.handled[item.id]; delete h.seen[item.id]; delete h.vehicleRecalls[item.id];
    await this.store.put(userId, h);
    return item;
  }

  /** Check everything. `fresh` holds "itemId|recallId" for matches the owner has not been told about before. */
  async checkAll(userId: string): Promise<{ items: Item[]; matches: Match[]; fresh: Set<string>; stale: Item[] }> {
    const h = await this.store.get(userId);
    const matches: Match[] = [], fresh = new Set<string>(), stale: Item[] = [];
    for (const item of h.items) {
      const cached = h.vehicleRecalls[item.id];
      if (item.kind === 'vehicle' && item.year && (!cached || this.now().getTime() - Date.parse(cached.fetchedAt) > VEHICLE_TTL_MS)) stale.push(item);
      const seen = new Set(h.seen[item.id] ?? []);
      for (const m of this.matchesFor(h, item)) {
        matches.push(m);
        if (!seen.has(m.recall.id)) { fresh.add(`${item.id}|${m.recall.id}`); seen.add(m.recall.id); }
      }
      h.seen[item.id] = [...seen];
    }
    if (fresh.size) await this.store.put(userId, h);
    return { items: h.items, matches: matches.sort(byImportance), fresh, stale };
  }

  /** Re-fetch vehicle recalls that are a day old. Called after the answer has been sent. */
  async refreshStale(userId: string, stale: Item[]): Promise<void> {
    if (!stale.length) return;
    const scratch = await this.store.get(userId);
    for (const s of stale) {
      const item = scratch.items.find((i) => i.id === s.id);
      if (item && (await this.refreshVehicle(scratch, item))) await this.storeVehicle(userId, item.id, scratch.vehicleRecalls[item.id]);
    }
  }

  async openRecallsFor(userId: string, ref: string): Promise<{ item: Item; matches: Match[] } | null> {
    const h = await this.store.get(userId);
    const item = findItem(h.items, ref);
    return item ? { item, matches: this.matchesFor(h, item) } : null;
  }

  async markHandled(userId: string, ref: string, recallId?: string): Promise<{ item: Item; handled: Recall[] } | null> {
    const h = await this.store.get(userId);
    const item = findItem(h.items, ref);
    if (!item) return null;
    const open = this.matchesFor(h, item).filter((m) => !recallId || m.recall.id === recallId);
    if (!open.length) return { item, handled: [] };
    h.handled[item.id] = [...new Set([...(h.handled[item.id] ?? []), ...open.map((m) => m.recall.id)])];
    await this.store.put(userId, h);
    return { item, handled: open.map((m) => m.recall) };
  }

  findRecall(h: Household | null, id: string): Recall | null {
    const hit = this.index.get(id);
    if (hit || !h) return hit;
    for (const v of Object.values(h.vehicleRecalls)) { const r = v.recalls.find((x) => x.id === id); if (r) return r; }
    return null;
  }
  async recallById(userId: string, id: string) { return this.findRecall(await this.store.get(userId), id); }
}

/** An error whose message is safe and useful to say aloud. */
export class UserError extends Error {}

const sameText = (a: string, b: string) => tokens(a).join(' ') === tokens(b).join(' ');

/** Find an item from how a person refers to it: its id, or words such as "stroller" or "the Honda". */
export function findItem(items: Item[], ref: string): Item | null {
  const byId = items.find((i) => i.id === ref.trim());
  if (byId) return byId;
  const want = tokens(ref);
  if (!want.length) return null;
  let best: Item | null = null, bestScore = 0, tie = false;
  for (const i of items) {
    const have = new Set(tokens(`${i.brand} ${i.name} ${i.model ?? ''} ${i.year ?? ''}`));
    const score = want.filter((t) => have.has(t)).length / want.length;
    if (score > bestScore) { best = i; bestScore = score; tie = false; } else if (score === bestScore && score > 0) tie = true;
  }
  return bestScore >= 0.5 && !tie ? best : null;
}
