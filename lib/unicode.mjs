// lib/unicode.mjs — SPEC B.9 text pipeline. Every regex here is asserted in selftest.mjs,
// because a Node/ICU upgrade must not be able to change any of them silently.
// Zero dependencies, no Node builtins: this module must run in any ES2024 engine.

// ---------------------------------------------------------------------------
// Character classes (SPEC B.9 / D1 §1.4)
// ---------------------------------------------------------------------------

// v-flag SET INTERSECTION. Writing this as [؀-ۿ] matches Arabic punctuation,
// tatweel and digits and silently biases every script ratio.
export const AR_LETTER = /[\p{Script=Arabic}&&\p{L}]/v;
export const AR_LETTER_G = /[\p{Script=Arabic}&&\p{L}]/gv;
export const LATIN_LETTER = /\p{Script=Latin}/u;
export const LATIN_LETTER_G = /\p{Script=Latin}/gu;
export const ANY_LETTER = /\p{L}/u;

export const TATWEEL = 'ـ';
export const TATWEEL_G = /ـ/gu;
// fathatan..sukun + superscript alef + hamza-above/below
export const AR_TASHKEEL_G = /[ً-ْٰٓ-ٕ]/gu;
export const PERSO_ARABIC = /[پچژگکی]/u;      // پ چ ژ گ ک ی
export const PERSO_ARABIC_G = /[پچژگکی]/gu;
export const TR_SPECIFIC = /[çğıöşüÇĞİÖŞÜ]/u;
export const TR_SPECIFIC_G = /[çğıöşüÇĞİÖŞÜ]/gu;

// Invisible characters. U+00AD soft hyphen included; ZWJ/ZWNJ/LRM/RLM handled by the caller
// (rules.mjs) because they are legitimate inside emoji sequences and RTL text.
export const ZW_G = /[​‌‍⁠﻿­]/gu;
export const BIDI_MARK_G = /[‎‏]/gu;
export const ODD_SPACE_G = /[  -   　]/gu;

export const EMOJI = /\p{Extended_Pictographic}/u;
export const EMOJI_G = /\p{Extended_Pictographic}/gu;
export const SKIN_TONE_G = /[\u{1F3FB}-\u{1F3FF}]/gu;

// SPEC B.9: \p{L} matches tatweel, so the negative lookahead is load-bearing — without it a run
// of tatweel counts as a word token. No numeric regex in this tool uses the ASCII digit
// class; selftest.mjs greps lib/ and stylometry.mjs for it and requires zero hits.
export const WORD_RE = /(?!ـ)[\p{L}\p{M}][\p{L}\p{M}ـ'’-]*/gu;
export const NUM_RE = /[\p{Nd}][\p{Nd}.,:٫٬]*/gu;
export const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;

// Unicode word boundaries. JS `\b` is ASCII-only: `\bcok` never matches after a Turkish letter
// and `...ani\b` never matches before one (reviewer D-02b class A). Every pattern in this tool
// that used to write `\b` next to a letter now interpolates these instead.
export const UB = '(?<![\\p{L}\\p{M}\\p{N}_])';
export const UE = '(?![\\p{L}\\p{M}\\p{N}_])';
/** Build a /u regex from a source string, expanding the tokens `(?<UB>)` / `(?<UE>)`. */
export function ure(src, flags = 'u') {
  return new RegExp(src.split('(?<UB>)').join(UB).split('(?<UE>)').join(UE), flags);
}

// ---------------------------------------------------------------------------
// Views (SPEC B.9)
//   raw       = text as received                       -> rules and typography read THIS
//   nfc       = raw.normalize("NFC")                   -> tokenization + segmentation
//   foldedLex = caseFold(stripTashkeel(stripTatweel(unifyAlef(nfc))), lang)  -> lexicon ONLY
// Never NFKC the scoring view: it turns … into ... and NBSP into a space.
// ---------------------------------------------------------------------------

/**
 * caseFold(s, lang). For Turkish, 'İ'.toLowerCase() yields TWO code points (i + U+0307),
 * so a locale-less fold silently never matches a lexicon entry stored as "istanbul".
 */
export function caseFold(s, lang) {
  const lowered = lang === 'tr' ? s.toLocaleLowerCase('tr') : s.toLowerCase();
  return lowered.replace(/i̇/gu, 'i');
}

export function stripTatweel(s) { return s.replace(TATWEEL_G, ''); }
export function stripTashkeel(s) { return s.replace(AR_TASHKEEL_G, ''); }

/** Alef / ya / ta-marbuta unification. Matching-only; never applied to the scoring view. */
export function unifyAlef(s) {
  return s.replace(/[أإآٱ]/gu, 'ا')
          .replace(/ى/gu, 'ي')
          .replace(/ة/gu, 'ه');
}

/** Curly apostrophe -> straight, for lexicon matching only (raw keeps the curly form). */
export function unifyApostrophe(s) { return s.replace(/[’ʼ]/gu, "'"); }

/**
 * R42(b) — an index map from the foldedLex view back to the NFC view, so a lexicon or phrase hit
 * can be quoted from the RAW input. It is built by replaying the same per-character transforms;
 * if the replay does not reproduce foldedLex byte for byte the map is discarded (null) and the
 * affected spans are simply not emitted. Matching behaviour is never changed by this function.
 */
function foldedIndexMap(nfc, lang) {
  const locale = lang === 'tr' ? 'tr' : 'en';
  let out = '';
  const map = [];
  let i = 0;
  while (i < nfc.length) {
    const ch = String.fromCodePoint(nfc.codePointAt(i));
    const step = ch.length;
    if (ch === TATWEEL || AR_TASHKEEL_G.test(ch)) { AR_TASHKEEL_G.lastIndex = 0; i += step; continue; }
    AR_TASHKEEL_G.lastIndex = 0;
    let c = ch;
    if ('أإآٱ'.includes(c)) c = 'ا';
    else if (c === 'ى') c = 'ي';
    else if (c === 'ة') c = 'ه';
    if (c === '’' || c === 'ʼ') c = "'";
    let low = locale === 'tr' ? c.toLocaleLowerCase('tr') : c.toLowerCase();
    if (low === 'i̇') low = 'i';
    for (let k = 0; k < low.length; k++) map.push(i);
    out += low;
    i += step;
  }
  map.push(nfc.length);
  return { out, map };
}

export function makeViews(text, lang, precomputedNfc) {
  const raw = text;
  // S-05: NFC is applied ONCE per document. buildContext already normalizes for language ID and
  // hands the result back here rather than paying for (and risking a drift between) a second pass.
  const nfc = precomputedNfc ?? raw.normalize('NFC');
  const foldedLex = caseFold(
    unifyApostrophe(stripTashkeel(stripTatweel(unifyAlef(nfc)))),
    lang === 'tr' ? 'tr' : 'en',
  );
  // R42(b): the map is advisory. It is kept only when the replay is byte-identical.
  const replay = foldedIndexMap(nfc, lang);
  const foldedMap = replay.out === foldedLex ? replay.map : null;
  return { raw, nfc, foldedLex, foldedMap, nfcIsRaw: nfc === raw };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function countMatches(s, re) {
  let n = 0;
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
  g.lastIndex = 0;
  while (g.exec(s) !== null) { n++; if (g.lastIndex === 0) break; }
  return n;
}

export function letters(nfc) {
  const out = [];
  for (const ch of nfc) if (ANY_LETTER.test(ch) && ch !== TATWEEL) out.push(ch);
  return out;
}

export function isWordChar(ch) { return ch !== undefined && WORD_CHAR.test(ch); }

// ---------------------------------------------------------------------------
// HEAD-RULINGS R30 — homoglyph / non-ASCII-Latin evasion.
// Detection power against a real adversary is ZERO and the README says so; this is a WARNING
// plus a second matching pass, not a defence. The table is explicit and strictly 1:1 per code
// point, so a folded copy is index-aligned with its source and a span maps straight back.
// ---------------------------------------------------------------------------
const CONFUSABLE_PAIRS = [
  // Cyrillic -> Latin
  ['а', 'a'], ['е', 'e'], ['о', 'o'], ['р', 'p'], ['с', 'c'],
  ['у', 'y'], ['х', 'x'], ['і', 'i'], ['ј', 'j'], ['ѕ', 's'],
  ['к', 'k'], ['м', 'm'], ['н', 'h'], ['в', 'b'], ['г', 'r'],
  ['А', 'A'], ['В', 'B'], ['Е', 'E'], ['К', 'K'], ['М', 'M'],
  ['Н', 'H'], ['О', 'O'], ['Р', 'P'], ['С', 'C'], ['Т', 'T'],
  ['Х', 'X'], ['І', 'I'], ['Ј', 'J'], ['Ѕ', 'S'], ['У', 'Y'],
  // Greek -> Latin
  ['α', 'a'], ['ο', 'o'], ['ν', 'v'], ['ρ', 'p'], ['υ', 'u'],
  ['χ', 'x'], ['Α', 'A'], ['Β', 'B'], ['Ε', 'E'], ['Ζ', 'Z'],
  ['Η', 'H'], ['Ι', 'I'], ['Κ', 'K'], ['Μ', 'M'], ['Ν', 'N'],
  ['Ο', 'O'], ['Ρ', 'P'], ['Τ', 'T'], ['Υ', 'Y'], ['Χ', 'X'],
];
const CONFUSABLE_MAP = new Map(CONFUSABLE_PAIRS);
// Halfwidth and Fullwidth Forms: the fullwidth ASCII block is a plain offset.
const FULLWIDTH_LO = 0xff01, FULLWIDTH_HI = 0xff5e, FULLWIDTH_DELTA = 0xfee0;

export const FULLWIDTH_RE = /[＀-￯]/u;
export const FULLWIDTH_DIGIT_RE = /[０-９]/u;
export const MATH_ALNUM_LO = 0x1d400, MATH_ALNUM_HI = 0x1d7ff;
export const MATH_ALNUM_RE = /[\u{1D400}-\u{1D7FF}]/u;

/**
 * R38(d): Mathematical Alphanumeric Symbols (U+1D400-U+1D7FF) are the block formula plus its
 * RESERVED HOLES (the twelve script/fraktur/double-struck letters unified with Letterlike
 * Symbols). Rather than re-encode the holes by hand — and get one wrong — the fold reads the
 * character's own compatibility decomposition, which IS that formula: 𝐀 -> A, 𝐚 -> a, 𝟎 -> 0,
 * and an unassigned hole decomposes to itself and is left alone. NFKC is forbidden on the SCORING
 * view (SPEC B.9) and is not used there; this is a matching-only fold, exactly like the explicit
 * table above. A math Greek letter decomposes to a Greek letter and is then folded again by that
 * table.
 */
function foldOne(ch) {
  const cp = ch.codePointAt(0);
  const direct = CONFUSABLE_MAP.get(ch);
  if (direct !== undefined) return direct;
  if (cp >= FULLWIDTH_LO && cp <= FULLWIDTH_HI) return String.fromCodePoint(cp - FULLWIDTH_DELTA);
  if (cp >= MATH_ALNUM_LO && cp <= MATH_ALNUM_HI) {
    const nfkc = ch.normalize('NFKC');
    if (nfkc === ch || [...nfkc].length !== 1) return undefined;      // a reserved hole
    return CONFUSABLE_MAP.get(nfkc) ?? nfkc;
  }
  return undefined;
}

/**
 * foldConfusablesMapped(s) -> { text, map, changed }
 * `map[i]` is the index in `s` of the character that produced `text[i]`; `map[text.length]` is
 * `s.length`. A map is needed because a Math Alphanumeric character is ASTRAL (two UTF-16 code
 * units) and folds to one ASCII character, so the folded copy is NOT index-aligned with its
 * source the way the BMP table alone was.
 */
export function foldConfusablesMapped(s) {
  let out = '';
  const map = [];
  let changed = false;
  let i = 0;
  while (i < s.length) {
    const ch = String.fromCodePoint(s.codePointAt(i));
    const r = foldOne(ch);
    const piece = r === undefined ? ch : r;
    if (r !== undefined) changed = true;
    for (let k = 0; k < piece.length; k++) map.push(i);
    out += piece;
    i += ch.length;
  }
  map.push(s.length);
  return { text: changed ? out : s, map, changed };
}

/** Convenience wrapper; use foldConfusablesMapped when spans must map back. */
export function foldConfusables(s) { return foldConfusablesMapped(s).text; }

const SCRIPT_TESTS = [
  ['Latin', /\p{Script=Latin}/u], ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u], ['Arabic', /[\p{Script=Arabic}&&\p{L}]/v],
  ['Han', /\p{Script=Han}/u], ['Hebrew', /\p{Script=Hebrew}/u],
];

/**
 * homoglyphScan(units) -> { count, examples } (R30, extended by R38(d)).
 * A unit is suspect when its letters come from more than one script, or when it carries a
 * Halfwidth/Fullwidth or Mathematical-Alphanumeric code point. The caller passes WHITESPACE-
 * DELIMITED runs, not word tokens: `REF-４４９２８１` carries fullwidth DIGITS, which no word
 * token contains, and it was the one shape that evaded the warning entirely.
 */
export function homoglyphScan(tokens) {
  let count = 0;
  const examples = [];
  for (const tk of tokens) {
    const t = typeof tk === 'string' ? tk : tk.t;
    if (!t) continue;
    let suspect = FULLWIDTH_RE.test(t) || MATH_ALNUM_RE.test(t);
    if (!suspect) {
      const scripts = new Set();
      for (const ch of t) {
        if (!ANY_LETTER.test(ch)) continue;
        for (const [name, re] of SCRIPT_TESTS) if (re.test(ch)) { scripts.add(name); break; }
      }
      suspect = scripts.size > 1;
    }
    if (!suspect) continue;
    count++;
    if (examples.length < 3) examples.push(t);
  }
  return { count, examples };
}
