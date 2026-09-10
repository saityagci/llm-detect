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
export function compareHistory(priorDocs, currentSignals) {
  const usable = priorDocs.filter((d) => d.tokens >= HISTORY_MIN_TOKENS);
  if (usable.length < HISTORY_MIN_DOCS) {
    return { insufficient: true, priorDocs: priorDocs.length, usableDocs: usable.length,
      comparedFeatures: 0, shifted: [], shift: false };
  }

  // Feature -> the z values it took across the prior documents.
  const byFeature = new Map();
  for (const d of usable) {
    for (const s of d.signals) {
      if (!Number.isFinite(s.z)) continue;
      if (!byFeature.has(s.name)) byFeature.set(s.name, []);
      byFeature.get(s.name).push(s.z);
    }
  }
  const current = new Map();
  for (const s of currentSignals) if (Number.isFinite(s.z)) current.set(s.name, s.z);

  const shifted = [];
  let compared = 0;
  for (const name of [...byFeature.keys()].sort()) {
    const zs = byFeature.get(name);
    if (zs.length < HISTORY_MIN_COMPARED) continue;      // present in >= 2 prior documents
    if (!current.has(name)) continue;                    // not observable in the new document
    compared++;
    const m = mean(zs);
    const rawSd = sd(zs);
    const s = Math.max(rawSd, HISTORY_SD_FLOOR);
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
    priorDocs: usable.length,
    usableDocs: usable.length,
    comparedFeatures: compared,
    shifted,
    shift: shifted.length >= HISTORY_MIN_SHIFTED,
  };
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
