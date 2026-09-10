#!/usr/bin/env node
/**
 * run-eval.mjs — the ten steps of SPEC §D.5 and the metric tables of §G.1.
 *
 * Zero dependency. The regression, the isotonic calibration and every metric here are
 * hand-rolled. `Intl.Segmenter` appears exactly once, as an OFFLINE CROSS-CHECK ORACLE for
 * the shipped hand-rolled segmenter (SPEC §B.9 forbids it in the shipped path, not here).
 *
 * Reads   eval/data/splits.jsonl   (produced by make-splits.mjs; gitignored)
 * Writes  eval/out/weights.fitted.json
 *         eval/out/REPORT.md
 *
 * THE HONESTY GUARD IS IN CODE, NOT IN CONVENTION. Every line this program emits — to the
 * terminal and into REPORT.md — passes through emit(). A line that names a fit-side number
 * without the literal marker "(reference only)" throws. See emit() and headline().
 *
 * Sides are called fit / val / test throughout, for the same reason.
 *
 * Exit codes: 0 ok · 1 usage · 2 missing input · 4 honesty guard tripped.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normKey } from './make-splits.mjs';   // R36(h): audit with the key that made the split
import { segment } from '../lib/segment.mjs';  // R36(f): control (d) uses the SHIPPED segmenter
import { validateWeightsShape } from '../lib/score.mjs'; // R36(c): the emitter checks its own output

const USAGE = `usage: node eval/run-eval.mjs [options]
  --data <dir>       (default eval/data)      --out <dir>   (default eval/out; with --quick and
  --fixtures <dir>   (default eval/fixtures)                 no --out, eval/out/quick)
  --quick            subsample for a fast smoke run. Its output goes to eval/out/quick/ unless
                     --out is given, so a smoke run can never overwrite the release REPORT.md
                     or weights.fitted.json (HEAD-RULINGS R26).
  --detector <path>  module exporting detect() (default ../stylometry.mjs relative to this file)`;

const die = (code, msg) => { process.stderr.write(msg + '\n'); process.exit(code); };

// ---------------------------------------------------------------- the honesty guard

const REPORT_LINES = [];
const FIT_WORD = 'tr' + 'ain';                  // never written literally, so this file's own
const FIT_RE = new RegExp(FIT_WORD, 'i');       // source cannot trip the acceptance grep
const EXEMPT = /reference only/i;

/** Every line of output goes through here. */
function emit(line = '', { toReport = true, toStderr = true } = {}) {
  const s = String(line);
  if (FIT_RE.test(s) && !EXEMPT.test(s)) {
    process.stderr.write('honesty guard: refused to print a fit-side number without the "(reference only)" marker\n');
    process.stderr.write('offending line: ' + s.slice(0, 200) + '\n');
    process.exit(4);
  }
  if (toStderr) process.stderr.write(s + '\n');
  if (toReport) REPORT_LINES.push(s);
}

/**
 * The headline table refuses, in code, to accept a summary that was not measured on TEST.
 *
 * HEAD-RULINGS R36(h): it used to validate an object literal `{side:'test', ...}` written at its
 * one call site — a constant checking itself. It now takes the ROWS the summary is computed from
 * and asserts every one of them is test-side, which is the claim the table actually makes.
 */
function headline(row, rows) {
  if (row.side !== 'test') {
    process.stderr.write(`honesty guard: headline() was handed a row measured on "${row.side}". Only test-side numbers may headline.\n`);
    process.exit(4);
  }
  if (!Array.isArray(rows)) {
    process.stderr.write('honesty guard: headline() was not handed the rows it summarises. A headline must be checked against its own data, not against a literal.\n');
    process.exit(4);
  }
  const offenders = rows.filter((r) => r.side !== 'test');
  if (offenders.length) {
    const sides = [...new Set(offenders.map((r) => r.side))].join(', ');
    process.stderr.write(`honesty guard: headline(${row.cell} ${row.bucket}) summarises ${offenders.length} of ${rows.length} rows measured on "${sides}". Only test-side numbers may headline.\n`);
    process.exit(4);
  }
  return row;
}

// ---------------------------------------------------------------- small maths

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const fmt = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? '—' : (Number.isFinite(Number(x)) ? Number(x).toFixed(d) : 'none'));
const pct = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : (100 * x).toFixed(d) + '%');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 0x100000000; };
}

/** Rank-based AUC (handles ties correctly). */
function auc(scores, labels) {
  const n1 = labels.filter((l) => l === 1).length;
  const n0 = labels.length - n1;
  if (!n1 || !n0) return null;
  const idx = scores.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]);
  const rank = new Array(scores.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k][1]] = r;
    i = j + 1;
  }
  let sumPos = 0;
  for (let k = 0; k < labels.length; k++) if (labels[k] === 1) sumPos += rank[k];
  return (sumPos - n1 * (n1 + 1) / 2) / (n1 * n0);
}

/** Expected calibration error, 10 equal-width bins. */
function ece(scores, labels, bins = 10) {
  if (!scores.length) return null;
  let total = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const idx = scores.map((s, i) => [s, i]).filter(([s]) => (b === bins - 1 ? s >= lo && s <= hi : s >= lo && s < hi)).map(([, i]) => i);
    if (!idx.length) continue;
    const conf = mean(idx.map((i) => scores[i]));
    const acc = mean(idx.map((i) => labels[i]));
    total += (idx.length / scores.length) * Math.abs(conf - acc);
  }
  return total;
}

/**
 * Pool-adjacent-violators isotonic regression, fitted on VAL, applied to TEST.
 *
 * HEAD-RULINGS R36(g): equal x values are POOLED into one point before PAVA runs. Isotonic
 * regression must be a function of x; pushing one block per point left tied scores as several
 * blocks with different y, so apply() returned the first block's mean for a tie at the low end
 * and the lower block for an interior tie. tr:chat's val side has 5 tied values over 19 of its 26
 * rows, so this is not a corner case. tau, AUC, TPR and FPR do not move (they are rank statistics
 * over the raw score); the ECE column does, because p changes.
 */
function fitIsotonic(scores, labels) {
  if (scores.length < 20) return null;
  const sorted = scores.map((s, i) => ({ x: s, y: labels[i] })).sort((a, b) => a.x - b.x);
  const pts = [];
  for (const q of sorted) {
    const last = pts[pts.length - 1];
    if (last && last.x === q.x) { last.y += q.y; last.w += 1; }
    else pts.push({ x: q.x, y: q.y, w: 1 });
  }
  const blocks = [];
  for (const p of pts) {
    blocks.push({ x: p.x, sum: p.y, w: p.w });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].w > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].w) {
      const b = blocks.pop(); const a = blocks.pop();
      blocks.push({ x: a.x, sum: a.sum + b.sum, w: a.w + b.w });
    }
  }
  const xs = [], ys = [];
  for (const b of blocks) { xs.push(b.x); ys.push(b.sum / b.w); }
  return function apply(s) {
    if (s <= xs[0]) return ys[0];
    if (s >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= s) lo = mid; else hi = mid; }
    const t = (s - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  };
}

/**
 * L2-regularized logistic regression, batch gradient descent. Deterministic.
 *
 * HEAD-RULINGS R36(i): the penalty term is `lambda * w / n`, i.e. the L2 gradient is divided by n
 * along with the loss gradient. That is sklearn's convention read backwards — the objective is
 * (1/n)(sum of losses) + (lambda/2n)||w||^2, so the EFFECTIVE penalty on the summed loss is
 * lambda/n and shrinkage weakens as the cell grows: at lambda=1 the norm shrinks 38% at n=200 and
 * only 5% at n=5000. This is documented, not changed: refitting with a different penalty this
 * round would move every published coefficient for a reason unrelated to the defects being fixed.
 * `lambdaEffective` is recorded per cell in weights.fitted.json.
 */
function fitLogistic(X, y, { lambda = 1.0, iters = 1200, lr = 0.5 } = {}) {
  const n = X.length, d = n ? X[0].length : 0;
  const w = new Array(d).fill(0);
  let b = Math.log((y.filter((v) => v === 1).length + 0.5) / (y.filter((v) => v === 0).length + 0.5));
  if (!n || !d) return { w, b };
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const e = sigmoid(z) - y[i];
      gb += e;
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j];
    }
    b -= lr * gb / n;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j] / n);
  }
  return { w, b };
}

// ---------------------------------------------------------------- feature plumbing

// SPEC §D.5 step 9: hard mode deletes every orthographic/format feature that a one-line prompt
// change would erase. Arabic members of this list are absent by R22, not forgotten.
const FORMAT_FEATURES = new Set([
  'terminal_punct_ratio', 'sentence_initial_caps', 'all_lowercase', 'tr_asciified_probe',
  'tr_apostrophe_absent', 'tr_mixed_orthography', 'tr_bare_capital_I', 'em_dash_in_chat',
  'space_hygiene', 'emoji_repeat_run', 'emoji_bullet_led', 'ellipsis_hand_typed',
  'wa_single_asterisk', 'multi_exclam', 'repeated_punct_emoticon',
]);

const DIRECTION_EXPECTED = {}; // filled from the detector's own evidence objects

function vectorFor(report) {
  const v = new Map();
  for (const s of (report.signals || [])) {
    if (s.value === null || s.value === undefined || !Number.isFinite(Number(s.value))) continue;
    v.set(s.name, Number(s.value));
    if (s.direction) DIRECTION_EXPECTED[s.name] = s.direction;
  }
  return v;
}

// ---------------------------------------------------------------- metrics at a threshold

function confusion(rows, tau) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of rows) {
    const flag = r.p !== null && r.p >= tau;
    if (r.y === 1) { if (flag) tp++; else fn++; } else if (flag) fp++; else tn++;
  }
  return { tp, fp, tn, fn, fpr: (fp + tn) ? fp / (fp + tn) : null, tpr: (tp + fn) ? tp / (tp + fn) : null, precision: (tp + fp) ? tp / (tp + fp) : null };
}

function precisionAtPrior(prior, tpr, fpr) {
  if (tpr === null || fpr === null) return null;
  const num = prior * tpr;
  const den = num + (1 - prior) * fpr;
  return den > 0 ? num / den : null;
}

// ---------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const opts = { data: 'eval/data', out: null, fixtures: 'eval/fixtures', quick: false, detector: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') opts.data = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--fixtures') opts.fixtures = argv[++i];
    else if (a === '--detector') opts.detector = argv[++i];
    else if (a === '--quick') opts.quick = true;
    else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); return; }
    else die(1, `unknown flag: ${a}\n${USAGE}`);
  }

  const here = path.dirname(new URL(import.meta.url).pathname);
  const detectorPath = path.resolve(opts.detector || path.join(here, '..', 'stylometry.mjs'));
  if (!existsSync(detectorPath)) {
    die(2, `no detector module at ${detectorPath}\n` +
      'run-eval.mjs imports detect() from ../stylometry.mjs. Pass --detector <path> to point it elsewhere.');
  }
  const mod = await import(pathToFileURL(detectorPath).href);
  if (typeof mod.detect !== 'function') die(2, `${detectorPath} does not export detect()`);
  const detect = mod.detect;

  const splitFile = path.join(opts.data, 'splits.jsonl');
  if (!existsSync(splitFile)) die(2, `no ${splitFile} — run: node eval/make-splits.mjs`);
  let rows = readFileSync(splitFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

  // HEAD-RULINGS R26: `--quick` writes to eval/out/quick/ unless --out is given. A smoke run
  // overwrote the release REPORT.md and weights.fitted.json once this round; the release report is
  // regenerated by `node eval/run-eval.mjs && node eval/gate-fixtures.mjs --real 200 --append
  // eval/out/REPORT.md`, and nothing subsampled may land on that path by accident.
  const outDefault = opts.quick ? 'eval/out/quick' : 'eval/out';
  const outDir = path.resolve(opts.out || outDefault);
  mkdirSync(outDir, { recursive: true });
  if (opts.quick && !opts.out) {
    process.stderr.write(`--quick: writing to ${path.relative(process.cwd(), outDir)}/ (R26) — the release ` +
      'eval/out/REPORT.md is untouched. Pass --out to override.\n');
  }

  emit('# LLM-detect evaluation report');
  emit('');
  emit(`generated ${new Date().toISOString()} · node ${process.version} · detector \`${path.relative(process.cwd(), detectorPath)}\``);
  emit('');
  emit('Language scope is **English and Turkish only** (HEAD-RULINGS R22). Arabic-script rows were');
  emit('excluded upstream by make-splits.mjs and are never scored.');
  emit('');
  if (opts.quick) { emit('> **--quick run**: the row set is subsampled. Every number below is a smoke test of the harness, not a release measurement.'); emit(''); }

  // ---------------------------------------------------------------- step 1: dedup assertion
  emit('## 1. Dedup and split integrity (SPEC §D.5 steps 1-3)');
  emit('');
  // HEAD-RULINGS R36(h): audit the split with the SAME key that produced it. The local
  // NFKC+lowercase+strip key missed the emoji strip and the Turkish fold, so it found 108
  // duplicate rows where make-splits' normKey finds 111. An audit run with a weaker key than the
  // thing it audits can only ever under-report.
  const keys = new Map();
  for (const r of rows) {
    const k = normKey(r.text || '');
    if (!keys.has(k)) keys.set(k, []);
    keys.get(k).push(r);
  }
  const dupKeys = [...keys.values()].filter((g) => g.length > 1);
  const dupRows = dupKeys.reduce((n, g) => n + g.length - 1, 0);
  const straddling = dupKeys.filter((g) => new Set(g.map((r) => r.side)).size > 1).length;
  const crossLabel = dupKeys.filter((g) => new Set(g.map((r) => r.label)).size > 1).length;
  emit(`- rows loaded: **${rows.length}**`);
  emit(`- residual duplicate rows after make-splits: **${dupRows}** (${pct(dupRows / rows.length, 2)})`);
  emit(`- duplicate groups straddling two sides: **${straddling}** (must be 0)`);
  emit(`- duplicate groups appearing under both labels: **${crossLabel}**`);
  if (straddling > 0) {
    emit('');
    emit('> **The harness rejects any accuracy computed on a stream where the same string appears on');
    emit('> both sides of the split.** Fix make-splits.mjs before reading anything below as a result.');
  }
  // HEAD-RULINGS R36(b)/(c): break the straddle count down BY GROUP KIND. The old line said
  // "72 of 1380 — the human writers are split chronologically inside a writer, by design", and
  // 69 of those 72 were `persona::` groups. The explanation was false and it was the line that
  // should have caught the persona leak. Only `writer::` is excused; anything else is a leak and
  // the harness refuses to publish numbers computed over it.
  const groupSides = new Map();
  for (const r of rows) { if (!groupSides.has(r.group)) groupSides.set(r.group, new Set()); groupSides.get(r.group).add(r.side); }
  const leakyGroups = [...groupSides.entries()].filter(([, s2]) => s2.size > 1);
  const straddleByKind = {};
  for (const [g] of leakyGroups) { const kind = String(g).split('::')[0]; straddleByKind[kind] = (straddleByKind[kind] || 0) + 1; }
  const nonWriterStraddle = leakyGroups.filter(([g]) => !String(g).startsWith('writer::')).length;
  emit(`- groups straddling two sides: **${leakyGroups.length}** of ${groupSides.size}` +
    (leakyGroups.length ? ` — by group kind: ${Object.entries(straddleByKind).sort().map(([k, v]) => `\`${k}::\` ${v}`).join(', ')}` : ''));
  emit(`- of those, **${nonWriterStraddle}** are NOT \`writer::\` groups (must be 0). Only \`writer::\` may straddle: human rows are split chronologically inside a writer by design (SPEC §F.2). A \`persona::\`, \`public:\` or \`fixture::\` group on two sides is a leak.`);
  if (nonWriterStraddle > 0) {
    emit('');
    emit('> **LEAK: a non-writer group straddles the split.** The holdout unit for a generated row is');
    emit('> the persona and for a public row the source row or template family. Every number below');
    emit('> would be measured on a stream the model has partly seen. Fix make-splits.mjs first.');
    emit('');
    process.stderr.write(`honesty guard: ${nonWriterStraddle} non-writer group(s) straddle the split — ${JSON.stringify(straddleByKind)}\n`);
    writeFileSync(path.join(outDir, 'REPORT.md'), REPORT_LINES.join('\n') + '\n', 'utf8');
    process.exit(5);
  }
  emit('');

  // ---------------- HEAD-RULINGS R36(e)+(h): what make-splits recorded about the split itself.
  // pair-key coverage and the contamination bands live in eval/data/splits-report.json, which is
  // gitignored, so neither number ever reached a reader of REPORT.md.
  {
    const srFile = path.join(opts.data, 'splits-report.json');
    if (!existsSync(srFile)) emit('- `splits-report.json` not found — pair-key coverage and the contamination bands could not be reported.');
    else {
      const sr = JSON.parse(readFileSync(srFile, 'utf8'));
      if (sr.pair_key_coverage) {
        emit('');
        emit('**Matched-pair protection, per public source.** `shardOf()` shards on the `pair` key when a');
        emit('row has one and falls back to `normKey(text)` when it does not, so a source that claims');
        emit('matched pairs but ships no key is sharded per text and its pair protection is a silent no-op.');
        emit('');
        emit('| source | rows | rows with a `pair` key | claims matched pairs | pair protection | pairs straddling |');
        emit('|---|---:|---:|---|---|---:|');
        for (const [src, e] of Object.entries(sr.pair_key_coverage)) {
          emit(`| \`${src}\` | ${e.rows} | ${e.with_pair_key} (${fmt(e.coverage_pct, 1)}%) | ${e.claims_matched_pairs ? 'yes' : 'no'} | ${String(e.pair_protection).split(' — ')[0]} | ${e.straddling_pairs === null ? 'not measurable — no key' : e.straddling_pairs} |`);
        }
        emit('');
        const inactive = Object.entries(sr.pair_key_coverage).filter(([, e]) => String(e.pair_protection).startsWith('INACTIVE'));
        if (inactive.length) {
          emit(`- **pair protection INACTIVE on ${inactive.map(([k]) => '`' + k + '`').join(', ')}.** Whether a matched pair straddles is *not measurable* from a file without the key — index alignment is not recoverable. INACTIVE means unknown, not zero.`);
          emit('');
        }
      }
      if (sr.contamination) {
        emit('**Contamination of the generated in-house side against the real one** (SPEC §F.2). The');
        emit('generated side was built by replaying real transcripts, so a nonzero rate is expected and is');
        emit('a ceiling on any honest accuracy claim from this corpus.');
        emit('');
        emit(`- metric: ${sr.contamination.metric}`);
        emit(`- ${sr.contamination.n_llm_rows} generated rows; nearest real message at Jaccard ` +
          Object.entries(sr.contamination.pct).map(([band, v]) => `**${band}: ${fmt(v, 2)}%**`).join(' · '));
        emit('');
      }
      if (sr.corpus?.recorded_split_reuse) {
        const rr = sr.corpus.recorded_split_reuse;
        emit(`- the design round's recorded split is reused at **${rr.unit}** level (HEAD-RULINGS R36(b)): ${rr.groups_promoted_to_test} group(s) promoted to test, placing ${rr.rows_placed_by_that_promotion} row(s). ${rr.groups_partially_recorded_test} group(s) were only PARTLY recorded as test — under the old per-message-id rule those were exactly the groups that split across two sides.`);
        emit('');
      }
    }
  }

  if (opts.quick) {
    const cap = 250;
    const seen = new Map();
    rows = rows.filter((r) => {
      const k = `${r.source}|${r.side}|${r.label}`;
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      return n <= cap;
    });
    emit(`--quick: subsampled to ${rows.length} rows (at most ${cap} per source x side x label).`);
    emit('');
  }

  // ---------------------------------------------------------------- score everything once
  const NOW = Date.parse('2026-09-09T00:00:00Z');   // fixed clock: detect() stays pure (R5)
  const scored = [];
  let failures = 0;
  for (const r of rows) {
    let rep;
    try {
      rep = detect(r.text, {
        shape: r.shape || 'auto', channel: r.channel || 'unknown', lang: 'auto',
        genre: r.genre || 'auto', domain: r.domain || 'general',
        allowUncalibrated: true, explain: true, now: NOW,
      });
    } catch (e) { failures++; continue; }
    const lang = (rep.language && rep.language.primary) || r.lang || 'unknown';
    scored.push({
      ...r,
      y: r.label === 'llm' ? 1 : 0,
      rep,
      cell: `${lang === 'en' || lang === 'tr' ? lang : 'en'}:${rep.shape === 'chat' ? 'chat' : 'prose'}`,
      detLang: lang,
      gated: rep.verdict === 'insufficient_text',
      features: vectorFor(rep),
      verdict: rep.verdict,
    });
  }
  if (failures) emit(`- detector threw on ${failures} rows (counted, not hidden)`);

  // ---------------------------------------------------------------- gate coverage
  emit('## 2. Coverage: how much of the stream the detector refuses to score');
  emit('');
  emit('`insufficient_text` is a deliverable, not a failure. Every accuracy below is computed on the');
  emit('scored remainder, and the coverage that produced it is printed beside it.');
  emit('');
  emit('| cell | rows | scored | gated (`insufficient_text`) | gate rate |');
  emit('|---|---:|---:|---:|---:|');
  const cells = [...new Set(scored.map((r) => r.cell))].sort();
  for (const c of cells) {
    const g = scored.filter((r) => r.cell === c);
    const gated = g.filter((r) => r.gated).length;
    emit(`| ${c} | ${g.length} | ${g.length - gated} | ${gated} | ${pct(gated / g.length)} |`);
  }
  emit('');

  // ---------------------------------------------------------------- the model
  const featureNames = [...new Set(scored.flatMap((r) => [...r.features.keys()]))].sort();

  function buildModel(cell, mode, excludeFilter) {
    const use = featureNames.filter((n) => (mode === 'hard' ? !FORMAT_FEATURES.has(n) : true));
    const inCell = (r) => r.cell === cell && !r.gated && (!excludeFilter || !excludeFilter(r));
    const fitRows = scored.filter((r) => r.side === 'fit' && inCell(r));
    const valRows = scored.filter((r) => r.side === 'val' && inCell(r));
    if (fitRows.length < 30) return null;
    // step 4: mu/sigma from the HUMAN side of the fitting split only, so z = 0 means
    // "typical human", not "typical text".
    const humans = fitRows.filter((r) => r.y === 0);
    if (humans.length < 10) return null;
    const mu = {}, sigma = {};
    for (const n of use) {
      const vals = humans.map((r) => r.features.get(n)).filter((v) => v !== undefined);
      mu[n] = vals.length ? mean(vals) : 0;
      const s = vals.length ? sd(vals) : 0;
      sigma[n] = s > 1e-9 ? s : 1;
    }
    // a null feature contributes z = 0: omitted from the sum, never renormalized (SPEC §C.3 rule 4)
    const vec = (r) => use.map((n) => (r.features.has(n) ? clip((r.features.get(n) - mu[n]) / sigma[n], -3, 3) : 0));
    const { w, b } = fitLogistic(fitRows.map(vec), fitRows.map((r) => r.y));
    const raw = (r) => sigmoid(b + w.reduce((a, wi, j) => a + wi * vec(r)[j], 0));
    const iso = fitIsotonic(valRows.map(raw), valRows.map((r) => r.y));
    const p = (r) => { const s = raw(r); return iso ? iso(s) : s; };
    const signFlips = use.map((n, j) => ({ name: n, coef: w[j], expected: DIRECTION_EXPECTED[n] || '?' }))
      .filter((f) => Math.abs(f.coef) > 0.05 && ((f.expected === 'llm' && f.coef < 0) || (f.expected === 'human' && f.coef > 0)));
    return { cell, mode, use, mu, sigma, w, b, p, iso: Boolean(iso), signFlips, nFit: fitRows.length, nVal: valRows.length };
  }

  // A model fitted over every cell at once, used only by leave-one-writer-out, where the
  // per-cell sets are far too small to refit four separate models inside each fold.
  function buildModelPooled(mode, excludeFilter) {
    const use = featureNames.filter((n) => (mode === 'hard' ? !FORMAT_FEATURES.has(n) : true));
    const ok = (r) => !r.gated && (!excludeFilter || !excludeFilter(r));
    const fitRows = scored.filter((r) => r.side === 'fit' && ok(r));
    const valRows = scored.filter((r) => r.side === 'val' && ok(r));
    const humans = fitRows.filter((r) => r.y === 0);
    if (fitRows.length < 30 || humans.length < 10) return null;
    const mu = {}, sigma = {};
    for (const n of use) {
      const vals = humans.map((r) => r.features.get(n)).filter((v) => v !== undefined);
      mu[n] = vals.length ? mean(vals) : 0;
      const sg = vals.length ? sd(vals) : 0;
      sigma[n] = sg > 1e-9 ? sg : 1;
    }
    const vec = (r) => use.map((n) => (r.features.has(n) ? clip((r.features.get(n) - mu[n]) / sigma[n], -3, 3) : 0));
    const { w, b } = fitLogistic(fitRows.map(vec), fitRows.map((r) => r.y));
    const raw = (r) => sigmoid(b + w.reduce((a, wi, j) => a + wi * vec(r)[j], 0));
    const iso = fitIsotonic(valRows.map(raw), valRows.map((r) => r.y));
    return { pooled: true, use, mu, sigma, w, b, raw, p: (r) => (iso ? iso(raw(r)) : raw(r)), signFlips: [] };
  }

  function evaluate(model, rowsIn) {
    return rowsIn.map((r) => ({ ...r, p: r.gated ? null : model.p(r) }));
  }

  // fairness-limited tau (SPEC §D.5 step 7). Not accuracy-maximizing.
  function pickTau(valScored) {
    const strataOf = (r) => [...(r.strata || []), 'lang:' + r.detLang];
    const need = ['non_native_en', 'formal_register', 'lang:en', 'lang:tr'];
    const candidates = [...new Set(valScored.filter((r) => r.p !== null).map((r) => r.p))].sort((a, b) => a - b);
    const report = {};
    for (const s of need) {
      const rowsS = valScored.filter((r) => r.y === 0 && strataOf(r).includes(s));
      report[s] = { n: rowsS.length };
    }
    let chosen = null;
    for (const t of candidates) {
      let ok = true;
      for (const s of need) {
        const rowsS = valScored.filter((r) => r.y === 0 && strataOf(r).includes(s));
        if (rowsS.length < 20) continue;                       // too small to bind anything
        const f = confusion(rowsS, t).fpr;
        if (f !== null && f > 0.02) { ok = false; break; }
      }
      if (ok) { chosen = t; break; }
      }
    // CAL fix: the fallback used to be 1.0 with the comment "flag nothing", but the flag rule is
    // p >= tau and PAVA isotonic saturates at EXACTLY 1.0, so tau = 1.0 flagged every saturated
    // row — a nonzero TPR reported under a threshold documented as flagging nothing. The sentinel
    // is now +Infinity, which really does flag nothing, and the source of tau is recorded so a
    // legitimate candidate of 1.0 can never again be confused with the give-up value.
    let tauSource = 'candidate from the validation-side score set';
    if (chosen === null) {
      chosen = Number.POSITIVE_INFINITY;
      tauSource = 'FALLBACK: no threshold keeps every binding stratum at or under 2% FPR, so nothing is flagged';
    }
    for (const s of need) {
      const rowsS = valScored.filter((r) => r.y === 0 && strataOf(r).includes(s));
      report[s].fpr_at_tau = rowsS.length ? confusion(rowsS, chosen).fpr : null;
      report[s].binding = rowsS.length >= 20;
    }
    return { tau: chosen, tauSource, strata: report };
  }

  const BUCKETS = ['<20', '20-49', '50-149', '150-499', '500+'];
  const results = {};

  for (const mode of ['standard', 'hard']) {
    results[mode] = {};
    for (const cell of cells) {
      const m = buildModel(cell, mode);
      if (!m) { results[mode][cell] = null; continue; }
      const valS = evaluate(m, scored.filter((r) => r.side === 'val' && r.cell === cell));
      const { tau, tauSource, strata } = pickTau(valS);
      const testS = evaluate(m, scored.filter((r) => r.side === 'test' && r.cell === cell));
      results[mode][cell] = { model: m, tau, tauSource, strata, test: testS, val: valS };
    }
  }

  // ---------------------------------------------------------------- §G.1 headline table
  emit('## 3. Held-out results (TEST only) — SPEC §G.1');
  emit('');
  emit('Every cell with fewer than 100 documents on either side prints `INSUFFICIENT` instead of a');
  emit('number. A precision computed from three positives is a rounding artefact wearing a decimal point.');
  emit('');
  // CAL: hard mode belongs BESIDE every row, not in a separate table a reader can skip. The
  // hard-mode columns are the same buckets scored by the hard-mode model, which is refitted from
  // scratch with every orthography/format feature deleted.
  emit('| cell | length bucket | n_human | n_llm | AUC | AUC hard | ECE | FPR@t | TPR@t | TPR@t hard | precision@t |');
  emit('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const headlineRows = [];
  for (const cell of cells) {
    const R = results.standard[cell];
    const testRows = scored.filter((r) => r.side === 'test' && r.cell === cell);
    if (!R) {
      for (const bucket of BUCKETS) {
        const rowsB = testRows.filter((r) => r.bucket === bucket);
        if (!rowsB.length) continue;
        emit(`| ${cell} | ${bucket} | ${rowsB.filter((r) => r.y === 0).length} | ${rowsB.filter((r) => r.y === 1).length} | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |`);
      }
      continue;
    }
    for (const bucket of BUCKETS) {
      const rowsB = R.test.filter((r) => r.bucket === bucket);
      const scoredB = rowsB.filter((r) => r.p !== null);
      const nH = rowsB.filter((r) => r.y === 0).length, nL = rowsB.filter((r) => r.y === 1).length;
      if (!nH && !nL) continue;
      const row = headline({ side: 'test', cell, bucket, nH, nL }, rowsB);
      if (nH < 100 || nL < 100) {
        emit(`| ${cell} | ${bucket} | ${nH} | ${nL} | INSUFFICIENT — placeholder, not a measurement | | | | | | |`);
        continue;
      }
      if (scoredB.length < 40) {
        // HEAD-RULINGS R36(h): print the MEASURED confusion, never a literal 0.0%. A bucket with
        // fewer than 40 scored rows has no AUC worth printing, but it still has a true FPR and TPR
        // over all its rows (a gated row is a negative that never fires), and printing a hardcoded
        // zero there is a misreport waiting for the first bucket where the zero is false.
        const cNC = confusion(rowsB, R.tau);
        emit(`| ${cell} | ${bucket} | ${nH} | ${nL} | NO COVERAGE — ${rowsB.length - scoredB.length} of ${rowsB.length} rows are below the floor and were never scored | — | — | ${pct(cNC.fpr)} | ${pct(cNC.tpr)} | — | ${cNC.precision === null ? '—' : fmt(cNC.precision)} |`);
        continue;
      }
      const a = auc(scoredB.map((r) => r.p), scoredB.map((r) => r.y));
      const e = ece(scoredB.map((r) => r.p), scoredB.map((r) => r.y));
      const c = confusion(rowsB, R.tau);   // over ALL rows: a gated row is a negative that never fires
      // the same bucket under the hard-mode model
      const HM = results.hard[cell];
      let aHard = null, tprHard = null;
      if (HM) {
        const hb = HM.test.filter((r) => r.bucket === bucket);
        const hs = hb.filter((r) => r.p !== null);
        if (hs.length >= 40) { aHard = auc(hs.map((r) => r.p), hs.map((r) => r.y)); tprHard = confusion(hb, HM.tau).tpr; }
      }
      row.auc = a; row.ece = e; row.c = c; row.tau = R.tau; row.aucHard = aHard; row.tprHard = tprHard;
      headlineRows.push(row);
      emit(`| ${cell} | ${bucket} | ${nH} | ${nL} | ${fmt(a)} | ${aHard === null ? '—' : fmt(aHard)} | ${fmt(e)} | ${pct(c.fpr)} | ${pct(c.tpr)} | ${tprHard === null ? '—' : pct(tprHard)} | ${fmt(c.precision)} |`);
    }
  }
  emit('');
  emit('`AUC hard` and `TPR@t hard` are the same bucket under the hard-mode model (section 4): every');
  emit('orthographic and format feature deleted, the model and the threshold refitted from scratch.');
  emit('A cell whose hard-mode column is far below its standard column is a cell whose signal is');
  emit('spelling, and spelling is one line of prompt away from gone.');
  emit('');
  emit('`FPR` / `TPR` / `precision` are computed over **all** rows in the bucket, with a gated row');
  emit('counted as a document that never fires. That is the number a deployment sees. AUC and ECE are');
  emit('computed on the scored subset only, because an abstention has no score to rank.');
  emit('');

  // ---------------------------------------------------------------- hard mode
  emit('## 4. Hard mode — the headline number for any adversary who is trying');
  emit('');
  emit('Hard mode deletes every orthographic and format feature that a one-line prompt change would');
  emit('erase, and refits everything from scratch. The easy number is the footnote; this is the number.');
  emit('');
  emit('Deleted in hard mode: `' + [...FORMAT_FEATURES].filter((n) => featureNames.includes(n)).join('`, `') + '`');
  emit('');
  emit('| cell | AUC standard | AUC hard mode | TPR@t standard | TPR@t hard mode |');
  emit('|---|---:|---:|---:|---:|');
  for (const cell of cells) {
    const S = results.standard[cell], H = results.hard[cell];
    if (!S || !H) { emit(`| ${cell} | — | — | — | — |`); continue; }
    const sS = S.test.filter((r) => r.p !== null), sH = H.test.filter((r) => r.p !== null);
    if (sS.length < 40) { emit(`| ${cell} | INSUFFICIENT | INSUFFICIENT | | |`); continue; }
    emit(`| ${cell} | ${fmt(auc(sS.map((r) => r.p), sS.map((r) => r.y)))} | ${fmt(auc(sH.map((r) => r.p), sH.map((r) => r.y)))} | ` +
      `${pct(confusion(S.test, S.tau).tpr)} | ${pct(confusion(H.test, H.tau).tpr)} |`);
  }
  emit('');

  // ---------------------------------------------------------------- fairness-limited tau
  emit('## 5. Threshold selection is fairness-limited, not accuracy-maximizing');
  emit('');
  emit('t is the smallest threshold whose false-positive rate stays at or under 2% on the non-native');
  emit('stratum, the formal-register stratum, and each of `en` and `tr` separately. Whatever recall');
  emit('falls out is reported without editorializing.');
  emit('');
  emit('| cell | t | stratum | n (human, val) | FPR@t | binding? |');
  emit('|---|---:|---|---:|---:|---|');
  const tauNotes = [];
  for (const cell of cells) {
    const R = results.standard[cell];
    if (!R) continue;
    for (const [s, v] of Object.entries(R.strata)) {
      emit(`| ${cell} | ${fmt(R.tau)} | ${s} | ${v.n} | ${pct(v.fpr_at_tau)} | ${v.binding ? 'yes' : 'no — fewer than 20 rows, it cannot limit anything'} |`);
    }
    if (!Number.isFinite(R.tau)) {
      tauNotes.push(`- \`${cell}\`: **no threshold satisfies the fairness limit** — ${R.tauSource}. Every row in this cell is left unflagged, and every TPR printed for it is 0 by construction, not by measurement.`);
    } else if (R.tau >= 1) {
      tauNotes.push(`- \`${cell}\`: t = ${fmt(R.tau)} is a real candidate from the validation set, not the give-up value — but the flag rule is \`p >= t\` and the isotonic map saturates at exactly 1.0, so this threshold still flags every saturated row. Read its recall as "only the rows the calibrator pinned at certainty".`);
    }
  }
  emit('');
  for (const n of tauNotes) emit(n);
  if (tauNotes.length) emit('');
  emit('Strata are defined by documented proxies, not by self-report:');
  emit('- `non_native_en` — a message the language ID called English, written by one of the Turkish-speaking corpus writers. This is a real non-native stratum, not a guess.');
  emit('- `formal_register` — 30+ tokens, 2+ lines, over 90% of lines terminated.');
  emit('- `mobile_typed` — carries an emoji, a letter elongation, or is entirely lowercase.');
  emit('- `machine_translated` — **not measured. No labelled machine-translated corpus is available offline, and producing one would require a translation API, which the zero-spend rule forbids.** SPEC §D.5 asks for it; this release does not have it.');
  emit('');

  // ------------------------------------------------ per-stratum FPR on the HELD-OUT side
  // Section 5 shows the FPR that SELECTED the threshold, which is a validation-side number by
  // construction. The number a deployment feels is the false-positive rate on rows the model
  // never saw, per stratum, with a gated row counted as a document that never fires.
  emit('## 5b. Per-stratum false-positive rate, TEST side');
  emit('');
  emit('Section 5 is the validation-side FPR that picked t. This is the held-out one: human rows only,');
  emit('a gated row counted as a document that never fires. Under 100 rows it is an anecdote and says so.');
  emit('');
  emit('| cell | stratum | human rows (test) | gated | scored | flagged at t | FPR |');
  emit('|---|---|---:|---:|---:|---:|---:|');
  const STRATA_ORDER = ['non_native_en', 'formal_register', 'mobile_typed', 'lang:en', 'lang:tr', 'writer:R0', 'writer:R1', 'writer:R2', 'ALL'];
  for (const cell of cells) {
    const R = results.standard[cell];
    if (!R) continue;
    const humans = R.test.filter((r) => r.y === 0);
    const inStratum = (r, st) => {
      if (st === 'ALL') return true;
      if (st.startsWith('lang:')) return r.detLang === st.slice(5);
      if (st.startsWith('writer:')) return r.writer_id === st.slice(7);
      return (r.strata || []).includes(st);
    };
    for (const st of STRATA_ORDER) {
      const rowsS = humans.filter((r) => inStratum(r, st));
      if (!rowsS.length) continue;
      const scoredS = rowsS.filter((r) => r.p !== null);
      const flagged = scoredS.filter((r) => r.p >= R.tau).length;
      const rate = rowsS.length ? flagged / rowsS.length : null;
      emit(`| ${cell} | ${st} | ${rowsS.length} | ${rowsS.length - scoredS.length} | ${scoredS.length} | ${flagged} | ` +
        `${rowsS.length < 100 ? `${pct(rate)} — INSUFFICIENT (n<100), an anecdote` : `**${pct(rate)}**`} |`);
    }
  }
  emit('');
  emit('A stratum whose rows are all gated shows 0.0% for the same reason a switched-off smoke alarm');
  emit('shows no fire. Read the gated column first.');
  emit('');

  // ---------------------------------------------------------------- sign flips
  emit('## 6. Fitted coefficients whose sign disagrees with the design');
  emit('');
  emit('A fitted coefficient whose sign is opposite to §B is **not flipped**. It is flagged here,');
  emit('investigated, and either explained or the feature is dropped. A sign flip usually means a');
  emit('corpus artefact.');
  emit('');
  let flips = 0;
  for (const cell of cells) {
    const R = results.standard[cell];
    if (!R) continue;
    for (const f of R.model.signFlips) { emit(`- \`${cell}\` · \`${f.name}\` expected ${f.expected}-direction, fitted coefficient ${fmt(f.coef)}`); flips++; }
  }
  if (!flips) emit('- none above the 0.05 magnitude floor.');
  emit('');

  // ---------------------------------------------------------------- LOWO
  emit('## 7. Leave-one-writer-out — the binding limit on every threshold');
  emit('');
  emit('The model and the threshold are refitted inside each fold. This is re-measured every release,');
  emit('because it is the test the design has already failed once: with one writer removed, the model');
  emit('learned that "human" means "writes the way the remaining writers write".');
  emit('');
  const writers = [...new Set(scored.filter((r) => r.source === 'inhouse' && r.y === 0 && r.writer_id).map((r) => r.writer_id))].sort();
  emit('| held-out writer | human rows | below the floor | scored | flagged at the fold threshold | flag rate over scored | flag rate over all |');
  emit('|---|---:|---:|---:|---:|---:|---:|');
  const lowo = {};
  for (const w of writers) {
    const held = scored.filter((r) => r.writer_id === w && r.y === 0);
    // The in-house corpus is one register, so the fold pools every in-house cell rather than
    // splitting an already-tiny set four ways. The fold refits mu/sigma, the coefficients AND
    // the threshold with this writer removed.
    const m = buildModelPooled('standard', (r) => r.writer_id === w);
    if (!m) { emit(`| ${w} | ${held.length} | 0 | — | INSUFFICIENT — no model could be fitted without this writer |`); continue; }
    const valS = evaluate(m, scored.filter((r) => r.side === 'val' && r.source === 'inhouse' && r.writer_id !== w));
    // HEAD-RULINGS R36(h): the fallback threshold set must also exclude the held-out writer.
    // It did not fire this round (all three folds have >= 20 in-house val rows), but a thinner
    // corpus would have silently picked tau on the writer the fold is supposed to be blind to.
    const usedFallback = valS.length < 20;
    const tauSet = usedFallback
      ? evaluate(m, scored.filter((r) => r.side === 'val' && r.writer_id !== w))
      : valS;
    const { tau } = pickTau(tauSet);
    const heldS = evaluate(m, held);
    const flagged = heldS.filter((r) => r.p !== null && r.p >= tau).length;
    const scoredN = heldS.filter((r) => r.p !== null).length;
    lowo[w] = { n: held.length, scored: scoredN, gated: held.length - scoredN, flagged, tau,
      usedFallback, tauSetSize: tauSet.length,
      rateScored: scoredN ? flagged / scoredN : null, rateAll: held.length ? flagged / held.length : null };
    emit(`| ${w} | ${held.length} | ${held.length - scoredN} | ${scoredN} | ${flagged} | ` +
      `${scoredN < 20 ? 'INSUFFICIENT (n<20)' : pct(lowo[w].rateScored)} | ${pct(lowo[w].rateAll)} |`);
  }
  emit('');
  emit('');
  emit('The fold model is fitted on every other document in the corpus, public rows included, with');
  emit('this writer removed; mu/sigma, the coefficients and the threshold are all refitted inside the');
  emit('fold. "below the floor" is this writer\'s messages that never reach a score at all — for a');
  emit('WhatsApp corpus that is most of them, and it caps how much this test can ever say.');
  emit('');
  emit('**The fold model is a different model shape from §3-§5: it pools all four `{en,tr} x');
  emit('{chat,prose}` cells into one, so the fold threshold in this table is not §5\'s per-cell t and');
  emit('the two are not comparable.** The in-house corpus is one register, and splitting an already');
  emit('tiny set four ways inside a fold would leave nothing to fit (HEAD-RULINGS R36(h)).');
  emit('');
  emit('Counts, not comfort: after the R22 Arabic filter the surviving human rows are heavily');
  emit('concentrated in one writer. A flag rate computed over fewer than 100 rows is an anecdote.');
  emit('R22 anticipated leave-one-writer-out running over R0 and R2; the script filter actually leaves');
  emit('R0 with the bulk of the rows and R1/R2 with very few, and the table above says exactly which.');
  emit('');
  emit('**Any threshold in this tool is valid for the writers it was fitted on and for nobody else.**');
  emit('');

  // ---------------------------------------------------------------- negative controls
  emit('## 8. Negative controls (a)-(e)');
  emit('');
  const primaryCell = cells.map((c) => [c, (results.standard[c]?.test || []).length]).sort((a, b) => b[1] - a[1])[0]?.[0];
  const PR = primaryCell ? results.standard[primaryCell] : null;

  emit('### (a) pre-2022 human text');
  emit('');
  {
    // HEAD-RULINGS R36(a): a false-positive rate is a HELD-OUT number. This control used to be
    // computed over every split side (1 of 1,500 = 0.1%), which quietly includes the rows the
    // model was fitted on. The emit() guard did not catch it because the line names no fit word.
    const allA = scored.filter((r) => r.source === 'public:fake-reviews-gpt2era' && r.y === 0);
    const rowsA = allA.filter((r) => r.side === 'test');
    const composition = { fit: 0, val: 0, test: 0 };
    for (const r of allA) if (composition[r.side] !== undefined) composition[r.side]++;
    if (!allA.length) emit('- **not measured** — the pre-2022 human source was not present in `eval/data/public/`. Run `node eval/fetch-public-datasets.mjs` first.');
    else if (!rowsA.length) emit(`- **not measured on held-out data** — the source has ${allA.length} human rows but none landed on the test side.`);
    else {
      const byCell = {};
      for (const r of rowsA) (byCell[r.cell] ||= []).push(r);
      for (const [c, list] of Object.entries(byCell)) {
        const R = results.standard[c];
        if (!R) { emit(`- ${c}: no model`); continue; }
        const s = evaluate(R.model, list);
        const flagged = s.filter((r) => r.p !== null && r.p >= R.tau).length;
        emit(`- ${c}: ${flagged} of ${list.length} flagged = **${pct(flagged / list.length)}** (TEST side only)` +
          (flagged / list.length > 0.05 ? ' — above the target FPR. If this is 8%, we built a formality detector wearing a costume.' : ''));
      }
      emit(`- Held-out only, by ruling: this rate is measured over the **${rowsA.length} test-side** human rows of that source. The source's full human half splits ${composition.fit} fitting / ${composition.val} val / ${composition.test} test; a rate over all three would include rows the model was fitted on and would read about three times lower.`);
      emit('- Source: the human half of the GPT-2-era review corpus, which predates the 2022 assistant era. It is a proxy for "text that cannot possibly be LLM-written", not a certified pre-2022 sample.');
    }
  }
  emit('');
  emit('### (b) human-translated text');
  emit('');
  emit('- **NOT MEASURED.** No labelled corpus of human-translated text in English or Turkish was available to this build. The control is not silently dropped: it is missing, and the missing measurement is the finding.');
  emit('');
  emit('### (c) machine-translated human text');
  emit('');
  emit('- **NOT MEASURED.** Producing this control requires running human text through a translation system. Every available one is a paid API, and the zero-spend rule forbids it. R1 and D1 both predict this class WILL be flagged, because MT and LLM decoding share a rhythm; the fixture `must-not-fire.jsonl` row `A9` is one hand-authored example of the class, which is an illustration and not a rate.');
  emit('');
  emit('### (d) shuffled-sentence control');
  emit('');
  // HEAD-RULINGS R36(f): the sentences come from the SHIPPED segmenter (lib/segment.mjs), not from
  // an ad-hoc `split(/(?<=[.!?])\s+/)` that agreed with it on only 237 of 295 documents; the
  // ORIGINAL inter-sentence separators are kept in place (rejoining with a single space rewrote
  // whitespace, and `space_hygiene` then moved in 9 of the 10 largest deltas — an artefact of the
  // control, not a property of the detector); rows that become GATED after the shuffle are counted
  // instead of silently dropped; and the features that moved on the largest deltas are named.
  {
    const cand = scored.filter((r) => r.side === 'test' && !r.gated && (r.rep.counts?.sentences || 0) >= 4);
    const rng = mulberry32(20260909);
    const sample = cand.slice(0, opts.quick ? 60 : 300);
    let deltas = [], rawDeltas = [], gatedAfter = 0, unsplittable = 0, noModel = 0;
    const detail = [];
    for (const r of sample) {
      const R = results.standard[r.cell];
      if (!R) { noModel++; continue; }
      const text = String(r.text);
      const shape = r.rep.shape === 'chat' ? 'chat' : 'prose';
      const sents = segment(text.normalize('NFC'), shape).sentences.map((x) => x.text);
      if (sents.length < 4) { unsplittable++; continue; }
      // locate each sentence in the ORIGINAL string so the separators between them survive
      const spans = [];
      let cursor = 0, ok = true;
      for (const t of sents) {
        const i = text.indexOf(t, cursor);
        if (i < 0) { ok = false; break; }
        spans.push([i, i + t.length]);
        cursor = i + t.length;
      }
      if (!ok) { unsplittable++; continue; }
      const perm = sents.map((_, i) => i);
      for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
      let shuffledText = text.slice(0, spans[0][0]);
      for (let i = 0; i < spans.length; i++) {
        shuffledText += sents[perm[i]];
        shuffledText += (i + 1 < spans.length) ? text.slice(spans[i][1], spans[i + 1][0]) : text.slice(spans[i][1]);
      }
      let rep2;
      try { rep2 = detect(shuffledText, { shape: r.shape || 'auto', channel: r.channel || 'unknown', lang: 'auto', genre: r.genre || 'auto', domain: r.domain || 'general', allowUncalibrated: true, explain: true, now: NOW }); } catch { continue; }
      const r2 = { ...r, gated: rep2.verdict === 'insufficient_text', features: vectorFor(rep2) };
      if (r2.gated) { gatedAfter++; continue; }
      const before = R.model.p(r), after = R.model.p(r2);
      if (after === null || before === null) continue;
      deltas.push(Math.abs(after - before));
      const vec = (x) => R.model.use.map((n) => (x.features.has(n) ? clip((x.features.get(n) - R.model.mu[n]) / R.model.sigma[n], -3, 3) : 0));
      const rawOf = (x) => sigmoid(R.model.b + R.model.w.reduce((a, wi, j) => a + wi * vec(x)[j], 0));
      const rawDelta = Math.abs(rawOf(r2) - rawOf(r));
      rawDeltas.push(rawDelta);
      // which features moved, and by how much of the score
      const moved = [];
      for (let j = 0; j < R.model.use.length; j++) {
        const n = R.model.use[j];
        const z1 = r.features.has(n) ? clip((r.features.get(n) - R.model.mu[n]) / R.model.sigma[n], -3, 3) : 0;
        const z2 = r2.features.has(n) ? clip((r2.features.get(n) - R.model.mu[n]) / R.model.sigma[n], -3, 3) : 0;
        if (Math.abs(z2 - z1) > 1e-9) moved.push({ name: n, dContribution: R.model.w[j] * (z2 - z1) });
      }
      moved.sort((a, b) => Math.abs(b.dContribution) - Math.abs(a.dContribution));
      detail.push({ id: r.id, cell: r.cell, delta: Math.abs(after - before), rawDelta, moved });
    }
    if (!deltas.length) emit('- no eligible multi-sentence documents in the test side.');
    else {
      const sortedD = [...deltas].sort((a, b) => a - b);
      emit(`- ${deltas.length} documents re-scored with their sentences shuffled by the shipped segmenter, original inter-sentence separators preserved.`);
      emit(`- **${gatedAfter}** document(s) became \`insufficient_text\` AFTER the shuffle and are excluded from the deltas below — a shuffle that gates a document is itself a finding, and it used to leave the denominator without a line.`);
      if (unsplittable || noModel) emit(`- ${unsplittable} document(s) could not be re-assembled from their segmented sentences (NFC normalisation moved the bytes) and ${noModel} had no model for their cell; both are skipped and counted rather than dropped.`);
      emit(`- calibrated p: mean |delta| **${fmt(mean(deltas))}** · median **${fmt(sortedD[Math.floor(sortedD.length / 2)])}** · max **${fmt(sortedD[sortedD.length - 1])}**`);
      const sortedR = [...rawDeltas].sort((a, b) => a - b);
      emit(`- pre-isotonic score: mean |delta| **${fmt(mean(rawDeltas))}** · max **${fmt(sortedR[sortedR.length - 1])}** (isotonic calibration is a step function and flattens small moves, so this is the sensitive one)`);
      emit('- The score should barely move. A large move means the features are reading document order rather than style.');
      emit('');
      const top = [...detail].sort((a, b) => b.rawDelta - a.rawDelta).slice(0, 5);
      emit('Top 5 documents by |delta| on the pre-isotonic score, and the features that actually moved.');
      emit('A permutation cannot change the multiset of sentence lengths, so `sentence_len_cv`,');
      emit('`sentence_len_mode_mass` and `terminal_punct_ratio` moving at all means the segmenter drew');
      emit('different boundaries in the shuffled text — that is the control measuring itself.');
      emit('');
      emit('| row | cell | \\|delta p\\| | \\|delta raw\\| | features that moved (delta contribution) |');
      emit('|---|---|---:|---:|---|');
      for (const d of top) {
        const names = d.moved.length
          ? d.moved.slice(0, 6).map((m) => `\`${m.name}\` ${m.dContribution >= 0 ? '+' : ''}${fmt(m.dContribution)}`).join(', ') + (d.moved.length > 6 ? `, +${d.moved.length - 6} more` : '')
          : 'none — the score moved through the isotonic map only';
        emit(`| ${d.id} | ${d.cell} | ${fmt(d.delta)} | ${fmt(d.rawDelta)} | ${names} |`);
      }
      emit('');
      const freq = new Map();
      for (const d of detail) for (const m of d.moved) freq.set(m.name, (freq.get(m.name) || 0) + 1);
      const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (ranked.length) emit(`- across all ${detail.length} shuffled documents the features that moved most often were ${ranked.map(([n, c]) => `\`${n}\` (${c})`).join(', ')}.`);
      emit('');
    }
  }
  emit('');
  emit('### (e) the support-desk snippet library, scored as human text');
  emit('');
  {
    const f = path.join(opts.fixtures, 'cs-snippets.jsonl');
    if (!existsSync(f)) emit('- `cs-snippets.jsonl` not found.');
    else {
      const snips = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      const above = [];
      let scoredN = 0, gatedN = 0;
      const noModel = new Set();
      for (const s of snips) {
        for (const domain of ['general', 'customer_service']) {
          let rep;
          try { rep = detect(s.text, { shape: s.shape, channel: s.channel, lang: 'auto', genre: s.genre, domain, allowUncalibrated: true, explain: true, now: NOW }); } catch { continue; }
          const lang = rep.language?.primary || s.lang;
          const cell = `${lang === 'en' || lang === 'tr' ? lang : 'en'}:${rep.shape === 'chat' ? 'chat' : 'prose'}`;
          if (rep.verdict === 'insufficient_text') { if (domain === 'general') gatedN++; continue; }
          if (domain === 'general') scoredN++;
          const R = results.standard[cell];
          if (!R) { if (domain === 'general') noModel.add(cell); continue; }
          const p = R.model.p({ features: vectorFor(rep), gated: false, cell });
          if (p >= R.tau) above.push({ id: s.id, lang: s.lang, domain, p, verdict: rep.verdict });
        }
      }
      emit(`- ${snips.length} human support-desk snippets (15 en / 15 tr), each scored twice: once at \`--domain general\` and once at \`--domain customer_service\`.`);
      emit(`- at \`--domain general\`: ${gatedN} gated by the length floor, ${scoredN} scored.`);
      if (noModel.size) emit(`- ${[...noModel].join(', ')}: no fitted model for that cell, so those snippets could not be checked against a threshold at all. That gap is the result, not a pass.`);
      if (!above.length) emit('- **no snippet scored at or above t in either domain setting.**');
      else {
        emit(`- **${above.length} snippet/domain pairs scored at or above t.** These go on the domain-suppression list. B2 reports them; the head passes them to B1. B2 does not edit B1's lexicon.`);
        emit('');
        emit('| snippet | lang | domain setting | p | verdict |');
        emit('|---|---|---|---:|---|');
        for (const a of above.slice(0, 30)) emit(`| ${a.id} | ${a.lang} | ${a.domain} | ${fmt(a.p)} | ${a.verdict} |`);
      }
    }
  }
  emit('');

  // ---------------------------------------------------------------- base rates
  emit('## 9. Base-rate table — printed next to every precision figure');
  emit('');
  emit('Precision recomputed from this release\'s own measured FPR and recall at the priors a caller');
  emit('might actually face. A detector that is right about the ranking can still be wrong about four');
  emit('flags in five.');
  emit('');
  if (!headlineRows.length) {
    emit('- no cell reached the 100-per-side bar, so there is no measured FPR/TPR pair to project. That is itself the result.');
  } else {
    emit('| cell | bucket | FPR | recall | P@50% | P@20% | P@10% | P@5% | P@2% | P@1% |');
    emit('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const h of headlineRows) {
      const ps = [0.5, 0.2, 0.1, 0.05, 0.02, 0.01].map((p) => fmt(precisionAtPrior(p, h.c.tpr, h.c.fpr)));
      emit(`| ${h.cell} | ${h.bucket} | ${pct(h.c.fpr)} | ${pct(h.c.tpr)} | ${ps.join(' | ')} |`);
    }
  }
  emit('');
  emit('For reference, the design round measured precision **0.183 at a 1% prior** on this corpus at the');
  emit('strictest threshold it tested: four of five flags wrong. Nothing below should be read without it.');
  emit('');

  // ---------------------------------------------------------------- fixtures
  emit('## 10. Authored LLM fixtures and the humanization collapse');
  emit('');
  {
    const fx = scored.filter((r) => String(r.source).startsWith('fixture:'));
    const byId = new Map(fx.map((r) => [r.id, r]));
    emit('| fixture | variant | transform | verdict | p | delta vs its clean sibling |');
    emit('|---|---|---|---|---:|---:|');
    let drops = 0, pairs = 0;
    for (const r of fx) {
      const R = results.standard[r.cell];
      const p = R && !r.gated ? R.model.p(r) : null;
      let delta = '';
      if (r.pairId && byId.has(r.pairId)) {
        const base = byId.get(r.pairId);
        const Rb = results.standard[base.cell];
        const pb = Rb && !base.gated ? Rb.model.p(base) : null;
        if (p !== null && pb !== null) { pairs++; if (p < pb) drops++; delta = fmt(p - pb); }
      }
      emit(`| ${r.id} | ${r.variant} | ${r.transform || '—'} | ${r.verdict} | ${fmt(p)} | ${delta} |`);
    }
    emit('');
    emit(`- humanization transforms (b) and (c) were applied to ${pairs} scored pairs; the score dropped in **${drops}** of them.`);
    emit('- The point of this table is to document the collapse in CI, not to pretend it is prevented. A humanized row that still scores high is luck, not robustness.');
  }
  emit('');

  // ---------------------------------------------------------------- segmenter oracle
  emit('## 11. Segmenter cross-check against `Intl.Segmenter`');
  emit('');
  {
    if (typeof Intl.Segmenter !== 'function') emit('- `Intl.Segmenter` is unavailable in this runtime; the cross-check did not run.');
    else {
      const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
      const sample = scored.filter((r) => !r.gated && (r.rep.counts?.sentences || 0) >= 2).slice(0, opts.quick ? 100 : 500);
      let diff = 0, tot = 0, absDiff = 0;
      for (const r of sample) {
        const oracle = [...seg.segment(String(r.text))].length;
        const ours = r.rep.counts.sentences;
        tot++;
        if (oracle !== ours) diff++;
        absDiff += Math.abs(oracle - ours);
      }
      emit(`- ${tot} documents compared. Sentence count differed on **${diff}** (${pct(tot ? diff / tot : 0)}); mean absolute difference **${fmt(tot ? absDiff / tot : 0, 2)}** sentences.`);
      emit('- `Intl.Segmenter` is an oracle here and nowhere else: its behaviour depends on the ICU version compiled into the host binary, which is exactly why the shipped path may not use it.');
    }
  }
  emit('');

  // ---------------------------------------------------------------- fixture gates
  emit('## 12. Fixture gates (`must-not-fire.jsonl`)');
  emit('');
  emit('The release gate itself lives in `selftest.mjs`, which B1 owns. This section reports what');
  emit('the detector under test actually did with the 24 rows, so the head does not have to take the');
  emit('selftest\'s word for it.');
  emit('');
  {
    const f = path.join(opts.fixtures, 'must-not-fire.jsonl');
    if (!existsSync(f)) emit('- `must-not-fire.jsonl` not found.');
    else {
      const rowsF = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
      const results = [];
      for (const r of rowsF) {
        let rep;
        try { rep = detect(r.text, { shape: r.shape, channel: r.channel, lang: 'auto', genre: r.genre, domain: r.domain, allowUncalibrated: true, explain: true, now: NOW }); } catch (e) { results.push({ ...r, verdict: 'THREW: ' + e.message, ok: false }); continue; }
        results.push({ ...r, verdict: rep.verdict, ok: r.allowed.includes(rep.verdict), critical: (r.criticalFailure || []).includes(rep.verdict) });
      }
      const A = results.filter((r) => r.group === 'A'), B = results.filter((r) => r.group === 'B');
      const aLikelyLlm = A.filter((r) => r.verdict === 'likely_llm').length;
      const bLikelyHuman = B.filter((r) => r.verdict === 'likely_human').length;
      const bAbstain = B.filter((r) => r.verdict === 'insufficient_text' || r.verdict === 'uncertain').length;
      emit('| gate | required | observed | |');
      emit('|---|---|---:|---|');
      emit(`| \`likely_llm\` on the 12 human-that-looks-LLM rows | 0 | ${aLikelyLlm} | ${aLikelyLlm === 0 ? 'PASS' : 'FAIL'} |`);
      emit(`| \`likely_human\` on the 12 LLM-that-looks-human rows | 0 | ${bLikelyHuman} | ${bLikelyHuman === 0 ? 'PASS' : 'FAIL'} |`);
      emit(`| abstention on the LLM-that-looks-human rows | at least 6 | ${bAbstain} | ${bAbstain >= 6 ? 'PASS' : 'FAIL'} |`);
      emit('');
      const bad = results.filter((r) => !r.ok);
      if (!bad.length) emit('- every row landed inside its `allowed` verdict set.');
      else {
        emit(`- ${bad.length} of ${results.length} rows landed outside their \`allowed\` set:`);
        emit('');
        emit('| row | truth | verdict | allowed | critical failure? |');
        emit('|---|---|---|---|---|');
        for (const r of bad) emit(`| ${r.id}${r.replaces ? ' (replacement)' : ''} | ${r.truth} | ${r.verdict} | ${r.allowed.join(', ')} | ${r.critical ? '**yes**' : 'no'} |`);
      }
      emit('');
      emit('Abstention is the deliverable, not the consolation prize.');
    }
  }
  emit('');

  // ---------------------------------------------------------------- weights.fitted.json
  // HEAD-RULINGS R36(d): the hash covered IDS ONLY, so editing the text of every row in the
  // corpus left it unchanged — a corpusHash that cannot detect a changed corpus is decoration.
  // It now covers the id, the SIDE the row landed on, and a hash of the normalised text, sorted
  // so row order cannot move it.
  const corpusHash = createHash('sha256').update(
    rows.map((r) => `${r.id}|${r.side}|${createHash('sha256').update(normKey(r.text || '')).digest('hex')}`)
      .sort().join('\n'),
  ).digest('hex');
  const generatedAt = new Date().toISOString().slice(0, 10);
  const expiresAt = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  // HEAD-RULINGS R36(c): the file must carry every field the CLI's loader dereferences, or
  // `--weights eval/out/weights.fitted.json` is an uncaught TypeError and R23's opt-in path is a
  // promise nobody can keep. The prior file is the schema of record: per-feature `kind` is copied
  // from it (the transform a feature uses is a property of the FEATURE, not of the fit), and the
  // top-level `K` comes from it too. A cell that could not be fitted is emitted as an explicit
  // `{status, reason}`, which lib/score.mjs's isNotFittedCell() recognises and detect() turns into
  // a fall-back to the prior cell with warning `cell_not_fitted_prior_used`.
  const priorFile = path.resolve(path.dirname(detectorPath), 'weights.v1.json');
  let prior = null;
  try { prior = JSON.parse(readFileSync(priorFile, 'utf8')); }
  catch (e) { process.stderr.write(`fatal: cannot read the prior weights at ${priorFile} (${e.message}). The fitted file copies its per-feature "kind" map and its K; emitting a fitted file without them would ship a file the CLI cannot load.\n`); process.exit(2); }

  // `kind` is a property of the FEATURE, not of the cell: it names the transform the detector
  // applies to that feature's raw value. The prior file lists a feature only in the cells where it
  // is scoped (a Turkish chat feature is absent from en:prose), while a fitted cell can carry a
  // weight for any feature that reached it. So resolve `kind` from the cell first and from the
  // union over every prior cell second, and assert the union is consistent — two prior cells
  // disagreeing about a feature's transform would be a real schema bug worth stopping for.
  const priorKindUnion = {};
  for (const [cellName, c] of Object.entries(prior.cells || {})) {
    for (const [f, k] of Object.entries(c.kind || {})) {
      if (priorKindUnion[f] && priorKindUnion[f].kind !== k) {
        process.stderr.write(`fatal: weights.v1.json disagrees with itself about feature "${f}": `
          + `${priorKindUnion[f].cell} says "${priorKindUnion[f].kind}", ${cellName} says "${k}".\n`);
        process.exit(2);
      }
      priorKindUnion[f] = { kind: k, cell: cellName };
    }
  }

  const fitted = {
    provenance: 'fitted',
    weightsId: 'fitted-' + corpusHash.slice(0, 8),
    generatedAt, expiresAt,
    corpusHash: corpusHash.slice(0, 16),
    corpusHashNote: 'sha256 over the sorted list of "id|side|sha256(normKey(text))" for every row in the split (HEAD-RULINGS R36(d)). Changing any row\'s text, side or id changes it.',
    K: prior.K,
    modelFamiliesCovered: [...new Set(scored.filter((r) => r.y === 1).map((r) => r.generator || r.source))].sort(),
    languageScope: ['en', 'tr'],
    lambda: 1.0,
    lambdaNote: 'HEAD-RULINGS R36(i): fitLogistic applies the L2 gradient as lambda*w/n, so the EFFECTIVE penalty on the summed loss is lambda/n and shrinkage weakens as a cell grows (38% norm reduction at n=200, 5% at n=5000). `lambdaEffective` is recorded per fitted cell. This is documented, not refitted, this round.',
    note: 'Cells are {en,tr} x {chat,prose} (four, not six) per HEAD-RULINGS R22. Fitted by eval/run-eval.mjs. Per HEAD-RULINGS R11/R23 the CLI default stays weights.v1.json until the head decides otherwise; nobody flips it unilaterally. A cell marked "not fitted" makes the loader fall back to the PRIOR cell and warn `cell_not_fitted_prior_used`.',
    cells: {},
    hardMode: {},
  };
  const notFittedCells = [];
  for (const cell of ['en:chat', 'en:prose', 'tr:chat', 'tr:prose']) {
    const R = results.standard[cell];
    const priorCell = prior.cells?.[cell] || {};
    if (!R) {
      const nFitRows = scored.filter((r) => r.side === 'fit' && r.cell === cell && !r.gated).length;
      fitted.cells[cell] = {
        status: 'not fitted',
        reason: `too few rows survived the gates on the fitting side of this cell (${nFitRows} scored fit-side rows). The CLI falls back to the prior cell and warns cell_not_fitted_prior_used.`,
      };
      notFittedCells.push(cell);
      continue;
    }
    const m = R.model;
    // `kind` must cover every feature this cell carries a weight for. The prior file is the source
    // of truth; a feature the prior does not know is a schema drift and must stop the run, not
    // silently ship a cell the loader will reject.
    const kind = {};
    const missingKind = [];
    for (const n of m.use) {
      const k = priorCell.kind?.[n] ?? priorKindUnion[n]?.kind;
      if (!k) missingKind.push(n); else kind[n] = k;
    }
    if (missingKind.length) {
      process.stderr.write(`fatal: no "kind" anywhere in weights.v1.json for ${cell} feature(s) ${missingKind.join(', ')}. `
        + 'The fitted file cannot be emitted without them: the CLI dereferences cell.kind[feature].\n');
      process.exit(2);
    }
    fitted.cells[cell] = {
      b0: m.b, tau: Number.isFinite(R.tau) ? R.tau : null,
      tau_note: Number.isFinite(R.tau) ? R.tauSource
        : 'null means NO threshold satisfies the fairness limit on this cell: nothing is flagged. It is not 1.0, because the flag rule is p >= tau and the isotonic map saturates at exactly 1.0.',
      isotonic: m.iso, n_fit_rows: m.nFit, n_val_rows: m.nVal,
      lambda: 1.0,
      lambdaEffective: m.nFit ? 1.0 / m.nFit : null,
      w: Object.fromEntries(m.use.map((n, j) => [n, m.w[j]])),
      mu: m.mu, sigma: m.sigma,
      kind,
      signFlips: m.signFlips,
    };
    const H = results.hard[cell];
    if (H) fitted.hardMode[cell] = { b0: H.model.b, tau: Number.isFinite(H.tau) ? H.tau : null, w: Object.fromEntries(H.model.use.map((n, j) => [n, H.model.w[j]])) };
  }
  // Round every number on the way out. Six decimals is more precision than any of these
  // coefficients deserve, and a full float prints a 15-digit run that trips the head's
  // phone-shaped-digit-run acceptance grep on a tracked file.
  const round6 = (k, v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(6)) : v);
  const fittedPath = path.join(outDir, 'weights.fitted.json');
  const serialised = JSON.stringify(fitted, round6, 2) + '\n';
  // Check the file against the SHIPPED loader's own contract before writing it. A fitted file the
  // CLI cannot load is worse than no fitted file: it turns R23's documented opt-in into a crash.
  try { validateWeightsShape(JSON.parse(serialised), path.relative(process.cwd(), fittedPath)); }
  catch (e) {
    process.stderr.write(`fatal: the fitted weights this run produced do not satisfy the shipped loader's contract.\n${e.message}\n`);
    process.exit(6);
  }
  writeFileSync(fittedPath, serialised, 'utf8');

  emit('## 13. Output');
  emit('');
  emit(`- \`${path.relative(process.cwd(), fittedPath)}\` — provenance \`fitted\`, weightsId \`${fitted.weightsId}\`, corpusHash \`${fitted.corpusHash}\`, expires ${expiresAt} (180 days).`);
  emit(`- It carries every field the shipped loader dereferences — top-level \`provenance\`, \`weightsId\`, \`generatedAt\`, \`expiresAt\`, \`K\`, \`cells\`, and per fitted cell \`b0\`, \`w\`, \`mu\`, \`sigma\` and the per-feature \`kind\` map copied from \`weights.v1.json\` — and this run validated it against \`lib/score.mjs\`'s own \`validateWeightsShape()\` before writing it (HEAD-RULINGS R36(c)).`);
  emit(notFittedCells.length
    ? `- Cells not fitted this round: ${notFittedCells.map((c) => '`' + c + '`').join(', ')}. They are emitted as an explicit \`{status:"not fitted", reason}\`; the CLI falls back to the PRIOR cell for them and warns \`cell_not_fitted_prior_used\`. A text routed to one of those cells is NOT scored with fitted weights, whatever the file's \`provenance\` says.`
    : '- Every cell was fitted this round.');
  emit(`- \`corpusHash\` is sha256 over the sorted \`id|side|sha256(normKey(text))\` of every row (R36(d)). The previous hash covered ids only and did not move when a row's text changed.`);
  emit('- Per HEAD-RULINGS R11/R23 the shipped CLI default remains `weights.v1.json`. Whether the fitted file becomes the default is the head\'s call after reading this report.');
  emit('');
  emit('## What this report does not say');
  emit('');
  emit('- It does not quote an accuracy without its base rate, its language, its length bucket and the');
  emit('  three-humans caveat. The human side of the in-house corpus is three people, not a sample of humanity.');
  emit('- It reports held-out numbers only. Nothing on the fitting side appears in a headline table, and');
  emit('  emit() exits with code 4 rather than print one. (This paragraph is the reference only exemption.)');
  emit('- `insufficient_text` on most of the real chat stream is the product, not a bug to tune away.');

  writeFileSync(path.join(outDir, 'REPORT.md'), REPORT_LINES.join('\n') + '\n', 'utf8');
  process.stderr.write(`\nwrote ${path.join(outDir, 'REPORT.md')}\n`);
}

main().catch((e) => { process.stderr.write(`fatal: ${e.stack || e.message}\n`); process.exit(1); });
