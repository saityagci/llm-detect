// lib/history.mjs — HEAD-RULINGS R42(d). Per-author history is the strongest lever a school
// platform has, and it is the one thing this tool's own README already told callers to do:
// "calibrate per sender against that sender's own history".
//
// What it is: the new submission's feature vector compared with the SAME author's prior
// submissions, in the z space detect() already computes. What it is NOT: a verdict. History can
// move a lean toward `uncertain` / `leaning_human` and never toward LLM, it can never produce a
// `likely_*`, and a shift is a warning to a human reader — a student whose writing improved over
// a term shifts too, and that is not evidence of anything.
//
// Pure: no clock, no I/O, deterministic.

export const HISTORY_MIN_DOCS = 2;          // prior documents required
export const HISTORY_MIN_TOKENS = 150;      // ... each of at least this many tokens
export const HISTORY_MIN_COMPARED = 2;      // a feature must be present in >= 2 prior documents
/**
 * SD floor. The comparison runs on z, which is already (x - mu) / sigma for the cell, so an SD
 * floor of "the cell's sigma / 4" (R42d) is exactly 0.25 in this space. Without it two nearly
 * identical prior documents give an SD near zero and every ordinary variation reads as a shift.
 */
export const HISTORY_SD_FLOOR = 0.25;
export const HISTORY_SHIFT_SD = 2;          // beyond this many SD counts as shifted
export const HISTORY_MIN_SHIFTED = 3;       // ... on this many features before we say anything
export const HISTORY_WEIGHT = 0.35;
/**
 * The consistency signal is pinned at z = 1, so its magnitude is exactly HISTORY_WEIGHT. On its
 * own that is a human channel of 1 - exp(-0.35/2) = 0.161, below the table's first boundary at
 * 0.25: history alone can never move the verdict a whole band, which is what R42(d) requires.
 */
export const HISTORY_Z = 1;

/**
 * R42 addendum: `opts.history` accepts BOTH bare strings and the `{id, text}` rows the CLI reads
 * out of NDJSON. The library path used to take strings only, so a caller that passed parsed rows
 * got `history_insufficient` on three perfectly valid essays — a silent wrong answer, which is
 * worse than an error. A row with no string `text` is skipped and named by its index.
 * @returns {{texts: string[], skipped: number[]}}
 */
export function normalizeHistory(history) {
  const texts = [];
  const skipped = [];
  (Array.isArray(history) ? history : []).forEach((row, i) => {
    const t = typeof row === 'string' ? row
      : (row && typeof row === 'object' && typeof row.text === 'string' ? row.text : null);
    if (t === null || t === '') { skipped.push(i); return; }
    texts.push(t);
  });
  return { texts, skipped };
}

function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/**
 * compareHistory(priorDocs, currentSignals)
 * @param {Array<{tokens:number, signals:Array<{name:string,z:number}>}>} priorDocs
 * @param {Array<{name:string,z:number}>} currentSignals  the current document's ACTIVE signals
 * @returns {{insufficient:boolean, priorDocs:number, comparedFeatures:number,
 *            shifted:Array, shift:boolean, usableDocs:number}}
 */
export const HISTORY_PROFILE_VERSION = 1;
/** Decimals kept in a serialised profile (R45 addendum 2). */
export const HISTORY_PROFILE_DECIMALS = 6;

/**
 * buildProfile(priorDocs, inputRows) -> a pure, JSON-serialisable summary of the author's prior
 * submissions. R45: a platform computes ONE profile per student and reuses it, instead of paying
 * a full detect() pass per prior document on every new submission.
 * @param {Array<{tokens:number, signals:Array<{name:string,z:number}>}>} priorDocs
 */
export function buildProfile(priorDocs, inputRows = priorDocs.length, skippedRows = []) {
  const usable = priorDocs.filter((d) => d.tokens >= HISTORY_MIN_TOKENS);
  const byFeature = new Map();
  for (const d of usable) {
    for (const sig of d.signals) {
      if (!Number.isFinite(sig.z)) continue;
      if (!byFeature.has(sig.name)) byFeature.set(sig.name, []);
      byFeature.get(sig.name).push(sig.z);
    }
  }
  const features = {};
  for (const name of [...byFeature.keys()].sort()) {
    const zs = byFeature.get(name);
    if (zs.length < HISTORY_MIN_COMPARED) continue;      // present in >= 2 prior documents
    // R45 addendum (2): rounded to 6 decimals HERE, in the shared builder, so the inline
    // `history` path and a serialised `historyProfile` compare the same numbers by construction
    // — the two reports cannot drift apart, rather than happening to agree. It also keeps a
    // committed profile free of 15-digit float runs, which trip the phone-shaped-digit
    // acceptance grep (the same reason R26 rounds what it prints).
    features[name] = {
      mean: Number(mean(zs).toFixed(HISTORY_PROFILE_DECIMALS)),
      sd: Number(sd(zs).toFixed(HISTORY_PROFILE_DECIMALS)),   // the SD FLOOR is applied at compare time
    };
  }
  return {
    version: HISTORY_PROFILE_VERSION,
    minTokensPerDoc: HISTORY_MIN_TOKENS,
    priorDocs: usable.length,
    inputRows,
    skippedRows,
    features,
  };
}

/**
 * compareWithProfile(profile, currentSignals) — the comparison half, shared by the `history` and
 * the `historyProfile` paths so the two produce byte-identical reports.
 */
export function compareWithProfile(profile, currentSignals) {
  if (!profile || profile.priorDocs < HISTORY_MIN_DOCS) {
    return { insufficient: true, priorDocs: profile ? profile.priorDocs : 0,
      usableDocs: profile ? profile.priorDocs : 0, comparedFeatures: 0, shifted: [], shift: false };
  }
  const current = new Map();
  for (const sig of currentSignals) if (Number.isFinite(sig.z)) current.set(sig.name, sig.z);

  const shifted = [];
  let compared = 0;
  for (const name of Object.keys(profile.features).sort()) {
    if (!current.has(name)) continue;                    // not observable in the new document
    compared++;
    const m = profile.features[name].mean;
    const s = Math.max(profile.features[name].sd, HISTORY_SD_FLOOR);
    const value = current.get(name);
    const z = (value - m) / s;
    if (Math.abs(z) > HISTORY_SHIFT_SD) {
      shifted.push({
        feature: name,
        priorMean: Number(m.toFixed(6)),
        priorSd: Number(s.toFixed(6)),
        value: Number(value.toFixed(6)),
        z: Number(z.toFixed(6)),
      });
    }
  }
  shifted.sort((a, b) => Math.abs(b.z) - Math.abs(a.z) || (a.feature < b.feature ? -1 : 1));
  return {
    insufficient: false,
    priorDocs: profile.priorDocs,
    usableDocs: profile.priorDocs,
    comparedFeatures: compared,
    shifted,
    shift: shifted.length >= HISTORY_MIN_SHIFTED,
  };
}

/**
 * compareHistory(priorDocs, currentSignals) — the direct path, kept as the definition of record.
 */
export function compareHistory(priorDocs, currentSignals) {
  return compareWithProfile(buildProfile(priorDocs), currentSignals);
}

/** A profile is only comparable against a document scored in the SAME cell with the SAME weights. */
export function profileMismatch(profile, cell, weightsId) {
  if (!profile || typeof profile !== 'object') return 'not an object';
  if (profile.version !== HISTORY_PROFILE_VERSION) return `version ${profile.version}`;
  if (!profile.features || typeof profile.features !== 'object') return 'no features map';
  if (profile.cell !== undefined && profile.cell !== null && profile.cell !== cell) {
    return `cell ${profile.cell} != ${cell}`;
  }
  if (profile.weightsId !== undefined && profile.weightsId !== null && profile.weightsId !== weightsId) {
    return `weights ${profile.weightsId} != ${weightsId}`;
  }
  return null;
}

/** The single human-direction signal a consistent history contributes (R42d). */
export function historySignal(priorDocs, comparedFeatures) {
  return {
    id: 'history_consistency',
    name: 'history_consistency',
    value: 1,
    matched: `consistent with ${priorDocs} prior document(s) on ${comparedFeatures} feature(s)`,
    direction: 'human',
    group: 'aggregate',
    scope: 'HISTORY-ONLY',
    weight: HISTORY_WEIGHT,
    z: HISTORY_Z,
    contributionRaw: -HISTORY_WEIGHT * HISTORY_Z,
    contribution: -HISTORY_WEIGHT * HISTORY_Z,
    confidence: 'MED',
    provenance: 'prior',
    spans: [],
    note: 'the author\'s own prior submissions are the only per-writer calibration this tool has, '
      + 'and consistency with them is weak evidence at best: a student who writes the same way '
      + 'every time is consistent whether or not a machine helped every time. Capped so that it '
      + 'can never move the verdict a whole band on its own, and it never points at a machine.',
  };
}
