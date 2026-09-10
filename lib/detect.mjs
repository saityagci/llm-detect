// lib/detect.mjs — the pure core. SPEC C.6: detect() has no clock, no RNG, no filesystem, no
// network and no global mutation. Same input => byte-identical report. The expiry clock arrives
// as opts.now (HEAD-RULINGS R5); with no `now` the expiry check is skipped and `warnings` says so.
import { makeViews, foldConfusablesMapped, homoglyphScan } from './unicode.mjs';
import { words, lines, paragraphs, nonEmptyLines } from './tokenize.mjs';
import { segment } from './segment.mjs';
import { identify } from './langid.mjs';
import { buildMatcher, search, dropOverlapping } from './lexicon.mjs';
import { runRules } from './rules.mjs';
import { FEATURES, featureApplies } from './features.mjs';
import { AGG_FEATURES, prepareAggregate } from './feat-aggregate.mjs';
import { sha256Hex, utf8Bytes } from './hash.mjs';
import { lexicalDiversity, diagnosticNotes } from './diagnostics.mjs';
import {
  transform, sigmoid, logit, channels, decideVerdict, shipTimeGuard,
  capBand, capLambda, GATE_MINS, gateMins, AGGREGATE_DISABLED,
  K_CHANNEL, validateWeightsShape, isUsableCell, isNotFittedCell,
  DECISION_WARNINGS, isDecisionNote,
} from './score.mjs';

export const DETECTOR_VERSION = '1.0.0';

let MATCHER = null;
let LEXICON = null;
let WEIGHTS = null;
let MARKERS = [];

/** Called once at module load by stylometry.mjs; keeps detect() free of any I/O. */
export function configure({ lexicon, weights, markers }) {
  // R36(c): the shipped file is held to the same contract as any --weights override, so a broken
  // artifact fails at load with a readable message instead of a TypeError three frames deeper.
  validateWeightsShape(weights, 'the configured weights file');
  LEXICON = lexicon;
  MATCHER = buildMatcher(lexicon.rows);
  WEIGHTS = weights;
  MARKERS = markers ?? [];
}

export function resources() { return { lexicon: LEXICON, weights: WEIGHTS, markers: MARKERS }; }

// ---------------------------------------------------------------------------
// Option resolution
// ---------------------------------------------------------------------------
const MD_STRUCTURE = /(^\s{0,3}#{1,6}\s+\S)|(\*\*[^*\n]{2,80}\*\*)|(^\s{0,3}```)|(^\s{0,3}\|.*\|)/m;

export function resolveShape(text, opts) {
  if (opts.shape && opts.shape !== 'auto') return opts.shape;
  const chars = [...text].length;
  const nLines = lines(text).length;
  // SPEC C.1: auto-detection is a FALLBACK. A caller that knows must pass it.
  const isChat = (chars < 400 && nLines <= 4 && !MD_STRUCTURE.test(text)) || opts.channel === 'whatsapp';
  return isChat ? 'chat' : 'prose';
}

function resolveGenre(shape, opts) {
  if (opts.genre && opts.genre !== 'auto') return opts.genre;
  if (shape === 'chat') return 'chat';
  if (opts.channel === 'email') return 'email';
  // Deliberately NOT guessing 'review': greeting_signoff_frame is only active for review/chat,
  // and guessing 'review' here would switch on a feature nobody asked for.
  return 'unspecified';
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
function buildContext(text, opts) {
  const channel = opts.channel ?? 'unknown';
  const shape = resolveShape(text, { ...opts, channel });
  const genre = resolveGenre(shape, opts);
  const domain = opts.domain ?? 'general';

  const preNfc = text.normalize('NFC');
  const langInfo = opts.lang && opts.lang !== 'auto'
    ? { primary: opts.lang, confidence: 1, mixed: false,
        shares: identify(preNfc).shares, notes: ['language_forced_by_caller'] }
    : identify(preNfc);

  const lang = langInfo.primary;
  // S-05: NFC once. `preNfc` above is the same normalization makeViews used to redo internally.
  const views = makeViews(text, lang, preNfc);
  const toks = words(views.nfc);
  const allLines = lines(views.raw);

  const seg = segment(views.nfc, shape);

  const ctx = {
    ...views,
    lang, langInfo, shape, channel, genre, domain,
    tokens: toks,
    tokenCount: toks.length,
    charCount: [...views.raw].length,
    linesAll: allLines,
    linesWithWords: nonEmptyLines(views.raw),
    paragraphs: paragraphs(views.raw),
    sentences: seg.sentences,
    segWarnings: seg.warnings,
    mode: opts.mode ?? 'single',
    markers: opts.markers ?? MARKERS,
    corpusIndex: opts.corpusIndex ?? null,
    sender: opts.sender ?? null,
    id: opts.id ?? null,
    opts,
  };

  // R30: homoglyph / non-ASCII-Latin evasion. Detection power against a real adversary is ZERO
  // and the README says so; the fix is the WARNING plus a second matching pass, not a defence.
  // R38(d): scan WHITESPACE-DELIMITED runs, not word tokens — `REF-４４９２８１` carries fullwidth
  // DIGITS, which never appear inside a word token, and evaded the warning entirely.
  ctx.homoglyphs = homoglyphScan(views.raw.split(/\s+/u).filter(Boolean));

  // Lexicon: ONE Aho-Corasick pass over foldedLex, plus (R30) a second pass over a
  // confusable-folded copy. The fold is 1:1 per code point, so the two hit lists share one
  // index space and dropOverlapping resolves them together.
  let hits = [];
  if (MATCHER && (lang === 'en' || lang === 'tr')) {
    let raw = search(MATCHER, ctx.foldedLex);
    const foldedConf = foldConfusablesMapped(ctx.foldedLex);
    if (foldedConf.changed) {
      const seen = new Set(raw.map((h) => `${h.start}:${h.end}:${h.id}`));
      for (const h of search(MATCHER, foldedConf.text)) {
        // Map the span back onto foldedLex so both hit lists share one index space.
        const start = foldedConf.map[h.start], end = foldedConf.map[h.end];
        const k = `${start}:${end}:${h.id}`;
        if (!seen.has(k)) { seen.add(k); raw.push({ ...h, start, end }); }
      }
      raw.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start)
        || (a.row.phrase < b.row.phrase ? -1 : a.row.phrase > b.row.phrase ? 1 : 0));
    }
    hits = dropOverlapping(raw).filter((h) => h.row.lang === lang);
  }
  const suppressed = [];
  if (domain === 'customer_service') {
    hits = hits.filter((h) => {
      if (h.row.kind === 'llm' && h.row.domain === 'cs') { suppressed.push(h.row.phrase); return false; }
      return true;
    });
  }
  ctx.lexHits = hits;
  ctx.lexSuppressed = suppressed;
  ctx.lexSpans = hits.map((h) => [h.start, h.end]);
  return ctx;
}

// ---------------------------------------------------------------------------
// Feature evaluation
// ---------------------------------------------------------------------------
function cellKey(lang, shape) {
  const l = lang === 'en' || lang === 'tr' ? lang : 'en';
  return `${l}:${shape}`;
}

function evaluate(ctx, featureList, cell, reducedWeights) {
  const active = [];
  const inactive = [];
  for (const f of featureList) {
    // R29: the concatenation of a sender's turns is an artefact — its "paragraphs" are messages
    // and its length is the number of turns — so these two features do not run in aggregate mode.
    const aggDisabled = ctx.mode === 'aggregate' && AGGREGATE_DISABLED.has(f.id);
    const applies = f.scope === 'AGGREGATE-ONLY' ? true : (!aggDisabled && featureApplies(f, ctx));
    const w = cell.w[f.id];
    if (!applies || w === undefined) {
      inactive.push({ name: f.id, value: null, direction: f.dir, group: f.group, scope: f.scope,
        weight: w ?? 0, contribution: 0, contributionRaw: 0, confidence: f.confidence,
        provenance: 'prior', note: f.note, reason: !applies ? 'not_applicable' : 'no_weight_in_cell' });
      continue;
    }
    let out = null;
    try { out = f.compute(ctx); } catch { out = null; }     // features never throw (SPEC C.6)
    if (out === null || out === undefined || !Number.isFinite(out.value)) {
      inactive.push({ name: f.id, value: null, direction: f.dir, group: f.group, scope: f.scope,
        weight: w, contribution: 0, contributionRaw: 0, confidence: f.confidence,
        provenance: 'prior', note: f.note, reason: 'no_observation' });
      continue;
    }
    // Domain suppression: politeness formulae are IN human support snippet libraries.
    let weight = w;
    let domainSuppressed = false;
    if (ctx.domain === 'customer_service' && f.id === 'politeness_formula') { weight = 0; domainSuppressed = true; }
    if (reducedWeights) weight = weight / 2;

    const kind = cell.kind[f.id] ?? f.transform;
    const z = transform(kind, out.value, cell.mu[f.id], cell.sigma[f.id]);
    const signed = f.dir === 'human' ? -1 : 1;
    active.push({
      id: f.id, name: f.id, value: out.value, matched: out.matched ?? null,
      direction: f.dir, group: f.group, scope: f.scope, weight,
      z, contributionRaw: signed * weight * z, contribution: signed * weight * z,
      confidence: f.confidence, provenance: 'prior',
      note: f.note + (domainSuppressed ? ' [weight forced to 0 by --domain customer_service]' : ''),
    });
  }
  return { active, inactive };
}

// ---------------------------------------------------------------------------
// Caveats (SPEC G.3 — the base-rate line must appear on every non-abstain report)
// ---------------------------------------------------------------------------
const BASE_RATE_CAVEAT =
  'This score is not a probability. At 2% FPR and 60% recall, precision is 0.968 at a 50% '
  + 'prevalence, 0.612 at 5%, 0.380 at 2% and 0.233 at 1%. Measured on the private calibration '
  + 'corpus at its own operating points: precision 0.183 at a 1% prior — four of five flags wrong.';

function buildCaveats(ctx, verdict, tokenCount, provenance) {
  const c = [];
  if (verdict !== 'insufficient_text') c.push(BASE_RATE_CAVEAT);
  if (provenance === 'prior') {
    c.push('No calibration set exists for this language and length. Every weight is a prior guess '
      + 'and the tool refuses to score without --allow-uncalibrated.');
  }
  if (tokenCount < 150) {
    c.push(`${tokenCount} tokens: below the 150-token floor at which any published detector holds `
      + 'accuracy. Commercial detectors lose accuracy under 50 words; vendor floors are 250 '
      + 'characters and 300 words.');
  }
  if (ctx.lang === 'tr') {
    c.push('Turkish: the only labelled Turkish resource in existence is 1,000 GPT-4 hotel reviews '
      + 'and their human counterparts, and Turkish is the language where GPT-4 output was measured '
      + 'least detectable of ten. Nobody has measured the non-native-writer bias direction for '
      + 'Turkish.');
  }
  if (verdict === 'leaning_llm' || verdict === 'likely_llm') {
    c.push('Non-native and formal writers: seven commercial detectors flagged 61.22% of 91 TOEFL '
      + 'essays by non-native English writers, versus 5.19% for US eighth-graders. If this tool '
      + 'leans LLM about a careful non-native writer it is wrong in exactly the way it is known '
      + 'to be wrong.');
    c.push('Three humans: the human side of the calibration corpus is three people. In a '
      + 'leave-one-writer-out test the model flagged 86% of one real writer\'s messages. Any '
      + 'threshold here is valid for the writers it was fitted on and for nobody else.');
  }
  return c;
}

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------
/**
 * @param {string} text
 * @param {object} opts  shape, channel, lang, genre, domain, corpusIndex, markers,
 *                       allowUncalibrated, explain, now, id, sender, weights
 * @returns {object} report (SPEC C.3)
 */
export function detect(text, opts = {}) {
  if (WEIGHTS === null) throw new Error('detect(): configure() has not been called');
  const weights = opts.weights ?? WEIGHTS;
  const ctx = buildContext(text, opts);
  const warnings = [...ctx.segWarnings];
  const notes = [];

  const key = cellKey(ctx.lang, ctx.shape);
  // R36(c): a cell the file marks "not fitted" (or omits) falls back to the PRIOR cell rather
  // than crashing or scoring against an empty cell. The fallback is loud: the cell in use is
  // uncalibrated whatever the file's own provenance says.
  let cell = weights.cells[key];
  let cellSource = 'file';
  if (!isUsableCell(cell)) {
    if (!isNotFittedCell(cell)) throw new Error(`weights file has a malformed cell "${key}"`);
    const priorCell = WEIGHTS?.cells?.[key];
    if (!isUsableCell(priorCell)) throw new Error(`weights file has no usable cell "${key}" and `
      + 'the shipped prior file has none either');
    cell = priorCell;
    cellSource = 'prior_fallback';
    warnings.push('cell_not_fitted_prior_used');
    warnings.push('uncalibrated_weights');
    notes.push(`cell_not_fitted_prior_used: the weights file marks "${key}" as not fitted, so the `
      + 'shipped PRIOR cell was used for this document. The file\'s provenance says "'
      + `${weights.provenance}", but the numbers behind this report are prior guesses.`);
  }
  const reduced = ctx.lang === 'mixed' || ctx.lang === 'unknown' || ctx.lang === 'unsupported';
  if (reduced && ctx.lang === 'mixed') warnings.push('mixed_language_reduced_features');

  const { active, inactive } = evaluate(ctx, FEATURES, cell, reduced);

  // Tier-0 rules. invisible_chars needs to know how many LLM-direction features are present.
  const llmFeatureCount = active.filter((s) => s.direction === 'llm' && s.contributionRaw > 0).length;
  const ruleOut = runRules(ctx, llmFeatureCount);
  warnings.push(...ruleOut.warnings);
  notes.push(...ruleOut.notes);
  if (ctx.lexSuppressed.length) {
    warnings.push('domain_suppressed');
    notes.push(`domain_suppressed: ${ctx.lexSuppressed.length} customer-service lexicon rows `
      + 'zeroed by --domain customer_service');
  }
  if (ctx.homoglyphs.count > 0) {
    warnings.push('homoglyph_suspect');
    notes.push(`homoglyph_suspect: ${ctx.homoglyphs.count} word token(s) mix scripts or carry `
      + 'Halfwidth/Fullwidth or Mathematical-Alphanumeric code points '
      + `(e.g. ${ctx.homoglyphs.examples.map((e) => JSON.stringify(e)).join(', ')}). `
      + 'Rules and the lexicon were also run on a confusable-folded copy (R30). Detection power '
      + 'against a deliberate adversary is zero; this is a warning, not a defence.');
  }
  if (ctx.langInfo.notes?.length) for (const n of ctx.langInfo.notes) notes.push(`language: ${n}`);
  // SPEC B.7 residue: measurements the spec kept as NOTES and refused as evidence.
  notes.push(...diagnosticNotes(ctx));

  // --- gates (SPEC D.2) ---------------------------------------------------
  const mins = gateMins(ctx.shape, opts.mode);
  const passed = [];
  let failed = null;
  let reason = null;

  // R22 hoist: an unsupported script is refused BEFORE the length gates, so a long Arabic text
  // fails on the language gate and not on a char count.
  if (ctx.lang === 'unsupported') {
    failed = 'G3_lang'; reason = 'unsupported_language';
  } else {
    const checks = [
      ['G1_chars', ctx.charCount >= mins.chars, 'below_char_floor'],
      ['G2_tokens', ctx.tokenCount >= mins.tokens, 'below_token_floor'],
      ['G3_lang', ctx.lang !== 'unknown', 'language_unknown'],
      ['G4_features', active.length >= mins.activeFeatures, 'too_few_active_features'],
      ['G5_confidence', active.some((s) => s.confidence === 'HIGH' || s.confidence === 'MED'),
        'no_high_or_med_confidence_feature'],
    ];
    for (const [name, ok, why] of checks) {
      if (ok) passed.push(name);
      else { failed = name; reason = why; break; }
    }
  }

  // --- arithmetic ---------------------------------------------------------
  const rawLogit = active.reduce((s, f) => s + f.contributionRaw, cell.b0);
  const band = capBand(ctx.tokenCount);
  const lambda = capLambda(rawLogit, band.cap);
  for (const s of active) s.contribution = s.contributionRaw * lambda;
  const b0Effective = cell.b0 * lambda;
  const cappedLogit = rawLogit * lambda;
  const score = sigmoid(cappedLogit);
  const K = Number.isFinite(weights.K) ? weights.K : K_CHANNEL;
  const ch = channels(active, K);

  // --- verdict ------------------------------------------------------------
  const decision = decideVerdict({
    signals: active, rules: ruleOut.rules, channelsValue: ch, band,
    mode: opts.mode ?? 'single', gateFailure: failed, provenance: weights.provenance,
  });
  warnings.push(...decision.warnings);
  notes.push(...decision.notes);
  if (!failed && decision.abstainReason) reason = decision.abstainReason;

  let verdict = decision.verdict;

  // SPEC H item 6 / D1 fixture A12: a MARKETING-register human is the worst confounder class in
  // the catalogue — humans copied emoji-headed sections and bulleted tip lists FROM models — and
  // the design's stated response is `warning:'marketing_register'` and abstention. Caller-declared
  // only (no auto-detection this round; cf. HEAD-RULINGS R6 for --domain).
  if (ctx.genre === 'marketing') {
    warnings.push('marketing_register');
    if ((verdict === 'leaning_llm' || verdict === 'likely_llm')
      && !ruleOut.rules.some((r) => r.direction === 'llm')) {
      verdict = 'uncertain';
      notes.push('marketing_register: format carries no authorship information in this genre, so '
        + 'a style-only LLM lean is withdrawn to uncertain (SPEC H.6, D1 fixture A12)');
    }
  }

  const guard = shipTimeGuard(verdict, {
    provenance: weights.provenance, expiresAt: weights.expiresAt, now: opts.now,
    hasRule: ruleOut.rules.some((r) => r.direction === 'llm'), mode: opts.mode ?? 'single',
  });
  verdict = guard.verdict;
  warnings.push(...guard.warnings);

  const scored = verdict !== 'insufficient_text';
  if (scored) {
    const scoreSaysLlm = score > 0.7, scoreSaysHuman = score < 0.3;
    if ((scoreSaysLlm && (verdict === 'leaning_human' || verdict === 'likely_human'))
      || (scoreSaysHuman && (verdict === 'leaning_llm' || verdict === 'likely_llm'))) {
      warnings.push('score_table_disagreement');
    }
  }

  const signals = active.slice().sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const shown = opts.explain ? signals.concat(inactive.slice().sort((a, b) => (a.name < b.name ? -1 : 1))) : signals;

  const bytes = utf8Bytes(text).length;
  const report = {
    version: {
      detector: DETECTOR_VERSION,
      lexicon: LEXICON?.version ?? 'unknown',
      weights: weights.weightsId ?? 'unknown',
      provenance: weights.provenance,
      expiresAt: weights.expiresAt,
    },
    input: { chars: ctx.charCount, bytes, sha256: sha256Hex(text) },
    language: {
      primary: ctx.lang,
      confidence: Number(ctx.langInfo.confidence.toFixed(3)),
      mixed: Boolean(ctx.langInfo.mixed),
      shares: {
        latin: Number(ctx.langInfo.shares.latin.toFixed(3)),
        arabic: Number(ctx.langInfo.shares.arabic.toFixed(3)),
        other: Number(ctx.langInfo.shares.other.toFixed(3)),
      },
    },
    shape: ctx.shape,
    channel: ctx.channel,
    genre: ctx.genre,
    domain: ctx.domain,
    counts: {
      chars: ctx.charCount, tokens: ctx.tokenCount, sentences: ctx.sentences.length,
      paragraphs: ctx.paragraphs.length, lines: ctx.linesAll.length,
    },
    verdict,
    // R26: 12 decimals, so acceptance check 7 (sum(contribution) + b0Effective == logit(score)
    // within 1e-9) holds from the JSON alone. 6-decimal rounding put it at 1.3e-6.
    score: scored ? Number(score.toFixed(12)) : null,
    channels: { human: Number(ch.human.toFixed(12)), llm: Number(ch.llm.toFixed(12)) },
    scoring: {
      cell: key,
      b0: cell.b0,
      b0Effective: Number(b0Effective.toFixed(12)),
      lambda: Number(lambda.toFixed(12)),
      logit: Number(cappedLogit.toFixed(12)),
      logitUncapped: Number(rawLogit.toFixed(12)),
      scoreUncapped: Number(sigmoid(rawLogit).toFixed(12)),
      K,
      cellSource,
    },
    rules: ruleOut.rules.map((r) => ({
      name: r.name, matched: r.matched, direction: r.direction, precision: r.precision, note: r.note,
    })),
    signals: shown.map((s) => ({
      name: s.name, value: s.value === null ? null : Number(Number(s.value).toFixed(6)),
      matched: s.matched ?? null, direction: s.direction, group: s.group, scope: s.scope,
      weight: s.weight, z: s.z === undefined ? null : Number(s.z.toFixed(6)),
      contribution: Number(s.contribution.toFixed(12)),
      contributionRaw: Number(s.contributionRaw.toFixed(12)),
      confidence: s.confidence, provenance: s.provenance, note: s.note,
      ...(s.reason ? { inactiveReason: s.reason } : {}),
    })),
    diagnostics: lexicalDiversity(ctx),   // SPEC B.7: display only, NEVER in the sum
    gates: { passed, failed: failed ? [failed] : [], ...(reason ? { reason } : {}) },
    caps: {
      band: band.band, maxDeviation: band.cap, applied: lambda < 1,
      ceiling: band.ceiling,
      bypassedByRule: decision.bypassedGates === true,
    },
    warnings: [...new Set(warnings)],
    notes,
    caveats: buildCaveats(ctx, verdict, ctx.tokenCount, weights.provenance),
  };

  if (opts.id != null) report.id = opts.id;
  if (opts.mode === 'aggregate') report.mode = 'aggregate';
  return report;
}

// ---------------------------------------------------------------------------
// Batch + aggregate
// ---------------------------------------------------------------------------
export function detectBatch(rows, opts = {}) {
  return rows.map((r) => {
    // D-08: a non-string `text` used to surface an internal error ("text is not iterable").
    if (r.text !== undefined && r.text !== null && typeof r.text !== 'string') {
      return { id: r.id ?? null, error: 'row.text must be a string' };
    }
    try {
      return detect(r.text ?? '', {
        ...opts, id: r.id, sender: r.sender,
        lang: r.lang ?? opts.lang, shape: r.context ?? opts.shape,
      });
    } catch (e) {
      return { id: r.id, error: String(e && e.message ? e.message : e) };
    }
  });
}

const AGG_SENTINEL = '\n\n';

/**
 * aggregate(messages, opts) — SPEC C.4 / B.6. Senders with <5 messages emit insufficient_text
 * with reason "aggregate_floor". Per-message verdicts are inputs, never surfaced as likely_*.
 */
export function aggregate(messages, opts = {}) {
  const perMessage = messages.map((m) => {
    const r = detect(m.text ?? '', { ...opts, id: m.id, sender: m.sender, mode: 'single' });
    return { id: m.id ?? null, verdict: r.verdict, score: r.score };
  });

  if (messages.length < 5) {
    // Schema-complete so that every consumer (and --pretty) sees the same shape as any other
    // report; only `verdict` and the aggregate gate differ.
    const joinedShort = messages.map((m) => m.text ?? '').join(AGG_SENTINEL);
    return {
      version: {
        detector: DETECTOR_VERSION, lexicon: LEXICON?.version ?? 'unknown',
        weights: (opts.weights ?? WEIGHTS).weightsId ?? 'unknown',
        provenance: (opts.weights ?? WEIGHTS).provenance,
        expiresAt: (opts.weights ?? WEIGHTS).expiresAt,
      },
      mode: 'aggregate', sender: opts.sender ?? messages[0]?.sender ?? null,
      messageCount: messages.length,
      input: { chars: [...joinedShort].length, bytes: utf8Bytes(joinedShort).length, sha256: sha256Hex(joinedShort) },
      language: { primary: 'unknown', confidence: 0, mixed: false, shares: { latin: 0, arabic: 0, other: 0 } },
      shape: 'prose', channel: opts.channel ?? 'unknown', genre: opts.genre ?? 'auto',
      domain: opts.domain ?? 'general',
      counts: { chars: [...joinedShort].length, tokens: words(joinedShort.normalize('NFC')).length,
        sentences: 0, paragraphs: 0, lines: 0 },
      verdict: 'insufficient_text', score: null,
      channels: { human: 0, llm: 0 },
      scoring: null,
      rules: [], signals: [],
      gates: { passed: [], failed: ['G_aggregate'], reason: 'aggregate_floor' },
      caps: { band: 'aggregate_floor', maxDeviation: null, applied: false, ceiling: 'insufficient_text', bypassedByRule: false },
      warnings: [], notes: [],
      perMessage,
      caveats: ['Fewer than 5 messages from this sender. Per-message chat verdicts are inputs to '
        + 'an aggregate, never a verdict on their own (SPEC B.6).'],
    };
  }

  const joined = messages.map((m) => m.text ?? '').join(AGG_SENTINEL);
  const base = detect(joined, { ...opts, mode: 'aggregate', shape: 'prose' });

  // Aggregate-only features run over the message list, then merge into the same accumulators.
  const weights = opts.weights ?? WEIGHTS;
  const cell = isUsableCell(weights.cells[base.scoring.cell])
    ? weights.cells[base.scoring.cell]
    : WEIGHTS.cells[base.scoring.cell];
  const lexPhrases = new Set((LEXICON?.rows ?? []).map((r) => r.phrase));
  const agg = prepareAggregate(messages, base.language.primary, lexPhrases);
  const { active, inactive } = evaluate(agg, AGG_FEATURES, cell, false);

  const merged = base.signals
    .filter((s) => s.value !== null)
    .map((s) => ({ ...s, id: s.name, contributionRaw: s.contributionRaw, z: s.z }))
    .concat(active);

  const rawLogit = merged.reduce((s, f) => s + f.contributionRaw, cell.b0);
  const band = capBand(base.counts.tokens);
  const lambda = capLambda(rawLogit, band.cap);
  for (const s of merged) s.contribution = s.contributionRaw * lambda;
  const score = sigmoid(rawLogit * lambda);
  const ch = channels(merged, Number.isFinite(weights.K) ? weights.K : K_CHANNEL);

  const rules = base.rules;
  const decision = decideVerdict({
    signals: merged, rules, channelsValue: ch, band, mode: 'aggregate',
    gateFailure: base.gates.failed[0] ?? null, provenance: weights.provenance,
  });
  const guard = shipTimeGuard(decision.verdict, {
    provenance: weights.provenance, expiresAt: weights.expiresAt, now: opts.now,
    hasRule: rules.some((r) => r.direction === 'llm'), mode: 'aggregate',
  });
  // Same contract in aggregate mode: an insufficient_text with no failed gate names its reason.
  const aggGates = base.gates.failed.length || !decision.abstainReason
    ? base.gates
    : { ...base.gates, reason: decision.abstainReason };

  const signals = merged.slice().sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)
    || (a.name < b.name ? -1 : 1));

  // R38(e): the per-document pass over the concatenation is an INPUT. Its verdict is discarded,
  // so its decision-derived warnings and notes must not survive into the aggregate report; only
  // its rule, language, gate and diagnostic output does. Notes are de-duplicated like warnings.
  const aggWarnings = [...new Set([
    ...base.warnings.filter((w) => !DECISION_WARNINGS.has(w)),
    ...decision.warnings, ...guard.warnings,
  ])];
  const aggNotes = [...new Set([
    ...base.notes.filter((n) => !isDecisionNote(n)),
    ...decision.notes,
  ])];
  // score_table_disagreement is recomputed against the AGGREGATE score, not the discarded one.
  if (guard.verdict !== 'insufficient_text') {
    const hi = score > 0.7, lo = score < 0.3;
    if ((hi && (guard.verdict === 'leaning_human' || guard.verdict === 'likely_human'))
      || (lo && (guard.verdict === 'leaning_llm' || guard.verdict === 'likely_llm'))) {
      aggWarnings.push('score_table_disagreement');
    }
  }

  return {
    ...base,
    gates: aggGates,
    mode: 'aggregate',
    sender: opts.sender ?? messages[0]?.sender ?? null,
    messageCount: messages.length,
    verdict: guard.verdict,
    score: guard.verdict === 'insufficient_text' ? null : Number(score.toFixed(12)),
    channels: { human: Number(ch.human.toFixed(12)), llm: Number(ch.llm.toFixed(12)) },
    scoring: {
      ...base.scoring,
      b0Effective: Number((cell.b0 * lambda).toFixed(12)),
      lambda: Number(lambda.toFixed(12)),
      logit: Number((rawLogit * lambda).toFixed(12)),
      logitUncapped: Number(rawLogit.toFixed(12)),
      scoreUncapped: Number(sigmoid(rawLogit).toFixed(12)),
    },
    signals: (opts.explain ? signals.concat(inactive) : signals).map((s) => ({
      name: s.name, value: s.value === null ? null : Number(Number(s.value).toFixed(6)),
      matched: s.matched ?? null, direction: s.direction, group: s.group, scope: s.scope,
      weight: s.weight, z: s.z === undefined || s.z === null ? null : Number(Number(s.z).toFixed(6)),
      contribution: Number(s.contribution.toFixed(12)),
      contributionRaw: Number(s.contributionRaw.toFixed(12)),
      confidence: s.confidence, provenance: s.provenance, note: s.note,
    })),
    warnings: aggWarnings,
    notes: aggNotes,
    perMessage,
    caveats: base.caveats.concat(
      'Aggregate mode: R1 §7b is the only evidence-backed short-text lever (concatenating 10 '
      + 'tweets moved accuracy 80% -> ~100%). It does not repair the per-message floor; it '
      + 'replaces it with a per-sender one.',
    ),
  };
}

export { buildCorpusIndex } from './rules.mjs';
// exported for selftest.mjs goldens only; not part of the public API
export { buildContext as _buildContext };
export { logit };
