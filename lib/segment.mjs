// lib/segment.mjs — hand-rolled sentence segmenter, D1 §3.
// Intl.Segmenter is FORBIDDEN in the shipped path (SPEC B.9): its behaviour is a function of the
// ICU build compiled into the host binary, which breaks determinism across machines.
import { words } from './tokenize.mjs';
import { EMOJI, ure } from './unicode.mjs';

// D1 §3.1. NOTE: ، (U+060C) is a COMMA and is never a terminator.
const HARD = new Set(['.', '!', '?', '؟', '۔', '‼', '⁉', '！', '？', '。']);
const SOFT = new Set([';', '؛']);          // boundary in prose only, never in chat
const ELLIPSIS = '…';

const ABBREV = new Set([
  // EN
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'no', 'vs', 'etc', 'inc', 'ltd', 'approx', 'dept',
  'fig', 'vol', 'p', 'pp', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
  'oct', 'nov', 'dec', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  // TR
  'doç', 'doc', 'sn', 'av', 'vb', 'örn', 'orn', 'bkz', 'yy', 'tl', 'cad', 'sok', 'mah', 'apt', 'bl',
  // S-03: "Tel. 0212 …" / "Fax. …" / "No. 12" / "Sn. Ayşe" split mid-address without these.
  'tel', 'fax', 'faks',
]);
const TLD = /\.(com|net|org|edu|gov|info|io|co|tr|de|uk|fr|nl|ru)\b/i;
const CLOSERS = new Set(['"', '”', '’', "'", ')', ']', '»', '›', '»']);

function isDigit(ch) { return ch !== undefined && /\p{Nd}/u.test(ch); }

/**
 * D-03 Turkish ordinals. "1. gece", "2. kat", "5. gün", "15. ayın" are everyday Turkish and the
 * decimal guard (digit on BOTH sides) never sees them. A 1-2 digit run followed by "." and a
 * LOWERCASE word is an ordinal, not a sentence boundary. An uppercase follower keeps the
 * boundary, so a numbered list ("1. Otel rezervasyonu.") still splits.
 */
function isOrdinalPeriod(unit, i) {
  let a = i;
  while (a > 0 && isDigit(unit[a - 1])) a--;
  const digits = i - a;
  if (digits < 1 || digits > 2) return false;
  if (isLetter(unit[a - 1])) return false;              // "abc1." is not an ordinal
  let j = i + 1;
  while (j < unit.length && /[^\S\n]/u.test(unit[j])) j++;
  const next = unit[j];
  if (next === undefined) return false;
  return isLetter(next) && !isUpper(next);
}
function isLetter(ch) { return ch !== undefined && /\p{L}/u.test(ch); }
function isUpper(ch) { return ch !== undefined && /\p{Lu}/u.test(ch); }

/** The whitespace-delimited token containing index i. */
function tokenAround(s, i) {
  let a = i; while (a > 0 && !/\s/u.test(s[a - 1])) a--;
  let b = i; while (b < s.length && !/\s/u.test(s[b])) b++;
  return s.slice(a, b);
}

/** The run of letters immediately before index i, lowercased. */
function wordBefore(s, i) {
  let a = i; while (a > 0 && isLetter(s[a - 1])) a--;
  return s.slice(a, i).toLocaleLowerCase('tr');
}

/**
 * Split one unit (a line in chat, a joined paragraph-run in prose) into sentences.
 * Returns [{text, terminator, run}].
 */
function splitUnit(unit, shape) {
  const out = [];
  let start = 0;
  let i = 0;
  while (i < unit.length) {
    // D-04: index by CODE POINT. `unit[i]` on an astral emoji is a lone high surrogate and
    // /\p{Extended_Pictographic}/u never matches it, which killed rule 5 for every emoji that
    // real chat traffic actually uses.
    const ch = String.fromCodePoint(unit.codePointAt(i));
    const step = ch.length;
    let isBoundary = false;
    let run = '';

    if (ch === ELLIPSIS || HARD.has(ch)) {
      isBoundary = true;
      if (ch === '.') {
        // (a) decimal: 3.5
        if (isDigit(unit[i - 1]) && isDigit(unit[i + 1])) isBoundary = false;
        // (f) Turkish ordinal: "1. gece" (D-03) — checked before the abbreviation table.
        else if (isOrdinalPeriod(unit, i)) isBoundary = false;
        // (b) abbreviation
        else if (ABBREV.has(wordBefore(unit, i))) isBoundary = false;
        // (c) URL / email / host token
        else {
          const tok = tokenAround(unit, i);
          if (tok.includes('://') || tok.includes('@') || TLD.test(tok)) isBoundary = false;
          // (d) initial: "J. Smith"
          else if (isUpper(unit[i - 1]) && !isLetter(unit[i - 2] ?? ' ')) isBoundary = false;
        }
      }
      if (isBoundary) {
        // (e) collapse a RUN of terminators into ONE boundary, recording composition first
        let j = i;
        while (j < unit.length && (HARD.has(unit[j]) || unit[j] === ELLIPSIS)) j++;
        run = unit.slice(i, j);
        // rule 6: a terminator immediately inside a closing quote/bracket closes at the outer one
        while (j < unit.length && CLOSERS.has(unit[j])) j++;
        out.push({ text: unit.slice(start, j), terminator: ch, run, start });
        start = j; i = j; continue;
      }
    } else if (shape === 'prose' && SOFT.has(ch)) {
      out.push({ text: unit.slice(start, i + 1), terminator: ch, run: ch, start });
      start = i + step; i = start; continue;
    } else if (EMOJI.test(ch)) {
      // rule 5: an emoji run is a boundary only when it ends the unit or is followed by an
      // uppercase letter starting a new clause. Mid-clause emoji is NOT a boundary.
      let j = i;
      while (j < unit.length) {
        const c = String.fromCodePoint(unit.codePointAt(j));
        if (!(EMOJI.test(c) || /[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/u.test(c))) break;
        j += c.length;
      }
      const restAfter = unit.slice(j);
      const nextVisible = restAfter.replace(/^\s+/u, '')[0];
      const precededByTerminator = HARD.has(unit[i - 1]) || unit[i - 1] === ELLIPSIS;
      if (!precededByTerminator && (restAfter.trim() === '' || isUpper(nextVisible))) {
        out.push({ text: unit.slice(start, j), terminator: 'emoji', run: '', start });
        start = j; i = j; continue;
      }
      i = j; continue;
    }
    i += step;
  }
  // rule 7: trailing fragment with no terminator is a sentence (the norm in chat)
  if (start < unit.length) out.push({ text: unit.slice(start), terminator: null, run: '', start });
  return out;
}

// D-02b class A: `\b` after `çünkü`/`ya da` is ASCII-only and never matched before a space.
const CONJ_START = ure('^\\s*(and|but|or|so|because|which|that|ve|ama|fakat|ancak|çünkü|ki|veya|ya da)(?<UE>)', 'iu');

// D-02: \p{Nd} only — the ASCII digit class is banned tree-wide (selftest greps for it).
const LIST_MARKER = /^\s*([-*•+‣·]|\p{Nd}{1,2}[.)])\s+/u;

/**
 * segment(nfc, shape) -> { sentences: [{text, tokens, isListItem, terminator, run}], warnings }
 * D1 §3.2 rules 1-8.
 */
export function segment(nfc, shape) {
  const warnings = [];
  const rawLines = nfc.split(/\r?\n/);
  const units = [];

  if (shape === 'chat') {
    // rule 2: in chat EVERY line is a hard sentence boundary. Chat users press send, not period.
    for (const l of rawLines) if (l.trim() !== '') units.push(l);
  } else {
    // rule 2 (prose): a blank line is hard; a single newline inside a paragraph is SOFT —
    // join when the next line starts lowercase or with a conjunction, split otherwise.
    let cur = '';
    for (const l of rawLines) {
      if (l.trim() === '') { if (cur.trim() !== '') units.push(cur); cur = ''; continue; }
      if (cur === '') { cur = l; continue; }
      const first = l.trimStart()[0];
      if ((first !== undefined && !isUpper(first) && isLetter(first)) || CONJ_START.test(l)) cur += ' ' + l.trim();
      else { units.push(cur); cur = l; }
    }
    if (cur.trim() !== '') units.push(cur);
  }

  const sentences = [];
  for (const u of units) {
    // D-05: the list marker of a NUMBERED list ("1. ") is consumed by the period split and lands
    // in a token-less fragment that rule 8 drops, so testing the SENTENCE never sees it. The
    // marker is a property of the LINE, so it is tested on the unit and carried to every sentence
    // that starts inside the marker (i.e. the first real sentence of the item).
    const marker = LIST_MARKER.exec(u);
    const markerEnd = marker ? marker[0].length : -1;
    for (const s of splitUnit(u, shape)) {
      const tokens = words(s.text);
      if (tokens.length === 0) continue;                 // rule 8
      sentences.push({
        text: s.text.trim(),
        tokens: tokens.map((t) => t.t),
        isListItem: (markerEnd >= 0 && s.start <= markerEnd) || LIST_MARKER.test(s.text),
        terminator: s.terminator,
        run: s.run,
      });
    }
  }

  // D1 §3.3: a sentence over 120 tokens is almost always a segmentation failure.
  if (sentences.some((s) => s.tokens.length > 120)) warnings.push('segmentation_suspect');

  return { sentences, warnings };
}
