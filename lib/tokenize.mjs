// lib/tokenize.mjs — word/number tokens, lines, paragraphs. SPEC B.9 / D1 §1.3.
import { WORD_RE, NUM_RE } from './unicode.mjs';

/** Word tokens on the NFC view. This count is what every gate in SPEC D.2 counts. */
export function words(nfc) {
  const out = [];
  const re = new RegExp(WORD_RE.source, WORD_RE.flags);
  let m;
  while ((m = re.exec(nfc)) !== null) out.push({ t: m[0], i: m.index });
  return out;
}

export function numbers(nfc) {
  const out = [];
  const re = new RegExp(NUM_RE.source, NUM_RE.flags);
  let m;
  while ((m = re.exec(nfc)) !== null) out.push({ t: m[0], i: m.index });
  return out;
}

export function wordCount(s) { return words(s).length; }

export function lines(raw) { return raw.split(/\r?\n/); }

export function nonEmptyLines(raw) {
  return lines(raw).filter((l) => wordCount(l) > 0);
}

/** Paragraphs = runs of lines separated by one or more blank lines. */
export function paragraphs(raw) {
  const out = [];
  let cur = [];
  for (const l of lines(raw)) {
    if (l.trim() === '') { if (cur.length) { out.push(cur); cur = []; } }
    else cur.push(l);
  }
  if (cur.length) out.push(cur);
  return out.map((ls) => ls.join('\n'));
}

export function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }

/** Sample standard deviation (n-1). Returns NaN for n < 2. */
export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
