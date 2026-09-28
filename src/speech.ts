/**
 * Everything Alexa says is written here. Rules: the action first, short sentences, no web addresses or
 * recall numbers, and an answer that takes under thirty seconds to say (about seventy-five words).
 */
import type { Item, Match, Recall } from './types.ts';
import { clip } from './text.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function sayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : 'an unknown date';
}

/** Short form, used wherever the item sits inside a sentence. */
export function sayItem(i: Item): string {
  return `${i.year ? `${i.year} ` : ''}${i.brand} ${i.name}`.trim();
}

/** Long form with the model number, used when the item is the whole point (just added, listed on a card). */
export function sayItemFull(i: Item): string {
  return i.model && i.kind !== 'vehicle' ? `${sayItem(i)}, model ${i.model}` : sayItem(i);
}

const REMEDY: Record<string, string> = { refund: 'refund', repair: 'free repair', replace: 'replacement', 'new instructions': 'set of new instructions', label: 'corrected label' };
const sayRemedy = (o: string) => REMEDY[o.toLowerCase()] ?? o.toLowerCase();
export function sayAnd(xs: string[], word = 'and'): string {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}`;
}

const first = (s: string, max: number) => clip(s.split(/(?<=[.!?])\s/)[0] ?? s, max).replace(/\s*\([^)]*\)/g, '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The sentence that tells the owner what to do. Agencies sometimes open the remedy by restating the hazard. */
function action(remedy: string, max: number): string {
  const sentences = remedy.split(/(?<=[.!?])\s/);
  const act = sentences.find((s) => /\b(should|contact|return|refund|repair|replace|replacement|dispose|discard|throw|free of charge|dealers? will|will (notify|replace|repair|inspect|update))\b/i.test(s));
  return clip(act ?? sentences[0] ?? remedy, max).replace(/\s*\([^)]*\)/g, '');
}

export const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** One recall on one item. */
export function sayMatch(m: Match): string {
  const it = sayItem(m.item), when = sayDate(m.recall.date);
  let lead: string;
  if (m.item.kind === 'vehicle') lead = `Your ${it} has a recall on the ${m.recall.part ?? 'vehicle'}, from ${when}.`;
  else if (m.confidence === 'confirmed') lead = `Your ${it} is recalled.`;
  else if (m.confidence === 'likely') lead = `Your ${it} is probably affected by a recall from ${when}.`;
  else lead = `There is a recall that may cover your ${it}.`;
  const stop = m.recall.urgent ? (m.item.kind === 'vehicle' ? ' Do not drive it until it is fixed.' : ' Stop using it now.') : '';
  return `${lead}${stop} ${first(m.recall.hazard, 150)}`.trim();
}

/** Every open recall on one item, said as one thought. `matches` must be sorted most important first. */
export function sayItemMatches(matches: Match[]): string {
  if (matches.length === 1) return sayMatch(matches[0]);
  const top = matches[0], it = sayItem(top.item), n = matches.length;
  const urgent = matches.find((m) => m.recall.urgent);
  const lead = top.item.kind === 'vehicle' ? `Your ${it} has ${n} open recalls.`
    : top.confidence === 'confirmed' ? `Your ${it} is recalled, and ${n} recalls cover it.`
    : `Your ${it} is probably affected by ${n} recalls.`;
  const stop = urgent ? (top.item.kind === 'vehicle' ? ' Do not drive it until it is fixed.' : ' Stop using it now.') : '';
  const pick = urgent ?? top;
  const about = top.item.kind === 'vehicle' ? ` The ${urgent ? 'most serious' : 'newest'} is on the ${pick.recall.part ?? 'vehicle'}.` : '';
  return `${lead}${stop}${about} ${first(pick.recall.hazard, 150)}`.trim();
}

function byItem(matches: Match[]): Match[][] {
  const groups = new Map<string, Match[]>();
  for (const m of matches) { const g = groups.get(m.item.id); if (g) g.push(m); else groups.set(m.item.id, [m]); }
  return [...groups.values()];
}

/** `unchecked` are vehicles still being looked up. "No recalls" is never said about something that was not checked. */
export function sayCheck(matches: Match[], itemCount: number, fresh: Set<string>, unchecked: Item[] = []): string {
  if (!itemCount) return 'You have not told me about anything you own yet. Try: add my Graco stroller.';
  const waiting = unchecked.length ? ` I am still checking your ${sayAnd(unchecked.slice(0, 2).map(sayItem))}${unchecked.length > 2 ? ' and others' : ''}. Ask me again in a moment.` : '';
  if (!matches.length) {
    const checked = itemCount - unchecked.length;
    if (!waiting) return `Good news. I checked ${plural(itemCount, 'item')} and found no recalls.`;
    return `${checked ? `I checked ${plural(checked, 'item')} and found no recalls so far.` : 'Nothing to report yet.'}${waiting}`;
  }
  const news = matches.filter((m) => fresh.has(`${m.item.id}|${m.recall.id}`));
  const tell = news.length ? news : matches;
  const groups = byItem(tell);
  const lead = news.length
    ? `I found ${plural(news.length, 'new recall')}.`
    : `Nothing new. You still have ${plural(matches.length, 'open recall')}.`;
  // say as many items as fit in the time a person will listen
  let body = '', told = 0;
  for (const g of groups.slice(0, 3)) {
    const next = sayItemMatches(g);
    if (told && words(`${lead} ${body} ${next}`) > 52) break;
    body += ` ${next}`; told += 1;
  }
  const rest = groups.length - told;
  const more = rest > 0 ? ` ${rest === 1 ? 'One more item is' : `${rest} more items are`} affected. The full list is in the Alexa app.` : '';
  if (waiting) return `${lead}${body}${more}${waiting}`;
  return `${lead}${body}${more} Ask me what to do about any of them.`.replace(/(in the Alexa app\.) Ask me what to do about any of them\.$/, '$1');
}

export function sayWhatToDo(r: Recall, item?: Item, opts: { verify?: boolean; others?: number } = {}): string {
  const what = item ? `your ${sayItem(item)}` : 'it';
  const lead = r.urgent ? (r.kind === 'vehicle' ? `Do not drive ${what} until it is fixed.` : `Stop using ${what} now.`) : `Here is what to do about ${what}.`;
  const offer = r.remedyOptions.length ? sayAnd(r.remedyOptions.map(sayRemedy), 'or') : '';
  const remedy = r.remedy ? action(r.remedy, 200) : offer ? `Contact the company to arrange a ${offer}.` : 'Contact the company for the remedy.';
  const option = r.kind !== 'vehicle' && r.remedy && offer ? ` The remedy on offer is a ${offer}.` : '';
  const verify = !opts.verify ? '' : r.kind === 'vehicle' ? ' To be sure it applies to your car, check your VIN with the dealer.' : ' To be sure, compare the model number on the label with the notice.';
  const others = opts.others ? ` It has ${plural(opts.others, 'more open recall')}.` : '';
  return `${lead} ${remedy}${option}${verify}${others} The contact details and the official notice are in the Alexa app.`;
}

export function saySearch(query: string, found: Recall[]): string {
  if (!found.length) return `I found no recalls matching ${query}.`;
  const lead = `I found ${plural(found.length, 'recall')} matching ${query}.`;
  const shown = found.slice(0, 2).map((r) => `From ${sayDate(r.date)}: ${first(r.title.split(';')[0], 130).replace(/[.;,]?$/, '.')}`).join(' ');
  return `${lead} ${shown}${found.length > 2 ? ' The rest are in the Alexa app.' : ''}`;
}

export function sayList(items: Item[]): string {
  if (!items.length) return 'Your list is empty. Tell me something you own and I will watch it for recalls.';
  const shown = items.slice(0, 5).map(sayItem);
  const said = items.length > 5 ? `${shown.join(', ')}, and ${items.length - 5} more` : sayAnd(shown);
  return `I am watching ${plural(items.length, 'item')}: ${said}.`;
}
