// lib/diagnostics.mjs — SPEC B.7's DISPLAY-ONLY residue. Nothing here enters the sum, the
// channels or the verdict. Each item is a measurement the spec explicitly refused to score,
// kept because a human reading the report may want to see it, with the reason it was refused.
import { words } from './tokenize.mjs';
import { EN_STOP, TR_STOP, TR_ASCII_PROBE } from './langid.mjs';

/**
 * EN/TR homographs: ordinary words in BOTH languages, so their presence proves nothing about
 * code switching. Turkish: an (moment), at (horse), be (interjection), can (life/name),
 * in (lair), it (dog), not (grade), on (ten), as (hang), am; English: her, once, var, no.
 * A 60-token Turkish leak probe counted 24 "English function words" on this class alone.
 */
const EN_TR_HOMOGRAPHS = new Set(['a', 'i', 'o', 'an', 'at', 'be', 'can', 'in', 'it', 'not',
  'on', 'as', 'am', 'her', 'once', 'var', 'no']);
const CODE_SWITCH_MIN_HITS = 3;
const CODE_SWITCH_MIN_SHARE = 0.10;

/**
 * Lexical-diversity family (SPEC B.7: mattr_50 / hapax_ratio / type_token_ratio).
 * "Direction genuinely flips by genre; TR agglutination breaks the denominator; DATA measured
 * AUC 0.654 on 25% applicability. Kept as display-only diagnostics, never in the sum."
 */
export function lexicalDiversity(ctx) {
  const toks = ctx.tokens.map((t) => t.t.toLocaleLowerCase(ctx.lang === 'tr' ? 'tr' : 'en').replace(/i̇/gu, 'i'));
  if (toks.length < 30) return null;
  const types = new Set(toks);
  const counts = new Map();
  for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
  const hapax = [...counts.values()].filter((c) => c === 1).length;

  // MATTR-50: mean type/token ratio over a sliding 50-token window.
  const W = 50;
  let mattr = null;
  if (toks.length >= W) {
    let sum = 0, n = 0;
    for (let i = 0; i + W <= toks.length; i++) { sum += new Set(toks.slice(i, i + W)).size / W; n++; }
    mattr = sum / n;
  }
  return {
    type_token_ratio: Number((types.size / toks.length).toFixed(4)),
    hapax_ratio: Number((hapax / toks.length).toFixed(4)),
    mattr_50: mattr === null ? null : Number(mattr.toFixed(4)),
    why_not_scored: 'SPEC B.7: direction flips by genre, Turkish agglutination breaks the '
      + 'denominator, and DATA measured AUC 0.654 on 25% applicability. Display only.',
  };
}

/**
 * Notes SPEC B.7 kept as notes and refused as evidence. Each returns a string or null.
 */
export function diagnosticNotes(ctx) {
  const notes = [];

  // quote_and_apostrophe_consistency — DATA measured the sign INVERTED (humans 23.5% curly, the
  // generator 0%), on n=17. Note only, in neither direction.
  const curly = (ctx.raw.match(/[“”‘’]/gu) ?? []).length;
  if (curly > 0) {
    notes.push(`curly_quotes_observed: ${curly} — DATA measured this INVERTED (humans 23.5% curly, `
      + 'the generator 0%, n=17). Not evidence in either direction (SPEC B.7).');
  }

  // digit_system_choice / ar_indic_digit_ratio — dropped at AUC 0.46. Extended (Perso-Arabic)
  // digits are retained only as an out-of-scope KEYBOARD note, never as authorship.
  if (/[۰-۹]/u.test(ctx.raw)) {
    notes.push('perso_arabic_layout: Extended Arabic-Indic digits (U+06F0-06F9) present — an '
      + 'out-of-scope keyboard layout, not an authorship signal (SPEC B.7).');
  }
  if (/[٠-٩]/u.test(ctx.raw)) {
    notes.push('arabic_indic_digits_observed: dropped as a feature at AUC 0.46 — both sides type '
      + 'these. Not evidence in either direction (SPEC B.7).');
  }

  // latin_arabic_mix became, in an EN/TR build, ordinary EN-inside-TR code switching. Normal
  // human behaviour in this domain; logged, never scored.
  if (ctx.lang === 'tr' || ctx.lang === 'en') {
    const toks = words(ctx.nfc).map((t) => t.t.toLowerCase());
    const other = ctx.lang === 'tr' ? EN_STOP : TR_STOP;
    const own = ctx.lang === 'tr' ? TR_STOP : EN_STOP;
    // Count only function words of the OTHER language that are not also words of THIS one:
    // no homographs, nothing in this language's own stop list or ASCII probe list, no
    // single-letter tokens. Then require both an absolute floor and a share of the document,
    // so one stray token is never "code switching".
    const hits = toks.filter((t) => other.has(t)
      && t.length > 1
      && !EN_TR_HOMOGRAPHS.has(t)
      && !own.has(t)
      && !TR_ASCII_PROBE.has(t)).length;
    const share = toks.length ? hits / toks.length : 0;
    if (hits >= CODE_SWITCH_MIN_HITS && share >= CODE_SWITCH_MIN_SHARE) {
      notes.push(`code_switch_observed: ${hits} ${ctx.lang === 'tr' ? 'English' : 'Turkish'} `
        + `function words in ${toks.length} tokens (${(share * 100).toFixed(1)}%) inside the `
        + 'dominant language — code-switching is normal human behaviour in this domain and is not '
        + 'evidence in either direction (SPEC B.7).');
    }
  }
  return notes;
}
