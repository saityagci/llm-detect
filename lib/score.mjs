// lib/score.mjs — SPEC D. Gates, caps, two independent channels, the 2-D verdict table,
// the >=2-features-from->=2-groups invariant, rule-gated likely_llm, aggregate-gated
// likely_human, and the ship-time guard.
//
// The two things this file exists to prevent:
//   1. reading the ABSENCE of human markers as evidence FOR a machine (that is the inference
//      that convicts an L2 writer) — hence two saturating accumulators, not one axis;
//   2. a single feature carrying a verdict — hence >=2 features from >=2 groups.

export const K_CHANNEL = 2.0;

export const VERDICTS = ['insufficient_text', 'likely_human', 'leaning_human', 'uncertain',
  'leaning_llm', 'likely_llm'];

// Ladder used by demoteOneStep / capToward; index 0 is the human end.
const LADDER = ['likely_human', 'leaning_human', 'uncertain', 'leaning_llm', 'likely_llm'];

// SPEC D.3 §: expensive to fake. arabizi is not in this build (R22).
export const EXPENSIVE_TO_FAKE = new Set(['self_correction_marker', 'idiolect_stability', 'letter_elongation']);

/**
 * HEAD-RULINGS R24 — REGISTER PROXIES.
 * These LLM-direction features are what a formal, careful or non-native HUMAN produces for free,
 * measured against mu/sigma guessed from three telegraphic WhatsApp writers. They may contribute
 * to the score and to the LLM channel (they still rank a queue) but they never carry a verdict on
 * their own: `leaning_llm` needs >=2 LLM-direction signals with contribution > 0 from OUTSIDE this
 * set, from >=2 groups. The refuter reproduced the failure on 9 of 35 authored human texts.
 */
export const REGISTER_PROXY_LLM = new Set([
  'terminal_punct_ratio', 'sentence_initial_caps', 'em_dash_in_chat', 'exclam_single_regular',
  'emoji_bullet_led', 'politeness_formula', 'greeting_signoff_frame', 'tr_formal_copula',
  'out_of_channel_register', 'llm_lexicon_weak',
  // R38(f): SPEC calls colon_led_list weak (w 0.25) and humans write labelled lists all day;
  // it fired on 10 of the refuter's 18 human-register texts and, with the plain bullet branch
  // moved into it from bold_lead_in_list, it is a register proxy like the rest of this set.
  'colon_led_list',
]);

/**
 * HEAD-RULINGS R29 — features that do NOT run in aggregate mode. The concatenation of a sender's
 * turns is an artefact: its "paragraphs" are messages, and its length is the number of turns.
 */
export const AGGREGATE_DISABLED = new Set(['out_of_channel_register', 'paragraph_uniformity']);

/**
 * HEAD-RULINGS R43 — MATERIALITY FLOOR.
 * A careful student's 299-token essay reached `leaning_llm` with an LLM channel carried by the
 * proxy `terminal_punct_ratio` (+0.600 of +0.921); the second non-proxy signal that satisfied
 * R24's "two from two groups" contributed +0.030. A sliver let a keyboard proxy convict. A
 * non-proxy signal counts toward that requirement only when its contribution reaches this floor;
 * one below it is named in the note instead. Score, channels, rules, the human side, G4 and the
 * table are all untouched — this changes ONLY which signals may satisfy R24.
 */
export const MATERIALITY_FLOOR = 0.10;

/**
 * R38(e): warnings and notes that decideVerdict / the score table produce. In aggregate mode the
 * per-document pass is an INPUT whose verdict is thrown away, so its decision output must not
 * survive into the aggregate report: `register_only_evidence` on a discarded per-document verdict
 * told the reader the aggregate lean was register-only when it was not.
 */
export const DECISION_WARNINGS = new Set([
  'contradictory_evidence', 'register_only_evidence', 'hybrid_suspect', 'score_table_disagreement',
]);
export const DECISION_NOTE_PREFIXES = [
  'single_feature_guard:', 'register_only_evidence', 'G6:', 'R28:', 'no_evidence_either_way',
  'near_duplicate alone', 'language_gate_not_bypassable', 'marketing_register:',
];
export function isDecisionNote(n) {
  return DECISION_NOTE_PREFIXES.some((p) => String(n).startsWith(p));
}

// ---------------------------------------------------------------------------
// HEAD-RULINGS R36(c) — weights-file shape contract.
// `--weights eval/out/weights.fitted.json` died with an uncaught
// `TypeError: Cannot read properties of undefined (reading 'sentence_len_cv')` because the fitted
// file carried no per-feature `kind` map and no top-level `K`, and the CLI validator only checked
// { provenance, cells, expiresAt }. Every field the core DEREFERENCES is required here, once, and
// the failure names the file, the cell and the field. R23's opt-in path is only real if the file
// can actually be loaded.
// ---------------------------------------------------------------------------
export const CANONICAL_CELLS = ['en:chat', 'en:prose', 'tr:chat', 'tr:prose'];
export const VALID_KINDS = new Set(['continuous', 'rate', 'binary']);

/**
 * A cell is USABLE when every accessor in detect()'s evaluate() has something to read.
 * A cell that is absent, or that carries only a `status` marker ("not fitted — too few rows
 * survived the gates"), is not usable — the caller falls back to the prior cell (R36c).
 */
export function isUsableCell(c) {
  return Boolean(c) && typeof c === 'object'
    && Number.isFinite(c.b0)
    && c.w && typeof c.w === 'object'
    && c.mu && typeof c.mu === 'object'
    && c.sigma && typeof c.sigma === 'object'
    && c.kind && typeof c.kind === 'object';
}

/** True for a cell the file deliberately marks as not fitted (any shape FIX-B2 emits). */
export function isNotFittedCell(c) {
  return c === undefined || c === null
    || (typeof c === 'object' && !c.w && typeof c.status === 'string');
}

/**
 * validateWeightsShape(weights, where) — throws an Error naming the file, cell and field.
 * The CLI turns the throw into exit 4; the library path gets a readable Error instead of a
 * TypeError from three frames deeper.
 */
export function validateWeightsShape(weights, where = 'weights file') {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const done = () => {
    if (problems.length === 0) return weights;
    const shown = problems.slice(0, 8);
    const more = problems.length - shown.length;
    throw new Error(`weights file schema mismatch in ${where}: ${shown.join('; ')}`
      + (more > 0 ? `; and ${more} more` : ''));
  };
  if (!weights || typeof weights !== 'object') { bad('not an object'); return done(); }

  for (const [field, ok] of [
    ['provenance', typeof weights.provenance === 'string' && weights.provenance !== ''],
    ['weightsId', typeof weights.weightsId === 'string' && weights.weightsId !== ''],
    ['generatedAt', typeof weights.generatedAt === 'string' && weights.generatedAt !== ''],
    ['expiresAt', typeof weights.expiresAt === 'string' && !Number.isNaN(Date.parse(weights.expiresAt))],
    ['K', Number.isFinite(weights.K) && weights.K > 0],
    ['cells', Boolean(weights.cells) && typeof weights.cells === 'object'],
  ]) {
    if (!ok) bad(`missing or invalid top-level field "${field}"`);
  }
  if (weights.provenance !== undefined
    && weights.provenance !== 'prior' && weights.provenance !== 'fitted') {
    bad(`top-level field "provenance" must be "prior" or "fitted", got ${JSON.stringify(weights.provenance)}`);
  }
  if (!weights.cells || typeof weights.cells !== 'object') return done();

  let usable = 0;
  for (const key of Object.keys(weights.cells)) {
    const c = weights.cells[key];
    if (isNotFittedCell(c)) continue;                    // declared not fitted: the caller falls back
    let cellBroken = false;
    for (const [field, ok] of [
      ['b0', Number.isFinite(c && c.b0)],
      ['w', Boolean(c && c.w) && typeof c.w === 'object'],
      ['mu', Boolean(c && c.mu) && typeof c.mu === 'object'],
      ['sigma', Boolean(c && c.sigma) && typeof c.sigma === 'object'],
      ['kind', Boolean(c && c.kind) && typeof c.kind === 'object'],
    ]) {
      if (!ok) { bad(`cell "${key}" is missing or has an invalid field "${field}"`); cellBroken = true; }
    }
    if (cellBroken) continue;
    let reported = 0;
    for (const f of Object.keys(c.w)) {
      if (reported >= 2) break;                          // two examples per cell is enough to fix it
      if (!Number.isFinite(c.w[f])) { bad(`cell "${key}", feature "${f}": w is not a finite number`); reported++; continue; }
      const kind = c.kind[f];
      if (!VALID_KINDS.has(kind)) {
        bad(`cell "${key}", feature "${f}": missing or invalid field "kind" `
          + `(need one of ${[...VALID_KINDS].join('|')}, got ${JSON.stringify(kind)})`);
        reported++; continue;
      }
      // mu/sigma are only dereferenced for non-binary transforms (transform() returns before
      // touching them for `binary`), so the prior file legitimately omits them there.
      if (kind === 'binary') continue;
      if (!Number.isFinite(c.mu[f])) { bad(`cell "${key}", feature "${f}": missing field "mu" (kind ${kind})`); reported++; continue; }
      if (!Number.isFinite(c.sigma[f]) || c.sigma[f] === 0) {
        bad(`cell "${key}", feature "${f}": missing or zero field "sigma" (kind ${kind})`);
        reported++;
      }
    }
    if (reported === 0) usable++;
  }
  if (usable === 0) bad('no usable cell — every cell is absent, marked not fitted, or malformed');
  return done();
}

export function clip(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
export function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
export function logit(p) { return Math.log(p / (1 - p)); }

/**
 * transform_i (SPEC D.1):
 *   continuous -> clip((x - mu)/sigma, -3, +3)
 *   rate       -> same, after log1p (heavy-tailed)
 *   binary     -> 0 or 1
 * mu/sigma come from the HUMAN side of the training split, so z = 0 means "typical human",
 * not "typical text". In weights.v1.json they are PRIOR GUESSES (provenance: "prior").
 */
export function transform(kind, x, mu, sigma) {
  if (kind === 'binary') return x ? 1 : 0;
  const v = kind === 'rate' ? Math.log1p(Math.max(0, x)) : x;
  const s = sigma && sigma !== 0 ? sigma : 1;
  return clip((v - (mu ?? 0)) / s, -3, 3);
}

// ---------------------------------------------------------------------------
// Gates (SPEC D.2)
// ---------------------------------------------------------------------------
export const GATE_MINS = {
  chat: { chars: 100, tokens: 20, activeFeatures: 3 },
  prose: { chars: 250, tokens: 50, activeFeatures: 6 },
};

/**
 * R29: aggregate gates are the 5-message floor (enforced in aggregate()) plus the CHAT floors on
 * the concatenation, not the prose floors — six typical WhatsApp turns (~190 chars) must produce
 * a report, not `below_char_floor`.
 */
export function gateMins(shape, mode) {
  return mode === 'aggregate' ? GATE_MINS.chat : GATE_MINS[shape];
}

export const CAP_BANDS = [
  { max: 19, band: '<20_tokens', cap: null, ceiling: 'insufficient_text' },
  { max: 49, band: '20-49_tokens', cap: 0.15, ceiling: 'leaning' },
  { max: 149, band: '50-149_tokens', cap: 0.30, ceiling: 'leaning' },
  { max: 499, band: '150-499_tokens', cap: 0.45, ceiling: 'likely' },
  { max: Infinity, band: '500+_tokens', cap: 0.50, ceiling: 'likely' },
];

export function capBand(tokenCount) {
  return CAP_BANDS.find((b) => tokenCount <= b.max);
}

/**
 * The lambda that enforces |score - 0.5| <= cap while KEEPING SPEC C.3 invariant 3 literally
 * true: |score-0.5| <= c is exactly |logit| <= log((0.5+c)/(0.5-c)), which is symmetric about 0,
 * so scaling every contribution AND the intercept by one factor lands the score exactly on the
 * cap. The uncapped contributions are still reported as `contributionRaw`.
 */
export function capLambda(rawLogit, cap) {
  if (cap === null || cap >= 0.5) return 1;
  const limit = Math.log((0.5 + cap) / (0.5 - cap));
  const mag = Math.abs(rawLogit);
  if (mag <= limit || mag === 0) return 1;
  return limit / mag;
}

// ---------------------------------------------------------------------------
// Two channels + the 2-D table (SPEC D.3)
// ---------------------------------------------------------------------------
export function channels(signals, K = K_CHANNEL) {
  let llm = 0, human = 0;
  for (const s of signals) {
    const magnitude = Math.max(0, s.weight * s.z);      // positive z = evidence in s.direction
    if (s.direction === 'llm') llm += magnitude;
    else if (s.direction === 'human') human += magnitude;
  }
  return { llm: 1 - Math.exp(-llm / K), human: 1 - Math.exp(-human / K) };
}

/** SPEC D.3 table. Returns { verdict, warnings }. likely_* is NOT reachable from here. */
export function tableVerdict(llm, human) {
  const warnings = [];
  const lo = (x) => x < 0.25, mid = (x) => x >= 0.25 && x <= 0.6, hi = (x) => x > 0.6;
  let verdict;
  if (hi(llm)) {
    if (lo(human)) verdict = 'leaning_llm';
    else if (mid(human)) verdict = 'uncertain';
    else { verdict = 'uncertain'; warnings.push('contradictory_evidence'); }
  } else if (mid(llm)) {
    if (lo(human)) verdict = 'leaning_llm';
    else if (mid(human)) verdict = 'uncertain';
    else verdict = 'leaning_human';
  } else {
    // The bottom-left cell is the design's core commitment: no evidence either way => abstain,
    // never "probably AI".
    if (lo(human)) verdict = 'insufficient_text';
    else verdict = 'leaning_human';
  }
  return { verdict, warnings };
}

export function demoteOneStep(v) {
  const i = LADDER.indexOf(v);
  if (i < 0) return v;
  const target = LADDER.indexOf('uncertain');
  if (i === target) return v;
  return LADDER[i < target ? i + 1 : i - 1];
}

/** Cap a verdict so it travels no further from `uncertain` than `ceiling` allows. */
export function capToCeiling(v, ceiling) {
  if (ceiling === 'likely') return v;
  if (ceiling === 'leaning') {
    if (v === 'likely_llm') return 'leaning_llm';
    if (v === 'likely_human') return 'leaning_human';
    return v;
  }
  return v;
}

function strength(v) { return Math.abs(LADDER.indexOf(v) - LADDER.indexOf('uncertain')); }

/** Capped contribution when the caller has already applied lambda, raw otherwise. */
function contributionOf(s) {
  return Number.isFinite(s.contribution) ? s.contribution : s.contributionRaw;
}

/** Take the stronger of two verdicts on the same side; never cross the middle. */
function atLeast(current, floorVerdict) {
  const ci = LADDER.indexOf(current), fi = LADDER.indexOf(floorVerdict);
  if (ci < 0 || fi < 0) return floorVerdict;
  const mid = LADDER.indexOf('uncertain');
  const sameSide = (ci - mid) * (fi - mid) > 0;
  if (!sameSide) return floorVerdict;
  return strength(current) >= strength(floorVerdict) ? current : floorVerdict;
}

// ---------------------------------------------------------------------------
// The verdict pipeline
// ---------------------------------------------------------------------------

/**
 * decideVerdict — everything after the arithmetic.
 *
 * @param {object} p
 *   p.signals        active signals (each {id, group, direction, weight, z, contributionRaw, confidence})
 *   p.rules          Tier-0 rules that fired
 *   p.channelsValue  {llm, human}
 *   p.band           cap band record
 *   p.mode           'single' | 'aggregate'
 *   p.gateFailure    the first failed hard gate, or null
 *   p.provenance     'prior' | 'fitted'
 */
export function decideVerdict(p) {
  const warnings = [];
  const notes = [];

  const llmRules = p.rules.filter((r) => r.direction === 'llm');
  const fingerprints = llmRules.filter((r) => r.precision === 'high' && r.name !== 'near_duplicate');
  const bypassesGates = fingerprints.length > 0;

  // --- hard gates ---------------------------------------------------------
  // R22 beats SPEC D.2's rule bypass, and post-dates it: an unsupported (or unidentifiable)
  // script is NEVER scored, whatever a Tier-0 rule matched. The match still appears in rules[];
  // the verdict may not use it. Reviewer D-06 reproduced `likely_llm` with a numeric score on a
  // document 94% Arabic by letter, scored in the en:prose cell.
  const languageGate = p.gateFailure === 'G3_lang';
  if (p.gateFailure && (!bypassesGates || languageGate)) {
    if (languageGate && bypassesGates) {
      notes.push('language_gate_not_bypassable: a Tier-0 rule matched, but the document is not in '
        + 'a supported language (HEAD-RULINGS R22: English and Turkish only). The match is '
        + 'reported in rules[] and is NOT used for the verdict.');
    }
    return { verdict: 'insufficient_text', warnings, notes, scored: false, bypassedGates: false };
  }

  // --- 2-D table ----------------------------------------------------------
  const t = tableVerdict(p.channelsValue.llm, p.channelsValue.human);
  let verdict = t.verdict;
  warnings.push(...t.warnings);

  // --- no single feature carries a verdict (SPEC D.3, additional invariant) -
  const firing = p.signals.filter((s) => Math.abs(s.contributionRaw) > 1e-12);
  const side = verdict === 'leaning_llm' || verdict === 'likely_llm' ? 'llm'
    : verdict === 'leaning_human' || verdict === 'likely_human' ? 'human' : null;
  if (side) {
    const same = firing.filter((s) => s.direction === side && s.weight * s.z > 0);
    const groups = new Set(same.map((s) => s.group));
    if (!(same.length >= 2 && groups.size >= 2)) {
      verdict = 'uncertain';
      notes.push(`single_feature_guard: ${same.length} ${side}-direction feature(s) from `
        + `${groups.size} group(s) — a verdict needs >=2 features from >=2 groups (SPEC D.3)`);
    }
  }

  // --- R24 register-proxy cap (after the table, BEFORE rule promotion) -------
  let r24Applied = false;
  if (verdict === 'leaning_llm') {
    const llmFiring = firing.filter((s) => s.direction === 'llm' && contributionOf(s) > 0);
    const proxies = llmFiring.filter((s) => REGISTER_PROXY_LLM.has(s.id ?? s.name));
    const nonProxyAll = llmFiring.filter((s) => !REGISTER_PROXY_LLM.has(s.id ?? s.name));
    // R43: only a MATERIAL non-proxy signal can satisfy the requirement.
    const nonProxy = nonProxyAll.filter((s) => contributionOf(s) >= MATERIALITY_FLOOR);
    const immaterial = nonProxyAll.filter((s) => contributionOf(s) < MATERIALITY_FLOOR);
    const nonProxyGroups = new Set(nonProxy.map((s) => s.group));
    if (!(nonProxy.length >= 2 && nonProxyGroups.size >= 2)) {
      verdict = 'uncertain';
      r24Applied = true;
      warnings.push('register_only_evidence');
      notes.push('register_only_evidence (HEAD-RULINGS R24): the LLM-direction evidence is '
        + `register proxies — ${proxies.map((s) => s.id ?? s.name).sort().join(', ') || '(none)'} — `
        + `plus ${nonProxy.length} non-proxy signal(s) from ${nonProxyGroups.size} group(s). `
        + (immaterial.length
          ? `${immaterial.map((s) => `${s.id ?? s.name} (+${contributionOf(s).toFixed(3)})`).sort().join(', ')} `
            + `${immaterial.length === 1 ? 'is' : 'are'} below the ${MATERIALITY_FLOOR.toFixed(2)} `
            + 'materiality floor (HEAD-RULINGS R43) and cannot carry the requirement. '
          : '')
        + 'A formal, careful or non-native HUMAN produces these for free, so they may rank a queue '
        + 'but they may not carry a verdict. leaning_llm needs >=2 non-proxy LLM signals from '
        + '>=2 groups, or a Tier-0 rule.');
    }
  }

  // --- G6 hybrid-suspect ---------------------------------------------------
  const strongHuman = firing.filter((s) => s.direction === 'human' && s.confidence === 'HIGH'
    && s.weight * s.z > 0);
  if (p.channelsValue.llm > 0.6 && strongHuman.length >= 2) {
    verdict = 'uncertain';
    warnings.push('hybrid_suspect');
    notes.push('G6: high LLM channel beside >=2 strong human markers — the most likely '
      + 'explanation is a post-edited hybrid or a person quoting a model. Do not pick a side.');
  }

  // --- R28: a known_machine_marker inside a HUMAN-written message is a hybrid ---------------
  // A marker match proves a machine-written SEGMENT is present, not that the message is machine
  // written. Mirrors G6. Refuter D4: likely_llm on a human WhatsApp user writing around a
  // forwarded booking summary, human channel 0.602.
  const humanFiringAll = firing.filter((s) => s.direction === 'human' && s.weight * s.z > 0);
  const humanGroups = new Set(humanFiringAll.map((s) => s.group));
  const markerOnly = llmRules.length === 1 && llmRules[0].name === 'known_machine_marker';
  const humanSideStands = p.channelsValue.human > 0.6
    || (humanFiringAll.length >= 2 && humanGroups.size >= 2);

  // --- Tier-0 rules: the ONLY road to likely_llm (SPEC D.3) -----------------
  if (markerOnly && humanSideStands && !p.gateFailure) {
    verdict = 'uncertain';
    warnings.push('hybrid_suspect');
    notes.push('R28: machine-written segment inside a human-written message; the sender may be '
      + `forwarding it (human channel ${p.channelsValue.human.toFixed(3)}, `
      + `${humanFiringAll.length} human-direction signal(s) from ${humanGroups.size} group(s)). `
      + 'A marker proves the STRING is machine-written, never that the SENDER is a machine.');
  } else if (fingerprints.length >= 1) {
    verdict = 'likely_llm';
  } else if (llmRules.length >= 2) {
    verdict = 'likely_llm';                                    // R3: near_duplicate + a second rule
  } else if (llmRules.length === 1) {
    verdict = atLeast(verdict, 'leaning_llm');
    if (llmRules[0].name === 'near_duplicate') {
      notes.push(`near_duplicate alone proves the text was not independently authored, not that a `
        + `machine wrote it (${llmRules[0].matched})`);
    }
  }

  // --- R38(j): R24 caps the TABLE's style verdict only. If a Tier-0 rule then carried the
  // verdict back to the LLM side, the warning would be reporting a cap that no longer applies —
  // `likely_llm` beside "the LLM lean rests only on register proxies" is a contradiction on the
  // face of the report. The rule is the evidence; the warning and its note are dropped.
  if (r24Applied && (verdict === 'likely_llm' || verdict === 'leaning_llm')) {
    const wi = warnings.indexOf('register_only_evidence');
    if (wi >= 0) warnings.splice(wi, 1);
    const ni = notes.findIndex((n) => n.startsWith('register_only_evidence'));
    if (ni >= 0) notes.splice(ni, 1);
  }

  // --- likely_human: aggregate mode only (SPEC D.3 §) -----------------------
  if (verdict === 'leaning_human' && p.mode === 'aggregate' && llmRules.length === 0) {
    // R42(d): the history signal is a note on a verdict, never a verdict. It is excluded from
    // the likely_human count so it can never be the third feature that produces one.
    const humanFiring = firing.filter((s) => s.direction === 'human' && s.weight * s.z > 0
      && (s.id ?? s.name) !== 'history_consistency');
    const expensive = humanFiring.filter((s) => EXPENSIVE_TO_FAKE.has(s.id));
    if (humanFiring.length >= 3 && expensive.length >= 1) verdict = 'likely_human';
  }
  if (verdict === 'likely_human' && p.mode !== 'aggregate') verdict = 'leaning_human';

  // --- length-band ceiling; a high-precision fingerprint bypasses it --------
  if (!bypassesGates) verdict = capToCeiling(verdict, p.band.ceiling);

  // Every insufficient_text must say WHY. Reaching here with insufficient_text means every gate
  // passed and the SPEC D.3 bottom-left cell fired: both channels below 0.25, i.e. the design's
  // core commitment — no evidence either way, so abstain, never "probably AI". Without this the
  // report showed gates.passed = all five, gates.failed = [], and no reason at all.
  let abstainReason = null;
  if (verdict === 'insufficient_text') {
    abstainReason = 'no_evidence_either_way';
    notes.push('no_evidence_either_way: every gate passed, but both channels are below the 0.25 '
      + `evidence floor (llm ${p.channelsValue.llm.toFixed(3)}, human ${p.channelsValue.human.toFixed(3)}) `
      + '— SPEC D.3 bottom-left cell. The text was long enough to score and produced nothing to '
      + 'score with. That is an answer, not a failure.');
  }

  return { verdict, warnings, notes, scored: true, bypassedGates: bypassesGates, firing, abstainReason };
}

/**
 * Ship-time guard (SPEC D.4, HEAD-RULINGS R5: the clock comes from the caller).
 * The asymmetry is deliberate: a false likely_human costs one missed datapoint; a false
 * likely_llm is an accusation against a real person. The loss matrix is ~20:1.
 */
export function shipTimeGuard(verdict, { provenance, expiresAt, now, hasRule, mode }) {
  const warnings = [];
  let v = verdict;
  if (provenance === 'prior') {
    warnings.push('uncalibrated_weights');
    // capToward('uncertain', ..., {except:['likely_human']}): with prior weights a likely_* that
    // is NOT backed by a Tier-0 rule (llm) or by aggregate mode (human) may not stand.
    if (v === 'likely_llm' && !hasRule) v = 'uncertain';
    if (v === 'likely_human' && mode !== 'aggregate') v = 'leaning_human';
  }
  if (now !== undefined && expiresAt && now > Date.parse(expiresAt)) {
    warnings.push('weights_expired');
    v = demoteOneStep(v);
  }
  if (now === undefined) warnings.push('expiry_not_checked');
  return { verdict: v, warnings };
}
