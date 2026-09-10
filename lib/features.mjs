// lib/features.mjs — Tier 1 feature catalogue, SPEC B.2-B.5 as amended by HEAD-RULINGS R1-R4
// and R22 (Arabic out: no ar_* features exist in this build).
//
// Contract for every feature (SPEC C.6): compute(ctx) reads only ctx, never throws, and returns
// null — never a fabricated 0 — when it cannot compute. A null is OMITTED from the sum and not
// renormalized (SPEC C.3 invariant 4).
//
// Every feature carries a `note` that names its own worst confounder. A feature with no
// confounder note is a bug (SPEC B.0).
import { mean, sd, clamp, words } from './tokenize.mjs';
import { EMOJI_G, SKIN_TONE_G, ure, caseFold } from './unicode.mjs';
import { TR_STOP, EN_STOP } from './langid.mjs';

const G = {
  RHYTHM: 'rhythm',
  PUNCT: 'punctuation',
  ORTHO: 'orthography',
  STRUCT: 'structure',
  REGISTER: 'register',
  HUMAN: 'human_marker',
};

// ===========================================================================
// R42(b) — LITERAL SPANS. A feature that matched a piece of TEXT returns where it matched, as
// [start, end, view] triples; detect() maps them onto the RAW input so a UI can quote them.
// Rhythm and ratio features match no literal text and return none — they are listed under
// `spanlessSignals` instead, which is the honest answer to "show me where".
// ===========================================================================
/** All matches of `re` in `text`, as [start, end, view] triples, capped. */
function spansOf(text, re, view, cap = 40) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  g.lastIndex = 0;
  const out = [];
  let m;
  while ((m = g.exec(text)) !== null && out.length < cap) {
    out.push([m.index, m.index + m[0].length, view]);
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

/** Spans for the whitespace-delimited word tokens that satisfy `pred` (offsets are NFC). */
function tokenSpans(ctx, pred, cap = 40) {
  const out = [];
  for (const t of ctx.tokens) {
    if (out.length >= cap) break;
    if (pred(t)) out.push([t.i, t.i + t.t.length, 'nfc']);
  }
  return out;
}

/** Spans for the RAW lines that satisfy `pred`. */
function lineSpans(ctx, pred, cap = 40) {
  const out = [];
  ctx.linesAll.forEach((l, i) => {
    if (out.length >= cap || !pred(l, i)) return;
    const start = ctx.lineOffsets[i];
    const trimmed = l.replace(/\s+$/u, '');
    if (trimmed !== '') out.push([start, start + trimmed.length, 'raw']);
  });
  return out;
}

function count(s, re) {
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
  g.lastIndex = 0;
  let n = 0;
  while (g.exec(s) !== null) { n++; if (g.lastIndex === 0) break; }
  return n;
}

const TERMINAL = /[.!?؟۔]/u;
const STRIP_TRAILING = /[\s​-‍﻿]+$/u;

/** Strip trailing whitespace and emoji so "great 😀" still counts as unterminated. */
function stripTrailingEmoji(line) {
  let s = line.replace(STRIP_TRAILING, '');
  let prev;
  do {
    prev = s;
    s = s.replace(/[\p{Extended_Pictographic}️‍\u{1F3FB}-\u{1F3FF}]+$/u, '').replace(STRIP_TRAILING, '');
  } while (s !== prev);
  return s;
}

// ===========================================================================
// B.2 — RHYTHM (PROSE-ONLY)
// ===========================================================================

const sentence_len_cv = {
  id: 'sentence_len_cv', group: G.RHYTHM, dir: 'human', langs: 'any', scope: 'PROSE-ONLY',
  confidence: 'MED', transform: 'continuous', minTokens: 120,
  note: 'burstiness is a genre property before it is an authorship property: a packing list and a '
    + 'spec sheet are structurally uniform, and a translated human text is flat too.',
  compute(ctx) {
    const ss = ctx.sentences;
    if (ss.length < 8) return null;
    const listShare = ss.filter((s) => s.isListItem).length / ss.length;
    if (listShare > 0.60) return null;                      // a packing list looks maximally "LLM"
    const lens = ss.map((s) => s.tokens.length);
    if (lens.some((l) => l > 120)) return null;             // segmentation_suspect
    const m = mean(lens);
    if (!(m > 0)) return null;
    return { value: sd(lens) / m };
  },
};

const sentence_len_mode_mass = {
  id: 'sentence_len_mode_mass', group: G.RHYTHM, dir: 'llm', langs: 'any', scope: 'PROSE-ONLY',
  confidence: 'LOW', transform: 'continuous', minTokens: 120,
  note: 'the 12-22 token band is also the band a competent human editor writes in; this measures '
    + 'editing more than authorship.',
  compute(ctx) {
    const ss = ctx.sentences;
    if (ss.length < 8) return null;
    const inBand = ss.filter((s) => s.tokens.length >= 12 && s.tokens.length <= 22).length;
    return { value: inBand / ss.length };
  },
};

const paragraph_uniformity = {
  id: 'paragraph_uniformity', group: G.RHYTHM, dir: 'llm', langs: 'any', scope: 'PROSE-ONLY',
  confidence: 'LOW', transform: 'continuous', minTokens: 250,
  note: 'CMS templates, review forms and email clients all impose paragraph rhythm on humans.',
  compute(ctx) {
    const ps = ctx.paragraphs;
    if (ps.length < 4) return null;
    const lens = ps.map((p) => words(p).length);
    const m = mean(lens);
    if (!(m > 0)) return null;
    return { value: 1 - clamp(sd(lens) / m, 0, 1) };
  },
};

const content_word_repeat = {
  id: 'content_word_repeat', group: G.RHYTHM, dir: 'human', langs: 'any', scope: 'PROSE-ONLY',
  confidence: 'LOW', transform: 'continuous', minTokens: 150,
  note: 'the TR prefix key is a crude stemmer, not morphology; a topic with one obvious noun '
    + '("hotel") inflates this for both humans and models.',
  compute(ctx) {
    const stop = ctx.lang === 'tr' ? TR_STOP : EN_STOP;
    const toks = ctx.tokens.map((t) => t.t.toLocaleLowerCase(ctx.lang === 'tr' ? 'tr' : 'en').replace(/i̇/gu, 'i'))
      .filter((t) => t.length >= 4 && !stop.has(t));
    if (toks.length < 20) return null;
    const key = (t) => (ctx.lang === 'tr' ? t.slice(0, Math.min(6, Math.max(1, t.length - 2))) : t);
    const uniq = new Set(toks.map(key)).size;
    return { value: 1 - uniq / toks.length };
  },
};

// ===========================================================================
// B.3 — PUNCTUATION AND TYPOGRAPHY
// ===========================================================================

const terminal_punct_ratio = {
  id: 'terminal_punct_ratio', group: G.PUNCT, dir: 'llm', langs: 'any',
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'continuous', minTokens: 20,
  note: 'register and keyboard, not authorship: one prompt line ("no final period") removes it, '
    + 'and a careful human who ends sentences with a period scores 1.0. DATA rows 4-7 are exactly '
    + 'this false positive. Counted over LINES, so a signature block ("Kind regards," / "M.") '
    + 'deflates it in email-shaped prose.',
  compute(ctx) {
    let units = ctx.linesWithWords;
    if (units.length < 2) units = ctx.sentences.map((s) => s.text);
    if (units.length < 2) return null;
    const terminated = units.filter((u) => TERMINAL.test(stripTrailingEmoji(u).slice(-1))).length;
    return { value: terminated / units.length, matched: `${terminated}/${units.length} units terminated` };
  },
};

const sentence_initial_caps = {
  id: 'sentence_initial_caps', group: G.PUNCT, dir: 'llm', langs: ['en', 'tr'], scope: 'CHAT-ONLY',
  confidence: 'LOW', transform: 'continuous', minTokens: 20,
  note: 'phone keyboards auto-capitalize the first letter of a message; >=3 sentences is mandatory '
    + 'because 1.0 on a single sentence measures the keyboard, not the writer.',
  compute(ctx) {
    const ss = ctx.sentences;
    if (ss.length < 3) return null;                       // mandatory, SPEC B.3
    let n = 0, d = 0;
    for (const s of ss) {
      const first = s.tokens[0];
      if (!first) continue;
      const c = first[0];
      if (!/\p{L}/u.test(c)) continue;
      d++;
      if (/\p{Lu}/u.test(c)) n++;
    }
    if (d < 3) return null;
    return { value: n / d };
  },
};

const all_lowercase = {
  id: 'all_lowercase', group: G.PUNCT, dir: 'human', langs: ['en', 'tr'], scope: 'CHAT-ONLY',
  confidence: 'MED', transform: 'binary', minTokens: 20,
  note: 'trivially promptable ("write in lowercase") — high precision against an unaware writer, '
    + 'zero robustness against one who is trying.',
  compute(ctx) {
    const ls = [...ctx.nfc].filter((c) => /\p{L}/u.test(c));
    if (ls.length < 20) return null;
    const lower = ls.filter((c) => c === c.toLocaleLowerCase(ctx.lang === 'tr' ? 'tr' : 'en')).length;
    const ratio = lower / ls.length;
    const loneLowerI = ctx.lang === 'en' ? count(ctx.nfc, ure('(?<UB>)i(?<UE>)', 'gu')) : 0;
    return { value: ratio > 0.98 ? 1 : 0, matched: `lowercase share ${ratio.toFixed(3)}`
      + (loneLowerI ? `, lone lowercase "i" x${loneLowerI}` : '') };
  },
};

const ellipsis_hand_typed = {
  id: 'ellipsis_hand_typed', group: G.PUNCT, dir: 'human', langs: 'any',
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'rate', minTokens: 0,
  note: 'only the two-dot and four-plus-dot arms survive: iOS/Android substitute the … glyph for '
    + 'exactly three dots, so the … and exact-... arms measure a keyboard, not a person.',
  compute(ctx) {
    const n = count(ctx.raw, /\.{2}(?!\.)/g) + count(ctx.raw, /\.{4,}/g);
    if (n === 0) return null;
    return { value: n, matched: `${n} hand-typed ellipsis runs`,
      spans: spansOf(ctx.raw, /\.{2,}/g, 'raw') };
  },
};

const EMOTICON = /:\)|:\(|:D|:'\(|<3|xD|:-\)|:-\(|;\)/g;
const repeated_punct_emoticon = {
  id: 'repeated_punct_emoticon', group: G.PUNCT, dir: 'human', langs: 'any',
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'HIGH', transform: 'rate', minTokens: 0,
  note: 'near-zero recall by construction (DATA: 0.002 vs 0.000 per message). Evidence when '
    + 'present, silence otherwise — and a model told to be casual emits it on request.',
  compute(ctx) {
    const n = count(ctx.raw, /[!?؟]{2,}/g) + count(ctx.raw, EMOTICON);
    if (n === 0) return null;
    return { value: n, matched: `${n} repeated-punct/emoticon hits`,
      spans: spansOf(ctx.raw, /[!?؟]{2,}/g, 'raw').concat(spansOf(ctx.raw, EMOTICON, 'raw')) };
  },
};

const letter_elongation = {
  id: 'letter_elongation', group: G.PUNCT, dir: 'human', langs: 'any',
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'HIGH', transform: 'rate', minTokens: 3,
  note: 'works at nine characters, which almost nothing else does — but "write like a texter" '
    + 'produces it too, and English words with legitimate triples are rare but exist.',
  compute(ctx) {
    const n = count(ctx.nfc, /(\p{L})\1{2,}/gu) + count(ctx.raw, /ـ{2,}/gu);
    if (n === 0) return null;
    return { value: n, matched: `${n} elongation runs`,
      spans: spansOf(ctx.nfc, /(\p{L})\1{2,}/gu, 'nfc').concat(spansOf(ctx.raw, /ـ{2,}/gu, 'raw')) };
  },
};

const space_hygiene = {
  id: 'space_hygiene', group: G.PUNCT, dir: 'human', langs: 'any', scope: 'DOMAIN-TRANSFERABLE',
  confidence: 'LOW', transform: 'rate', minTokens: 20,
  note: 'a rich-text editor or a paste can create or destroy these; decimals, URLs and '
    + 'abbreviations are subtracted but the subtraction is approximate.',
  compute(ctx) {
    const t = ctx.raw;
    const doubleSpace = count(t, /\S {2,}\S/g);
    const spaceBeforePunct = count(t, /\s+[,.;:!?،؛؟]/gu);
    let noSpaceAfterPunct = count(t, /[,.;:،؛](?=\p{L})/gu);
    noSpaceAfterPunct -= count(t, /\p{Nd}[.,]\p{Nd}/gu);                        // decimals
    noSpaceAfterPunct -= count(t, /(?:https?:\/\/|www\.)\S+/gu) * 2;            // URLs
    noSpaceAfterPunct -= count(t, ure('(?<UB>)(?:e\\.g|i\\.e|vs|etc|vb|bkz)\\.', 'giu'));  // abbreviations
    const trailingSpaceLines = ctx.linesAll.filter((l) => /[^\S\n]$/u.test(l) && l.trim() !== '').length;
    const raw = doubleSpace + spaceBeforePunct + Math.max(0, noSpaceAfterPunct) + trailingSpaceLines;
    return { value: (raw * 100) / ctx.tokenCount, matched: `${raw} hygiene slips per ${ctx.tokenCount} tokens` };
  },
};

const multi_exclam = {
  id: 'multi_exclam', group: G.PUNCT, dir: 'human', langs: 'any', scope: 'DOMAIN-TRANSFERABLE',
  confidence: 'MED', transform: 'rate', minTokens: 0,
  note: 'marketing copy written by humans and by models both use it; it is only human-leaning '
    + 'in conversational registers.',
  compute(ctx) {
    const n = count(ctx.raw, /!{2,}/g);
    if (n === 0) return null;
    return { value: n, matched: `${n} runs of "!!"`, spans: spansOf(ctx.raw, /!{2,}/g, 'raw') };
  },
};

const exclam_single_regular = {
  id: 'exclam_single_regular', group: G.PUNCT, dir: 'llm', langs: 'any', scope: 'PROSE-ONLY',
  confidence: 'LOW', transform: 'binary', minTokens: 0,
  note: 'the assistant enthusiasm register — and also the register of every enthusiastic human '
    + 'review ever written. Weakest feature in the catalogue by design.',
  compute(ctx) {
    const ss = ctx.sentences;
    if (ss.length < 4) return null;
    if (count(ctx.raw, /!{2,}/g) > 0) return { value: 0 };
    const singles = count(ctx.raw, /(?<!!)!(?!!)/g);
    const r = singles / ss.length;
    return { value: r >= 0.25 && r <= 0.75 ? 1 : 0, matched: `${singles} single "!" over ${ss.length} sentences` };
  },
};

const em_dash_in_chat = {
  id: 'em_dash_in_chat', group: G.PUNCT, dir: 'llm', langs: ['en', 'tr'], scope: 'CHAT-ONLY',
  confidence: 'LOW', transform: 'binary', minTokens: 0,
  note: 'deliberately near-worthless (w 0.15). R1: the human em-dash range 0.33-17.12 per 1,000 '
    + 'words FULLY CONTAINS the model range, two shipping models sit at 0.00, and review corpora '
    + 'ASCII-normalize dashes on ingest. Folklore at document scale; a corroborator at most.',
  compute(ctx) {
    const em = count(ctx.raw, /—/g);
    const hy = count(ctx.raw, / - /g);
    return { value: em >= 1 && hy === 0 ? 1 : 0, matched: `${em} em dashes, ${hy} spaced hyphens`,
      spans: em >= 1 && hy === 0 ? spansOf(ctx.raw, /—/g, 'raw', 10) : [] };
  },
};

const wa_single_asterisk = {
  id: 'wa_single_asterisk', group: G.PUNCT, dir: 'human', langs: 'any', scope: 'CHAT-ONLY',
  confidence: 'MED', transform: 'binary', minTokens: 0,
  note: 'WhatsApp\'s own bold markup. Do not invert it into an LLM signal: DOUBLE asterisk is the '
    + 'model tell, single asterisk is a person using the app they are writing in.',
  compute(ctx) {
    const m = /(?<!\*)\*[^*\n]{2,60}\*(?!\*)/u.exec(ctx.raw);
    return m ? { value: 1, matched: m[0], spans: [[m.index, m.index + m[0].length, 'raw']] } : null;
  },
};

const emoji_repeat_run = {
  id: 'emoji_repeat_run', group: G.PUNCT, dir: 'human', langs: 'any', scope: 'DOMAIN-TRANSFERABLE',
  confidence: 'MED', transform: 'binary', minTokens: 0,
  note: 'the emoji RATE is dropped (DATA AUC 0.513); only the repeat pattern survives, and it is '
    + 'promptable.',
  compute(ctx) {
    const skin = count(ctx.raw, SKIN_TONE_G);
    const emojis = [...ctx.raw.matchAll(new RegExp(EMOJI_G.source, 'gu'))];
    let repeat = 0;
    for (let i = 1; i < emojis.length; i++) {
      if (emojis[i][0] === emojis[i - 1][0] && emojis[i].index === emojis[i - 1].index + emojis[i - 1][0].length) repeat++;
    }
    if (repeat === 0 && skin === 0) return null;
    const runs = spansOf(ctx.raw, /(\p{Extended_Pictographic}[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]*){2,}/gu, 'raw', 10);
    return { value: 1, matched: repeat ? `${repeat} identical adjacent emoji` : `${skin} skin-tone modifiers`,
      spans: runs };
  },
};

const emoji_bullet_led = {
  id: 'emoji_bullet_led', group: G.STRUCT, dir: 'llm', langs: 'any', scope: 'DOMAIN-TRANSFERABLE',
  confidence: 'MED', transform: 'binary', minTokens: 0,
  note: 'human marketing and travel-blog copy uses emoji section markers constantly — humans '
    + 'copied this format FROM models. Worst confounder class in the catalogue.',
  compute(ctx) {
    const pred = (l) => /^\s*\p{RGI_Emoji}\s+\p{Lu}/v.test(l);
    const n = ctx.linesAll.filter(pred).length;
    return n >= 2 ? { value: 1, matched: `${n} emoji-led section lines`, spans: lineSpans(ctx, pred) } : null;
  },
};

// ===========================================================================
// B.4 — TURKISH ORTHOGRAPHY. All HUMAN-direction (the amputation rule, SPEC B.4).
// Every "correct orthography => LLM" arm carries weight ZERO and is not implemented:
// a human-direction feature cannot produce a false accusation.
// ===========================================================================

const TR_ASCII_PROBE = [
  ['icin', 'için'], ['cok', 'çok'], ['degil', 'değil'], ['gecen', 'geçen'], ['yasinda', 'yaşında'],
  ['cocuk', 'çocuk'], ['buyuk', 'büyük'], ['kucuk', 'küçük'], ['sey', 'şey'], ['oyle', 'öyle'],
  ['boyle', 'böyle'], ['tesekkurler', 'teşekkürler'], ['gunaydin', 'günaydın'],
  ['gorusuruz', 'görüşürüz'], ['ogrenci', 'öğrenci'], ['dogru', 'doğru'], ['yarin', 'yarın'],
  ['bugun', 'bugün'], ['sabah', 'sabah'], ['aksam', 'akşam'], ['ucret', 'ücret'], ['ucus', 'uçuş'],
  ['gelecegim', 'geleceğim'], ['gidecegim', 'gideceğim'], ['yapacagim', 'yapacağım'],
  ['olacagim', 'olacağım'], ['kalacagiz', 'kalacağız'], ['calisiyorum', 'çalışıyorum'],
  ['guzel', 'güzel'], ['kotu', 'kötü'], ['insallah', 'inşallah'], ['nasilsin', 'nasılsın'],
  ['naber', 'naber'], ['tamamdir', 'tamamdır'], ['sagol', 'sağol'], ['oncelikle', 'öncelikle'],
  ['ozellikle', 'özellikle'], ['sonrasinda', 'sonrasında'], ['kisiyiz', 'kişiyiz'],
  ['giris', 'giriş'], ['gece', 'gece'],
].filter(([a, b]) => a !== b);

function trProbeCounts(ctx) {
  const toks = new Set(ctx.tokens.map((t) => t.t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i')));
  const all = ctx.tokens.map((t) => t.t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i'));
  let ascii = 0, diac = 0;
  const hit = [];
  for (const [a, d] of TR_ASCII_PROBE) {
    const na = all.filter((t) => t === a).length;
    const nd = all.filter((t) => t === d).length;
    ascii += na; diac += nd;
    if (na) hit.push(a);
  }
  return { ascii, diac, hit, toks };
}

const tr_asciified_probe = {
  id: 'tr_asciified_probe', group: G.ORTHO, dir: 'human', langs: ['tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'HIGH', transform: 'continuous', minTokens: 8,
  note: 'this measures WHICH KEYBOARD the writer has, not who wrote the text. It is one-armed on '
    + 'purpose: the "correct diacritics => LLM" arm was deleted because an iPhone with a Turkish '
    + 'keyboard produces flawless orthography (D1 fixture A6).',
  compute(ctx) {
    const { ascii, diac, hit } = trProbeCounts(ctx);
    const value = ascii / (ascii + diac + 1);
    if (!(value > 0.5 && ascii >= 2)) return null;
    const hits = new Set(hit);
    return { value, matched: `ASCII-fied: ${hit.slice(0, 5).join(', ')} (${ascii} vs ${diac} diacritic)`,
      spans: tokenSpans(ctx, (t) => hits.has(t.t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i'))) };
  },
};

const tr_mixed_orthography = {
  id: 'tr_mixed_orthography', group: G.ORTHO, dir: 'human', langs: ['tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'binary', minTokens: 8,
  note: 'mixture is a person typing across two devices — but a copy-paste of two sources produces '
    + 'it too, and a model given mixed few-shot examples reproduces it.',
  compute(ctx) {
    const { ascii, diac } = trProbeCounts(ctx);
    return ascii > 0 && diac > 0 ? { value: 1, matched: `${ascii} ASCII-fied + ${diac} correct forms` } : null;
  },
};

const tr_bare_capital_I = {
  id: 'tr_bare_capital_I', group: G.ORTHO, dir: 'human', langs: ['tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'rate', minTokens: 8,
  note: 'the "İstanbul is correct => LLM" arm carries ZERO. This arm only fires on a Latin I '
    + 'where Turkish wants İ — which is a keyboard fact, and an English loanword or brand name '
    + 'legitimately spelled with I is a false hit.',
  compute(ctx) {
    const pred = (t) => /^I(?=[a-zçğıöşü])/u.test(t.t);
    const n = ctx.tokens.filter(pred).length;
    return n > 0 ? { value: n, matched: `${n} bare capital I`, spans: tokenSpans(ctx, pred) } : null;
  },
};

// SPEC B.4 condition (e): "in either orthography". Note that toLocaleLowerCase('tr') maps a bare
// Latin I to the DOTLESS ı, so "Istanbul" folds to "ıstanbul" — the exact spelling this feature
// exists to catch. Both forms must be in the list or the feature never fires on its own subject.
const TR_CITY = ['istanbul', 'ıstanbul', 'ankara', 'izmir', 'ızmir', 'antalya', 'turkiye',
  'türkiye', 'trabzon', 'bursa', 'konya', 'kapadokya', 'taksim'];
const TR_CASE_SUFFIX = /(da|de|ta|te|dan|den|tan|ten|a|e|ya|ye|ı|i|u|ü|yı|yi|yu|yü|ın|in|un|ün|nın|nin|nun|nün)$/u;

const tr_apostrophe_absent = {
  id: 'tr_apostrophe_absent', group: G.ORTHO, dir: 'human', langs: ['tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'LOW', transform: 'rate', minTokens: 12,
  note: 'condition (e) — the stem must recur in the text or be a known city — is mandatory; '
    + 'without it ordinary sentence-initial words are misread as suffixed proper nouns. Even with '
    + 'it, this is the weakest orthography feature and it is keyboard-confounded.',
  compute(ctx) {
    const lower = ctx.tokens.map((t) => t.t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i'));
    const bag = new Set(lower);
    let n = 0;
    const hits = [];
    for (const tk of ctx.tokens) {
      const t = tk.t;
      if (!/^\p{Lu}/u.test(t)) continue;
      if (t.length < 6) continue;
      if (t.includes("'") || t.includes('’')) continue;
      const low = t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i');
      const m = TR_CASE_SUFFIX.exec(low);
      if (!m) continue;
      const stem = low.slice(0, low.length - m[0].length);
      if (stem.length < 4) continue;
      if (!(bag.has(stem) || TR_CITY.includes(stem))) continue;
      n++; hits.push(t);
    }
    return n >= 2 ? { value: n, matched: hits.slice(0, 4).join(', ') } : null;
  },
};

const TR_CHAT_FUTURE = /\p{L}+(cam|cem|cak|cek|caz|cez|ceksin|caksin|icem|icam|icez|icaz)$/iu;
const TR_CHAT_WORD = ure('(?<UB>)(bi|bii|napıyon|napiyon|valla|aynen|hadi|abi|abicim|reis|hocam|kanka|eyvallah|tmm|slm|mrb|nbr|sagol|sağol)(?<UE>)', 'iu');

const tr_chat_morphology = {
  id: 'tr_chat_morphology', group: G.ORTHO, dir: 'human', langs: ['tr'], scope: 'CHAT-ONLY',
  confidence: 'HIGH', transform: 'rate', minTokens: 3,
  note: 'highest-precision Turkish human marker under an unaware writer, and the cheapest thing '
    + 'in the world to prompt for: "tmm abi bakarim ben sana donerim" is one instruction away '
    + '(D1 fixture B1). Never let it alone reach likely_human.',
  compute(ctx) {
    const fut = ctx.tokens.filter((t) => TR_CHAT_FUTURE.test(t.t)).length;
    const wordRe = new RegExp(TR_CHAT_WORD.source, 'giu');
    const wrd = count(ctx.nfc, wordRe);
    const n = fut + wrd;
    if (n === 0) return null;
    return { value: n, matched: `${fut} reduced futures + ${wrd} chat words`,
      spans: tokenSpans(ctx, (t) => TR_CHAT_FUTURE.test(t.t))
        .concat(spansOf(ctx.nfc, wordRe, 'nfc')) };
  },
};

const tr_formal_copula = {
  id: 'tr_formal_copula', group: G.ORTHO, dir: 'llm', langs: ['tr'], scope: 'PROSE-ONLY',
  confidence: 'LOW', transform: 'rate', minTokens: 100,
  note: 'Turkish officialese IS this register. Disabled entirely when genre=formal_letter '
    + '(D1 fixture A3, a lawyer\'s complaint letter); a bureaucrat, an academic and an assistant '
    + 'are indistinguishable on this axis.',
  compute(ctx) {
    if (ctx.genre === 'formal_letter') return null;
    const pred = (t) => {
      const low = t.t.toLocaleLowerCase('tr').replace(/i̇/gu, 'i');
      return /(makta|mekte)(dır|dir)$/u.test(low) || /(malı|meli)dır$/u.test(low);
    };
    const n = ctx.tokens.filter(pred).length;
    return { value: (n * 100) / ctx.tokenCount,
      matched: `${n} -mAktAdIr/-mAlIdIr per ${ctx.tokenCount} tokens`, spans: tokenSpans(ctx, pred) };
  },
};

// ===========================================================================
// B.5 — STRUCTURE AND REGISTER
// ===========================================================================

// R2 already ruled that plain dash bullets are not a `markdown_in_chat` rule hit; R38(f) applies
// the same reasoning to the FEATURE. Markdown arriving in a non-markdown channel is the artifact
// the design trusts, and `- Check-in: 14:00` contains no markdown at all.
const BOLD_LEAD = /^\s*[-*•\p{Nd}.)]+\s*\*\*[^*\n]{2,40}\*\*\s*[:：-]/u;
const BOLD_LEAD_INNER = /^\s*[-*•\p{Nd}.)]+\s*\*\*[^*\n]{2,40}:\s*\*\*/u;
const PLAIN_LEAD = /^\s*[-*•]\s*\p{Lu}[^:\n]{2,40}:\s+\S/u;

const bold_lead_in_list = {
  id: 'bold_lead_in_list', group: G.STRUCT, dir: 'llm', langs: 'any', scope: 'DOMAIN-TRANSFERABLE',
  confidence: 'HIGH', transform: 'rate', minTokens: 20,
  note: 'near-zero human base rate OUTSIDE technical docs and work email — but a project '
    + 'manager\'s real email is exactly this shape (D1 fixture A2). Structure, not authorship. '
    + 'R38(f): ACTUAL **bold** is required. The plain "- Label: value" branch fired on 10 of the '
    + 'refuter\'s 18 ordinary human lists and moved to colon_led_list, which is a register proxy.',
  compute(ctx) {
    // SPEC B.5 shows BOTH shapes: "- **Location**: X" and "- **Location:** X". A line counts once.
    // D-02: \p{Nd} only — the ASCII digit class is banned tree-wide (selftest greps for it).
    const pred = (l) => BOLD_LEAD.test(l) || BOLD_LEAD_INNER.test(l);
    const hits = ctx.linesAll.filter(pred);
    return hits.length > 0
      ? { value: hits.length, matched: hits[0].trim().slice(0, 60), spans: lineSpans(ctx, pred) } : null;
  },
};

const colon_led_list = {
  id: 'colon_led_list', group: G.STRUCT, dir: 'llm', langs: 'any', scope: 'DOMAIN-TRANSFERABLE',
  confidence: 'LOW', transform: 'rate', minTokens: 20,
  note: 'a human writing a packing list or a booking summary produces exactly this. Weak by design '
    + '(SPEC w 0.25), and R38(f) moved the plain "- Label: value" shape here from '
    + 'bold_lead_in_list and put this feature in REGISTER_PROXY_LLM: humans write labelled lists '
    + 'all day and 10 of the refuter\'s 18 human-register texts fired it.',
  compute(ctx) {
    const ls = ctx.linesAll;
    let n = 0;
    let first = null;
    const marked = new Set();
    for (let i = 0; i < ls.length - 1; i++) {
      if (/:\s*$/u.test(ls[i]) && /^\s*[-*•\p{Nd}]/u.test(ls[i + 1])) { n++; first ??= ls[i].trim().slice(0, 60); marked.add(i); }
    }
    // R38(f): the plain capitalised-lead bullet, moved here from bold_lead_in_list.
    ls.forEach((l, i) => {
      if (PLAIN_LEAD.test(l) && !BOLD_LEAD.test(l) && !BOLD_LEAD_INNER.test(l)) {
        n++; first ??= l.trim().slice(0, 60); marked.add(i);
      }
    });
    return n > 0
      ? { value: n, matched: first ?? `${n} colon-led lists`, spans: lineSpans(ctx, (l, i) => marked.has(i)) }
      : null;
  },
};

// D-02b class B: these are matched against a CASE-FOLDED copy of the unit, never with /i.
// /i uses SIMPLE folding, where U+0130 (I-with-dot) and U+0131 (dotless i) fold to themselves,
// so /^ikinci olarak/i missed "İkinci olarak" — the correct Turkish spelling. `[iı]` carries the
// other orthography: a bare Latin I tr-folds to the DOTLESS i.
const ENUM_OPENERS = {
  en: [/^first,/, /^second(ly)?,/, /^third(ly)?,/, /^finally,/, /^lastly,/],
  tr: [ure('^öncelikle(?<UE>)'), ure('^[iı]lk olarak(?<UE>)'), ure('^[iı]kinci olarak(?<UE>)'),
    ure('^ardından(?<UE>)'), ure('^son olarak(?<UE>)')],
};

const enumerated_openers = {
  id: 'enumerated_openers', group: G.STRUCT, dir: 'llm', langs: ['en', 'tr'], scope: 'PROSE-ONLY',
  confidence: 'MED', transform: 'binary', minTokens: 0,
  note: 'explicitly taught to L2 writers as essay scaffolding — this is the single feature most '
    + 'likely to misfire on a non-native writer doing exactly what school told them to do.',
  compute(ctx) {
    const ss = ctx.sentences;
    if (ss.length < 6) return null;
    const pats = ENUM_OPENERS[ctx.lang] ?? [];
    if (pats.length === 0) return null;
    let run = 0, best = 0;
    const hits = [];
    for (const s of ss) {
      const t = caseFold(s.text.trimStart(), ctx.lang);
      if (pats.some((p) => p.test(t))) { run++; best = Math.max(best, run); hits.push(t.slice(0, 20)); }
    }
    if (!(best >= 1 && hits.length >= 3)) return null;
    const spans = [];
    let cursor = 0;
    for (const h of hits) {
      const head = h.split(/[\s,]/u)[0];
      if (!head) continue;
      const at = ctx.foldedLex.indexOf(head, cursor);
      if (at < 0) continue;
      spans.push([at, at + head.length, 'folded']);
      cursor = at + head.length;
    }
    return { value: 1, matched: hits.slice(0, 3).join(' | '), spans };
  },
};

const CONNECTORS = {
  en: ['furthermore', 'moreover', 'additionally'],
  tr: ['ayrıca', 'bunun yanı sıra', 'ek olarak'],
};
/** Word-bounded connector counter over foldedLex — "ayrıca" must not match inside a longer word. */
function connectorHits(foldedLex, conns) {
  return conns.reduce((a, c) => a + count(foldedLex,
    ure('(?<UB>)' + c.replace(/ /g, '\\s+') + '(?<UE>)', 'gu')), 0);
}

const parallel_openers = {
  id: 'parallel_openers', group: G.STRUCT, dir: 'llm', langs: ['en', 'tr'], scope: 'PROSE-ONLY',
  confidence: 'LOW', transform: 'continuous', minTokens: 120,
  note: 'KNOWN ESL BIAS, carried into the fairness report: L2 writers are explicitly taught '
    + 'connector lists, so repeated openers point at schooling as often as at a model.',
  compute(ctx) {
    const ss = ctx.sentences;
    if (ss.length < 6) return null;
    const firsts = ss.map((s) => (s.tokens[0] ?? '').toLocaleLowerCase(ctx.lang === 'tr' ? 'tr' : 'en'));
    const uniq = new Set(firsts).size;
    let value = 1 - uniq / firsts.length;
    const conns = CONNECTORS[ctx.lang] ?? [];
    const connHits = connectorHits(ctx.foldedLex, conns);
    if (connHits >= 3) value = Math.min(1, value + 0.15);
    return { value, matched: `${uniq}/${firsts.length} distinct openers, ${connHits} connector hits` };
  },
};

// Matched against a case-FOLDED copy of the last paragraph (D-02b class B) with Unicode word
// boundaries (class A: `kısacası\b` needs an ASCII word character after the dotless i).
const CLOSERS_RE = {
  en: ure('^(in conclusion|overall|in summary|all in all|to sum up)(?<UE>)'),
  tr: ure('^(sonuç olarak|özetle|k[iı]sacas[iı]|genel olarak)(?<UE>)'),
};

const closing_summary_move = {
  id: 'closing_summary_move', group: G.STRUCT, dir: 'llm', langs: ['en', 'tr'], scope: 'PROSE-ONLY',
  confidence: 'MED', transform: 'binary', minTokens: 120,
  note: 'a five-paragraph-essay habit taught in school; a human review that ends "Overall, great '
    + 'stay" fires it exactly as hard as a model does.',
  compute(ctx) {
    const ps = ctx.paragraphs;
    if (ps.length === 0) return null;
    const last = caseFold(ps[ps.length - 1].trimStart(), ctx.lang);
    const re = CLOSERS_RE[ctx.lang];
    if (!re) return null;
    const m = re.exec(last);
    if (!m) return null;
    // The closer is the head of the last paragraph; locate that exact string in foldedLex so the
    // span survives into the raw view (the paragraph itself carries no absolute offset).
    const at = ctx.foldedLex.lastIndexOf(m[0]);
    return { value: 1, matched: m[0], spans: at >= 0 ? [[at, at + m[0].length, 'folded']] : [] };
  },
};

// Run against ctx.foldedLex (already lowercase in the document's locale), never against nfc
// with /i — "İster ... ister" is the correct Turkish spelling and simple folding misses it.
const BALANCED = {
  en: [ure('(?<UB>)not only(?<UE>)[\\s\\S]{0,80}?(?<UB>)but also(?<UE>)'),
    ure("(?<UB>)whether you(?:'re| are)(?<UE>)[\\s\\S]{0,80}?(?<UB>)or(?<UE>)"),
    ure('(?<UB>)on the one hand(?<UE>)')],
  tr: [ure('(?<UB>)hem(?<UE>)[\\s\\S]{0,60}?(?<UB>)hem de(?<UE>)'),
    ure('(?<UB>)sadece(?<UE>)[\\s\\S]{0,60}?(?<UB>)değil,?\\s*aynı zamanda(?<UE>)'),
    ure('(?<UB>)[iı]ster(?<UE>)[\\s\\S]{0,60}?(?<UB>)[iı]ster(?<UE>)')],
};

const balanced_contrast_frame = {
  id: 'balanced_contrast_frame', group: G.STRUCT, dir: 'llm', langs: ['en', 'tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'rate', minTokens: 100,
  note: 'these are ordinary grammatical constructions in both languages; "hem ... hem de" is '
    + 'everyday Turkish, not a tell, and the feature is only meaningful in bulk.',
  compute(ctx) {
    const pats = BALANCED[ctx.lang] ?? [];
    let n = 0;
    let first = null;
    const spans = [];
    for (const p of pats) {
      const c = count(ctx.foldedLex, new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g'));
      if (c > 0 && first === null) first = (ctx.foldedLex.match(p) ?? [''])[0].slice(0, 50);
      if (c > 0) spans.push(...spansOf(ctx.foldedLex, p, 'folded', 10));
      n += c;
    }
    return n > 0 ? { value: n, matched: first, spans } : null;
  },
};

const out_of_channel_register = {
  id: 'out_of_channel_register', group: G.STRUCT, dir: 'llm', langs: 'any',
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'binary', minTokens: 0,
  note: 'structural, survives translation and paraphrase — but a human writing a long complaint '
    + 'or a detailed itinerary on WhatsApp fires it, and travel agencies receive those daily.',
  compute(ctx) {
    if (ctx.channel !== 'whatsapp') return null;
    const ok = ctx.charCount > 400 && ctx.paragraphs.length >= 2;
    return ok ? { value: 1, matched: `${ctx.charCount} chars, ${ctx.paragraphs.length} paragraphs on whatsapp` } : null;
  },
};

// Run against ctx.foldedLex, never nfc with /i (D-02b class B): "İyi günler," and
// "İyi çalışmalar," are the CORRECT spellings and /i missed both.
const OPENERS_RE = {
  en: ure('^(dear(?<UE>)|hello(?<UE>)|greetings(?<UE>)|good morning(?<UE>)|good afternoon(?<UE>)|good evening(?<UE>))'),
  tr: ure('^(sayın(?<UE>)|merhaba(?<UE>)|[iı]yi günler(?<UE>)|[iı]yi akşamlar(?<UE>))'),
};
const SIGNOFF_RE = {
  en: ure('(best regards|kind regards|sincerely|yours faithfully|warm regards)'),
  tr: ure('(saygılarımla|[iı]yi çalışmalar|saygılarımızla|[iı]yi günler dilerim)'),
};

const greeting_signoff_frame = {
  id: 'greeting_signoff_frame', group: G.STRUCT, dir: 'llm', langs: ['en', 'tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'LOW', transform: 'binary', minTokens: 30,
  note: 'worthless in an email corpus — humans write letter frames all day. Active only for '
    + 'genre=review or shape=chat, where a full letter frame is out of register.',
  compute(ctx) {
    if (!(ctx.genre === 'review' || ctx.shape === 'chat')) return null;
    const o = OPENERS_RE[ctx.lang]; const s = SIGNOFF_RE[ctx.lang];
    if (!o || !s) return null;
    const lead = ctx.foldedLex.length - ctx.foldedLex.trimStart().length;
    const first = ctx.foldedLex.trimStart();
    const om = o.exec(first);
    const sm = s.exec(ctx.foldedLex);
    if (!(om && sm)) return null;
    return { value: 1, matched: `${first.slice(0, 16).trim()} … ${sm[0]}`,
      spans: [[lead + om.index, lead + om.index + om[0].length, 'folded'],
        [sm.index, sm.index + sm[0].length, 'folded']] };
  },
};

const llm_lexicon_strong = {
  id: 'llm_lexicon_strong', group: G.REGISTER, dir: 'llm', langs: ['en', 'tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'HIGH', transform: 'rate', minTokens: 0,
  note: 'the lexicon is a SNAPSHOT of one generation of instruction-tuned register and it decays '
    + 'with every model release (180-day expiry). Marketing humans copied several of these '
    + 'phrases from models, and domain=customer_service zeroes the support-desk rows.',
  compute(ctx) {
    const hits = ctx.lexHits.filter((h) => h.row.kind === 'llm' && h.row.tag === 'strong');
    if (hits.length === 0) return null;
    return { value: hits.length, matched: hits.slice(0, 3).map((h) => h.matched).join(' | '),
      spans: hits.slice(0, 40).map((h) => [h.start, h.end, 'folded']) };
  },
};

const llm_lexicon_weak = {
  id: 'llm_lexicon_weak', group: G.REGISTER, dir: 'llm', langs: ['en', 'tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'LOW', transform: 'rate', minTokens: 40,
  note: 'weak rows are common enough in human text that they corroborate and never carry; '
    + 'density is clipped so one dense paragraph cannot dominate.',
  compute(ctx) {
    const hits = ctx.lexHits.filter((h) => h.row.kind === 'llm' && h.row.tag === 'weak');
    return { value: (hits.length * 100) / ctx.tokenCount,
      matched: hits.slice(0, 3).map((h) => h.matched).join(' | ') || 'none',
      spans: hits.slice(0, 40).map((h) => [h.start, h.end, 'folded']) };
  },
};

const POLITENESS = {
  // Run against ctx.foldedLex (lowercase already), so no /i and Unicode word ends.
  en: [ure('thank you (so much )?for(?<UE>)'), ure('please let me know(?<UE>)'),
    ure('please do not hesitate(?<UE>)'), ure('we appreciate your(?<UE>)'),
    ure('i am sorry to hear(?<UE>)'), ure('we are sorry for(?<UE>)'),
    ure('it is my pleasure(?<UE>)'), ure('happy to assist(?<UE>)')],
  tr: [ure('teşekkür eder(im|iz)(?<UE>)'), ure('rica ederim(?<UE>)'), ure('memnuniyetle(?<UE>)'),
    ure('kolay gelsin(?<UE>)'), ure('nazik ilginiz için(?<UE>)'), ure('[iı]yi günler dilerim(?<UE>)')],
};

const politeness_formula = {
  id: 'politeness_formula', group: G.REGISTER, dir: 'llm', langs: ['en', 'tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'rate', minTokens: 0,
  note: 'DOMAIN-SUPPRESSED to weight 0 when domain=customer_service: these strings are literally '
    + 'in human support snippet libraries. A caller who forgets the flag accuses the support team.',
  compute(ctx) {
    const pats = POLITENESS[ctx.lang] ?? [];
    let n = 0; let first = null;
    const spans = [];
    for (const p of pats) {
      const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
      let m;
      while ((m = re.exec(ctx.foldedLex)) !== null) {
        // disjoint from the lexicon (SPEC B.5): skip a hit that overlaps a lexicon match.
        // Runs on foldedLex so the spans are exactly comparable.
        if (ctx.lexSpans.some(([a, b]) => m.index < b && a < m.index + m[0].length)) continue;
        n++; first ??= m[0];
        if (spans.length < 40) spans.push([m.index, m.index + m[0].length, 'folded']);
      }
    }
    return n > 0 ? { value: n, matched: first, spans } : null;
  },
};

const HEDGES = {
  // Run against ctx.foldedLex. `\bçoğunlukla\b` matched ZERO of 8 occurrences (D-02b class A):
  // `\b` before ç requires an ASCII word character in front of it.
  en: [ure('(?<UB>)may(?<UE>)', 'gu'), ure('(?<UB>)might(?<UE>)', 'gu'), ure('(?<UB>)could(?<UE>)', 'gu'),
    ure('(?<UB>)tends to(?<UE>)', 'gu'), ure('(?<UB>)generally(?<UE>)', 'gu'),
    ure('(?<UB>)typically(?<UE>)', 'gu'), ure('(?<UB>)it is worth noting(?<UE>)', 'gu'),
    ure('(?<UB>)that said(?<UE>)', 'gu')],
  tr: [ure('(?<UB>)olabilir(?<UE>)', 'gu'), ure('(?<UB>)genellikle(?<UE>)', 'gu'),
    ure('(?<UB>)çoğunlukla(?<UE>)', 'gu'), ure('(?<UB>)nispeten(?<UE>)', 'gu'),
    ure('(?<UB>)unutulmamalıdır(?<UE>)', 'gu'), ure('(?<UB>)görünmektedir(?<UE>)', 'gu')],
};

const hedge_density = {
  id: 'hedge_density', group: G.REGISTER, dir: 'llm', langs: ['en', 'tr'], scope: 'PROSE-ONLY',
  confidence: 'LOW', transform: 'rate', minTokens: 100,
  note: 'academic and legal humans hedge more than any model; this is a register measure with an '
    + 'authorship label stuck on it.',
  compute(ctx) {
    const pats = HEDGES[ctx.lang] ?? [];
    if (pats.length === 0) return null;
    let n = 0;
    const spans = [];
    for (const p of pats) {
      n += count(ctx.foldedLex, p);
      if (spans.length < 40) spans.push(...spansOf(ctx.foldedLex, p, 'folded', 40 - spans.length));
    }
    return { value: (n * 100) / ctx.tokenCount,
      matched: `${n} hedges per ${ctx.tokenCount} tokens`, spans };
  },
};

const human_lexicon = {
  id: 'human_lexicon', group: G.HUMAN, dir: 'human', langs: ['en', 'tr'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'HIGH', transform: 'rate', minTokens: 1,
  note: 'a POSITIVE observation, which is why it outweighs distributional features — and it is '
    + 'also the single most promptable thing in the catalogue. One "nbr" proves a register, '
    + 'not a species.',
  compute(ctx) {
    const hits = ctx.lexHits.filter((h) => h.row.kind === 'human');
    if (hits.length === 0) return null;
    const strong = hits.filter((h) => h.row.tag === 'strong').length;
    const weak = hits.length - strong;
    return { value: strong * 3 + weak,
      matched: hits.slice(0, 5).map((h) => h.matched).join(', '),
      spans: hits.slice(0, 40).map((h) => [h.start, h.end, 'folded']) };
  },
};

const CONTRACTIONS = new Set(['dont', 'cant', 'wont', 'im', 'ive', 'id', 'youre', 'theyre',
  'doesnt', 'didnt', 'wasnt', 'isnt', 'thats', 'theres', 'whats', 'hes', 'shes', 'wouldnt',
  'couldnt', 'shouldnt', 'lets', 'aint', 'yall', 'gonna', 'wanna', 'gotta', 'kinda', 'dunno']);

const contraction_apostrophe_drop = {
  id: 'contraction_apostrophe_drop', group: G.HUMAN, dir: 'human', langs: ['en'],
  scope: 'DOMAIN-TRANSFERABLE', confidence: 'MED', transform: 'rate', minTokens: 5,
  note: 'exactly what a "humanizer" tool injects — character noise is the cheapest fake there is. '
    + 'Weighted BELOW self_correction_marker for that reason. "its" and "were" are excluded '
    + 'because they are legitimate words.',
  compute(ctx) {
    const pred = (t) => CONTRACTIONS.has(t.t.toLowerCase());
    const hits = ctx.tokens.filter(pred);
    return hits.length > 0
      ? { value: hits.length, matched: [...new Set(hits.map((t) => t.t.toLowerCase()))].slice(0, 5).join(', '),
        spans: tokenSpans(ctx, pred) }
      : null;
  },
};

const SELF_CORRECT = [
  /^\*\s*\S/m,
  ure('(?<UB>)i meant(?<UE>)', 'iu'), ure('(?<UB>)sorry,? typo(?<UE>)', 'iu'),
  ure('(?<UB>)edit:', 'iu'), ure('(?<UB>)nvm(?<UE>)', 'iu'),
  ure('(?<UB>)pardon(?<UE>)', 'iu'), ure('(?<UB>)yok yani(?<UE>)', 'iu'),
  ure('(?<UB>)düzelt(me|iyorum)(?<UE>)', 'iu'), ure('(?<UB>)yok\\s+pardon(?<UE>)', 'iu'),
];

const self_correction_marker = {
  id: 'self_correction_marker', group: G.HUMAN, dir: 'human', langs: 'any', scope: 'CHAT-ONLY',
  confidence: 'HIGH', transform: 'rate', minTokens: 2,
  note: 'the hardest human marker to fake: humanizer tools inject character noise, not '
    + 'conversational repair. Still promptable if the adversary thinks of it, and a leading "*" '
    + 'in a bullet list is a false hit.',
  compute(ctx) {
    let n = 0; let first = null;
    const spans = [];
    for (const p of SELF_CORRECT) {
      const m = p.exec(ctx.raw);
      if (m) { n++; first ??= m[0].trim().slice(0, 30); spans.push([m.index, m.index + m[0].length, 'raw']); }
    }
    return n > 0 ? { value: n, matched: first, spans } : null;
  },
};

export const FEATURES = [
  sentence_len_cv, sentence_len_mode_mass, paragraph_uniformity, content_word_repeat,
  terminal_punct_ratio, sentence_initial_caps, all_lowercase, ellipsis_hand_typed,
  repeated_punct_emoticon, letter_elongation, space_hygiene, multi_exclam,
  exclam_single_regular, em_dash_in_chat, wa_single_asterisk, emoji_repeat_run, emoji_bullet_led,
  tr_asciified_probe, tr_mixed_orthography, tr_bare_capital_I, tr_apostrophe_absent,
  tr_chat_morphology, tr_formal_copula,
  bold_lead_in_list, colon_led_list, enumerated_openers, parallel_openers, closing_summary_move,
  balanced_contrast_frame, out_of_channel_register, greeting_signoff_frame,
  llm_lexicon_strong, llm_lexicon_weak, politeness_formula, hedge_density,
  human_lexicon, contraction_apostrophe_drop, self_correction_marker,
];

export const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]));
export const GROUPS = G;

/** Scope + language gating (SPEC B.0). `mixed` disables every language-specific feature. */
export function featureApplies(f, ctx) {
  if (f.scope === 'PROSE-ONLY' && ctx.shape !== 'prose') return false;
  if (f.scope === 'CHAT-ONLY' && ctx.shape !== 'chat') return false;
  if (f.langs !== 'any') {
    if (ctx.lang === 'mixed' || ctx.lang === 'unknown') return false;
    if (!f.langs.includes(ctx.lang)) return false;
  }
  if (ctx.tokenCount < f.minTokens) return false;
  return true;
}
