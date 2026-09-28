/**
 * The MCP surface. Seven tools, each named for what a person would ask for.
 *
 * Every result carries two things: `content` is one short paragraph written to be spoken, and
 * `structuredContent` holds the same facts as data plus a card (title, text, link) for a screen.
 * Nothing on the answer path calls a government API: answers come from the local index and the household file.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Item, Kind, Match, Recall } from './types.ts';
import { RecallCheck, UserError, findItem } from './service.ts';
import { sayCheck, sayDate, sayItem, sayItemFull, sayItemMatches, sayList, saySearch, sayWhatToDo } from './speech.ts';

export const SERVER_INFO = { name: 'recall-check', title: 'Recall Check', version: '0.1.0' };
/** Tools that need no household, so they answer before an account is linked. */
export const PUBLIC_TOOLS: string[] = ['search_recalls'];

const INSTRUCTIONS = [
  'Recall Check watches the things a household owns for United States safety recalls (consumer products, vehicles, food, medicine).',
  'Add an item as soon as the user mentions owning something. Ask for a model number only if the user has it to hand; it is optional.',
  'Read the text result to the user as written. It is already phrased for speech. Do not read web addresses or recall numbers aloud.',
  'Confidence matters: "confirmed" means the model number matches, "likely" and "possible" mean the user should compare the label. Never state a possible match as certain.',
  'For medicine, never tell the user to stop a prescribed drug. Tell them to ask their pharmacist or doctor.',
].join(' ');

const KindIn = z.string().max(30).describe('One of: product, vehicle, food, medicine. product = anything sold to consumers (appliance, furniture, toy, baby gear, tool, electronics). vehicle = car, truck, SUV, van, motorcycle. food = food, drink, groceries. medicine = drug, medication, pills, supplement.');

/** People and models say "car" and "drug"; the four kinds are ours. */
const KINDS: Record<Kind, string[]> = {
  product: ['product', 'appliance', 'furniture', 'toy', 'electronics', 'device', 'gear', 'tool', 'item', 'thing', 'consumer product'],
  vehicle: ['vehicle', 'car', 'truck', 'suv', 'van', 'minivan', 'motorcycle', 'auto', 'automobile'],
  food: ['food', 'drink', 'beverage', 'grocery', 'groceries', 'snack'],
  medicine: ['medicine', 'drug', 'medication', 'pill', 'pills', 'supplement', 'vitamin', 'prescription'],
};
export function toKind(said: string): Kind {
  const s = said.trim().toLowerCase();
  for (const k of Object.keys(KINDS) as Kind[]) if (KINDS[k].includes(s) || KINDS[k].includes(s.replace(/s$/, ''))) return k;
  throw new UserError('Is that a product, a vehicle, food or medicine?');
}

// What every tool returns, declared so the host can rely on it.
const ItemOut = z.object({ id: z.string(), kind: z.string(), brand: z.string(), name: z.string(), model: z.string().nullable(), year: z.number().nullable(), spoken: z.string() });
const RecallOut = z.object({ id: z.string(), agency: z.string(), date: z.string(), title: z.string(), part: z.string().nullable(), hazard: z.string(), remedy: z.string(), remedyOptions: z.array(z.string()), contact: z.string(), url: z.string(), urgent: z.boolean() });
const MatchOut = z.object({ item: ItemOut, recall: RecallOut, confidence: z.enum(['confirmed', 'likely', 'possible']), why: z.string(), isNew: z.boolean() });
const CardOut = z.object({ title: z.string(), text: z.string(), url: z.string().optional() });
const speech = z.string().describe('The answer, written to be read aloud.');

const item = (i: Item) => ({ id: i.id, kind: i.kind, brand: i.brand, name: i.name, model: i.model ?? null, year: i.year ?? null, spoken: sayItemFull(i) });
const recall = (r: Recall) => ({ id: r.id, agency: r.source, date: r.date, title: r.title, part: r.part ?? null, hazard: r.hazard, remedy: r.remedy, remedyOptions: r.remedyOptions, contact: r.contact, url: r.url, urgent: r.urgent });
const match = (m: Match, isNew = false) => ({ item: item(m.item), recall: recall(m.recall), confidence: m.confidence, why: m.why, isNew });
const card = (title: string, text: string, url?: string) => ({ title, text, ...(url ? { url } : {}) });

function say(speech: string, data: Record<string, unknown> = {}): CallToolResult {
  return { content: [{ type: 'text', text: speech }], structuredContent: { speech, ...data } };
}
function fail(e: unknown): CallToolResult {
  const speech = e instanceof UserError ? e.message : 'Something went wrong on my side. Please try again in a moment.';
  if (!(e instanceof UserError)) console.error('[recall-check]', e);
  return { content: [{ type: 'text', text: speech }], structuredContent: { speech }, isError: true };
}

export function buildServer(app: RecallCheck, userId: string, onIdle: (work: Promise<unknown>) => void = () => {}): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool('add_item', {
    title: 'Add something I own',
    description: 'Save something the user owns so it is watched for recalls, and check it straight away. Use when the user says they own, bought or use a product, vehicle, food or medicine. Example: "add my Graco stroller", "I drive a 2020 Honda Civic".',
    inputSchema: {
      kind: KindIn,
      brand: z.string().min(1).max(60).describe('The maker or brand, e.g. "Graco", "Honda", "Ninja". For a vehicle this is the make.'),
      name: z.string().min(1).max(80).describe('What it is, in plain words, e.g. "stroller", "air fryer", "infant car seat". For a vehicle this is the model, e.g. "Civic".'),
      model: z.string().max(40).optional().describe('Model number from the label, if the user gave one. Never guess it.'),
      year: z.number().int().min(1950).max(2100).optional().describe('Model year. Required for a vehicle.'),
    },
    outputSchema: { speech, item: ItemOut.optional(), matches: z.array(MatchOut).optional(), duplicate: z.boolean().optional(), stillChecking: z.boolean().optional() },
    annotations: { title: 'Add something I own', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => {
    try {
      const r = await app.addItem(userId, { ...a, kind: toKind(a.kind) });
      if (r.pending) onIdle(r.pending);
      const lead = r.duplicate ? `Your ${sayItemFull(r.item)} is already on the list.` : `Added your ${sayItemFull(r.item)}.`;
      const waiting = r.item.kind === 'vehicle' && !r.vehicleChecked && !r.duplicate;
      const body = r.matches.length
        ? ` ${sayItemMatches(r.matches)} Ask me what to do about it.`
        : waiting ? ' I am checking the vehicle recall database now. Ask me about it in a moment.'
        : ' I found no recalls for it, and I will keep watching.';
      return say(`${lead}${body}`, { item: item(r.item), matches: r.matches.map((m) => match(m, true)), duplicate: r.duplicate, stillChecking: waiting });
    } catch (e) { return fail(e); }
  });

  server.registerTool('check_my_items', {
    title: 'Check my things for recalls',
    description: 'Check everything the user owns against current recalls. Use for "is anything I own recalled", "any new recalls", "check my stuff". New recalls since the last check are reported first.',
    inputSchema: {},
    outputSchema: { speech, itemCount: z.number().optional(), newCount: z.number().optional(), matches: z.array(MatchOut).optional(), stillChecking: z.array(ItemOut).optional().describe('Vehicles whose recalls are still being fetched. Nothing is known about them yet.'), card: CardOut.optional() },
    annotations: { title: 'Check my things for recalls', readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try {
      const r = await app.checkAll(userId);
      onIdle(app.refreshStale(userId, r.stale));
      const top = r.matches[0];
      return say(sayCheck(r.matches, r.items.length, r.fresh, r.unchecked), {
        itemCount: r.items.length, newCount: r.fresh.size, stillChecking: r.unchecked.map(item),
        // new ones first, so the screen shows what the voice is talking about
        matches: r.matches.map((m) => match(m, r.fresh.has(`${m.item.id}|${m.recall.id}`))).sort((a, b) => Number(b.isNew) - Number(a.isNew)),
        ...(top ? { card: card(top.recall.title, `${top.recall.hazard}\n\nWhat to do: ${top.recall.remedy}`, top.recall.url) } : {}),
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('get_recall_guidance', {
    title: 'What should I do about this recall',
    description: 'Explain what to do about a recall: whether to stop using the item, the remedy (refund, repair, replacement) and who to contact. Give either the item the user means or a recall id from an earlier result.',
    inputSchema: {
      item: z.string().max(120).optional().describe('How the user referred to the item, e.g. "the stroller", "my Honda". Or an item id.'),
      recall_id: z.string().max(60).optional().describe('A recall id from an earlier result, e.g. "cpsc:26789".'),
    },
    outputSchema: { speech, item: ItemOut.optional(), recall: RecallOut.optional(), matches: z.array(MatchOut).optional(), card: CardOut.optional() },
    annotations: { title: 'What should I do about this recall', readOnlyHint: true, openWorldHint: false },
  }, async (a) => {
    try {
      if (a.recall_id) {
        const r = await app.recallById(userId, a.recall_id);
        if (!r) throw new UserError('I could not find that recall. Ask me to check your things again.');
        return say(sayWhatToDo(r), { recall: recall(r), card: card(r.title, `${r.remedy}\n\nContact: ${r.contact}`, r.url) });
      }
      if (!a.item) throw new UserError('Which item do you mean?');
      const found = await app.openRecallsFor(userId, a.item);
      if (!found) throw new UserError(`I do not have ${a.item} on your list. Ask me what I am watching.`);
      if (!found.matches.length) return say(`There are no open recalls for your ${sayItem(found.item)}.`, { item: item(found.item), matches: [] });
      const m = found.matches[0];
      return say(sayWhatToDo(m.recall, m.item, { verify: m.confidence !== 'confirmed', others: found.matches.length - 1 }), {
        item: item(found.item), matches: found.matches.map((x) => match(x)),
        card: card(m.recall.title, `${m.recall.remedy}\n\nContact: ${m.recall.contact}`, m.recall.url),
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('mark_recall_handled', {
    title: 'I have dealt with this recall',
    description: 'Record that the user has dealt with a recall (got the refund, repair or replacement, or threw the item away) so it is not reported again. Use only when the user says they have dealt with it.',
    inputSchema: {
      item: z.string().min(1).max(120).describe('How the user referred to the item, or an item id.'),
      recall_id: z.string().max(60).optional().describe('Limit to one recall. Leave out to mark every open recall on the item.'),
    },
    outputSchema: { speech, item: ItemOut.optional(), handled: z.array(RecallOut).optional() },
    annotations: { title: 'I have dealt with this recall', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => {
    try {
      const r = await app.markHandled(userId, a.item, a.recall_id);
      if (!r) throw new UserError(`I do not have ${a.item} on your list.`);
      if (!r.handled.length) return say(`Your ${sayItem(r.item)} has no open recalls to mark.`, { item: item(r.item), handled: [] });
      return say(`Done. I will not mention ${r.handled.length === 1 ? 'that recall' : `those ${r.handled.length} recalls`} on your ${sayItem(r.item)} again.`, { item: item(r.item), handled: r.handled.map(recall) });
    } catch (e) { return fail(e); }
  });

  server.registerTool('list_items', {
    title: 'What am I watching',
    description: 'List what the user has asked Recall Check to watch.',
    inputSchema: {},
    outputSchema: { speech, items: z.array(ItemOut).optional() },
    annotations: { title: 'What am I watching', readOnlyHint: true, openWorldHint: false },
  }, async () => {
    try { const items = await app.listItems(userId); return say(sayList(items), { items: items.map(item) }); }
    catch (e) { return fail(e); }
  });

  server.registerTool('remove_item', {
    title: 'Stop watching an item',
    description: 'Remove something from the list, for example when the user sold it or threw it away. Call first with confirmed false: the answer names the item and asks the user to confirm. Call again with confirmed true only after the user has said yes.',
    inputSchema: {
      item: z.string().min(1).max(120).describe('How the user referred to the item, or an item id.'),
      confirmed: z.boolean().default(false).describe('True only when the user has just said yes to removing this exact item.'),
    },
    outputSchema: { speech, removed: ItemOut.optional(), needsConfirmation: ItemOut.optional() },
    annotations: { title: 'Stop watching an item', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (a) => {
    try {
      const unclear = new UserError(`I could not tell which item you mean by ${a.item}. Ask me what I am watching.`);
      if (!a.confirmed) {
        const target = findItem(await app.listItems(userId), a.item);
        if (!target) throw unclear;
        return say(`Do you want me to stop watching your ${sayItemFull(target)}?`, { needsConfirmation: item(target) });
      }
      const gone = await app.removeItem(userId, a.item);
      if (!gone) throw unclear;
      return say(`Removed your ${sayItem(gone)}.`, { removed: item(gone) });
    } catch (e) { return fail(e); }
  });

  server.registerTool('search_recalls', {
    title: 'Look up a recall',
    description: 'Search recalls for something the user does not own yet or is about to buy, e.g. "is the Fisher-Price Rock n Play recalled". Covers consumer products, food and medicine. For a vehicle, add it with add_item instead.',
    inputSchema: { query: z.string().min(2).max(120).describe('Brand and product in plain words.') },
    outputSchema: { speech, recalls: z.array(RecallOut).optional(), card: CardOut.optional() },
    annotations: { title: 'Look up a recall', readOnlyHint: true, openWorldHint: false },
  }, async (a) => {
    try {
      const found = app.index.search(a.query, 5);
      const top = found[0];
      return say(saySearch(a.query, found), { recalls: found.map(recall), ...(top ? { card: card(top.title, `${sayDate(top.date)}. ${top.hazard}`, top.url) } : {}) });
    } catch (e) { return fail(e); }
  });

  return server;
}
