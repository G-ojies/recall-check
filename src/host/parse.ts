/**
 * Understanding an utterance without a language model. This is the simulator's fallback brain, so the demo
 * runs with no API key. On Alexa+ itself the assistant does this step.
 */
import type { Kind } from '../types.ts';

export type Intent =
  | { tool: 'add_item'; args: { kind: Kind; brand: string; name: string; model?: string; year?: number } }
  | { tool: 'check_my_items' | 'list_items'; args: Record<string, never> }
  | { tool: 'get_recall_guidance' | 'mark_recall_handled'; args: { item?: string } }
  | { tool: 'remove_item'; args: { item: string; confirmed: boolean } }
  | { tool: 'search_recalls'; args: { query: string } }
  | { ask: string; remember?: { name: string; kind: Kind; model?: string; year?: number } }
  | { say: string };

const MAKES = ['land rover', 'mercedes benz', 'mercedes-benz', 'alfa romeo', 'aston martin', 'rolls royce', 'harley davidson', 'harley-davidson'];
const FOOD = /\b(spinach|lettuce|salad|milk|cheese|yogurt|butter|peanut butter|chicken|beef|pork|turkey|sausage|ham|eggs?|bread|cereal|granola|cookies?|crackers|chips|snacks?|candy|chocolate|ice cream|juice|soda|water|coffee|tea|flour|rice|pasta|sauce|soup|fish|tuna|salmon|shrimp|fruit|berries|apples?|onions?|cucumbers?|carrots?|nuts|almonds|cashews|hummus|baby food|formula|frozen)\b/i;
const MED = /\b(medicine|medication|pills?|tablets?|capsules?|caplets?|syrup|drops|ointment|inhaler|supplement|vitamins?|ibuprofen|acetaminophen|aspirin|antibiotic|insulin|prescription|mg)\b/i;
// a car seat is a product, not a car
const CAR = /\b(car(?! seats?\b)|truck|suv|van|minivan|sedan|pickup|motorcycle|vehicle)\b/i;

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,.]+|[\s,.!?]+$/g, '').trim();
const strip = (s: string) => tidy(s.replace(/\b(please|thanks|thank you)\b/gi, '').replace(/\b(to|on|from|off) (my|the|our) (list|watch ?list)\b/gi, ''));
const bare = (s: string) => tidy(s.replace(/^(my|the|our|a|an|that|this)\s+/i, ''));

export interface Thing { kind: Kind; brand: string; name: string; model?: string; year?: number }

/** "2020 Honda Civic", "Cosori air fryer model CP158-AF", "Fisher-Price rock n play". */
export function parseThing(text: string, knowsBrand: (words: string) => boolean, hint?: Kind): Thing {
  let s = strip(text);
  let model: string | undefined, year: number | undefined;
  s = s.replace(/[,]?\s*\b(?:model|model number|model no\.?|part number)\s*(?:is\s+)?([A-Za-z0-9][A-Za-z0-9-]{2,})/i, (_, m: string) => { model = m; return ''; });
  s = s.replace(/\b(19[5-9]\d|20[0-4]\d)\b/, (y) => { year = Number(y); return ''; });
  s = bare(tidy(s));
  const kind: Kind = hint ?? (MED.test(s) ? 'medicine' : FOOD.test(s) ? 'food' : year || CAR.test(s) ? 'vehicle' : 'product');
  if (kind === 'vehicle') s = tidy(s.replace(CAR, ''));
  const words = s.split(' ').filter(Boolean);
  if (words.length < 2) return { kind, brand: '', name: words[0] ?? '', model, year };
  let split = 1;
  const lower = s.toLowerCase();
  const make = kind === 'vehicle' ? MAKES.find((m) => lower.startsWith(`${m} `)) : undefined;
  if (make) split = make.split(' ').length;
  else for (let k = Math.min(3, words.length - 1); k >= 2; k--) if (knowsBrand(words.slice(0, k).join(' '))) { split = k; break; }
  return { kind, brand: words.slice(0, split).join(' '), name: words.slice(split).join(' '), model, year };
}

export interface Memory {
  /** an item named without its brand, waiting for the brand */
  pendingAdd?: { name: string; kind: Kind; model?: string; year?: number };
  /** an item we asked to confirm removing */
  pendingRemove?: string;
  /** the item the conversation is about, so "what should I do about it" works */
  lastItem?: string;
}

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm|please do|correct|that's right)\b/i;
const NO = /^(no|nope|nah|cancel|never ?mind|don't|do not|stop)\b/i;

export function understand(utterance: string, mem: Memory, knowsBrand: (words: string) => boolean): Intent {
  const u = tidy(utterance.replace(/^(hey |ok |okay )?alexa[,.!]?\s*/i, ''));
  if (!u) return { say: 'I did not catch that.' };
  const it = (s: string | undefined) => { const r = bare(strip(s ?? '')); return !r || /^(it|that|this|them|that one|this one)$/i.test(r) ? mem.lastItem : r; };
  let m: RegExpExecArray | null;

  if (mem.pendingRemove) {
    if (YES.test(u)) return { tool: 'remove_item', args: { item: mem.pendingRemove, confirmed: true } };
    if (NO.test(u)) return { say: 'Okay. I will keep watching it.' };
  }
  if (mem.pendingAdd && !/\b(recall|check|list|remove|what)\b/i.test(u)) {
    const brand = bare(u.replace(/^(it's|it is|its|the brand is|brand is|made by|by)\s+/i, ''));
    if (brand && brand.split(' ').length <= 3) return { tool: 'add_item', args: { ...mem.pendingAdd, brand } };
  }

  if (/\b(what (are|am) (you|i) (watching|tracking)|what('s| is) on my list|(list|show|read)( me)? (my|the) (things|items|stuff|list)|what do i (own|have))\b/i.test(u)) return { tool: 'list_items', args: {} };
  if (/\b((any ?thing|something|everything|any of (it|my (stuff|things)))\b.*\brecall|any (new |open )?recalls?\b(?! (on|for|about))|check (my|everything|all|for recalls)|run a check|am i (safe|affected))/i.test(u)) return { tool: 'check_my_items', args: {} };

  if ((m = /^(?:remove|delete|stop (?:watching|tracking)|forget(?: about)?|take off|get rid of)\s+(.+)$/i.exec(u))) {
    const item = it(m[1]);
    return item ? { tool: 'remove_item', args: { item, confirmed: false } } : { ask: 'Which item should I stop watching?' };
  }
  if ((m = /^(?:i|we)(?:'ve| have)?\s+(?:already\s+)?(?:dealt with|handled|fixed|sorted|returned|replaced|repaired|threw (?:away|out)|got (?:a|the|my) (?:refund|replacement|repair)(?: (?:for|on))?)\s*(.*)$/i.exec(u))) {
    const item = it(m[1]);
    return item ? { tool: 'mark_recall_handled', args: { item } } : { ask: 'Which item did you deal with?' };
  }
  if ((m = /\b(?:what (?:should|do|can|must) (?:i|we) do|what now|what next|how do i (?:fix|get|claim)|what(?:'s| is) the (?:remedy|fix)|tell me more|more (?:details|info)|what(?:'s| is) wrong)\b(?:.*?\b(?:about|with|for|on)\s+(.+))?/i.exec(u))) {
    const item = it(m[1]);
    return item ? { tool: 'get_recall_guidance', args: { item } } : { ask: 'Which item do you mean?' };
  }
  if ((m = /^(?:is|are|was|were)\s+(?:there\s+)?(?:a recall (?:on|for)\s+)?(.+?)\s+(?:been\s+)?(?:recalled|under recall|safe|affected)\b/i.exec(u))
    || (m = /^(?:any|are there(?: any)?) recalls? (?:on|for|about)\s+(.+)$/i.exec(u))
    || (m = /^(?:look up|search(?: for)?|find)\s+(?:recalls? (?:on|for|about)\s+)?(.+)$/i.exec(u))) {
    return { tool: 'search_recalls', args: { query: bare(strip(m[1])) } };
  }
  if ((m = /^(?:please\s+)?(?:add|track|watch|save|remember)\s+(.+)$/i.exec(u)) || (m = /^(?:i|we)\s+(?:just\s+)?(?:own|have|bought|got|drive|use|take|ride)\s+(.+)$/i.exec(u))) {
    const hint: Kind | undefined = /\b(drive|ride)\b/i.test(u) ? 'vehicle' : /\btake\b/i.test(u) ? 'medicine' : undefined;
    const t = parseThing(m[1], knowsBrand, hint);
    if (!t.name) return { ask: 'What would you like me to watch? Tell me the brand and what it is.' };
    if (!t.brand) return { ask: `What brand is the ${t.name}?`, remember: { name: t.name, kind: t.kind, model: t.model, year: t.year } };
    return { tool: 'add_item', args: { kind: t.kind, brand: t.brand, name: t.name, ...(t.model ? { model: t.model } : {}), ...(t.year ? { year: t.year } : {}) } };
  }
  if (/^(help|what can you do|how does this work)/i.test(u)) return { say: 'Tell me what you own, like: add my Graco stroller, or: I drive a 2020 Honda Civic. Then ask: is anything I own recalled?' };
  return { say: 'I can watch the things you own for safety recalls. Try: add my Cosori air fryer. Or ask: is anything I own recalled?' };
}
