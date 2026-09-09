// lib/rules.mjs — Tier 0 ARTIFACT RULES (SPEC B.1) as amended by HEAD-RULINGS R1-R4, R17, R22.
// These are RULES, not stylometry: near-100% precision, low recall, language-agnostic.
// They are reported in rules[] and are NEVER merged into score (SPEC C.3 invariant 5).
import { ZW_G, BIDI_MARK_G, ODD_SPACE_G, AR_LETTER, ure, foldConfusables } from './unicode.mjs';
import { words } from './tokenize.mjs';
import { fnv1a64Hex } from './hash.mjs';

// ---------------------------------------------------------------------------
// R1 + R27 — assistant_frame_leak.
// The rule bypasses every gate and is the main road to likely_llm, so a false fire is the worst
// output this tool has. R27 rebuilt it after the refuter made it accuse a human three ways
// (D1-D3) and slip past it nineteen ways (D5-D7), and after the reviewer found three mechanical
// defects (D-11 apostrophe parity, D-12 first-occurrence blanking, D-13 first-pattern-wins).
//
// Matching runs on a WHITESPACE-NORMALISED, case-FOLDED copy of raw with an index map back to
// raw, so "As  an  AI", "As an\nAI" and an NBSP all match and the reported span is still the raw
// string. English patterns run on an en-folded copy, Turkish patterns on a tr-folded copy (D-02b
// class B: /i uses SIMPLE folding, where I and i-dotless fold to themselves).
// ---------------------------------------------------------------------------

const WS = /\s/u;

/**
 * normalizeForRules(text, locale) -> { text, map }
 * map[i] is the index in `text` (the caller's raw string) of the character that produced the
 * i-th output character; map[out.length] is text.length, so a match [a,b) maps to [map[a],map[b]).
 * A whitespace RUN collapses to one space mapped to the first character of the run.
 */
export function normalizeForRules(src, locale) {
  let out = '';
  const map = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = String.fromCodePoint(src.codePointAt(i));
    if (WS.test(ch)) {
      const runStart = i;
      while (i < n) {
        const c = String.fromCodePoint(src.codePointAt(i));
        if (!WS.test(c)) break;
        i += c.length;
      }
      out += ' ';
      map.push(runStart);
      continue;
    }
    let low = locale === 'tr' ? ch.toLocaleLowerCase('tr') : ch.toLowerCase();
    if (low === 'i̇') low = 'i';               // en-fold of I-with-dot leaves a stray U+0307
    if (low === '’' || low === 'ʼ') low = "'";  // one apostrophe form, so patterns need only one
    for (let k = 0; k < low.length; k++) map.push(i);
    out += low;
    i += ch.length;
  }
  map.push(n);
  return { text: out, map };
}

// Every pattern is a FIRST-PERSON self-identification or a drafting frame. Nothing that a human
// says all day belongs here — those were moved to llm_lexicon_strong by R1.
const EN_FRAMES = [
  // R27 common-noun guard: bare "language model" no longer fires; it needs a self-ID frame.
  { re: ure("(?<UB>)(?:as|i'?m|i am|being|since i am) (?:just |merely |only )?an? (?:ai |large |artificial intelligence )?(?:language model|llm)(?<UE>)", 'gu'),
    name: 'language-model self-identification' },
  { re: ure('(?<UB>)as an ai(?<UE>)', 'gu'), name: 'as an AI' },
  { re: ure("(?<UB>)i'?m (?:just |merely |only )?an ai(?<UE>)", 'gu'), name: "I'm an AI" },
  { re: ure('(?<UB>)i am (?:just |merely |only )?an ai(?<UE>)', 'gu'), name: 'I am an AI' },
  { re: ure('(?<UB>)my (?:training data|knowledge cut-?off|training cut-?off)(?<UE>)', 'gu'),
    name: 'my training data / knowledge cutoff' },
  { re: ure("(?<UB>)(?:i )?(?:do not|don'?t|dont|cannot|can'?t|cant|am unable to) have (?:access to )?real[ -]?time(?<UE>)", 'gu'),
    name: 'no real-time access' },
  { re: ure("(?<UB>)(?:do not|don'?t|cannot|can'?t|am unable to) (?:have )?(?:access to|browse) (?:the )?(?:internet|web)(?<UE>)", 'gu'),
    name: 'no internet access / cannot browse' },
  { re: ure('(?<UB>)i cannot browse(?<UE>)', 'gu'), name: 'I cannot browse' },
  // R34 (b): the tighter drafting frame REPLACES R1's `here('s| is) (a|an|the) (draft|revised|…)`.
  // "Here is the revised itinerary my colleague sent over" is a human forwarding a document, and
  // that pattern accused them (verify-round row N07). The head noun is now mandatory.
  { re: ure("(?<UB>)here(?:'s)? (?:your|a|an|the) (?:revised|rewritten|polished|updated) (?:version|draft|text)(?<UE>)", 'gu'),
    name: "here's the revised/rewritten version|draft|text" },
  { re: ure('(?<UB>)here is (?:your|a|an|the) (?:revised|rewritten|polished|updated) (?:version|draft|text)(?<UE>)', 'gu'),
    name: 'here is the revised/rewritten version|draft|text' },
  { re: ure('(?<UB>)i have (?:rewritten|revised|drafted|polished|reworked) (?:it|this|the|your)(?<UE>)', 'gu'),
    name: 'I have rewritten/revised it' },
  { re: ure('(?<UB>)i (?:was|am|have been) trained on data(?<UE>)', 'gu'), name: 'I was trained on data' },
  { re: ure('(?<UB>)as of my (?:last|latest) (?:update|training)(?<UE>)', 'gu'), name: 'as of my last update' },
];

// R27: zek[aâ] everywhere (â is standard formal Turkish orthography and is what a model
// writing careful Turkish emits). These run against a tr-FOLDED copy, never with /i.
const TR_FRAMES = [
  // R34 (a): the FIRST-PERSON marker is mandatory. "sitenin yapay zeka asistanı felaket" is a
  // human complaining about a product (verify-round row N09), not a machine identifying itself,
  // and the bare common noun accused them. Only "-(y)Im" or " olarak" fires — for `dil modeli`
  // too, which now needs the same frame.
  { re: ure('(?<UB>)bir (?:yapay zek[aâ] )?dil modeli(?:yim| olarak)(?<UE>)', 'gu'),
    name: 'bir dil modeli olarak (language-model self-ID)' },
  { re: ure('(?<UB>)bir yapay zek[aâ] (?:modeli|asistan[iı])(?:y[iı]m|yim)(?<UE>)', 'gu'),
    name: 'bir yapay zeka modeliyim/asistaniyim (a first-person self-ID)' },
  { re: ure('(?<UB>)yapay zek[aâ] (?:modeli|asistan[iı]) olarak(?<UE>)', 'gu'),
    name: 'yapay zeka modeli olarak (a first-person self-ID frame)' },
  { re: ure('(?<UB>)eğitim verilerim(?<UE>)', 'gu'), name: 'egitim verilerim (my training data)' },
  { re: ure('(?<UB>)bilgi kesim tarih', 'gu'), name: 'bilgi kesim tarihi (knowledge cutoff date)' },
  { re: ure('(?<UB>)gerçek zamanl[iı] (?:erişim|veri)[\\p{L}\\p{M}]* (?:yok|bulunm[\\p{L}\\p{M}]*|olmad[\\p{L}\\p{M}]*|olmuyor)', 'gu'),
    name: 'gercek zamanli erisim yok (no real-time access)' },
];

// R27 cue list. The search runs over the WHOLE document, not a 100-character window (D1: one
// intervening sentence was enough to clear it).
const CUE_RE = ure('(chatgpt|claude|gemini|copilot|gpt(?:-\\p{Nd})?|llm|chat ?bot|(?<UB>)bot(?<UE>)'
  + '|assistant|asistan|(?<UB>)ai(?<UE>)|yapay zek[aâ]|dil modeli)', 'gu');

const WORD_TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

function tokensBetween(text, a, b) {
  if (b <= a) return 0;
  const re = new RegExp(WORD_TOKEN.source, 'gu');
  let n = 0;
  const slice = text.slice(a, b);
  while (re.exec(slice) !== null) n++;
  return n;
}

/**
 * D-11: a curly apostrophe BETWEEN TWO LETTERS is an apostrophe, not a quote. The old parity
 * count made "It doesn't matter. As an AI, ..." suppress itself on the one character LLM output
 * emits most.
 */
export function insideQuotes(text, idx) {
  let dq = false, sq = false;
  for (let i = 0; i < idx && i < text.length; i++) {
    const c = text[i];
    if (c === '"') { dq = !dq; continue; }
    if (c === '“' || c === '«') { dq = true; continue; }
    if (c === '”' || c === '»') { dq = false; continue; }
    if (c === '‘') { sq = true; continue; }
    if (c === '’' || c === "'") {
      const prev = text[i - 1], next = text[i + 1];
      const intraWord = prev !== undefined && next !== undefined
        && /\p{L}/u.test(prev) && /\p{L}/u.test(next);
      if (intraWord) continue;                       // an apostrophe, not a quotation mark
      if (c === '’') sq = false; else sq = !sq;
    }
  }
  return dq || sq;
}

function collect(view, patterns) {
  const hits = [];
  for (const p of patterns) {
    const re = new RegExp(p.re.source, 'gu');
    let m;
    while ((m = re.exec(view.text)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, pattern: p.name, view });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return hits;
}

/**
 * The first cue in the WHOLE document that is not part of a frame match itself. A cue that
 * overlaps ANY frame span, or sits within one token of one, does not count — so
 * "As an AI assistant, I cannot ..." still fires, and (D-12) a frame that occurs TWICE cannot
 * suppress itself with its own second copy.
 */
function freeCue(view, spans) {
  const text = view.text;
  const re = new RegExp(CUE_RE.source, 'gu');
  let m;
  while ((m = re.exec(text)) !== null) {
    const cs = m.index, ce = cs + m[0].length;
    const rcs = view.map[cs], rce = view.map[ce];
    let attached = false;
    for (const sp of spans) {
      if (cs < sp.e && sp.s < ce) { attached = true; break; }                // overlaps a frame
      const tok = ce <= sp.s ? tokensBetween(text, ce, sp.s) : tokensBetween(text, sp.e, cs);
      // Character distance is measured on RAW, because the matching view collapsed whitespace:
      // "ChatGPT" + 90 spaces + "As an AI" is a discussion, not a self-identification, and the
      // collapsed view would otherwise show them as adjacent.
      const chars = ce <= sp.s ? sp.rs - rce : rcs - sp.re;
      if (tok === 0 && chars <= 16) { attached = true; break; }              // part of the frame
    }
    if (!attached) return m[0];
  }
  return null;
}

// R27: every pattern is a FIRST-PERSON frame. A third-person subject immediately after it means
// the writer is REPORTING what something else said ("... that as an AI he could not diagnose the
// fault remotely"), which is refuter D1 — a human retelling, not a machine identifying itself.
const THIRD_PERSON_AFTER = ure('^[\\s,.:;\'"“”’)-]*(?:he|she|they|him|her|them|his|their)(?<UE>)', 'u');

const LEAK_NOTE = 'assistant self-identification or drafting frame; suppressed when quoted or when '
  + 'the document discusses an assistant (R27 runs that cue search over the whole document). '
  + 'A person can paste this deliberately.';

export function assistantFrameLeak(ctx) {
  const raw = ctx.raw;
  const passes = [[raw, false]];
  const folded = foldConfusables(raw);
  if (folded !== raw) passes.push([folded, true]);   // R30: a second, confusable-folded pass

  for (const [src, viaFold] of passes) {
    const enView = normalizeForRules(src, 'en');
    const trView = normalizeForRules(src, 'tr');
    const hits = collect(enView, EN_FRAMES).concat(collect(trView, TR_FRAMES))
      .map((h) => ({ ...h, rawStart: h.view.map[h.start], rawEnd: h.view.map[h.end] }))
      .sort((a, b) => a.rawStart - b.rawStart || a.rawEnd - b.rawEnd
        || (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));

    // The cue verdict is a property of the DOCUMENT, computed against every frame span at once.
    const span = (h) => ({ s: h.start, e: h.end, rs: h.rawStart, re: h.rawEnd });
    const enSpans = hits.filter((h) => h.view === enView).map(span);
    const trSpans = hits.filter((h) => h.view === trView).map(span);
    const cueEn = hits.length ? freeCue(enView, enSpans) : null;
    const cueTr = hits.length ? freeCue(trView, trSpans) : null;

    let suppressedFirst = null;
    for (const h of hits) {
      // Report the string as it appears in RAW, not the folded/normalised form.
      const matched = raw.slice(h.rawStart, h.rawEnd).trim()
        || src.slice(h.rawStart, h.rawEnd).trim();
      if (insideQuotes(raw, h.rawStart)) {
        suppressedFirst ??= { matched, cue: 'quotation marks' };
        continue;                                    // D-13: keep looking at the remaining hits
      }
      if (THIRD_PERSON_AFTER.test(h.view.text.slice(h.end))) {
        suppressedFirst ??= { matched, cue: 'a third-person subject follows the frame (reported speech)' };
        continue;
      }
      const cue = h.view === enView ? cueEn : cueTr;
      if (cue) { suppressedFirst ??= { matched, cue }; continue; }
      return {
        name: 'assistant_frame_leak', matched, direction: 'llm', precision: 'high',
        note: LEAK_NOTE + (viaFold ? ' Matched only after confusable folding (R30).' : ''),
        pattern: h.pattern,
        ...(viaFold ? { homoglyphFolded: true, warning: 'homoglyph_suspect' } : {}),
      };
    }
    if (suppressedFirst) {
      return {
        suppressed: true, matched: suppressedFirst.matched, cue: suppressedFirst.cue,
        note: `possible_quotation_or_discussion: ${suppressedFirst.cue} — ${LEAK_NOTE}`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// R2 — markdown_in_chat. Plain dash bullets alone are NOT a rule hit: a human on WhatsApp writes
// "- 2 yetiskin\n- 1 cocuk" all the time. They feed colon_led_list / bold_lead_in_list instead.
// ---------------------------------------------------------------------------
const MD_HEADER = /^\s{0,3}#{1,6}\s+\S/m;          // the space is mandatory: #hashtag is human
const MD_BOLD = /\*\*[^*\n]{2,80}\*\*/;            // DOUBLE asterisk. WhatsApp's own bold is *single*.
const MD_FENCE = /^\s{0,3}```/m;
const MD_TABLE = /^\s{0,3}\|.*\|/m;
const MD_BULLET = /^\s{0,3}[-*+]\s+\S/gm;
const MD_BULLET_BOLD = /^\s{0,3}[-*+]\s*\*\*[^*\n]{2,60}\*\*/m;

export function markdownInChat(ctx) {
  if (!(ctx.shape === 'chat' || ctx.channel === 'whatsapp')) return null;
  const t = ctx.raw;
  const found = [];
  let matched = null;
  if (MD_HEADER.test(t)) { found.push('header'); matched ??= t.match(MD_HEADER)[0].trim(); }
  if (MD_BOLD.test(t)) { found.push('double_asterisk_bold'); matched ??= t.match(MD_BOLD)[0]; }
  if (MD_FENCE.test(t)) { found.push('code_fence'); matched ??= '```'; }
  if (MD_TABLE.test(t)) { found.push('pipe_table'); matched ??= t.match(MD_TABLE)[0].trim().slice(0, 40); }
  const bullets = (t.match(MD_BULLET) ?? []).length;
  if (bullets >= 2 && MD_BULLET_BOLD.test(t)) {
    found.push('bullets_with_bold_lead_in');
    matched ??= t.match(MD_BULLET_BOLD)[0].trim();
  }
  if (found.length === 0) return null;
  return {
    name: 'markdown_in_chat', matched, direction: 'llm', precision: 'medium', kinds: found,
    note: 'markdown arriving in a channel that does not render it — a writer who did not know '
      + 'where they were writing. A technical user pasting notes produces the same shape. '
      + 'WhatsApp trap: single *bold* is WhatsApp’s own markup and points HUMAN, not LLM.',
  };
}

// ---------------------------------------------------------------------------
// R17 — known_machine_marker (was own_bot_marker). Reads markers.json; ships as [] so the rule
// never fires by default. Behaviour on a match is unchanged from SPEC B.1.
// ---------------------------------------------------------------------------
export function knownMachineMarker(ctx) {
  const markers = ctx.markers ?? [];
  const folded = foldConfusables(ctx.raw);
  for (const m of markers) {
    let re;
    // An invalid pattern is refused at LOAD time by stylometry.mjs (D-07) and exits 2, so an
    // operator can never believe a marker is armed when it is not. This catch is the library
    // path's last resort only.
    try { re = new RegExp(m.pattern, 'u'); } catch { continue; }
    let hit = re.exec(ctx.raw);
    let viaFold = false;
    if (!hit && folded !== ctx.raw) { hit = re.exec(folded); viaFold = Boolean(hit); }
    if (!hit) continue;
    return {
      name: 'known_machine_marker', matched: hit[0], direction: 'llm', precision: 'high',
      marker: m.name,
      ...(viaFold ? { homoglyphFolded: true } : {}),
      note: (m.note ? m.note + ' ' : '')
        + 'The STRING is machine-written; the SENDER is a person who may simply be forwarding it. '
        + 'Origin is not attribution.',
      warning: 'pasted_machine_text',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// near_duplicate — 5-gram word shingles over foldedLex, 64-bit FNV-1a, Jaccard >= 0.80 against
// any document with a DIFFERENT sender. R3: alone this proves "not independently authored",
// not "LLM", so it drives leaning_llm + templated_or_copied, never likely_llm by itself.
// ---------------------------------------------------------------------------
export function shingles(foldedLex, n = 5) {
  const toks = words(foldedLex).map((w) => w.t);
  const set = new Set();
  for (let i = 0; i + n <= toks.length; i++) set.add(fnv1a64Hex(toks.slice(i, i + n).join(' ')));
  return set;
}

export function buildCorpusIndex(docs) {
  return docs.map((d) => ({
    id: d.id, sender: d.sender ?? null, shingles: shingles((d.text ?? '').normalize('NFC').toLowerCase()),
  })).filter((d) => d.shingles.size > 0);
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function nearDuplicate(ctx) {
  const index = ctx.corpusIndex;
  if (!index || index.length === 0) return null;
  if (ctx.tokenCount < 20) return null;
  const mine = shingles(ctx.foldedLex);
  if (mine.size === 0) return null;
  let best = null;
  for (const d of index) {
    if (ctx.sender != null && d.sender != null && d.sender === ctx.sender) continue;
    if (ctx.id != null && d.id === ctx.id) continue;
    const j = jaccard(mine, d.shingles);
    if (j >= 0.80 && (best === null || j > best.jaccard
      || (j === best.jaccard && String(d.id) < String(best.id)))) best = { id: d.id, jaccard: j };
  }
  if (!best) return null;
  return {
    name: 'near_duplicate', matched: `duplicate of ${best.id} at Jaccard ${best.jaccard.toFixed(3)}`,
    direction: 'llm', precision: 'high', duplicateOf: best.id, jaccard: best.jaccard,
    // S-01: SPEC B.1 says "a DIFFERENT sender". With no sender the code cannot honour that.
    senderUnknown: ctx.sender == null,
    note: 'template or copy; NOT proof of LLM authorship. Two people pasting the same agency '
      + 'template, or the same person under two ids, produce this exactly.',
    warning: 'templated_or_copied',
  };
}

// ---------------------------------------------------------------------------
// invisible_chars — CORROBORATOR ONLY. It is a "passed through a rich-text surface" fact
// (Word, Notion, a webpage), not an LLM fact. Never fires alone.
// ---------------------------------------------------------------------------
export function invisibleChars(ctx) {
  const t = ctx.raw;
  const hasArabic = AR_LETTER.test(t);
  let zw = 0;
  const zwRe = new RegExp(ZW_G.source, 'gu');
  let m;
  while ((m = zwRe.exec(t)) !== null) {
    const ch = m[0], i = m.index;
    // D-09: a U+FEFF at offset 0 is a file ENCODING MARKER, not a rich-text artefact. Windows
    // and Excel exports carry one routinely.
    if (ch === '\ufeff' && i === 0) continue;
    // exclude ZWJ inside emoji sequences
    if (ch === '‍') continue;
    // exclude ZWNJ adjacent to Arabic letters
    if (ch === '‌' && (AR_LETTER.test(t[i - 1] ?? '') || AR_LETTER.test(t[i + 1] ?? ''))) continue;
    zw++;
  }
  // U+200E / U+200F only count when the text has no Arabic at all
  if (!hasArabic) zw += (t.match(new RegExp(BIDI_MARK_G.source, 'gu')) ?? []).length;
  const odd = (t.match(new RegExp(ODD_SPACE_G.source, 'gu')) ?? []).length;
  const count = zw + odd;
  if (count === 0) return null;
  return {
    name: 'invisible_chars', matched: `${count} invisible/odd-space characters`, direction: 'llm',
    precision: 'low', count,
    note: 'a rich-text surface (Word, Notion, a web page) was involved. That is a provenance '
      + 'fact, not an authorship fact. Corroborator only: never fires alone.',
  };
}

/**
 * runRules(ctx) -> { rules, notes, warnings }
 * invisible_chars is demoted to a note unless >=1 other rule fired or >=2 LLM-direction features
 * are present (the caller passes llmFeatureCount).
 */
export function runRules(ctx, llmFeatureCount = 0) {
  const rules = [];
  const notes = [];
  const warnings = [];

  const frame = assistantFrameLeak(ctx);
  if (frame && frame.suppressed) notes.push(`assistant_frame_suppressed: "${frame.matched}" — ${frame.note}`);
  else if (frame) rules.push(frame);

  const md = markdownInChat(ctx);
  if (md) rules.push(md);

  const marker = knownMachineMarker(ctx);
  if (marker) rules.push(marker);

  const dup = nearDuplicate(ctx);
  if (dup) {
    rules.push(dup);
    if (dup.senderUnknown) {
      notes.push('near_duplicate: sender unknown; the match may be the same author writing under '
        + 'two ids. SPEC B.1 requires a DIFFERENT sender and this run could not check that.');
    }
  }

  const inv = invisibleChars(ctx);
  if (inv) {
    if (rules.length >= 1 || llmFeatureCount >= 2) rules.push(inv);
    else notes.push(`invisible_chars: ${inv.count} — ${inv.note}`);
  }

  for (const r of rules) if (r.warning) warnings.push(r.warning);
  return { rules, notes, warnings };
}
