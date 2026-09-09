#!/usr/bin/env node
// selftest.mjs — SPEC §I B1 item 6. Exits non-zero on ANY failure.
//
//   1. Unicode assertions for every claim in SPEC B.9 — re-asserted in code so that a Node/ICU
//      upgrade cannot break the pipeline silently.
//   2. Segmenter fixtures (decimals, Dr., URLs, ellipsis, !!!, emoji-terminated lines, a six-line
//      unpunctuated WhatsApp message, an RTL paragraph with embedded Latin).
//   3. One hand-computed golden value per feature — all 38 Tier-1 + all 5 aggregate.
//   4. The contribution-sum invariant (SPEC C.3 rule 3).
//   5. Determinism (HEAD-RULINGS R12).
//   6. The must-not-fire fixtures: 8 inline copies from D1 §7, plus every row of
//      eval/fixtures/must-not-fire.jsonl when B2 has produced it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import './stylometry.mjs';                    // configures the core from the shipped artifacts
import { detect, aggregate, buildCorpusIndex, VERSION } from './stylometry.mjs';
import { _buildContext } from './lib/detect.mjs';
import { FEATURES } from './lib/features.mjs';
import { AGG_FEATURES, prepareAggregate } from './lib/feat-aggregate.mjs';
import { segment } from './lib/segment.mjs';
import { identify, latinSubId } from './lib/langid.mjs';
import { caseFold, AR_LETTER, WORD_RE, NUM_RE, makeViews, foldConfusables, homoglyphScan } from './lib/unicode.mjs';
import { words } from './lib/tokenize.mjs';
import { sha256Hex } from './lib/hash.mjs';
import { transform, capLambda, tableVerdict, REGISTER_PROXY_LLM, AGGREGATE_DISABLED } from './lib/score.mjs';
import { assistantFrameLeak, runRules } from './lib/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXED_NOW = Date.parse('2026-09-09T12:00:00Z');
const BASE = { allowUncalibrated: true, now: FIXED_NOW };

let pass = 0;
const failures = [];
const info = [];
const arbitration = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; return true; }
  failures.push(`${name}${detail ? ' — ' + detail : ''}`);
  return false;
}
function eq(name, got, want) {
  return ok(name, Object.is(got, want) || got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function near(name, got, want, tol = 1e-9) {
  return ok(name, Number.isFinite(got) && Math.abs(got - want) <= tol,
    `got ${got}, want ${want} (tol ${tol})`);
}

// ===========================================================================
// 1. UNICODE ASSERTIONS — every claim in SPEC B.9
// ===========================================================================
function unicodeAssertions() {
  // Never NFKC the scoring view.
  eq('B.9 NFKC destroys the ellipsis', '…'.normalize('NFKC'), '...');
  eq('B.9 NFKC destroys NBSP', ' '.normalize('NFKC'), ' ');
  eq('B.9 NFC preserves the ellipsis', '…'.normalize('NFC'), '…');
  eq('B.9 NFC preserves NBSP', ' '.normalize('NFC'), ' ');
  eq('B.9 NFKC keeps tatweel', 'ـ'.normalize('NFKC'), 'ـ');
  eq('B.9 NFKC keeps Arabic-Indic digits', '٠'.normalize('NFKC'), '٠');
  eq('B.9 NFKC folds the Arabic presentation form', 'ﻳ'.normalize('NFKC'), 'ي');

  // The Turkish trap.
  eq('B.9 locale-less İ.toLowerCase() is TWO code points',
    [...'İ'.toLowerCase()].map((c) => c.codePointAt(0)).join(','), '105,775');
  eq('B.9 tr-locale İ folds to one i', 'İ'.toLocaleLowerCase('tr'), 'i');
  eq('B.9 tr-locale I folds to dotless ı', 'I'.toLocaleLowerCase('tr'), 'ı');
  eq('B.9 caseFold(tr) strips the stray U+0307', caseFold('İstanbul', 'tr'), 'istanbul');
  eq('B.9 caseFold(en) strips the stray U+0307 too', caseFold('İstanbul', 'en'), 'istanbul');

  // AR_LETTER must be the v-flag SET INTERSECTION, letters only.
  ok('B.9 AR_LETTER matches an Arabic letter', AR_LETTER.test('ب'));
  ok('B.9 AR_LETTER rejects the Arabic comma U+060C', !AR_LETTER.test('،'));
  ok('B.9 AR_LETTER rejects the Arabic question mark U+061F', !AR_LETTER.test('؟'));
  ok('B.9 AR_LETTER rejects tatweel U+0640', !AR_LETTER.test('ـ'));
  ok('B.9 AR_LETTER rejects Arabic-Indic digit U+0660', !AR_LETTER.test('٠'));
  ok('B.9 AR_LETTER rejects extended digit U+06F0', !AR_LETTER.test('۰'));
  ok('B.9 AR_LETTER rejects fatha U+064E', !AR_LETTER.test('َ'));
  ok('B.9 Arabic comma is Script=Common, not Arabic', !/\p{Script=Arabic}/u.test('،'));
  ok('B.9 tatweel is Script=Common, not Arabic', !/\p{Script=Arabic}/u.test('ـ'));
  ok('B.9 Arabic-Indic digits ARE Script=Arabic', /\p{Script=Arabic}/u.test('٠'));

  // WORD_RE: the tatweel lookahead is load-bearing.
  ok('B.9 \\p{L} matches tatweel (why the lookahead exists)', /\p{L}/u.test('ـ'));
  eq('B.9 WORD_RE rejects a bare tatweel run', words('ـــ').length, 0);
  eq('B.9 WORD_RE keeps tatweel INSIDE a word', words('الــس').length, 1);
  eq('B.9 WORD_RE keeps an internal apostrophe', words("İstanbul'a").length, 1);
  ok('B.9 WORD_RE is the u-flag form SPEC fixes',
    WORD_RE.source === "(?!ـ)[\\p{L}\\p{M}][\\p{L}\\p{M}ـ'’-]*");

  // NUM_RE: no numeric regex in this tool uses \d.
  ok('B.9 \\p{Nd} matches U+0660-0669', /\p{Nd}/u.test('٠'));
  ok('B.9 \\p{Nd} matches U+06F0-06F9', /\p{Nd}/u.test('۰'));
  ok('B.9 ASCII \\d rejects Arabic-Indic digits (the bug NUM_RE avoids)', !/\d/.test('٠'));
  eq('B.9 NUM_RE tokenizes an Arabic-Indic number',
    ('٠١٢'.match(new RegExp(NUM_RE.source, 'gu')) ?? []).length, 1);

  // Intl.Segmenter is forbidden in the shipped path.
  const shipped = ['stylometry.mjs', 'lib/detect.mjs', 'lib/segment.mjs', 'lib/features.mjs',
    'lib/tokenize.mjs', 'lib/langid.mjs', 'lib/lexicon.mjs', 'lib/rules.mjs', 'lib/score.mjs',
    'lib/unicode.mjs', 'lib/hash.mjs', 'lib/io.mjs', 'lib/feat-aggregate.mjs',
    'lib/diagnostics.mjs'];
  const stripComments = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const f of shipped) {
    ok(`B.9 no Intl.Segmenter in ${f}`, !stripComments(readFileSync(join(HERE, f), 'utf8')).includes('Intl.Segmenter'));
  }
  // ...and zero third-party imports anywhere in the shipped tool.
  const bare = /^\s*(?:import|export)[^'"\n]*from\s+['"]([^'".][^'"]*)['"]/gm;
  for (const f of shipped) {
    const src = readFileSync(join(HERE, f), 'utf8');
    const bad = [...src.matchAll(bare)].map((m) => m[1]).filter((s) => !s.startsWith('node:'));
    ok(`zero third-party imports in ${f}`, bad.length === 0, bad.join(', '));
  }

  // Language ID facts.
  eq('B.9 Perso-Arabic guard returns unknown, not ar',
    identify('سلام من امروز به مدرسه رفتم کتاب').primary, 'unknown');
  eq('R22 Arabic script is refused, never scored',
    identify('مرحبا كيف حالك اليوم').primary, 'unsupported');
  eq('langid: de-diacriticized Turkish still identifies as tr',
    identify('cocuk yasinda gidecegiz ve cok guzel bir sey oldu').primary, 'tr');
  eq('langid: English identifies as en',
    identify('the hotel was very good and the staff were helpful for us').primary, 'en');
  ok('langid: latinSubId gives Turkish positive votes', latinSubId('bu cok guzel bir sey').tr > 0);

  // SHA-256 (used for input.sha256) — pure implementation, known vectors.
  eq('sha256 of the empty string', sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  eq('sha256 of "abc"', sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  // Views.
  const v = makeViews('İyi Günler…', 'tr');
  eq('views: raw is untouched', v.raw, 'İyi Günler…');
  eq('views: foldedLex is tr-folded', v.foldedLex, 'iyi günler…');
  ok('views: nfc keeps the ellipsis glyph', v.nfc.includes('…'));
}

// ===========================================================================
// 2. SEGMENTER FIXTURES
// ===========================================================================
function segmenterFixtures() {
  const S = (t, shape = 'prose') => segment(t.normalize('NFC'), shape).sentences.map((s) => s.text);

  eq('seg: a decimal does not split', S('The room cost 3.50 euros per night.').length, 1);
  eq('seg: an abbreviation does not split', S('Dr. Smith arrived at noon.').length, 1);
  eq('seg: a URL does not split', S('Please visit example.com for details.').length, 1);
  eq('seg: an initial does not split', S('It was J. Smith who called.').length, 1);
  eq('seg: an ellipsis is ONE boundary', S('Yes… maybe not').length, 2);
  eq('seg: "!!!" collapses to one boundary', S('Wow!!! Amazing').length, 2);
  eq('seg: a terminator run records its composition',
    segment('Really?!? Yes'.normalize('NFC'), 'prose').sentences[0].run, '?!?');
  eq('seg: a closing quote stays with the sentence',
    S('He said "it was fine." Then he left.')[0], 'He said "it was fine."');
  eq('seg: an emoji ending a line is a boundary',
    S('great stay \u{1F600}\nthe room was clean', 'chat').length, 2);
  ok('seg: mid-clause emoji is NOT a boundary',
    S('the room \u{1F600} was clean and quiet', 'chat').length === 1);

  // A six-line unpunctuated WhatsApp message: in chat EVERY line is a hard boundary.
  const wa = 'merhaba\n5 kasim giris\n3 gece\n2 kisiyiz\nfiyat nedir\ntesekkurler';
  eq('seg: six-line unpunctuated WhatsApp message = 6 sentences', S(wa, 'chat').length, 6);
  // In PROSE shape a single newline is SOFT: lines starting lowercase are joined, lines starting
  // with a digit are not. "fiyat nedir" and "tesekkurler" join onto "2 kisiyiz" => 4 units.
  eq('seg: the same message in PROSE shape joins soft-wrapped lowercase lines', S(wa, 'prose').length, 4);

  // An RTL paragraph with embedded Latin. Arabic is out of scope for SCORING (R22) but the
  // segmenter must still not crash or mis-split on it.
  const rtl = 'مرحبا، أريد حجز Grand Hotel ليومين. شكرا.';
  eq('seg: Arabic comma U+060C is NOT a terminator', S(rtl).length, 2);
  ok('seg: RTL with embedded Latin does not crash', S(rtl)[0].includes('Grand Hotel'));

  // Degenerate outcomes must be handled, not crashed on.
  eq('seg: a trailing fragment with no terminator is a sentence', S('no terminator here').length, 1);
  eq('seg: an empty string yields zero sentences', S('').length, 0);
  eq('seg: a bare emoji line yields zero word-token sentences', S('\u{1F600}\u{1F600}', 'chat').length, 0);
  ok('seg: a >120-token sentence sets segmentation_suspect',
    segment(('word '.repeat(130)).trim(), 'prose').warnings.includes('segmentation_suspect'));
  ok('seg: list items are marked',
    segment('- two adults\n- one child', 'chat').sentences.every((s) => s.isListItem));
}

// ===========================================================================
// 3. ONE HAND-COMPUTED GOLDEN PER FEATURE
// ===========================================================================
function sentencesOf(counts, opener = 'The') {
  // Build a sentence with exactly n word tokens: opener + (n-1) filler words + "."
  return counts.map((n) => `${opener} ${Array.from({ length: n - 1 }, () => 'room').join(' ')}.`).join(' ');
}

const GOLDENS = [
  // --- B.2 rhythm --------------------------------------------------------
  { id: 'sentence_len_cv',
    text: sentencesOf([10, 10, 10, 10, 20, 20, 20, 20]), opts: { shape: 'prose' },
    // token counts 4x10 + 4x20 => mean 15, sample sd sqrt(200/7)=5.345224838, cv=0.356348323
    want: Math.sqrt(200 / 7) / 15 },
  { id: 'sentence_len_mode_mass',
    text: sentencesOf([10, 10, 10, 10, 20, 20, 20, 20]), opts: { shape: 'prose' },
    want: 0.5 },                                    // 4 of 8 sentences fall in [12,22]
  { id: 'paragraph_uniformity',
    text: [60, 60, 80, 80].map((n) => sentencesOf([n / 2, n / 2])).join('\n\n'),
    opts: { shape: 'prose' },
    // paragraph token counts 60,60,80,80 => mean 70, sample sd sqrt(400/3)=11.5470054
    want: 1 - (Math.sqrt(400 / 3) / 70) },
  { id: 'content_word_repeat',
    text: `${'hotel '.repeat(40)}${'the '.repeat(110)}`.trim(), opts: { shape: 'prose' },
    want: 1 - 1 / 40 },                              // 40 content tokens, 1 unique type

  // --- B.3 punctuation ---------------------------------------------------
  { id: 'terminal_punct_ratio',
    text: 'we arrived at the hotel late and the room was ready.\nthe staff was kind and helpful and quick',
    opts: { shape: 'chat' }, want: 0.5 },            // 1 of 2 lines terminated
  { id: 'sentence_initial_caps',
    text: 'The room was clean and quiet. The staff was kind and helpful. The view was nice and open. it was cheap too.',
    opts: { shape: 'chat' }, want: 0.75 },           // 3 of 4 sentences start uppercase
  { id: 'all_lowercase',
    text: 'we arrived at the hotel late and the room was ready and the staff was kind to us',
    opts: { shape: 'chat' }, want: 1 },
  { id: 'ellipsis_hand_typed', text: 'hmm.. ok', opts: { shape: 'chat' }, want: 1 },
  { id: 'repeated_punct_emoticon', text: 'really?? yes :) haha', opts: { shape: 'chat' }, want: 2 },
  { id: 'letter_elongation', text: 'pleaseee çoook', opts: { shape: 'chat' }, want: 2 },
  { id: 'space_hygiene',
    text: 'we arrived at the hotel  late and the room was ready , the staff was kind and helpful,really nice today',
    opts: { shape: 'chat' },
    want: 15 },                                      // 3 slips over 20 tokens => 15 per 100
  { id: 'multi_exclam', text: 'wow!! amazing!!!', opts: { shape: 'chat' }, want: 2 },
  { id: 'exclam_single_regular',
    text: 'The room was clean! The staff was kind. The view was open! The bed was soft.',
    opts: { shape: 'prose' }, want: 1 },             // 2 singles / 4 sentences = 0.5, in [0.25,0.75]
  { id: 'em_dash_in_chat', text: 'we went there — it was nice', opts: { shape: 'chat' }, want: 1 },
  { id: 'wa_single_asterisk', text: '*urgent* please call me back', opts: { shape: 'chat' }, want: 1 },
  { id: 'emoji_repeat_run', text: 'great stay \u{1F600}\u{1F600}', opts: { shape: 'chat' }, want: 1 },
  { id: 'emoji_bullet_led',
    text: '\u{1F31F} Location is great\n\u{1F3E8} Rooms are clean', opts: { shape: 'chat' }, want: 1 },

  // --- B.4 Turkish orthography (all HUMAN-direction) ---------------------
  { id: 'tr_asciified_probe',
    text: 'merhaba yarin cok tesekkurler ve gelecegim icin bugun', opts: { shape: 'chat', lang: 'tr' },
    want: 6 / 7 },                                   // 6 ASCII-fied hits, 0 diacritic: 6/(6+0+1)
  { id: 'tr_mixed_orthography',
    text: 'yarin cok geçen büyük tesekkurler ve bugun için',
    opts: { shape: 'chat', lang: 'tr' }, want: 1 },
  { id: 'tr_bare_capital_I',
    text: 'Istanbul ve Izmir cok guzel yerler bence gercekten', opts: { shape: 'chat', lang: 'tr' },
    want: 2 },
  { id: 'tr_apostrophe_absent',
    text: 'yarin sabah Istanbulda olacagiz ve sonra Ankarada bulusalim diye dusunuyorum ben de tamam',
    opts: { shape: 'chat', lang: 'tr' }, want: 2 },
  { id: 'tr_chat_morphology',
    text: 'tmm abi ben gelicem yarin', opts: { shape: 'chat', lang: 'tr' }, want: 3 },
  { id: 'tr_formal_copula',
    text: `bulunmaktadır yapılmalıdır ${'ve '.repeat(98)}`.trim(),
    opts: { shape: 'prose', lang: 'tr' }, want: 2 }, // 2 hits per 100 tokens

  // --- B.5 structure and register ---------------------------------------
  { id: 'bold_lead_in_list',
    text: '- **Location**: Central and well connected.\n- **Breakfast:** Included every morning here.\n- Rooms: Clean and quiet for the price paid.',
    opts: { shape: 'prose' }, want: 3 },
  { id: 'colon_led_list',
    text: 'Here is what you get for the price of one night in this hotel:\n- breakfast\n- parking',
    opts: { shape: 'prose' }, want: 1 },
  { id: 'enumerated_openers',
    text: 'First, the room was clean. Second, the staff was kind. Third, the view was open. '
      + 'The bed was soft. The shower was hot. The price was fair.',
    opts: { shape: 'prose' }, want: 1 },
  { id: 'parallel_openers',
    text: sentencesOf([15, 15, 15, 15], 'The') + ' ' + sentencesOf([15], 'Alpha')
      + ' ' + sentencesOf([15], 'Beta') + ' ' + sentencesOf([15], 'Gamma')
      + ' ' + sentencesOf([15], 'Delta'),
    opts: { shape: 'prose' }, want: 1 - 5 / 8 },     // 5 distinct openers over 8 sentences
  { id: 'closing_summary_move',
    text: sentencesOf([60, 60], 'The') + '\n\nIn conclusion, the stay was pleasant and good.',
    // lang pinned: the filler is one repeated word, so language ID has nothing to vote on and
    // R32 correctly calls it `mixed`. This golden is about the FEATURE, not the language ID.
    opts: { shape: 'prose', lang: 'en' }, want: 1 },
  { id: 'balanced_contrast_frame',
    text: 'The hotel was not only clean but also quiet. ' + sentencesOf([95], 'The'),
    opts: { shape: 'prose', lang: 'en' }, want: 1 },
  { id: 'out_of_channel_register',
    text: sentencesOf([60], 'The') + '\n\n' + sentencesOf([60], 'The'),
    opts: { channel: 'whatsapp', shape: 'prose' }, want: 1 },
  { id: 'greeting_signoff_frame',
    text: 'Dear Sir, ' + sentencesOf([30], 'The') + ' Best regards, M.',
    opts: { shape: 'chat', lang: 'en' }, want: 1 },
  { id: 'llm_lexicon_strong',
    text: 'i hope this helps and we can delve into the rest of the plan tomorrow with you',
    opts: { shape: 'chat' }, want: 2 },
  { id: 'llm_lexicon_weak',
    text: 'the hotel is a hidden gem and it is top-notch ' + sentencesOf([38], 'The'),
    opts: { shape: 'prose' }, want: null },          // computed below (density depends on tokens)
  { id: 'politeness_formula',
    text: 'thank you for your help with the booking last week and the change of dates',
    opts: { shape: 'chat' }, want: 1 },
  { id: 'hedge_density',
    text: 'The room may be small and the staff might be busy. ' + sentencesOf([90], 'The'),
    opts: { shape: 'prose', lang: 'en' }, want: null },   // computed below
  { id: 'human_lexicon',
    text: 'btw idk lol i think that is fine for me', opts: { shape: 'chat' },
    want: 7 },                                       // idk+lol strong (3 each) + btw weak (1)
  { id: 'contraction_apostrophe_drop',
    text: 'i dont think thats right im tired', opts: { shape: 'chat' }, want: 3 },
  { id: 'self_correction_marker',
    text: 'sorry typo i meant tomorrow', opts: { shape: 'chat' }, want: 2 },
];

function featureGoldens() {
  const byId = new Map(FEATURES.map((f) => [f.id, f]));
  const covered = new Set();

  for (const g of GOLDENS) {
    const f = byId.get(g.id);
    if (!ok(`golden ${g.id}: feature exists`, Boolean(f))) continue;
    covered.add(g.id);
    const ctx = _buildContext(g.text, { ...BASE, ...g.opts });
    const out = f.compute(ctx);
    if (!ok(`golden ${g.id}: computed a value`, out !== null && out !== undefined,
      `ctx lang=${ctx.lang} shape=${ctx.shape} tokens=${ctx.tokenCount} sentences=${ctx.sentences.length}`)) continue;
    if (g.want === null) {
      // density goldens: assert the arithmetic explicitly rather than a magic constant
      if (g.id === 'llm_lexicon_weak') {
        const hits = ctx.lexHits.filter((h) => h.row.kind === 'llm' && h.row.tag === 'weak').length;
        near(`golden ${g.id}`, out.value, (hits * 100) / ctx.tokenCount);
        ok(`golden ${g.id}: at least one weak hit present`, hits >= 2, `hits=${hits}`);
      } else if (g.id === 'hedge_density') {
        near(`golden ${g.id}`, out.value, (2 * 100) / ctx.tokenCount);   // "may" + "might"
      }
      continue;
    }
    near(`golden ${g.id}`, out.value, g.want, 1e-9);
  }

  for (const f of FEATURES) {
    ok(`every Tier-1 feature has a golden: ${f.id}`, covered.has(f.id));
    ok(`every Tier-1 feature names a confounder: ${f.id}`, typeof f.note === 'string' && f.note.length > 30);
  }
}

function aggregateGoldens() {
  const lex = new Set();
  const mk = (texts) => prepareAggregate(texts.map((t, i) => ({ id: 'm' + i, text: t })), 'en', lex);
  const byId = new Map(AGG_FEATURES.map((f) => [f.id, f]));

  // msg_length_uniformity: five messages of identical length => sd 0 => value 1
  near('golden msg_length_uniformity',
    byId.get('msg_length_uniformity').compute(mk(['abcdefghij', 'abcdefghij', 'abcdefghij', 'abcdefghij', 'abcdefghij'])).value, 1);

  // template_repetition: one identical 6-gram across 3 of 5 messages => binary 1
  const tpl = 'thanks for the quick reply about that';
  near('golden template_repetition',
    byId.get('template_repetition').compute(mk([tpl, tpl, tpl, 'ok', 'fine'])).value, 1);

  // cross_msg_style_variance: five IDENTICAL messages => every axis sd is 0 => value 0
  near('golden cross_msg_style_variance',
    byId.get('cross_msg_style_variance').compute(mk(['Ok fine.', 'Ok fine.', 'Ok fine.', 'Ok fine.', 'Ok fine.'])).value, 0);

  // idiolect_stability: exactly one rare token repeated in exactly 2 of 5 messages
  const idio = byId.get('idiolect_stability').compute(mk([
    'kapadokya trip', 'the kapadokya plan', 'ok', 'fine', 'sure',
  ]));
  near('golden idiolect_stability', idio.value, 1);

  // bare_token_turn_rate: 2 of 5 messages are bare turns
  near('golden bare_token_turn_rate',
    byId.get('bare_token_turn_rate').compute(mk(['ok', '5', 'the room was clean and quiet',
      'the staff were kind to us', 'the view was open and wide'])).value, 0.4);

  for (const f of AGG_FEATURES) {
    ok(`every aggregate feature names a confounder: ${f.id}`, typeof f.note === 'string' && f.note.length > 30);
  }
}

// ===========================================================================
// 4. SCORER INVARIANTS
// ===========================================================================
const INVARIANT_TEXTS = [
  ['llm prose', 'Nestled in the heart of the old town, this hotel offers a wide range of amenities '
    + 'designed to ensure a comfortable stay. It is worth noting that the staff go above and beyond. '
    + 'Furthermore, the breakfast plays a crucial role in the day. In conclusion, this property '
    + 'stands as a testament to thoughtful hospitality.', { shape: 'prose' }],
  ['tr chat', 'merhaba abi yarin sabah geliyoruz 2 kisiyiz 3 gece kalcaz fiyat nedir acaba '
    + 'tesekkurler kolay gelsin size', { shape: 'chat', channel: 'whatsapp' }],
  ['en formal l2', 'Dear Sir or Madam, I am writing to express my sincere appreciation for the '
    + 'excellent service provided during my recent stay. The staff were highly professional, the '
    + 'room was impeccably clean, and the location was very convenient for business travellers. '
    + 'I would definitely recommend this hotel to my colleagues. Kind regards, M.', { shape: 'prose' }],
  ['explain mode', 'The room was clean and the staff were kind and helpful to us during our stay '
    + 'in the city last week.', { shape: 'chat', explain: true }],
];

function scorerInvariants() {
  for (const [name, text, opts] of INVARIANT_TEXTS) {
    const r = detect(text, { ...BASE, ...opts });

    // SPEC C.3 rule 3 — the contributions must literally explain the number.
    if (r.score !== null) {
      const sum = r.signals.filter((s) => s.value !== null)
        .reduce((a, s) => a + s.contribution, 0) + r.scoring.b0Effective;
      near(`invariant [${name}]: sum(contribution) + b0Effective === logit(score)`, sum, r.scoring.logit, 1e-9);
      near(`invariant [${name}]: logit(score) matches score`, 1 / (1 + Math.exp(-r.scoring.logit)), r.score, 1e-6);
      const rawSum = r.signals.filter((s) => s.value !== null)
        .reduce((a, s) => a + s.contributionRaw, 0) + r.scoring.b0;
      near(`invariant [${name}]: sum(contributionRaw) + b0 === uncapped logit`, rawSum, r.scoring.logitUncapped, 1e-9);
    }

    // SPEC C.3 rule 1.
    ok(`invariant [${name}]: score is null iff insufficient_text`,
      (r.verdict === 'insufficient_text') === (r.score === null));

    // SPEC C.3 rule 4: nulls are omitted, never renormalized.
    ok(`invariant [${name}]: null features contribute exactly 0`,
      r.signals.filter((s) => s.value === null).every((s) => s.contribution === 0));

    // SPEC C.3 rule 5: rules and signals are never merged.
    ok(`invariant [${name}]: no rule leaked into signals[]`,
      r.signals.every((s) => !['assistant_frame_leak', 'markdown_in_chat', 'known_machine_marker',
        'near_duplicate', 'invisible_chars'].includes(s.name)));

    // Every emitted signal carries a confounder note.
    ok(`invariant [${name}]: every signal names a confounder`,
      r.signals.every((s) => typeof s.note === 'string' && s.note.length > 20));

    // Cap band actually holds.
    if (r.score !== null && r.caps.maxDeviation !== null) {
      ok(`invariant [${name}]: |score-0.5| <= cap`,
        Math.abs(r.score - 0.5) <= r.caps.maxDeviation + 1e-9,
        `|${r.score}-0.5| vs ${r.caps.maxDeviation}`);
    }
  }

  // SPEC B.7 residue: display-only diagnostics must never reach the sum or the channels.
  const diag = detect('The room was clean and quiet and the staff were kind. ' + 'The bed was soft. '.repeat(20),
    { ...BASE, shape: 'prose' });
  ok('diagnostics: lexical-diversity block is present above 30 tokens', diag.diagnostics !== null);
  ok('diagnostics: type_token_ratio is reported', typeof diag.diagnostics?.type_token_ratio === 'number');
  ok('diagnostics: never enters signals[]',
    diag.signals.every((s) => !['mattr_50', 'hapax_ratio', 'type_token_ratio'].includes(s.name)));
  const curly = detect('he said \u201cit was fine\u201d and left the hotel at noon without paying the bill',
    { ...BASE, shape: 'chat' });
  ok('diagnostics: curly quotes are a NOTE, never a signal',
    curly.notes.some((n) => n.startsWith('curly_quotes_observed'))
    && curly.signals.every((s) => s.name !== 'quote_and_apostrophe_consistency'));

  // --explain must surface inactive features with value null.
  const ex = detect(INVARIANT_TEXTS[3][1], { ...BASE, ...INVARIANT_TEXTS[3][2] });
  ok('--explain lists inactive features with value null', ex.signals.some((s) => s.value === null));

  // Cap arithmetic.
  near('capLambda: no cap when already inside the band', capLambda(0.1, 0.45), 1);
  const lam = capLambda(4, 0.15);
  near('capLambda: lands exactly on the cap',
    Math.abs(1 / (1 + Math.exp(-(4 * lam))) - 0.5), 0.15, 1e-12);

  // Transform arithmetic.
  near('transform binary', transform('binary', 1, 0, 1), 1);
  near('transform continuous clips at +3', transform('continuous', 100, 0, 1), 3);
  near('transform rate uses log1p', transform('rate', 3, 0, 1), Math.log1p(3));

  // The 2-D table's core commitment: the bottom-left cell abstains.
  eq('table: no evidence either way => insufficient_text', tableVerdict(0.1, 0.1).verdict, 'insufficient_text');
  eq('table: llm high + human low => leaning_llm (never likely_llm)', tableVerdict(0.9, 0.1).verdict, 'leaning_llm');
  eq('table: both high => uncertain', tableVerdict(0.9, 0.9).verdict, 'uncertain');
  ok('table: both high flags contradictory_evidence',
    tableVerdict(0.9, 0.9).warnings.includes('contradictory_evidence'));
  eq('table: human high, llm low => leaning_human', tableVerdict(0.1, 0.9).verdict, 'leaning_human');
}

// ===========================================================================
// 5. RULE / VERDICT BEHAVIOUR
// ===========================================================================
function ruleBehaviour() {
  const leak = 'As an AI language model, I do not have access to real-time booking information, '
    + 'but here is a draft you can adapt for your hotel enquiry next week.';
  const r1 = detect(leak, { ...BASE, shape: 'chat' });
  eq('rule: assistant_frame_leak reaches likely_llm', r1.verdict, 'likely_llm');
  ok('rule: assistant_frame_leak is reported in rules[]', r1.rules.some((x) => x.name === 'assistant_frame_leak'));

  // R1 suppression: talking ABOUT an assistant is not being one.
  // R27 narrowed the common-noun case: bare "it was a language model" no longer matches at all.
  // This fixture keeps a real frame in the text so that the SUPPRESSION path is exercised.
  const about = 'I asked ChatGPT about the booking yesterday and it was no help at all. It replied '
    + 'that as an AI it could not check live availability, which was annoying but fine.';
  const r2 = detect(about, { ...BASE, shape: 'chat' });
  ok('rule: assistant_frame_leak suppressed near "chatgpt"',
    !r2.rules.some((x) => x.name === 'assistant_frame_leak'));
  ok('rule: suppression is reported as a note',
    r2.notes.some((n) => n.startsWith('assistant_frame_suppressed')));

  // Quoted match is suppressed too.
  const quoted = 'He wrote back "as an AI I cannot help with that" and then hung up on me, '
    + 'which felt rude given the circumstances.';
  ok('rule: assistant_frame_leak suppressed inside quotation marks',
    !detect(quoted, { ...BASE, shape: 'chat' }).rules.some((x) => x.name === 'assistant_frame_leak'));

  // Gate bypass: a fingerprint outranks the length floor.
  const tiny = detect('As an AI, no.', { ...BASE, shape: 'chat' });
  eq('rule: a high-precision fingerprint bypasses the length gates', tiny.verdict, 'likely_llm');

  // R2: plain dash bullets are NOT a markdown_in_chat hit.
  const plainBullets = detect('merhaba\n- 2 yetişkin\n- 1 çocuk\n- 3 gece kalıyoruz',
    { ...BASE, shape: 'chat', channel: 'whatsapp' });
  ok('R2: plain dash bullets alone are not a rule hit',
    !plainBullets.rules.some((x) => x.name === 'markdown_in_chat'));

  const mdChat = detect('## Your stay\n\n- **Location**: central\n- **Breakfast**: included\n\nLet me know.',
    { ...BASE, shape: 'chat', channel: 'whatsapp' });
  ok('R2: a markdown header IS a rule hit', mdChat.rules.some((x) => x.name === 'markdown_in_chat'));

  // R17: markers.json ships as [] so known_machine_marker never fires by default.
  ok('R17: known_machine_marker is silent with the shipped empty markers.json',
    !detect('REF-123456 your booking is confirmed for two nights in the double room.',
      { ...BASE, shape: 'chat' }).rules.some((x) => x.name === 'known_machine_marker'));
  const marked = detect('REF-123456 your booking is confirmed for two nights in the double room.',
    { ...BASE, shape: 'chat', markers: [{ name: 'demo_ref', pattern: '\\bREF-[0-9]{6}\\b', note: 'demo.' }] });
  ok('R17: a configured marker fires and reaches likely_llm',
    marked.rules.some((x) => x.name === 'known_machine_marker') && marked.verdict === 'likely_llm');
  ok('R17: a marker hit warns pasted_machine_text', marked.warnings.includes('pasted_machine_text'));

  // R3: near_duplicate alone stops at leaning_llm and says what it actually proves.
  const dupText = 'The hotel was excellent and the staff were extremely helpful during our stay in '
    + 'the old town last week, and we would gladly return again next summer with the family.';
  const idx = buildCorpusIndex([{ id: 'other-1', sender: 'B', text: dupText }]);
  const dup = detect(dupText, { ...BASE, shape: 'prose', corpusIndex: idx, sender: 'A' });
  ok('R3: near_duplicate fires', dup.rules.some((x) => x.name === 'near_duplicate'));
  ok('R3: near_duplicate alone does not reach likely_llm', dup.verdict !== 'likely_llm');
  ok('R3: near_duplicate warns templated_or_copied', dup.warnings.includes('templated_or_copied'));

  // invisible_chars never fires alone.
  const inv = detect('the room was clean​ and the staff were kind to us during the stay here ok',
    { ...BASE, shape: 'chat' });
  ok('invisible_chars alone is a note, not a rule',
    !inv.rules.some((x) => x.name === 'invisible_chars')
    && inv.notes.some((n) => n.startsWith('invisible_chars')));

  // Domain suppression.
  const snippet = 'Thank you for reaching out. I would be happy to help with that. Could you please '
    + 'confirm your booking reference and the dates you had in mind? Rest assured we will look into '
    + 'it as soon as the reservations desk opens tomorrow morning. We apologize for any inconvenience '
    + 'this has caused you and your family. Let me know if you have any questions. Best regards.';
  const general = detect(snippet, { ...BASE, shape: 'chat' });
  const cs = detect(snippet, { ...BASE, shape: 'chat', domain: 'customer_service' });
  ok('domain suppression lowers the LLM channel on a support snippet',
    cs.channels.llm < general.channels.llm, `${cs.channels.llm} vs ${general.channels.llm}`);
  ok('domain suppression is reported', cs.warnings.includes('domain_suppressed'));

  // likely_human is unreachable single-message.
  ok('likely_human is unreachable in single-message mode',
    detect('tmm abi bakarim ben sana donerim yarin sabah gorusuruz eyvallah kolay gelsin sana',
      { ...BASE, shape: 'chat', channel: 'whatsapp' }).verdict !== 'likely_human');

  // >=2 features from >=2 groups.
  const single = detect('pleaseee' + ' ok'.repeat(30), { ...BASE, shape: 'chat' });
  ok('single-feature guard leaves a lone-feature verdict at uncertain or below',
    ['uncertain', 'insufficient_text', 'leaning_human'].includes(single.verdict));

  // R22: Arabic is refused with the exact contract.
  const ar = detect('مرحبا كيف حالك '
    + 'اليوم أتمنى أن تكون '
    + 'بخير وسعيد جدا بهذا '
    + 'اليوم الجميل والرائع',
  { ...BASE });
  eq('R22: Arabic primary is "unsupported"', ar.language.primary, 'unsupported');
  eq('R22: Arabic verdict is insufficient_text', ar.verdict, 'insufficient_text');
  eq('R22: Arabic score is null', ar.score, null);
  eq('R22: Arabic fails G3_lang', ar.gates.failed.join(','), 'G3_lang');
  eq('R22: Arabic reason is unsupported_language', ar.gates.reason, 'unsupported_language');

  // Aggregate mode.
  const msgs = [
    { id: 'a1', text: 'merhaba abi yarin geliyoruz' },
    { id: 'a2', text: 'tmm' },
    { id: 'a3', text: 'kapadokya icin fiyat nedir acaba' },
    { id: 'a4', text: 'pardon yok yani 3 gece dedim' },
    { id: 'a5', text: 'kapadokya turu da olsun eyvallahhh' },
  ];
  const ag = aggregate(msgs, { ...BASE, sender: 'R0', lang: 'tr' });
  eq('aggregate: mode is reported', ag.mode, 'aggregate');
  eq('aggregate: messageCount is reported', ag.messageCount, 5);
  eq('aggregate: perMessage traceability is present', ag.perMessage.length, 5);
  ok('aggregate: aggregate-only features ran',
    ag.signals.some((s) => s.group === 'aggregate' && s.value !== null));
  const few = aggregate(msgs.slice(0, 3), { ...BASE, sender: 'R0' });
  eq('aggregate: <5 messages is insufficient_text', few.verdict, 'insufficient_text');
  eq('aggregate: <5 messages reason is aggregate_floor', few.gates.reason, 'aggregate_floor');
}

// ===========================================================================
// 6. DETERMINISM (HEAD-RULINGS R12)
// ===========================================================================
function determinism() {
  const text = 'Nestled in the heart of the old town, this hotel offers a wide range of amenities. '
    + 'It is worth noting that the staff go above and beyond every single day of the week.';
  const a = JSON.stringify(detect(text, { ...BASE, shape: 'prose' }));
  const b = JSON.stringify(detect(text, { ...BASE, shape: 'prose' }));
  ok('determinism: two calls in one process are byte-identical', a === b);

  // D-16: an execFileSync throw used to end the run in a Node stack trace before the assertion
  // summary was ever printed (that is how the reviewer's mutation (a) surfaced). A non-zero child
  // exit is a FAIL line now.
  const args = ['stylometry.mjs', '--text', text, '--allow-uncalibrated', '--json'];
  const child = () => {
    try { return { ok: true, out: execFileSync(process.execPath, args, { cwd: HERE, encoding: 'utf8' }) }; }
    catch (e) {
      return { ok: false, out: String(e.stdout ?? ''), err: `exit ${e.status}: ${String(e.stderr ?? e.message).trim().slice(0, 200)}` };
    }
  };
  const p1 = child(), p2 = child();
  if (ok('determinism: the CLI sub-process exits 0', p1.ok && p2.ok, p1.err ?? p2.err)) {
    const strip = (s) => s.replace(/"sha256":"[0-9a-f]{64}"/, '"sha256":"<hash>"');
    ok('determinism: two separate processes are byte-identical', strip(p1.out) === strip(p2.out));
  }

  info.push('determinism across two Node MINOR VERSIONS: NOT VERIFIED — only Node '
    + `${process.version} is installed on this machine (HEAD-RULINGS R12). The two-run and `
    + 'two-process checks above did pass.');

  // detect() is pure: opts.now is the only clock, and omitting it says so.
  const noNow = detect(text, { allowUncalibrated: true, shape: 'prose' });
  ok('purity: omitting opts.now warns expiry_not_checked', noNow.warnings.includes('expiry_not_checked'));
  const withNow = detect(text, { allowUncalibrated: true, shape: 'prose', now: FIXED_NOW });
  ok('purity: opts.now removes the expiry_not_checked warning',
    !withNow.warnings.includes('expiry_not_checked'));
  const expired = detect(text, { allowUncalibrated: true, shape: 'prose', now: Date.parse('2030-01-01') });
  ok('expiry: a past expiresAt warns weights_expired', expired.warnings.includes('weights_expired'));
}

// ===========================================================================
// 7. MUST-NOT-FIRE FIXTURES (D1 §7)
// ===========================================================================
// Inline copies of 8 of D1 §7's rows so B1 is not blocked by B2. The Arabic rows (A4, A7, A8, B3,
// B11) are dropped by HEAD-RULINGS R22. `allowed` is the verdict set the release gate permits.
const NOT_LIKELY_LLM = ['insufficient_text', 'uncertain', 'leaning_human', 'leaning_llm', 'likely_human'];
const NOT_LIKELY_HUMAN = ['insufficient_text', 'uncertain', 'leaning_human', 'leaning_llm', 'likely_llm'];

const INLINE_FIXTURES = [
  { id: 'A1', group: 'A', lang: 'en', context: 'prose', allowed: NOT_LIKELY_LLM,
    why: 'L2 (Turkish-speaking) writer, textbook-formal, zero typos, greeting+signoff',
    text: 'Dear Sir or Madam, I am writing to express my sincere appreciation for the excellent '
      + 'service provided during my recent stay. The staff were highly professional, the room was '
      + 'impeccably clean, and the location was very convenient for business travellers. I would '
      + 'definitely recommend this hotel to my colleagues. Kind regards, M.' },
  { id: 'A2', group: 'A', lang: 'en', context: 'prose', allowed: NOT_LIKELY_LLM,
    why: "a project manager's real email: bold lead-in list plus a polite close",
    text: 'Hi team,\n\nQuick update before Friday.\n\n- **Booking**: confirmed for the 12th, two '
      + 'rooms held under the company name.\n- **Invoice**: finance will process it next week once '
      + 'the PO lands.\n- **Transport**: I have asked the hotel for a shuttle quote.\n\nLet me know '
      + 'if you have any questions.\n\nBest,\nDave' },
  { id: 'A3', group: 'A', lang: 'tr', context: 'prose', genre: 'formal_letter', allowed: NOT_LIKELY_LLM,
    why: "a lawyer's complaint letter — Turkish officialese IS this register",
    text: 'Söz konusu rezervasyonun iptal edilmesi hususunda tarafınıza defalarca '
      + 'bildirimde bulunulmuş olmasına rağmen herhangi bir işlem '
      + 'yapılmamaktadır. Konunun önem taşıdığı ve '
      + 'müvekkilimin mağduriyetinin devam ettiği göz önünde '
      + 'bulundurulduğunda, gereğinin yapılmasını saygılarımla '
      + 'arz ederim.' },
  { id: 'A5', group: 'A', lang: 'en', context: 'chat', domain: 'customer_service', allowed: NOT_LIKELY_LLM,
    why: "a support agent's real snippet — every phrase is on the LLM list and in a human library",
    text: 'Thank you for reaching out. I would be happy to help with that. Could you please confirm '
      + 'your booking reference and the dates you had in mind? Best regards.' },
  { id: 'A6', group: 'A', lang: 'tr', context: 'chat', allowed: NOT_LIKELY_LLM,
    why: 'a hotel guest on an iPhone with a Turkish keyboard — flawless because the KEYBOARD is',
    text: 'Merhaba, İstanbul’a 12 Mart’ta geliyoruz. İki kişilik bir oda '
      + 'ayırtmak istiyorum. Üç gece kalacağız. Teşekkürler.' },
  { id: 'A11', group: 'A', lang: 'en', context: 'chat', allowed: ['insufficient_text'],
    why: '16 tokens, polite, terminated, no human markers. There is no information here.',
    text: 'Good morning. Could you please confirm the reservation for two adults on 12 March? Thank you.' },
  { id: 'B1', group: 'B', lang: 'tr', context: 'chat', allowed: NOT_LIKELY_HUMAN,
    why: 'model prompted "reply like a WhatsApp user" — every human channel lights up',
    text: 'tmm abi bakarim ben sana donerim yarin sabah gorusuruz eyvallah kolay gelsin' },
  { id: 'B2', group: 'B', lang: 'en', context: 'chat', allowed: ['insufficient_text'],
    why: 'model output, 3 tokens',
    text: 'Sure, sounds good.' },
];

function loadB2Fixtures() {
  const p = join(HERE, 'eval', 'fixtures', 'must-not-fire.jsonl');
  if (!existsSync(p)) return null;
  const rows = [];
  readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    try { rows.push(JSON.parse(line)); }
    catch { failures.push(`must-not-fire.jsonl line ${i + 1} is not valid JSON`); }
  });
  return rows;
}

function mustNotFire() {
  const b2 = loadB2Fixtures();
  const rows = b2 ?? INLINE_FIXTURES;
  const source = b2 ? `eval/fixtures/must-not-fire.jsonl (${rows.length} rows)`
    : `inline copy of ${INLINE_FIXTURES.length} D1 §7 rows (B2 has not produced the file yet)`;
  info.push(`must-not-fire source: ${source}`);

  let aLikelyLlm = 0, bLikelyHuman = 0, bAbstained = 0, aCount = 0, bCount = 0;
  for (const row of rows) {
    const opts = {
      ...BASE, shape: row.shape ?? row.context ?? 'auto', lang: row.lang ?? 'auto',
      genre: row.genre ?? 'auto', domain: row.domain ?? 'general', channel: row.channel ?? 'unknown',
    };
    let r;
    try { r = detect(row.text ?? '', opts); }
    catch (e) { failures.push(`must-not-fire ${row.id}: threw ${e.message}`); continue; }

    const group = row.group ?? (row.id?.startsWith('A') ? 'A' : 'B');
    if (group === 'A') {
      aCount++;
      if (r.verdict === 'likely_llm') aLikelyLlm++;
      ok(`must-not-fire ${row.id}: not likely_llm (${row.why ?? ''})`, r.verdict !== 'likely_llm',
        `got ${r.verdict}`);
    } else {
      bCount++;
      if (r.verdict === 'likely_human') bLikelyHuman++;
      if (r.verdict === 'insufficient_text' || r.verdict === 'uncertain') bAbstained++;
      ok(`must-not-fire ${row.id}: not likely_human (${row.why ?? ''})`, r.verdict !== 'likely_human',
        `got ${r.verdict}`);
    }
    // B2's fixture file carries BOTH a hard contract (criticalFailure) and a tighter expectation
    // (allowed). criticalFailure is fatal here; an `allowed` mismatch that is not a critical
    // failure is reported for the head to arbitrate (SPEC §I "Conflict rules": B1 does not edit
    // B2's fixtures and B2 does not edit B1's verdicts).
    if (Array.isArray(row.criticalFailure) && row.criticalFailure.length) {
      ok(`must-not-fire ${row.id}: no critical failure (${row.why ?? ''})`,
        !row.criticalFailure.includes(r.verdict), `got ${r.verdict}`);
    }
    if (Array.isArray(row.allowed) && row.allowed.length && !row.allowed.includes(r.verdict)) {
      const critical = Array.isArray(row.criticalFailure) && row.criticalFailure.includes(r.verdict);
      if (critical) {
        ok(`must-not-fire ${row.id}: verdict in allowed set`, false,
          `got ${r.verdict}, allowed ${row.allowed.join('|')}`);
      } else {
        arbitration.push(`${row.id} (${row.lang}/${row.shape}): core says ${r.verdict}, fixture `
          + `allows ${row.allowed.join('|')} — not a critical failure. ${row.why ?? ''}`);
      }
    } else if (Array.isArray(row.allowed) && row.allowed.length) {
      ok(`must-not-fire ${row.id}: verdict in allowed set`, true);
    }
  }

  ok(`release gate: zero likely_llm on group A (${aCount} rows)`, aLikelyLlm === 0);
  ok(`release gate: zero likely_human on group B (${bCount} rows)`, bLikelyHuman === 0);
  if (bCount > 0) {
    const need = Math.ceil(bCount / 2);
    ok(`release gate: >=half of group B abstains (${bAbstained}/${bCount}, need ${need})`,
      bAbstained >= need);
    info.push(`abstention on group B: ${bAbstained}/${bCount} produced insufficient_text or uncertain`);
  }
  if (!b2) {
    info.push('NOTE: the full 24-row gate (SPEC §I) cannot run until B2 ships '
      + 'eval/fixtures/must-not-fire.jsonl. This run used the inline subset.');
  }
}

// ===========================================================================
// 7b. VERIFY ROUND 1 — every fix in HEAD-RULINGS R22/R24/R26-R30 and the reviewer's D-01..D-16
//     has an assertion here, each one reproducing the defect the fix closed.
// ===========================================================================

// R24 §: the refuter's authored human texts, copied in as goldens. None of these may reach
// leaning_llm or likely_llm. Provenance: authored in the verify round, head-approved
// (.scratch/refuter/texts/); H13/H34 name-scrubbed.
const R24_HUMAN_GOLDENS = [
  { id: 'H01', lang: 'en', shape: 'prose', channel: 'unknown',
    why: 'TOEFL-style L2 English essay, 229 words — SPEC H.3, the class detectors are known to convict',
    text: 'In my opinion, the most important thing for a young person is to travel while he is still '
      + 'student. When I was in the university in Izmir, I did not have much money, but I saved from '
      + 'my food money and I went to Prague with two friend. This experience change my life '
      + 'completely.\n\nFirst reason is that travel teach you the things which book cannot teach. You '
      + 'must find the hotel by yourself, you must speak with people who do not understand your '
      + 'language, and you must solve the problem when the train is late. These are the skills that '
      + 'no exam can measure.\n\nSecond reason is about the tolerance. Before I travel, I think that '
      + "my country's way is the only correct way. After I saw how the people live in other place, I "
      + 'understand that there are many correct ways. This is very important lesson for a young '
      + 'mind.\n\nSome people say that the young person should first finish the education and after '
      + 'that travel. I do not agree with this idea, because when you finish the education you have '
      + 'the job and the family, and you cannot travel freely anymore. The time of the student is the '
      + 'only free time in the life.\n\nFor these reasons I believe strongly that every student must '
      + 'travel at least one time to a foreign country before he graduate.' },
  { id: 'H07', lang: 'tr', shape: 'chat', channel: 'whatsapp',
    why: 'careful Turkish WhatsApp booking request — the A7 class, escaping on the ordinary word "ayrıca"',
    text: "Merhaba, 12 Ağustos'ta İstanbul'a geliyoruz ve otelinizde iki gece kalmak istiyoruz. Biz üç "
      + 'kişiyiz, eşim ve dokuz yaşındaki kızımla birlikte. Kızım için ilave yatak koyabilir misiniz? '
      + 'Ayrıca havalimanından otele transfer hizmetiniz var mı, varsa ücreti nedir? Bilgi verirseniz '
      + 'çok sevinirim. Saygılarımla.' },
  { id: 'H13', lang: 'en', shape: 'chat', channel: 'web',
    why: 'EN support-desk reply WITHOUT --domain customer_service — the caller who forgets the flag',
    text: 'Hi there, thank you for reaching out. I’d be happy to help with this. I have checked '
      + 'your booking and I can see the payment was taken twice on the 3rd. I have requested a refund '
      + 'for the duplicate charge and it should reach your account within five working days. Please '
      + 'let me know if you have any questions.' },
  { id: 'H15', lang: 'tr', shape: 'chat', channel: 'whatsapp',
    why: 'TR support-desk reply WITHOUT --domain customer_service',
    text: 'Merhaba, mesajınız için teşekkür ederiz. Rezervasyonunuzu kontrol ettim, 14 Ağustos girişli '
      + 'kaydınız sistemde görünüyor. Ödeme onayınız da geldi. Anlayışınız için teşekkür ederiz, başka '
      + 'bir sorunuz olursa yazabilirsiniz. İyi günler dileriz.' },
  { id: 'H34', lang: 'en', shape: 'chat', channel: 'whatsapp',
    why: 'careful native-English formal WhatsApp guest message — escaped on out_of_channel_register',
    text: 'Good morning. I am writing regarding a booking I made through your website last Tuesday, '
      + 'reference 88214.\n\nI have not yet received a confirmation email, although the payment has '
      + 'already been taken from my card. I have checked my spam folder twice and there is nothing '
      + 'there. Could you please confirm that the reservation exists in your system?\n\nWe are '
      + 'arriving on the evening of the 14th, quite late, around eleven o’clock. Is the reception '
      + 'staffed at that hour, or should we make some other arrangement?\n\nOne last thing. My wife '
      + 'uses a wheelchair. The website mentions accessible rooms but does not say whether the '
      + 'bathroom has a roll-in shower. Could you clarify?\n\nThank you for your time. Kind regards, P.' },
];

// R27: every leak pattern ships with ONE POSITIVE and ONE HUMAN-NEGATIVE line. The positive list
// is the refuter's .scratch/refuter/leakprobe.mjs; the negatives are the shapes a human writes.
const LEAK_POSITIVES = [
  ['as a large language model', 'As a large language model, I am not able to verify that claim.'],
  ["I'm just an AI", "I'm just an AI, so I cannot confirm the current price of that room."],
  ['I am merely an AI assistant', 'I am merely an AI assistant and cannot make the reservation for you.'],
  ['my knowledge cut-off (hyphen)', 'My knowledge cut-off means I may not have the latest information.'],
  ['my knowledge cutoff', 'My knowledge cutoff means I may not have the latest information.'],
  ['as of my last update', 'As of my last update, the property was under the previous management.'],
  ['as of my latest training', 'As of my latest training, the property was under previous management.'],
  ['real time (no hyphen)', 'I do not have real time access to booking systems, so please confirm.'],
  ['real-time (hyphen)', 'I do not have real-time access to booking systems, so please confirm.'],
  ['no access to the internet', "I don't have access to the internet, so I cannot check availability."],
  ['unable to browse the web', 'I am unable to browse the web, so I cannot check availability for you.'],
  ['here is a revised draft', 'Here is a revised draft of the complaint letter you asked for.'],
  ["here's your revised version", "Here's your revised version of the complaint letter you asked for."],
  ['I have rewritten it below', 'I have rewritten it below in a more formal register for you.'],
  ["here's a polished VERSION (R34 b)", "Here's a polished version of your email, ready to send."],
  ['I was trained on data', 'I was trained on data up to a certain point, so I may be out of date.'],
  ['TR yapay zeka modeli olarak', 'Bir yapay zeka modeli olarak bu rezervasyonu sizin adınıza yapamam.'],
  ['TR yapay zekâ (circumflex)', 'Bir yapay zekâ modeli olarak bu rezervasyonu sizin adınıza yapamam.'],
  ['TR yapay zeka asistanıyım', 'Ben bir yapay zeka asistanıyım ve bu işlemi sizin yerinize yapamam.'],
  ['TR BÜYÜK HARF MODELİYİM', 'BEN BİR YAPAY ZEKA MODELİYİM, size nasıl yardımcı olabilirim?'],
  ['TR bilgi kesim tarihim', 'Bilgi kesim tarihim nedeniyle güncel fiyatları bilmiyor olabilirim.'],
  ['TR eğitim verilerim', 'Eğitim verilerim belirli bir tarihe kadar olduğu için güncel bilgim yok.'],
  ['TR bir dil modeli olarak', 'Bir dil modeli olarak bu konuda hukuki tavsiye veremem maalesef.'],
  ['TR gerçek zamanlı erişim', 'Gerçek zamanlı erişimim olmadığı için müsaitliği kontrol edemiyorum.'],
  ['line break inside the frame', 'As an\nAI I cannot verify that claim for you at this moment.'],
  ['double spaces inside the frame', 'As  an  AI  I  cannot verify that claim for you at this moment.'],
  ['NBSP inside the frame', 'As an AI I cannot verify that claim for you at this moment.'],
  ['language model over a line break', 'I am a large language\nmodel and cannot make that booking.'],
  ['TR frame over a line break', 'Bir yapay zeka\nmodeli olarak bu rezervasyonu yapamam bugün.'],
];

const LEAK_NEGATIVES = [
  ['common-noun "language model" (D3)',
    'The spreadsheet has never once told me it was a language model, which is more than I can say '
    + 'for the chatbot the agency installed last spring.'],
  ['a human discussing an assistant (D2)',
    'The assistant my company installed is genuinely not ready for customers yet. It answered a '
    + 'pricing question with as an AI I cannot access that, which is not an answer anybody wanted.'],
  ['a human discussing an LLM (D2)',
    'The LLM they bought last year still replies with I am an AI and cannot help, every single time '
    + 'a customer asks about a refund.'],
  ['reported speech, third person (D1)',
    'He then told me, and I am quoting him exactly here, that as an AI he could not diagnose the '
    + 'fault remotely, which is when I realised he had been reading answers off his phone.'],
  ['a cue one sentence away (D1)',
    'I asked chatgpt about it yesterday and it was no use at all. It replied that as an AI it could '
    + 'not help me, so I gave up and phoned the hotel instead.'],
  ['quoted inside double quotes',
    'He wrote back "as an AI I cannot help with that" and then hung up on me, which felt rude.'],
  ['TR human quoting an assistant',
    'Dün yapay zekaya sordum, bana "bir yapay zeka modeli olarak bunu yapamam" diye cevap verdi, '
    + 'çok saçma geldi açıkçası.'],
  ['a human drafting for themselves',
    'I have rewritten my CV three times this month and I still hate the opening paragraph.'],
  // R34 (b) / verify-round row N07: a human FORWARDING a document is not a drafting frame. The
  // old R1 pattern `here is (a|an|the) (draft|revised|…)` had no head noun and accused them.
  ['N07 — a human forwarding a revised itinerary',
    'Here is the revised itinerary my colleague sent over this morning, with the ferry times '
    + 'corrected and the museum moved to Tuesday. Let me know if the new order works for you.'],
  // R34 (a) / verify-round row N09: the bare Turkish common noun "yapay zeka asistanı" is a
  // product a human is complaining about, not a machine identifying itself.
  ['N09 — a human complaining about an agency assistant (TR)',
    'Acentenin sitesindeki yapay zeka asistanı tam bir felaket. Fiyat sorduğumda bana bir yapay '
    + 'zeka modeli olarak bu bilgiye erişemiyorum diye cevap verdi, sonra da konuşmayı kapattı.'],
  ['the bare TR common noun alone never fires',
    'Sitenin yapay zeka asistanı felaket durumda ve hiçbir soruya doğru cevap veremiyor bugün.'],
];

function verifyRoundOne() {
  const P = { ...BASE, shape: 'prose' };
  const C = { ...BASE, shape: 'chat' };

  // --- reviewer D-06 / R22: the language gate is NOT bypassable by a Tier-0 rule -----------
  // Built from code points so no Arabic script appears in this file.
  const arabic = [0x645, 0x631, 0x62d, 0x628, 0x627, 0x20, 0x623, 0x631, 0x64a, 0x62f, 0x20, 0x62d,
    0x62c, 0x632, 0x20, 0x63a, 0x631, 0x641, 0x629, 0x20, 0x644, 0x64a, 0x648, 0x645, 0x64a, 0x646,
    0x20, 0x641, 0x64a, 0x20, 0x641, 0x646, 0x62f, 0x642, 0x643, 0x645, 0x20, 0x627, 0x644, 0x62c,
    0x62f, 0x64a, 0x62f, 0x20, 0x648, 0x634, 0x643, 0x631, 0x627, 0x20, 0x644, 0x643, 0x645]
    .map((c) => String.fromCodePoint(c)).join('');
  const arLeak = detect(`${arabic} As an AI language model, I cannot browse the web. ${arabic}`, P);
  eq('D-06/R22: an Arabic-dominant document with an EN fingerprint is NOT scored',
    arLeak.verdict, 'insufficient_text');
  eq('D-06/R22: ... and its score is null', arLeak.score, null);
  eq('D-06/R22: ... and it fails G3_lang', arLeak.gates.failed.join(','), 'G3_lang');
  eq('D-06/R22: ... with reason unsupported_language', arLeak.gates.reason, 'unsupported_language');
  eq('D-06/R22: ... and caps.bypassedByRule is false', arLeak.caps.bypassedByRule, false);
  ok('D-06/R22: the rule match is still REPORTED in rules[], it is just not used',
    arLeak.rules.some((r) => r.name === 'assistant_frame_leak'));
  ok('D-06/R22: the report says why the rule did not carry the verdict',
    arLeak.notes.some((n) => n.startsWith('language_gate_not_bypassable')));

  // --- R24 register-proxy cap --------------------------------------------------------------
  eq('R24: the proxy set is the ten features the ruling names', REGISTER_PROXY_LLM.size, 10);
  for (const id of ['terminal_punct_ratio', 'sentence_initial_caps', 'em_dash_in_chat',
    'exclam_single_regular', 'emoji_bullet_led', 'politeness_formula', 'greeting_signoff_frame',
    'tr_formal_copula', 'out_of_channel_register', 'llm_lexicon_weak']) {
    ok(`R24: ${id} is a register proxy`, REGISTER_PROXY_LLM.has(id));
  }

  const a7 = 'Merhaba, eylül ayının ikinci haftası için Kapadokya’da iki gecelik bir rezervasyon '
    + 'yaptırmak istiyorum. Biz iki yetişkin ve bir çocuğuz, çocuğumuz yedi yaşında. Mağara '
    + 'odalarınızdan biri müsait midir, müsait değilse standart oda da olabilir. Kahvaltı fiyata '
    + 'dahil mi, onu da öğrenmek isterim. Teşekkür ederim, iyi çalışmalar.';
  const rA7 = detect(a7, { ...C, lang: 'tr', channel: 'whatsapp', genre: 'chat' });
  eq('R24: fixture A7 (register proxies only) is uncertain, not leaning_llm', rA7.verdict, 'uncertain');
  ok('R24: A7 warns register_only_evidence', rA7.warnings.includes('register_only_evidence'));
  ok('R24: A7 names the proxy features and the non-proxy count in notes',
    rA7.notes.some((n) => n.startsWith('register_only_evidence') && n.includes('terminal_punct_ratio')));

  const review = '1. **Location:** The hotel sits in the heart of the old town and it is nestled in '
    + 'the heart of everything.\n2. **Breakfast:** A wide range of options that cater to every taste '
    + 'and delve into local flavours.\n3. **Service:** The staff go above and beyond, playing a '
    + 'crucial role in a seamless stay.\n\nIn conclusion, this property stands as a testament to '
    + 'thoughtful hospitality and it is worth noting that it offers a rich tapestry of comfort.';
  const rRev = detect(review, { ...P, genre: 'review' });
  eq('R24: lexicon-strong + bold_lead_in_list still reaches leaning_llm', rRev.verdict, 'leaning_llm');
  ok('R24: ... and does NOT carry register_only_evidence',
    !rRev.warnings.includes('register_only_evidence'));

  for (const g of R24_HUMAN_GOLDENS) {
    const r = detect(g.text, { ...BASE, shape: g.shape, lang: g.lang, channel: g.channel });
    ok(`R24 human golden ${g.id}: never leans LLM (${g.why})`,
      r.verdict !== 'leaning_llm' && r.verdict !== 'likely_llm', `got ${r.verdict}`);
  }
  info.push('R24 known confound, NOT asserted either way: the refuter’s H03 (L2 English '
    + 'complaint letter) and H04 (ESL connector essay) may stay leaning_llm. Their evidence is the '
    + 'prose rhythm/connector trio, which survives hard mode and is deliberately NOT a register '
    + 'proxy — that is the documented SPEC G.2 bias, mitigated by the judge’s C10, not the CLI.');

  // --- R26: acceptance check 7 holds FROM THE JSON ALONE ------------------------------------
  for (const [name, text, opts] of INVARIANT_TEXTS) {
    const r = detect(text, { ...BASE, ...opts });
    if (r.score === null) continue;
    const back = Math.log(r.score / (1 - r.score));
    near(`R26 [${name}]: logit(printed score) === scoring.logit`, back, r.scoring.logit, 1e-9);
  }

  // --- R27: 28 positives and 8 human negatives ----------------------------------------------
  for (const [name, text] of LEAK_POSITIVES) {
    const hit = assistantFrameLeak({ raw: text });
    ok(`R27 leak positive: ${name}`, Boolean(hit) && !hit.suppressed,
      hit ? `suppressed by ${hit.cue}` : 'no match');
  }
  for (const [name, text] of LEAK_NEGATIVES) {
    const hit = assistantFrameLeak({ raw: text });
    ok(`R27 human negative: ${name}`, hit === null || hit.suppressed === true,
      hit ? `FIRED on ${JSON.stringify(hit.matched)}` : '');
  }
  ok('R27: a suppressed hit is reported as a note naming the cue',
    runRules({ raw: LEAK_NEGATIVES[4][1], shape: 'prose', channel: 'unknown', tokenCount: 40,
      markers: [], foldedLex: LEAK_NEGATIVES[4][1].toLowerCase() })
      .notes.some((n) => n.includes('possible_quotation_or_discussion')));
  ok('R27: "As an AI assistant, I cannot" still fires — a cue inside the frame does not suppress',
    Boolean(assistantFrameLeak({ raw: 'As an AI assistant, I cannot make that booking for you.' })
      ?.name));

  // reviewer D-11 / D-12 / D-13
  ok('D-11: a curly apostrophe between two letters is not an open quote',
    assistantFrameLeak({ raw: 'It doesn’t matter. As an AI, I cannot browse the web.' })?.name
      === 'assistant_frame_leak');
  ok('D-11: a Turkish suffix apostrophe is not an open quote',
    assistantFrameLeak({ raw: 'Istanbul’a gidiyoruz. As an AI, I cannot help with that.' })?.name
      === 'assistant_frame_leak');
  ok('D-12: a frame occurring TWICE does not suppress itself',
    assistantFrameLeak({ raw: 'Ben bir yapay zeka modeliyim. Evet, bir yapay zeka modeliyim '
      + 'gercekten.' })?.name === 'assistant_frame_leak');
  ok('D-13: a suppressed hit does not suppress a later unsuppressed one',
    assistantFrameLeak({ raw: '"As an AI" is a phrase. Later: I am an AI and I cannot browse.' })
      ?.name === 'assistant_frame_leak');

  // --- reviewer D-02b: the Turkish regex cluster, end to end --------------------------------
  const trLeaks = [
    'Ben bir yapay zeka asistanı olarak bu konuda size yardımcı olamam maalesef.',
    'BEN BİR YAPAY ZEKA MODELİYİM, size nasıl yardımcı olabilirim?',
    'BİLGİ KESİM TARİHİM nedeniyle güncel fiyatları bilmiyorum.',
  ];
  for (const t of trLeaks) {
    ok(`D-02b: TR frame fires end to end (${t.slice(0, 34)}...)`,
      detect(t, { ...C, lang: 'tr' }).rules.some((r) => r.name === 'assistant_frame_leak'));
  }
  const trFiller = ' Otelin konumu gerçekten çok merkezi ve kahvaltı da oldukça zengin sayılır. '
    + 'Odalar temizdi, personel ilgiliydi ve fiyat performans dengesi bizim için uygundu. '
    + 'Havuz biraz küçüktü ama akşamları sessiz oluyordu, bu da bizim işimize yaradı. '
    + 'Kahvaltıda yerel ürünler vardı ve çay sınırsızdı, bunu ayrıca not etmek isterim. '
    + 'Ulaşım açısından tramvay durağı yürüme mesafesindeydi, bu büyük bir avantaj oldu. '
    + 'Resepsiyon geç saatte bile açıktı ve bize yardımcı oldular, teşekkür ederiz. '
    + 'Genel olarak konaklamamız beklediğimizden daha iyi geçti diyebilirim rahatlıkla. '
    + 'Otoparkı vardı ve arabayı akşam saatlerinde rahatça park edebildik biz orada. '
    + 'Odada mini buzdolabı ve su ısıtıcısı bulunuyordu, bunlar bizim için yeterliydi. '
    + 'Deniz manzarası olan odalar biraz daha pahalıydı ama bize göre değerdi diyebilirim. '
    + 'Çalışanlar bizi sıcak karşıladı ve her sorumuza sabırla cevap verdiler orada. ';
  const closer = detect(trFiller + '\n\nKısacası harika bir tatil oldu ve tekrar geleceğiz.',
    { ...P, lang: 'tr', genre: 'review' });
  ok('D-02b: closing_summary_move fires on "Kısacası" (a \\b after the dotless i never matched)',
    closer.signals.some((s) => s.name === 'closing_summary_move' && s.value === 1));
  const hedge = detect(trFiller.replace(/oldukça/g, 'çoğunlukla').replace(/oldukça/g, 'çoğunlukla')
    + ' Oda çoğunlukla sessizdi ve manzara çoğunlukla açıktı, bu da çoğunlukla iyi geldi.',
  { ...P, lang: 'tr', genre: 'review' });
  ok('D-02b: hedge_density counts "çoğunlukla" (it counted zero of eight before)',
    hedge.signals.some((s) => s.name === 'hedge_density' && s.value > 0));
  const frame = detect('İyi günler, geçen hafta otelinizde üç gece konakladık ve genel olarak '
    + 'memnun kaldık. Odalar temizdi, personel ilgiliydi ve kahvaltı beklediğimizden zengindi. '
    + 'Havuz biraz küçüktü ama akşamları sessizdi. Ulaşım da kolaydı. İyi çalışmalar.',
  { ...P, lang: 'tr', genre: 'review' });
  ok('D-02b: greeting_signoff_frame sees "İyi günler," / "İyi çalışmalar," (the CORRECT spellings)',
    frame.signals.some((s) => s.name === 'greeting_signoff_frame' && s.value === 1));
  const enumUp = detect('ÖNCELİKLE OTELİN KONUMU ÇOK MERKEZİ. ARDINDAN KAHVALTIDAN BAHSETMEK '
    + 'İSTERİM. İKİNCİ OLARAK ODALARIN TEMİZLİĞİ İYİYDİ. SON OLARAK PERSONEL İLGİLİYDİ. '
    + 'HAVUZ KÜÇÜKTÜ. FİYAT UYGUNDU.', { ...P, lang: 'tr' });
  ok('D-02b: enumerated_openers survives an upper-cased Turkish essay',
    enumUp.signals.some((s) => s.name === 'enumerated_openers' && s.value === 1));
  ok('D-02b: the segmenter joins a line starting with "çünkü" instead of splitting it',
    segment('bu iyi oldu\nçünkü öyle istemiştik'.normalize('NFC'), 'prose').sentences.length === 1);

  // --- reviewer D-01: the dotless-i lexicon variant ------------------------------------------
  const lexHit = (t) => _buildContext(t, { ...C, lang: 'tr' }).lexHits.map((h) => h.matched);
  ok('D-01: "İnşallah geliriz" hits the lexicon', lexHit('İnşallah geliriz').length > 0);
  ok('D-01: "Inşallah geliriz" (bare Latin I) hits the lexicon too',
    lexHit('Inşallah geliriz').length > 0);

  // --- reviewer D-02: no ASCII digit class anywhere in the shipped tree ---------------------
  const shipped = ['stylometry.mjs', ...readdirSync(join(HERE, 'lib')).filter((f) => f.endsWith('.mjs'))
    .map((f) => join('lib', f))];
  let asciiDigitHits = 0;
  const asciiDigitFiles = [];
  for (const f of shipped) {
    const src = readFileSync(join(HERE, f), 'utf8');
    const n = (src.match(/\\d/g) ?? []).length;
    if (n) { asciiDigitHits += n; asciiDigitFiles.push(`${f} x${n}`); }
  }
  eq(`D-02: zero ASCII-digit-class uses in lib/ and stylometry.mjs (${asciiDigitFiles.join(', ')})`,
    asciiDigitHits, 0);

  // --- reviewer D-03 / D-04 / D-05 / S-03: the segmenter -------------------------------------
  const ordinal = segment('Merhaba. 1. gece Antalya, 2. gece Kapadokya, 5. gün İstanbul olacak. '
    + 'Oda 2. katta olsun lütfen. Toplam 3 kişiyiz ve 15. ayın sonunda geliyoruz. Teşekkürler.'
      .normalize('NFC'), 'prose').sentences;
  eq('D-03: Turkish ordinals do not split ("1. gece", "2. kat", "15. ayın")', ordinal.length, 5);
  ok('D-03: the ordinal digit is not eaten', ordinal[1].text.startsWith('1. gece'));
  eq('D-03: a numbered LIST still splits (uppercase follower)',
    segment('1. Otel rezervasyonu.\n2. Transfer.\n3. Tur.'.normalize('NFC'), 'prose').sentences.length, 3);
  eq('D-04: an ASTRAL emoji ends a sentence (the rule was dead for real chat emoji)',
    segment('Tamam \u{1F600} Yarın görüşürüz'.normalize('NFC'), 'chat').sentences.length, 2);
  ok('D-05: numbered-list sentences are marked isListItem',
    segment('1. Otel rezervasyonu.\n2. Transfer.\n3. Tur.'.normalize('NFC'), 'prose')
      .sentences.every((x) => x.isListItem));
  const listy = '1. Otel rezervasyonu ve giriş işlemleri tamamlandı burada.\n'.repeat(6)
    + '2. Havalimanı transferi sabah erken saatte ayarlandı bizim için.\n'.repeat(6);
  const cvNull = detect(listy, { ...P, lang: 'tr' }).signals.find((s) => s.name === 'sentence_len_cv');
  ok('D-05: the listShare guard in sentence_len_cv now fires on a numbered list',
    !cvNull || cvNull.value === null, `got ${cvNull?.value}`);
  eq('S-03: "Tel." is an abbreviation, not a boundary',
    segment('Tel. 0212 numarasını aradım.'.normalize('NFC'), 'prose').sentences.length, 1);

  // --- reviewer D-09: a leading BOM is a file marker, not an invisible character -------------
  const bom = detect('﻿the room was clean and the staff were kind to us during our stay here ok',
    C);
  ok('D-09: a leading BOM raises no invisible_chars note',
    !bom.notes.some((n) => n.startsWith('invisible_chars')));
  ok('D-09: a BOM in the MIDDLE of the text still counts',
    detect('the room was clean﻿ and the staff were kind to us during our stay here ok', C)
      .notes.some((n) => n.startsWith('invisible_chars')));

  // --- reviewer D-10: dropOverlapping is linear ----------------------------------------------
  const big = 'nestled in the heart of the old town. '.repeat(4000);
  const t0 = Date.now();
  detect(big, P);
  const dt = Date.now() - t0;
  ok(`D-10: a 4,000-repeat lexicon-dense document scores in under 3 s (${dt} ms)`, dt < 3000);

  // --- R28: a marker inside a human-written message is a hybrid ------------------------------
  const markers = [{ name: 'agency_ref', pattern: 'REF-[0-9]{6}', note: 'agency booking reference.' }];
  const hybrid = 'abi bak ajans bunu atti bakar misin\n\n*Rezervasyon Ozeti*\nREF-500592\nGiris: 12 '
    + 'Agustos\nCikis: 15 Agustos\n2 kisi\n\nsence uygun mu bilmiyorum ya, bi bakiver hocam sagol';
  const rHybrid = detect(hybrid, { ...C, lang: 'tr', channel: 'whatsapp', markers });
  eq('R28: a marker beside a standing human side is uncertain, not likely_llm', rHybrid.verdict, 'uncertain');
  ok('R28: ... and warns pasted_machine_text + hybrid_suspect',
    rHybrid.warnings.includes('pasted_machine_text') && rHybrid.warnings.includes('hybrid_suspect'));
  ok('R28: ... and says the sender may be forwarding it',
    rHybrid.notes.some((n) => n.startsWith('R28:')));
  const pasted = detect('Your booking REF-500592 is confirmed. Check-in 12 August, check-out 15 '
    + 'August, two guests, breakfast included. Total 420 EUR paid in full.',
  { ...P, markers });
  eq('R28: a marker with a weak human side is still likely_llm', pasted.verdict, 'likely_llm');
  ok('R28: ... and still warns pasted_machine_text', pasted.warnings.includes('pasted_machine_text'));

  // --- R29: aggregate gates and features -----------------------------------------------------
  eq('R29: two features are disabled in aggregate mode', AGGREGATE_DISABLED.size, 2);
  const waTurns = [
    { id: 'w1', text: 'Merhaba, yarın sabah geliyoruz.' },
    { id: 'w2', text: 'Biz üç kişiyiz, bir de çocuk var.' },
    { id: 'w3', text: 'Oda müsait midir acaba?' },
    { id: 'w4', text: 'Kahvaltı fiyata dahil mi?' },
    { id: 'w5', text: 'Transfer hizmetiniz var mı?' },
    { id: 'w6', text: 'Teşekkür ederim, iyi çalışmalar.' },
  ];
  const agg6 = aggregate(waTurns, { ...BASE, sender: 'S1', lang: 'tr', shape: 'chat', channel: 'whatsapp' });
  ok(`R29: six typical WhatsApp turns produce a report, not below_char_floor (${agg6.counts.chars} chars)`,
    agg6.verdict !== 'insufficient_text', `${agg6.verdict} / ${agg6.gates.reason}`);
  eq('R29: ... and no gate failed', agg6.gates.failed.length, 0);
  eq('R29: per-message traceability is intact', agg6.perMessage.length, 6);
  ok('R29: out_of_channel_register does not run in aggregate mode',
    !agg6.signals.some((s) => s.name === 'out_of_channel_register' && s.value !== null));
  ok('R29: paragraph_uniformity does not run in aggregate mode',
    !agg6.signals.some((s) => s.name === 'paragraph_uniformity' && s.value !== null));

  const chatty = ['merhaba abi yarin sabah geliyoruz biz iki kisiyiz tamam mi',
    'tmm hocam bakarim ben sana donerim', 'kapadokya icin fiyat nedir acaba bi bakabilir misin',
    'pardon yok yani 3 gece dedim ozur dilerim', 'kapadokya turu da olsun eyvallahhh sagol',
    'naber hocam nasilsin bugun', 'sagol kanka cok yardimci oldun',
    'valla bilmiyorum ben simdi bakicam', 'aynen oyle abi haklisin sen',
    'bi bakayim ben sonra yazarim sana'];
  const agg30 = aggregate(Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, text: chatty[i % 10] })),
    { ...BASE, sender: 'R0', lang: 'tr', shape: 'chat', channel: 'whatsapp' });
  eq('R29: the 30-message likely_human case still reaches likely_human', agg30.verdict, 'likely_human');

  // --- R30: homoglyph / fullwidth evasion ----------------------------------------------------
  eq('R30: confusable folding is 1:1 per code point (spans line up)',
    foldConfusables('a revised drаft').length, 'a revised drаft'.length);
  eq('R30: Cyrillic a folds to Latin a', foldConfusables('drаft'), 'draft');
  eq('R30: fullwidth H folds to ASCII H', foldConfusables('Ｈere'), 'Here');
  eq('R30: homoglyphScan counts a mixed-script token', homoglyphScan([{ t: 'drаft' }]).count, 1);
  const cyr = detect('Here is а revised drаft of the letter you asked me to prepare for '
    + 'the hotel. Please review it and let me know if you would like any changes made before it is '
    + 'sent to the manager this week and also the week after that.', P);
  ok('R30: a Cyrillic homoglyph still fires the leak rule',
    cyr.rules.some((r) => r.name === 'assistant_frame_leak'));
  ok('R30: ... and carries the homoglyph_suspect warning', cyr.warnings.includes('homoglyph_suspect'));
  const fw = detect('Ｈere is a revised draft of the letter you asked me to prepare for the '
    + 'hotel. Please review it and let me know if you would like any changes made before it is sent '
    + 'to the manager this week and also the week after that.', P);
  ok('R30: a fullwidth letter still fires the leak rule',
    fw.rules.some((r) => r.name === 'assistant_frame_leak'));
  ok('R30: ... and carries the homoglyph_suspect warning', fw.warnings.includes('homoglyph_suspect'));

  // --- R32: language ID — zero-vote Latin is `mixed`, and ASCII-fied Turkish votes Turkish ---
  // The repro: a 14-word ASCII-folded Turkish WhatsApp booking line came back en@0.25 with the
  // note latin_subid_no_votes, and was scored in the en:chat cell against the English lexicons.
  const R32_TR = [
    ['T4 e2e, folded TR booking line',
      'reis selam 18 ekim giris 4 gece kaliyoruz 3 kisiyiz denize yakin oda varmi'],
    ['the SPEC §I check-5 line', 'reis naber antalya 5 kasim giris 3 gece 2 kisiyiz'],
    ['refuter L07, folded TR mimicry',
      'selam hocam bi sorum olcak antalya icin 5 kasim giris 3 gece 2 kisiyiz fiyat ne kadar '
      + 'oluyor\ndeniz manzarali oda var mi acaba\nbi de havalimanindan transfer var mi onu da '
      + 'sorcaktim\nmusaitse bugun kesinlestiricez'],
    ['refuter L08, folded TR mimicry',
      'reis naber ya sana bi sey sorcam kapadokya icin bakiyoruz 12 subat gibi 2 gece\nbalon turu '
      + 'dahil paket var mi sizde\nkac kisilik oda veriyosunuz ucumuz gidicez\nfiyat uygunsa hemen '
      + 'kapatalim gec kalmayalim yine'],
  ];
  for (const [name, text] of R32_TR) {
    const id = identify(text.normalize('NFC'));
    eq(`R32: ${name} identifies as Turkish`, id.primary, 'tr');
    ok(`R32: ${name} is above the 0.5 confidence floor`, id.confidence > 0.5, `got ${id.confidence}`);
  }

  // A 25-word folded-Turkish booking message must route into the tr:chat CELL, not en:chat.
  const foldedBooking = 'merhaba reis 12 agustos giris 3 gece kaliyoruz 2 kisiyiz cocuk da var '
    + 'yaninda denize yakin oda olsun lutfen fiyat ne kadar oluyor acaba tesekkurler kolay gelsin';
  const fb = detect(foldedBooking, { ...C, channel: 'whatsapp' });
  eq('R32: a 25-word folded-Turkish booking message is tr', fb.language.primary, 'tr');
  eq('R32: ... and is scored in the tr:chat cell', fb.scoring.cell, 'tr:chat');

  // English negatives: the ASCII suffix shapes have a real English base rate, so the vote is
  // skipped whenever the English function-word vote fired.
  const R32_EN = [
    ['an L2 English essay full of -lar/-den/-ce endings',
      'In my opinion the most important thing for a young person is to travel while he is still a '
      + 'student. The garden of the hotel was a dollar cheaper since the service was similar to the '
      + 'place we booked in December, and the seller told us the price would not change.'],
    ['a native English review',
      'The room was clean and the staff were kind to us during our stay in the old town last week, '
      + 'and we would gladly return again next summer with the family and the children.'],
  ];
  for (const [name, text] of R32_EN) {
    const id = identify(text.normalize('NFC'));
    eq(`R32 English negative: ${name} stays en`, id.primary, 'en');
  }
  ok('R32: the capped suffix vote never fires while English function words voted',
    latinSubId(R32_EN[0][1].normalize('NFC')).detail.trAsciiSuffixVoted === undefined);

  // Zero votes each is "within one vote", which SPEC B.9 already calls mixed.
  const amb = identify('ok super merci 5 nov 3 nights'.normalize('NFC'));
  eq('R32: an ambiguous short Latin line is mixed, not en', amb.primary, 'mixed');
  ok('R32: ... and is flagged mixed', amb.mixed === true);
  ok('R32: ... and still says why', amb.notes.includes('latin_subid_no_votes'));
  const ambR = detect('ok super merci 5 nov 3 nights and also some more filler words here to pass '
    + 'the token floor for this particular check ok', C);
  ok('R32: a mixed document uses the reduced feature set',
    ambR.warnings.includes('mixed_language_reduced_features'));
  ok('R32: ... and runs no language-specific feature',
    !ambR.signals.some((x) => x.value !== null && x.name.startsWith('tr_')));

  // --- R34 (2): every insufficient_text carries a reason ------------------------------------
  // The rewritten email fixtures (165-214 tokens) returned insufficient_text with all five gates
  // PASSED, gates.failed empty and no reason at all: the SPEC D.3 bottom-left cell abstaining
  // silently. An abstention with no stated cause is unreadable.
  const silent = [
    'Dear colleagues,', '',
    'Please find below a short summary of the arrangements for next week, which I have put '
    + 'together after speaking to the venue and to the finance team about the two outstanding '
    + 'items from the last meeting.', '',
    'The rooms are held under the company name and the invoice will follow once the purchase '
    + 'order has been issued. Transport from the airport has been requested and we expect a quote '
    + 'by Thursday. The agenda has not changed since the last note, although the Friday session '
    + 'may start half an hour later than planned, depending on when the earlier meeting in the '
    + 'same building finishes.', '',
    'On the catering, the venue has asked for final numbers by Wednesday, so please send me any '
    + 'changes to the guest list before then. The deposit has been paid and the cancellation '
    + 'terms are the same ones we agreed in March, which give us until the end of the month to '
    + 'reduce the room block without a charge.', '',
    'Please reply if any of this needs adjusting before I confirm with the venue tomorrow.', '',
    'Best,', 'M',
  ].join('\n');
  const silentR = detect(silent, { ...P, genre: 'email', channel: 'email' });
  eq('R34: the silent-abstention shape is insufficient_text', silentR.verdict, 'insufficient_text');
  eq('R34: ... with every gate passed', silentR.gates.failed.length, 0);
  eq('R34: ... and now names its reason', silentR.gates.reason, 'no_evidence_either_way');
  ok('R34: ... and a note gives both channel values',
    silentR.notes.some((n) => n.startsWith('no_evidence_either_way') && n.includes('llm ')
      && n.includes('human ')));

  // The contract, over every report this file builds: no insufficient_text without a reason.
  const reasonProbes = [
    ...INVARIANT_TEXTS.map(([, t, o]) => [t, { ...BASE, ...o }]),
    ...R24_HUMAN_GOLDENS.map((g) => [g.text, { ...BASE, shape: g.shape, lang: g.lang, channel: g.channel }]),
    ...LEAK_NEGATIVES.map(([, t]) => [t, P]),
    [silent, { ...P, genre: 'email', channel: 'email' }],
    ['tamam abi', C], ['Sure, sounds good.', C],
    ['Good morning. Could you please confirm the reservation for two adults on 12 March?', C],
    ['the room was clean and the staff were kind to us during our stay here ok', C],
  ];
  let abstained = 0, reasonless = 0;
  for (const [t, o] of reasonProbes) {
    const r = detect(t, o);
    if (r.verdict !== 'insufficient_text') continue;
    abstained++;
    if (typeof r.gates.reason !== 'string' || r.gates.reason.length === 0) reasonless++;
  }
  eq(`R34: every insufficient_text carries a non-empty reason (${abstained} abstentions checked)`,
    reasonless, 0);

  // --- R34 (3): the code_switch note ---------------------------------------------------------
  // A Turkish text made of words that are ALSO English function words ("at" horse, "an" moment,
  // "not" grade, "it" dog, "on" ten) counted 24 "English function words" and emitted the note.
  const trOnly = 'Otelin önünde bir at vardı ve bir an durduk. Not aldım. Odada it yoktu. On '
    + 'kişilik masa ayırttık, akşam yemeği çok güzeldi, personel de ilgiliydi bize karşı.';
  ok('R34: an all-Turkish text emits no code_switch note',
    !detect(trOnly, { ...P, lang: 'tr' }).notes.some((n) => n.startsWith('code_switch_observed')),
    JSON.stringify(detect(trOnly, { ...P, lang: 'tr' }).notes.filter((n) => n.startsWith('code_switch'))));
  const trMixed = "Grand Palace Hotel'de üç gece kaldık ve çok memnun kaldık. The staff were kind "
    + 'and the room was clean and quiet for us. Kahvaltı da zengindi.';
  ok('R34: Turkish carrying a Latin hotel name AND an English sentence still emits it',
    detect(trMixed, { ...P, lang: 'tr' }).notes.some((n) => n.startsWith('code_switch_observed')));
  ok('R34: ... and the note reports the share, not just the count',
    detect(trMixed, { ...P, lang: 'tr' }).notes.some((n) => n.startsWith('code_switch_observed')
      && n.includes('%')));

  // --- S-01: near_duplicate with an unknown sender ------------------------------------------
  const dupText = 'The hotel was excellent and the staff were extremely helpful during our stay in '
    + 'the old town last week, and we would gladly return again next summer with the family.';
  const dupIdx = buildCorpusIndex([{ id: 'other-1', sender: null, text: dupText }]);
  const dupUnknown = detect(dupText, { ...P, corpusIndex: dupIdx, sender: null, id: 'mine' });
  ok('S-01: an unknown sender adds a note that the match may be the same author',
    dupUnknown.notes.some((n) => n.startsWith('near_duplicate: sender unknown')));
}

// ===========================================================================
// 8. EXIT-CODE CONTRACT (checked through the real CLI)
// ===========================================================================
function exitCodes() {
  const run = (args, opts = {}) => {
    try {
      const out = execFileSync(process.execPath, ['stylometry.mjs', ...args],
        { cwd: HERE, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
      return { code: 0, out };
    } catch (e) { return { code: e.status, out: e.stdout ?? '' }; }
  };
  eq('exit 0 on a normal report', run(['--text', 'hello there friend', '--allow-uncalibrated']).code, 0);
  eq('exit 1 on an unknown flag', run(['--nope']).code, 1);
  eq('exit 1 on two inputs', run(['--text', 'a', '--file', 'b']).code, 1);
  eq('exit 2 on a missing file', run(['--file', '/nonexistent/x.txt', '--allow-uncalibrated']).code, 2);
  eq('exit 3 without --allow-uncalibrated', run(['--text', 'hello there friend']).code, 3);
  eq('exit 0 for --version', run(['--version']).code, 0);

  // D-07: a markers file that parses but holds an invalid regex must NOT be silently ignored.
  const tmp = join(HERE, '.selftest-tmp');
  mkdirSync(tmp, { recursive: true });
  const badMarkers = join(tmp, 'bad-markers.json');
  writeFileSync(badMarkers, '[{"name":"bad","pattern":"([a-z"}]');
  eq('D-07: exit 2 on a markers file whose pattern is not a valid regex',
    run(['--text', 'hello there friend and some more words', '--allow-uncalibrated',
      '--markers', badMarkers]).code, 2);
  const goodMarkers = join(tmp, 'good-markers.json');
  writeFileSync(goodMarkers, '[{"name":"ok","pattern":"REF-[0-9]{6}","note":"demo."}]');
  eq('D-07: exit 0 on a markers file whose patterns all compile',
    run(['--text', 'hello there friend and some more words', '--allow-uncalibrated',
      '--markers', goodMarkers]).code, 0);

  // D-08: a non-string `text` in --jsonl gets a named error, not an internal message.
  const badRows = join(tmp, 'bad-rows.jsonl');
  writeFileSync(badRows, '{"id":1,"text":"the room was clean"}\n{"id":3,"text":5}\n');
  const batch = run(['--jsonl', badRows, '--allow-uncalibrated']);
  eq('D-08: --jsonl still exits 0 on a bad row', batch.code, 0);
  ok('D-08: a non-string text reports "row.text must be a string"',
    batch.out.includes('row.text must be a string'), batch.out.slice(-160));

  // S-04: a malformed expiresAt must be refused (it used to mean "never expires").
  const badWeights = join(tmp, 'bad-weights.json');
  const w = JSON.parse(readFileSync(join(HERE, 'weights.v1.json'), 'utf8'));
  writeFileSync(badWeights, JSON.stringify({ ...w, expiresAt: 'not-a-date' }));
  eq('S-04: exit 4 on a weights file whose expiresAt is not a parsable date',
    run(['--text', 'hello there friend and some more words', '--allow-uncalibrated',
      '--weights', badWeights]).code, 4);
  rmSync(tmp, { recursive: true, force: true });
}

// ===========================================================================
run();

function run() {
  unicodeAssertions();
  segmenterFixtures();
  featureGoldens();
  aggregateGoldens();
  scorerInvariants();
  ruleBehaviour();
  determinism();
  mustNotFire();
  verifyRoundOne();
  exitCodes();

  const w = process.stdout.write.bind(process.stdout);
  w(`llm-detect selftest — detector ${VERSION.detector}, lexicon ${VERSION.lexicon}, `
    + `weights ${VERSION.weights} (${VERSION.provenance}), node ${process.version}\n`);
  for (const i of info) w(`  note: ${i}\n`);
  if (arbitration.length) {
    w(`\nARBITRATION REQUIRED — ${arbitration.length} fixture row(s) disagree with the core.\n`);
    w('These are NOT release-gate failures (SPEC §I bans likely_llm on group A and likely_human on\n'
      + 'group B; neither happened). They are B2 fixtures whose `allowed` set is tighter than what\n'
      + 'the SPEC D.3 table can produce. The head arbitrates; B1 does not edit B2 fixtures.\n');
    for (const a of arbitration) w(`  - ${a}\n`);
  }
  w(`\n${pass} assertions passed, ${failures.length} failed\n`);
  if (failures.length) {
    for (const f of failures) w(`  FAIL ${f}\n`);
    process.exit(1);
  }
  w('OK\n');
  process.exit(0);
}
