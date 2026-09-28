/** Tokenising shared by the index and the matcher, so both sides of a comparison are reduced the same way. */

const STOP = new Set(('a an and the of for with in on to by from or at as is are this that these those it its be been was were ' +
  'recall recalls recalled recalling due risk hazard hazards injury injuries death serious sold exclusively about units inc llc ltd co corp company ' +
  'usa america american products product brand branded model models').split(' '));

export function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && /(ches|shes|sses|xes)$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function tokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export const tokenSet = (s: string) => new Set(tokens(s));

/** Model numbers are compared with spacing, dashes and case removed: "YD-001" and "yd 001" are the same model. */
export function normModel(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Pull things that look like model numbers out of free text: a mix of letters and digits, or a long run of digits. */
export function modelsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(/\b[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*\b/g) ?? []) {
    const n = normModel(m);
    if (n.length < 4 || n.length > 20) continue;
    const hasDigit = /\d/.test(n), hasAlpha = /[A-Z]/.test(n);
    if ((hasDigit && hasAlpha) || (hasDigit && n.length >= 5 && !/^(19|20)\d{2}$/.test(n))) out.add(n);
  }
  return [...out];
}

export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '...').trim();
}
