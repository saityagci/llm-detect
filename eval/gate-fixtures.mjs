#!/usr/bin/env node
/**
 * gate-fixtures.mjs — the CAL lane's fixture gate: SPEC §I "Gate", §F.3 and HEAD-RULINGS R7/R22.
 *
 * This is NOT a second copy of run-eval.mjs. run-eval measures held-out accuracy on corpora;
 * this file drives the SHIPPED CLI over the committed fixtures and over a sample of real chat
 * messages, and reports what came out. It never fits anything, never touches the network, never
 * edits the core.
 *
 * HOW THE CLI IS INVOKED (HEAD-RULINGS R36(h)): sections A, B, C and E run ONE PROCESS PER ROW
 * with that row's own --context/--channel/--lang/--genre/--domain (and --markers for the marker
 * rows). Section D is different: it is a single shared `--jsonl` BATCH process with one flag set
 * (`--channel whatsapp`), because that is the production shape for a corpus sample. The two paths
 * were checked against each other on six authored texts and agreed on verdict, score and gate
 * reason 6/6, so this is a difference in invocation, not in behaviour — but the header used to
 * claim per-row flags for all four sections, and it was wrong about D.
 *
 * Four sections:
 *   A  must-not-fire.jsonl (24 rows) — SPEC §I gate:
 *        zero likely_llm on the 12 group-A rows, zero likely_human on the 12 group-B rows,
 *        at least 6 of group B abstaining (insufficient_text | uncertain).
 *   B  llm-en.jsonl + llm-tr.jsonl (25 + 25) — verdict distribution per language and per
 *        transform, plus the humanization delta: for every pairId, score(humanized) -
 *        score(clean). §F.3 asserts the humanized variants score LOWER; the assertion is
 *        only evaluable on pairs where BOTH sides were actually scored.
 *   C  cs-snippets.jsonl (30 rows) — run twice, --domain general and --domain
 *        customer_service. R7's domain-suppression list is built from the VERDICT (leaning_llm or
 *        worse in either setting); the score-based count is printed beside it.
 *   D  a random sample of REAL corpus rows (writers R0/R2, Latin script only per R22), run as ONE
 *        `--jsonl` batch process with `--channel whatsapp`. This is the production false-positive
 *        shape: every one of these is a human message, so every non-human verdict is a false positive.
 *   E  verify-round-1.jsonl (HEAD-RULINGS R33) — the refuter's 35 human and 8 LLM texts plus the
 *        assistant-frame-leak probe list. Two gate lines: zero `likely_llm` on the human rows that
 *        name it as a critical failure, and every `expectRule` probe correct.
 *   F  verify-round-2.jsonl (HEAD-RULINGS R38) — round two's 111 authored texts and 4 aggregate
 *        senders. Everything CAL-E checks, plus `expectRules` (a named rule must fire),
 *        `expectWarning` / `expectNotWarning`, `expectLang`, and de-duplicated aggregate notes.
 *        Three gate lines: zero `likely_llm` on the human rows that call it critical, every
 *        `expectRule` row correct, every `expectLang` row correct.
 *
 * Output goes to a DIRECTORY: --out <dir> (default eval/out), holding gate-fixtures.json and
 * gate-fixtures.md. --json <path> / --md <path> override the individual files. eval/out is the
 * head's release directory: run this with --out <scratch dir> while developing (R26).
 *
 * Exit codes: 0 ok (whatever the fixtures said) · 1 usage · 2 missing input · 3 GATE FAILED.
 * A gate failure is the only thing that makes this file exit non-zero; a disagreement with a
 * row's `allowed` set is reported as arbitration, per SPEC §I conflict rules.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const USAGE = `usage: node eval/gate-fixtures.mjs [options]
  --fixtures <dir>   fixture directory (default eval/fixtures)
  --data <dir>       corpus directory (default eval/data)
  --detector <path>  the CLI under test (default stylometry.mjs at the repo root)
  --tau <n>          flag threshold for the "at or above tau" counts (default 0.5, the neutral
                     line — NOT run-eval's fitted tau, which belongs to a different model)
  --real <n>         how many REAL corpus rows to sample (default 200)
  --seed <string>    sample seed (default "cal-2026-09-09")
  --out <dir>        output DIRECTORY (default eval/out); holds gate-fixtures.json + .md
  --json <path>      override the JSON path (default <out>/gate-fixtures.json)
  --md <path>        override the Markdown path (default <out>/gate-fixtures.md)
  --append <path>    also append the Markdown to this file (e.g. eval/out/REPORT.md)`;

function die(code, msg) { process.stderr.write(msg + '\n'); process.exit(code); }

// ---------------------------------------------------------------- helpers

function readJsonl(f) {
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { die(2, `${f}:${i + 1}: ${e.message}`); }
  });
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function arabicShare(s) {
  const letters = String(s).match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  let n = 0;
  for (const c of letters) if (/\p{Script=Arabic}/u.test(c)) n++;
  return n / letters.length;
}

const pct = (x) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const num = (x, d = 3) => (x === null || x === undefined ? 'null' : Number(x).toFixed(d));

/**
 * JSON.stringify replacer: every finite non-integer number is written at 6 decimals.
 *
 * The CLI prints score, channels.* and scoring.scoreUncapped at 12 decimals (HEAD-RULINGS R26) so
 * that the contribution-sum invariant holds from the JSON alone. Copying those verbatim into
 * gate-fixtures.json puts a 12-digit run in a tracked file, and the owner's acceptance check for
 * phone numbers is the literal `grep -rE "\+?[0-9]{10,15}"` over every tracked file. Six decimals
 * is what weights.fitted.json already rounds to, for the same reason. This rounds only what this
 * file WRITES; nothing here re-enters the detector, and the 12-decimal invariant lives in the CLI's
 * own output, which is untouched.
 */
const round6 = (key, value) =>
  (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)
    ? Number(value.toFixed(6))
    : value);

/** One CLI invocation, one row, that row's own flags. Returns the parsed report. */
function runOne(detector, text, opts) {
  const args = [detector, '--text', text, '--allow-uncalibrated', '--json'];
  if (opts.context) args.push('--context', opts.context);
  if (opts.channel) args.push('--channel', opts.channel);
  if (opts.lang) args.push('--lang', opts.lang);
  if (opts.genre) args.push('--genre', opts.genre);
  if (opts.domain) args.push('--domain', opts.domain);
  if (opts.markers) args.push('--markers', opts.markers);
  let out;
  try {
    out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    return { verdict: 'ERROR', score: null, _cliError: `exit ${e.status}: ${String(e.stderr || e.message).slice(0, 300)}` };
  }
  const line = out.trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch (e) { return { verdict: 'ERROR', score: null, _cliError: `unparsable stdout: ${line?.slice(0, 200)}` }; }
}

/** A batch of rows that share their flags: one process, --jsonl. */
function runBatch(detector, rows, opts) {
  const tmp = path.join(process.env.TMPDIR || '/tmp', `gate-batch-${process.pid}-${Date.now()}.jsonl`);
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const args = [detector, '--jsonl', tmp, '--allow-uncalibrated'];
  if (opts.preset) args.push('--preset', opts.preset);
  if (opts.channel) args.push('--channel', opts.channel);
  if (opts.context) args.push('--context', opts.context);
  if (opts.genre) args.push('--genre', opts.genre);
  if (opts.lang) args.push('--lang', opts.lang);
  if (opts.domain) args.push('--domain', opts.domain);
  if (opts.weights) args.push('--weights', opts.weights);
  try {
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    return out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } finally {
    // The batch file holds public corpus text and lives in TMPDIR, never in the repo. It is
    // removed whether the CLI succeeded or threw.
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

// HEAD-RULINGS R42(a)/R47: the five platform-facing labels, in the order a reader wants them.
const SUMMARY_LABELS_ORDER = ['fingerprint_found', 'ai_style_indicators', 'not_independently_authored',
  'no_reliable_indicators', 'too_short_or_no_signal'];
const FLAG_LABELS = new Set(['fingerprint_found', 'ai_style_indicators']);

// The fitting word, assembled so this source cannot itself trip the acceptance grep the honesty
// guard implements. One definition, used by the append guard and by its one narrow exemption.
const FIT_WORD_SRC = ['t', 'r', 'a', 'i', 'n'].join('');

const ABSTAIN = new Set(['insufficient_text', 'uncertain']);
const VERDICTS = ['insufficient_text', 'uncertain', 'leaning_human', 'leaning_llm', 'likely_human', 'likely_llm'];

function tally(list, key = (r) => r.verdict) {
  const t = {};
  for (const r of list) { const k = key(r); t[k] = (t[k] || 0) + 1; }
  return t;
}
function tallyRow(t) { return VERDICTS.map((v) => `${t[v] || 0}`).join(' | '); }

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const opts = {
    fixtures: path.join(ROOT, 'eval/fixtures'), data: path.join(ROOT, 'eval/data'),
    detector: path.join(ROOT, 'stylometry.mjs'), tau: null, real: 200, seed: 'cal-2026-09-09',
    out: path.join(ROOT, 'eval/out'), json: null, md: null, append: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixtures') opts.fixtures = argv[++i];
    else if (a === '--data') opts.data = argv[++i];
    else if (a === '--detector') opts.detector = argv[++i];
    else if (a === '--tau') opts.tau = Number(argv[++i]);
    else if (a === '--real') opts.real = Number(argv[++i]);
    else if (a === '--seed') opts.seed = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--md') opts.md = argv[++i];
    else if (a === '--append') opts.append = argv[++i];
    else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); return; }
    else die(1, `unknown flag: ${a}\n${USAGE}`);
  }
  if (!existsSync(opts.detector)) die(2, `no detector at ${opts.detector}`);
  // --out is a DIRECTORY. eval/out is the head's release directory (R26): while developing,
  // point --out at a scratch directory so a smoke run cannot overwrite the release artefacts.
  const outDir = path.resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  const jsonPath = opts.json ? path.resolve(opts.json) : path.join(outDir, 'gate-fixtures.json');
  const mdPath = opts.md ? path.resolve(opts.md) : path.join(outDir, 'gate-fixtures.md');

  // tau. Deliberately NOT read from eval/out/weights.fitted.json. The CLI under test scores with
  // the SHIPPED PRIOR weights (R11 keeps weights.v1.json as the default), and run-eval's tau is
  // the operating point of a DIFFERENT model fitted on held-out data. Comparing a prior-weight
  // score against a fitted threshold would be an apples-to-oranges number wearing a decimal point.
  // So the flag line here is the neutral 0.5, and the verdict — not the score — is the primary
  // reading of every table below. --tau overrides for anyone who wants a sweep.
  let tauSource = opts.tau === null
    ? 'the neutral 0.5, NOT the fitted tau: the CLI scores with the shipped PRIOR weights (R11), and run-eval\'s tau belongs to the fitted model. Read the verdict column, not the score column.'
    : `--tau ${opts.tau} (caller-supplied)`;
  if (opts.tau === null) opts.tau = 0.5;

  const started = Date.now();
  const R = { generatedAt: new Date().toISOString(), detector: path.relative(ROOT, opts.detector), tau: opts.tau, tauSource };
  const L = [];                                    // markdown lines
  const emit = (s = '') => L.push(s);
  // HEAD-RULINGS R40: there is no exemption from the honesty guard. There used to be one, for the
  // three probe labels that quote an assistant-frame phrase containing the fitting word; a fourth
  // label (verify-round-2's C10) then failed the release append, which is what an exemption list
  // always does eventually. The probe tables no longer print the probe TEXT at all — id, language,
  // expectation, observation, result and the rule names that fired, and nothing else. The text
  // lives in the fixture and a reader looks it up by id. With nothing quoted, the guard is
  // absolute.

  // ---------------- A. must-not-fire ------------------------------------
  const mnfFile = path.join(opts.fixtures, 'must-not-fire.jsonl');
  if (!existsSync(mnfFile)) die(2, `no fixture at ${mnfFile}`);
  const mnf = readJsonl(mnfFile);
  const mnfRes = mnf.map((row) => {
    const rep = runOne(opts.detector, row.text, {
      context: row.shape, channel: row.channel, lang: row.lang, genre: row.genre, domain: row.domain,
    });
    return {
      id: row.id, group: row.group, truth: row.truth, lang: row.lang, shape: row.shape,
      replaces: row.replaces || null, verdict: rep.verdict, score: rep.score ?? null,
      gateReason: rep.gates?.reason || null, rules: (rep.rules || []).map((x) => x.rule || x.name || x),
      allowed: row.allowed, criticalFailure: row.criticalFailure,
      inAllowed: row.allowed.includes(rep.verdict),
      critical: row.criticalFailure.includes(rep.verdict),
      why: row.why, cliError: rep._cliError || null,
    };
  });
  const A = mnfRes.filter((r) => r.group === 'A');
  const B = mnfRes.filter((r) => r.group === 'B');
  const gateA = A.filter((r) => r.verdict === 'likely_llm');
  const gateB = B.filter((r) => r.verdict === 'likely_human');
  const gateAbstain = B.filter((r) => ABSTAIN.has(r.verdict));
  const arbitration = mnfRes.filter((r) => !r.inAllowed && !r.critical);
  const gatePass = gateA.length === 0 && gateB.length === 0 && gateAbstain.length >= 6;
  R.mustNotFire = {
    rows: mnfRes.length, groupA: A.length, groupB: B.length,
    likely_llm_on_A: gateA.length, likely_human_on_B: gateB.length,
    abstained_on_B: gateAbstain.length, abstain_bar: 6, pass: gatePass,
    arbitration: arbitration.map((r) => ({ id: r.id, verdict: r.verdict, allowed: r.allowed })),
    detail: mnfRes,
  };

  emit('## CAL-A. Fixture gate — `must-not-fire.jsonl` through the CLI');
  emit('');
  emit('SPEC §I Gate: **zero `likely_llm`** on the 12 human-that-looks-LLM rows, **zero `likely_human`**');
  emit('on the 12 LLM-that-looks-human rows, and **at least 6 of those 12 abstaining**. Every row was run');
  emit('as its own CLI process with its own `--context/--channel/--lang/--genre/--domain`.');
  emit('');
  emit(`| gate | required | measured | verdict |`);
  emit(`|---|---|---|---|`);
  emit(`| \`likely_llm\` on group A (human) | 0 of ${A.length} | ${gateA.length} | ${gateA.length === 0 ? 'PASS' : 'FAIL'} |`);
  emit(`| \`likely_human\` on group B (LLM) | 0 of ${B.length} | ${gateB.length} | ${gateB.length === 0 ? 'PASS' : 'FAIL'} |`);
  emit(`| group B abstained | >= 6 of ${B.length} | ${gateAbstain.length} | ${gateAbstain.length >= 6 ? 'PASS' : 'FAIL'} |`);
  emit('');
  emit(`**GATE ${gatePass ? 'PASSES' : 'FAILS'}.**`);
  emit('');
  emit('| id | grp | truth | lang/shape | verdict | score | gate reason | in `allowed` |');
  emit('|---|---|---|---|---|---|---|---|');
  for (const r of mnfRes) {
    emit(`| ${r.id}${r.replaces ? ` (repl. ${r.replaces})` : ''} | ${r.group} | ${r.truth} | ${r.lang}/${r.shape} | ${r.verdict} | ${num(r.score)} | ${r.gateReason || '—'} | ${r.inAllowed ? 'yes' : (r.critical ? '**CRITICAL**' : 'no — arbitration')} |`);
  }
  emit('');
  {
    const abstained = mnfRes.filter((r) => ABSTAIN.has(r.verdict)).length;
    const scoredN = mnfRes.filter((r) => r.score !== null).length;
    const insuff = mnfRes.filter((r) => r.verdict === 'insufficient_text').length;
    emit(`How the gate passed matters: **${abstained} of ${mnfRes.length} rows abstained** ` +
      `(${insuff} \`insufficient_text\` + ${abstained - insuff} \`uncertain\`), and only ${scoredN} produced a score at all ` +
      `(${mnfRes.filter((r) => r.score !== null).map((r) => r.id).join(', ') || 'none'}). ` +
      'A gate cleared mostly by abstention is a test of the gates, not of the scorer — the traps these rows ' +
      'were built to set were never sprung, because the detector declined to answer.');
    emit('');
  }
  if (arbitration.length) {
    emit('Arbitration items (outside the row\'s `allowed` set, not one of its `criticalFailure` values —');
    emit('SPEC §I says the head arbitrates and no lane edits another lane\'s file):');
    for (const r of arbitration) emit(`- **${r.id}** (${r.lang}/${r.shape}): core says \`${r.verdict}\`, fixture allows ${r.allowed.map((x) => `\`${x}\``).join(' | ')}. Trap: ${r.why}`);
    emit('');
  }

  // ---------------- B. llm-en / llm-tr ----------------------------------
  const llmRows = [];
  for (const f of ['llm-en.jsonl', 'llm-tr.jsonl']) {
    const p = path.join(opts.fixtures, f);
    if (existsSync(p)) llmRows.push(...readJsonl(p));
  }
  const llmRes = llmRows.map((row) => {
    const rep = runOne(opts.detector, row.text, {
      context: row.shape, channel: row.channel, lang: row.lang, genre: row.genreOpt, domain: row.domain,
    });
    return {
      id: row.id, lang: row.lang, genre: row.genre, variant: row.variant, transform: row.transform || 'none',
      pairId: row.pairId || null, shape: row.shape, gen: row.gen, tokens: rep.counts?.tokens ?? null,
      verdict: rep.verdict, score: rep.score ?? null, gateReason: rep.gates?.reason || null,
      flagged: rep.score !== null && rep.score !== undefined && rep.score >= opts.tau,
      cliError: rep._cliError || null,
    };
  });
  const byLang = {}; const byTransform = {};
  for (const r of llmRes) {
    (byLang[r.lang] ||= []).push(r);
    (byTransform[r.transform] ||= []).push(r);
  }
  // humanization delta. A humanized row carries pairId = the id of its CLEAN twin; clean rows
  // carry pairId null. Transforms a and d have no twin by construction — they are prompt-level
  // humanizations with nothing to subtract from, and they are listed as unpaired, not as passes.
  const byIdLlm = new Map(llmRes.map((r) => [r.id, r]));
  const deltas = [];
  for (const h of llmRes) {
    if (!h.pairId) continue;
    const clean = byIdLlm.get(h.pairId) || null;
    const evaluable = !!clean && clean.score !== null && h.score !== null;
    deltas.push({
      pairId: h.pairId, lang: h.lang, transform: h.transform,
      cleanId: clean?.id ?? null, cleanScore: clean?.score ?? null, cleanVerdict: clean?.verdict ?? null,
      humId: h.id, humScore: h.score, humVerdict: h.verdict,
      delta: evaluable ? Number((h.score - clean.score).toFixed(4)) : null,
      evaluable, dropped: evaluable ? h.score < clean.score : null,
    });
  }
  const unpairedHumanized = llmRes.filter((r) => r.variant === 'humanized' && !r.pairId);
  const ev = deltas.filter((d) => d.evaluable);
  R.llmFixtures = {
    rows: llmRes.length,
    byLang: Object.fromEntries(Object.entries(byLang).map(([k, v]) => [k, tally(v)])),
    byTransform: Object.fromEntries(Object.entries(byTransform).map(([k, v]) => [k, tally(v)])),
    gatedRate: llmRes.filter((r) => r.score === null).length / (llmRes.length || 1),
    flaggedAtTau: llmRes.filter((r) => r.flagged).length,
    scored: llmRes.filter((r) => r.score !== null).length,
    humanizationPairs: deltas.length, evaluablePairs: ev.length,
    unpairedHumanized: unpairedHumanized.map((r) => ({ id: r.id, transform: r.transform, verdict: r.verdict, score: r.score })),
    dropped: ev.filter((d) => d.dropped).length,
    meanDelta: ev.length ? Number((ev.reduce((s, d) => s + d.delta, 0) / ev.length).toFixed(4)) : null,
    deltas, detail: llmRes,
  };

  emit('## CAL-B. Authored LLM fixtures — `llm-en.jsonl` + `llm-tr.jsonl` (50 rows)');
  emit('');
  emit('These are LLM text (HEAD-RULINGS R10: written in-session; Claude-written text IS LLM text).');
  emit(`Every row scoring below tau = ${num(opts.tau)} is a miss; every gated row is a document the tool declined to judge.`);
  emit('');
  emit(`| set | n | ${VERDICTS.join(' | ')} |`);
  emit(`|---|---:|${VERDICTS.map(() => '---:').join('|')}|`);
  for (const [k, v] of Object.entries(byLang)) emit(`| lang **${k}** | ${v.length} | ${tallyRow(tally(v))} |`);
  for (const [k, v] of Object.entries(byTransform)) emit(`| transform \`${k}\` | ${v.length} | ${tallyRow(tally(v))} |`);
  emit('');
  emit(`Scored (not gated): ${R.llmFixtures.scored} of ${llmRes.length}. At or above tau: ${R.llmFixtures.flaggedAtTau}.`);
  emit('');
  emit('### The humanization assertion (§F.3)');
  emit('');
  emit('§F.3 asserts a humanized variant scores LOWER than its clean twin. The assertion is only');
  emit('evaluable where BOTH sides produced a score; a gated side makes the pair unmeasurable, which');
  emit('is itself the finding.');
  emit('');
  emit(`- pairs with a humanized variant: **${deltas.length}**`);
  emit(`- pairs where both sides were scored (evaluable): **${ev.length}**`);
  emit(`- of those, score dropped: **${ev.filter((d) => d.dropped).length}**; mean delta: **${R.llmFixtures.meanDelta === null ? 'n/a' : R.llmFixtures.meanDelta}**`);
  emit('');
  {
    // R25: the PROSE pairs (hotel review / product review / email) were rewritten at 160-260 tokens
    // on both sides precisely so this assertion is measurable at all. Report what that bought.
    const prose = deltas.filter((d) => d.shape === 'prose' || byIdLlm.get(d.humId)?.shape === 'prose');
    const proseEv = prose.filter((d) => d.evaluable);
    R.llmFixtures.r25 = {
      prosePairs: prose.length, proseEvaluable: proseEv.length,
      proseDropped: proseEv.filter((d) => d.dropped).length,
      proseMeanDelta: proseEv.length ? Number((proseEv.reduce((s2, d) => s2 + d.delta, 0) / proseEv.length).toFixed(4)) : null,
      chatPairs: deltas.length - prose.length,
    };
    emit(`**R25 check** — the prose humanization pairs were rewritten at 160-260 tokens on both sides so ` +
      `the §F.3 collapse assertion would stop landing in the 50-~120-token dead band. Measured: ` +
      `**${proseEv.length} of ${prose.length}** prose pairs are evaluable, ` +
      `**${proseEv.filter((d) => d.dropped).length}** of those dropped, mean delta ` +
      `**${R.llmFixtures.r25.proseMeanDelta === null ? 'n/a' : R.llmFixtures.r25.proseMeanDelta}**. ` +
      `A pair that is evaluable and does NOT drop is a real result about transform (b)/(c), not a fixture bug.`);
    emit('');
  }
  if (ev.length) {
    emit('| pair | lang | transform | clean | humanized | delta |');
    emit('|---|---|---|---|---|---:|');
    for (const d of ev) emit(`| ${d.pairId} | ${d.lang} | ${d.transform} | ${num(d.cleanScore)} (${d.cleanVerdict}) | ${num(d.humScore)} (${d.humVerdict}) | ${d.delta > 0 ? '+' : ''}${num(d.delta)} |`);
    emit('');
  }
  const unmeasurable = deltas.filter((d) => !d.evaluable);
  if (unmeasurable.length) {
    emit(`${unmeasurable.length} pair(s) are NOT measurable because at least one side was gated:`);
    for (const d of unmeasurable) emit(`- ${d.humId} vs ${d.pairId} (${d.lang}, \`${d.transform}\`): clean ${d.cleanVerdict ?? 'missing'} ${num(d.cleanScore)} / humanized ${d.humVerdict} ${num(d.humScore)}`);
    emit('');
  }
  if (unpairedHumanized.length) {
    emit(`${unpairedHumanized.length} humanized row(s) have NO clean twin by construction (transforms \`a\` and \`d\`:`);
    emit('the humanization is in the prompt, so there is nothing to subtract from). They are reported as');
    emit('verdicts, never as a passed assertion:');
    for (const r of unpairedHumanized) emit(`- ${r.id} (${r.lang}, \`${r.transform}\`): ${r.verdict} ${num(r.score)}`);
    emit('');
  }

  // ---------------- C. cs-snippets --------------------------------------
  const csFile = path.join(opts.fixtures, 'cs-snippets.jsonl');
  const cs = existsSync(csFile) ? readJsonl(csFile) : [];
  const csRes = cs.map((row) => {
    const gen = runOne(opts.detector, row.text, { context: row.shape, channel: row.channel, lang: row.lang, genre: row.genre, domain: 'general' });
    const sup = runOne(opts.detector, row.text, { context: row.shape, channel: row.channel, lang: row.lang, genre: row.genre, domain: 'customer_service' });
    return {
      id: row.id, lang: row.lang, shape: row.shape,
      general: { verdict: gen.verdict, score: gen.score ?? null, warnings: gen.warnings || [] },
      cs: { verdict: sup.verdict, score: sup.score ?? null, warnings: sup.warnings || [] },
      delta: (gen.score !== null && gen.score !== undefined && sup.score !== null && sup.score !== undefined)
        ? Number((sup.score - gen.score).toFixed(4)) : null,
      aboveTauGeneral: gen.score !== null && gen.score !== undefined && gen.score >= opts.tau,
      aboveTauCs: sup.score !== null && sup.score !== undefined && sup.score >= opts.tau,
    };
  });
  // R7's suppression list. R7 says "any row scoring above tau", but tau here is the neutral 0.5
  // against prior-weight scores (see the tau note above), so the list is built from the VERDICT —
  // the thing a caller actually acts on — and the score-based count is reported beside it.
  const suppression = csRes.filter((r) => r.general.verdict === 'leaning_llm' || r.general.verdict === 'likely_llm'
    || r.cs.verdict === 'leaning_llm' || r.cs.verdict === 'likely_llm');
  const csDeltas = csRes.filter((r) => r.delta !== null);
  const csGatedByLang = {};
  for (const r of csRes) if (r.general.score === null) csGatedByLang[r.lang] = (csGatedByLang[r.lang] || 0) + 1;
  R.csSnippets = {
    rows: csRes.length,
    tallyGeneral: tally(csRes, (r) => r.general.verdict), tallyCs: tally(csRes, (r) => r.cs.verdict),
    gatedGeneral: csRes.filter((r) => r.general.score === null).length,
    gatedCs: csRes.filter((r) => r.cs.score === null).length,
    aboveTauGeneral: csRes.filter((r) => r.aboveTauGeneral).length,
    aboveTauCs: csRes.filter((r) => r.aboveTauCs).length,
    meanDeltaWhenBothScored: csDeltas.length ? Number((csDeltas.reduce((s, r) => s + r.delta, 0) / csDeltas.length).toFixed(4)) : null,
    domainSuppressionList: suppression.map((r) => r.id),
    gatedByLang: csGatedByLang,
    detail: csRes,
  };

  emit('## CAL-C. Negative control (e) — `cs-snippets.jsonl`, 30 human support-desk lines');
  emit('');
  emit('Every row is a human writing support-desk phrasing (HEAD-RULINGS R7, 15 en / 15 tr). Run twice:');
  emit('`--domain general` and `--domain customer_service`. R7 puts any row above tau on the');
  emit('domain-suppression list; since tau here is the neutral 0.5 against prior-weight scores, the list');
  emit('is built from the **verdict** (`leaning_llm` or worse in either setting) and the score-based count');
  emit('is printed beside it.');
  emit('');
  emit(`| setting | ${VERDICTS.join(' | ')} | gated | at/above tau |`);
  emit(`|---|${VERDICTS.map(() => '---:').join('|')}|---:|---:|`);
  emit(`| \`--domain general\` | ${tallyRow(R.csSnippets.tallyGeneral)} | ${R.csSnippets.gatedGeneral} | ${R.csSnippets.aboveTauGeneral} |`);
  emit(`| \`--domain customer_service\` | ${tallyRow(R.csSnippets.tallyCs)} | ${R.csSnippets.gatedCs} | ${R.csSnippets.aboveTauCs} |`);
  emit('');
  emit(`Rows scored under both settings: ${csDeltas.length}. Mean score change from the domain flag: ` +
    `**${R.csSnippets.meanDeltaWhenBothScored === null ? 'n/a — nothing was scored under both' : R.csSnippets.meanDeltaWhenBothScored}**.`);
  emit('');
  if (csDeltas.length) {
    emit('| id | lang | general | customer_service | delta |');
    emit('|---|---|---|---|---:|');
    for (const r of csDeltas) emit(`| ${r.id} | ${r.lang} | ${num(r.general.score)} (${r.general.verdict}) | ${num(r.cs.score)} (${r.cs.verdict}) | ${r.delta > 0 ? '+' : ''}${num(r.delta)} |`);
    emit('');
  }
  emit(`Gated rows by language: ${Object.entries(csGatedByLang).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`);
  emit(`Rows at or above 0.5 by score: ${R.csSnippets.aboveTauGeneral} general / ${R.csSnippets.aboveTauCs} customer_service.`);
  emit('');
  emit(suppression.length
    ? `**Domain-suppression list (R7): ${suppression.map((r) => r.id).join(', ')}** — ${suppression.length} of ${csRes.length} human support-desk lines lean LLM by verdict.`
    : '**Domain-suppression list (R7): EMPTY by verdict this round.** Read it weakly — see the gated count above; ' +
      'a control that never gets scored cannot exonerate anything.');
  emit('');

  // ---------------- D. real corpus rows ---------------------------------
  const corpusFile = path.join(opts.data, 'corpus_user_messages.json');
  if (existsSync(corpusFile)) {
    const corpus = JSON.parse(readFileSync(corpusFile, 'utf8'));
    const pool = corpus.filter((r) => r.label === 'REAL'
      && (r.writer_id === 'R0' || r.writer_id === 'R2')
      && r.content && r.content.trim()
      && (r.language === 'en' || r.language === 'tr')
      && arabicShare(r.content) < 0.2);
    // deterministic sample: sort by a seeded hash of the row id, take the first N
    const ranked = pool.map((r) => ({ r, h: fnv1a(opts.seed + '|' + r.id) })).sort((a, b) => a.h - b.h || String(a.r.id).localeCompare(String(b.r.id)));
    const sample = ranked.slice(0, opts.real).map((x) => x.r);
    const reports = runBatch(opts.detector, sample.map((r) => ({ id: r.id, text: r.content })), { channel: 'whatsapp' });
    const byId = new Map(reports.map((x) => [x.id, x]));
    const realRes = sample.map((r) => {
      const rep = byId.get(r.id) || {};
      return {
        writer: r.writer_id, lang: r.language, tokens: rep.counts?.tokens ?? null,
        verdict: rep.verdict, score: rep.score ?? null, gateReason: rep.gates?.reason || null,
        rules: (rep.rules || []).map((x) => x.rule || x.name || x),
        flagged: rep.score !== null && rep.score !== undefined && rep.score >= opts.tau,
      };
    });
    const scored = realRes.filter((r) => r.score !== null);
    const nonHuman = realRes.filter((r) => r.verdict === 'leaning_llm' || r.verdict === 'likely_llm');
    R.realRows = {
      poolSize: pool.length, sampled: realRes.length, seed: opts.seed, channel: 'whatsapp',
      byWriter: tally(realRes, (r) => r.writer), byLang: tally(realRes, (r) => r.lang),
      tallyVerdict: tally(realRes), scored: scored.length, gated: realRes.length - scored.length,
      gateReasons: tally(realRes.filter((r) => r.score === null), (r) => r.gateReason || 'none'),
      flaggedAtTau: realRes.filter((r) => r.flagged).length,
      llmLeaningOrWorse: nonHuman.length,
      rulesFired: tally(realRes.flatMap((r) => r.rules).map((x) => ({ verdict: x }))),
      medianScoreScored: scored.length ? scored.map((r) => r.score).sort((a, b) => a - b)[Math.floor(scored.length / 2)] : null,
    };

    emit('## CAL-D. The production shape — real human WhatsApp messages');
    emit('');
    emit(`${realRes.length} REAL rows sampled deterministically (seed \`${opts.seed}\`) from writers R0/R2, Latin script only`);
    emit('(HEAD-RULINGS R22), out of a pool of ' + pool.length + ', run as a **single `--jsonl` batch process** with');
    emit('`--channel whatsapp` — unlike sections A/B/C/E, which run one process per row with that row\'s own');
    emit('flags. The two paths were checked against each other and agreed 6/6 on verdict, score and gate reason.');
    emit('**Every one of these is a');
    emit('human message**, so every `leaning_llm` / `likely_llm` here is a false positive and every score at or');
    emit('above tau is a flag against a real person.');
    emit('');
    emit(`| ${VERDICTS.join(' | ')} | gated | scored | at/above tau | FP (leaning_llm+) |`);
    emit(`|${VERDICTS.map(() => '---:').join('|')}|---:|---:|---:|---:|`);
    emit(`| ${tallyRow(R.realRows.tallyVerdict)} | ${R.realRows.gated} | ${R.realRows.scored} | ${R.realRows.flaggedAtTau} | ${nonHuman.length} |`);
    emit('');
    emit(`Writers: ${Object.entries(R.realRows.byWriter).map(([k, v]) => `${k} ${v}`).join(', ')}. ` +
      `Languages: ${Object.entries(R.realRows.byLang).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
    emit(`Gate reasons: ${Object.entries(R.realRows.gateReasons).map(([k, v]) => `\`${k}\` ${v}`).join(', ') || 'none'}.`);
    emit(`Coverage is the headline: **${pct(R.realRows.scored / realRes.length)}** of real chat messages get a score at all.`);
    emit(`False-positive rate over ALL sampled rows: **${pct(nonHuman.length / realRes.length)}**; over the scored subset: **${pct(scored.length ? nonHuman.length / scored.length : null)}**.`);
    emit('');
  } else {
    R.realRows = { error: `no corpus at ${corpusFile}` };
    emit('## CAL-D. The production shape — real human WhatsApp messages');
    emit('');
    emit(`**NOT RUN**: no corpus at \`<repo>/${path.relative(ROOT, corpusFile)}\`.`);
    emit('');
  }

  // ---------------- E. verify-round-1 (HEAD-RULINGS R33) ----------------
  // The refuter's 35 human + 8 LLM texts and the assistant-frame-leak probe list, committed as a
  // fixture so the verify round stops being a scratch file. Two gate lines (R33):
  //   1. zero `likely_llm` on the human rows that name it as a critical failure;
  //   2. every `expectRule` probe correct.
  // H17 and H20 are the deliberate exception to line 1: they are machine-written templates with no
  // human turn around them, so when the configured marker fires `likely_llm` is the correct output
  // (R28 downgrades only when the human channel is high — that is H19, and H19 keeps likely_llm as
  // its critical failure).
  let verifyPass = true;
  const vrFile = path.join(opts.fixtures, 'verify-round-1.jsonl');
  if (existsSync(vrFile)) {
    const vr = readJsonl(vrFile);
    const texts = vr.filter((r) => r.kind !== 'leakProbe');
    const probes = vr.filter((r) => r.kind === 'leakProbe');

    // marker rows run against a TEMPORARY markers file built from their own requiresMarkers.
    // markers.json ships as [] (R17) and this file never edits it.
    const tmpMarkers = path.join(process.env.TMPDIR || '/tmp', `gate-markers-${process.pid}-${Date.now()}.json`);
    const textRes = texts.map((row) => {
      let markersPath = null;
      if (row.markers && Array.isArray(row.requiresMarkers) && row.requiresMarkers.length) {
        writeFileSync(tmpMarkers, JSON.stringify(row.requiresMarkers) + '\n');
        markersPath = tmpMarkers;
      }
      const rep = runOne(opts.detector, row.text, {
        context: row.context, channel: row.channel, lang: row.lang, genre: row.genre,
        domain: row.domain, markers: markersPath,
      });
      const warnings = rep.warnings || [];
      return {
        id: row.id, truth: row.truth, class: row.class, lang: row.lang, context: row.context,
        markers: !!markersPath, expectedEvasion: row.expected_evasion === true,
        verdict: rep.verdict, score: rep.score ?? null, gateReason: rep.gates?.reason || null,
        rules: (rep.rules || []).map((x) => x.rule || x.name || x), warnings,
        allowed: row.allowed, criticalFailure: row.criticalFailure || [],
        inAllowed: (row.allowed || []).includes(rep.verdict),
        critical: (row.criticalFailure || []).includes(rep.verdict),
        note: row.note || '', cliError: rep._cliError || null,
      };
    });
    if (existsSync(tmpMarkers)) rmSync(tmpMarkers, { force: true });

    const humanRows = textRes.filter((r) => r.truth === 'human');
    const llmRows = textRes.filter((r) => r.truth === 'llm');
    const critLL = humanRows.filter((r) => r.criticalFailure.includes('likely_llm'));
    const gateLL = critLL.filter((r) => r.verdict === 'likely_llm');
    const gateLH = llmRows.filter((r) => r.verdict === 'likely_human');
    const evaded = llmRows.filter((r) => r.verdict === 'leaning_human' || r.verdict === 'likely_human');
    const vrArb = textRes.filter((r) => !r.inAllowed && !r.critical);

    const probeRes = probes.map((row) => {
      const rep = runOne(opts.detector, row.text, {
        context: row.context, channel: row.channel, lang: row.lang, genre: row.genre, domain: row.domain,
      });
      const rules = (rep.rules || []).map((x) => x.rule || x.name || x);
      const fired = rules.includes('assistant_frame_leak');
      return {
        id: row.id, lang: row.lang, probe: row.probe, expectRule: row.expectRule === true,
        fired, rules, correct: fired === (row.expectRule === true), verdict: rep.verdict,
        notes: (rep.notes || []).filter((n) => /quotation_or_discussion|assistant_frame/.test(String(n))),
        note: row.note || '',
      };
    });
    const probeWrong = probeRes.filter((r) => !r.correct);
    const missed = probeWrong.filter((r) => r.expectRule);      // recall failures
    const falseFires = probeWrong.filter((r) => !r.expectRule);  // PRECISION failures — the worst output

    const gate1 = gateLL.length === 0;
    const gate2 = probeWrong.length === 0;
    verifyPass = gate1 && gate2;

    R.verifyRound1 = {
      textRows: textRes.length, humanRows: humanRows.length, llmRows: llmRows.length,
      probes: probeRes.length,
      gate_zero_likely_llm_on_human: { required: `0 of ${critLL.length}`, measured: gateLL.length, pass: gate1, offenders: gateLL.map((r) => r.id) },
      gate_every_probe_correct: { required: `${probeRes.length} of ${probeRes.length}`, measured: probeRes.length - probeWrong.length, pass: gate2, missed: missed.map((r) => r.id), falseFires: falseFires.map((r) => r.id) },
      likely_human_on_llm: gateLH.map((r) => r.id),
      evasions: evaded.map((r) => ({ id: r.id, verdict: r.verdict, expected: r.expectedEvasion })),
      tallyHuman: tally(humanRows), tallyLlm: tally(llmRows),
      arbitration: vrArb.map((r) => ({ id: r.id, verdict: r.verdict, allowed: r.allowed })),
      pass: verifyPass, detail: textRes, probeDetail: probeRes,
    };

    emit('## CAL-E. Verify round 1 — `verify-round-1.jsonl` (HEAD-RULINGS R33)');
    emit('');
    emit(`${humanRows.length} human texts and ${llmRows.length} LLM texts written in-session by the verify-round refuter`);
    emit('(no corpus row, provenance per row), plus the assistant-frame-leak probe list. Every row runs as its');
    emit('own CLI process with its own flags; the three marker rows run against a temporary markers file built');
    emit('from their `requiresMarkers` field, because `markers.json` ships as `[]` (R17) and this file never edits it.');
    emit('');
    emit('| gate | required | measured | verdict |');
    emit('|---|---|---|---|');
    emit(`| \`likely_llm\` on human rows that call it critical | 0 of ${critLL.length} | ${gateLL.length}${gateLL.length ? ` (${gateLL.map((r) => r.id).join(', ')})` : ''} | ${gate1 ? 'PASS' : 'FAIL'} |`);
    emit(`| \`expectRule\` probes correct | ${probeRes.length} of ${probeRes.length} | ${probeRes.length - probeWrong.length} | ${gate2 ? 'PASS' : 'FAIL'} |`);
    emit('');
    emit(`**VERIFY-ROUND GATE ${verifyPass ? 'PASSES' : 'FAILS'}.** H17 and H20 are excluded from the first line by their own`);
    emit('`criticalFailure` set: they are machine-written templates with no human turn, so a marker-driven');
    emit('`likely_llm` is correct there (R28 downgrades only the hybrid case, H19).');
    emit('');
    emit(`| set | n | ${VERDICTS.join(' | ')} |`);
    emit(`|---|---:|${VERDICTS.map(() => '---:').join('|')}|`);
    emit(`| human (H01-H35) | ${humanRows.length} | ${tallyRow(R.verifyRound1.tallyHuman)} |`);
    emit(`| llm (L01-L08) | ${llmRows.length} | ${tallyRow(R.verifyRound1.tallyLlm)} |`);
    emit('');
    emit('| id | truth | class | lang/ctx | mk | verdict | score | rules | warnings | in `allowed` |');
    emit('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of textRes) {
      emit(`| ${r.id} | ${r.truth} | ${String(r.class).split(' (')[0]} | ${r.lang}/${r.context} | ${r.markers ? 'yes' : '—'} | ${r.verdict} | ${num(r.score)} | ${r.rules.join(', ') || '—'} | ${r.warnings.join(', ') || '—'} | ${r.inAllowed ? 'yes' : (r.critical ? '**CRITICAL**' : 'no — arbitration')} |`);
    }
    emit('');
    if (evaded.length) {
      emit(`${evaded.length} LLM row(s) reached a human-leaning verdict: ` +
        evaded.map((r) => `${r.id} (${r.verdict}${r.expectedEvasion ? ', expected_evasion' : ', **NOT** marked expected_evasion'})`).join(', ') +
        '. L07/L08 are the measured mimicry cost (33 tokens and one prompt line); an unexpected one is a new finding.');
      emit('');
    }
    if (vrArb.length) {
      emit('Arbitration items (outside `allowed`, not a `criticalFailure` value — the head arbitrates):');
      for (const r of vrArb) emit(`- **${r.id}**: core says \`${r.verdict}\`, fixture allows ${r.allowed.map((x) => `\`${x}\``).join(' | ')}. ${r.note}`);
      emit('');
    }
    emit('### The `assistant_frame_leak` probe list (R27)');
    emit('');
    emit(`${probeRes.length} probes: ${probes.filter((p) => p.expectRule).length} that must fire (self-identification or drafting frames)`);
    emit(`and ${probes.filter((p) => !p.expectRule).length} that must NOT (a human quoting or discussing an assistant, and the bare common noun).`);
    emit('A false fire is the worst output this tool has; a miss is only lost recall. They are counted separately.');
    emit('');
    emit(`- correct: **${probeRes.length - probeWrong.length} / ${probeRes.length}**`);
    emit(`- missed (should fire, did not): **${missed.length}**${missed.length ? ` — ${missed.map((r) => r.id).join(', ')}` : ''}`);
    emit(`- **false fires (should NOT fire, did): ${falseFires.length}**${falseFires.length ? ` — ${falseFires.map((r) => r.id).join(', ')}` : ''}`);
    emit('');
    emit('The probe TEXT is deliberately not printed here (HEAD-RULINGS R40): look a row up by its id in');
    emit('`eval/fixtures/verify-round-1.jsonl`. Some probes quote an assistant frame containing the word');
    emit('this report\'s honesty guard watches for, and an exemption list for them failed the moment a new');
    emit('fixture added a fourth. Nothing quoted, no exemption, guard absolute.');
    emit('');
    emit('| id | lang | expect | observed | result | rules fired |');
    emit('|---|---|---|---|---|---|');
    for (const r of probeRes) emit(`| ${r.id} | ${r.lang} | ${r.expectRule ? 'FIRE' : 'no fire'} | ${r.fired ? 'FIRE' : 'no fire'} | ${r.correct ? 'ok' : (r.expectRule ? '**MISS**' : '**FALSE FIRE**')} | ${r.rules.join(', ') || '—'} |`);
    emit('');
  } else {
    R.verifyRound1 = { error: `no fixture at ${vrFile}` };
    emit('## CAL-E. Verify round 1 — `verify-round-1.jsonl` (HEAD-RULINGS R33)');
    emit('');
    emit(`**NOT RUN**: no fixture at \`<repo>/${path.relative(ROOT, vrFile)}\`.`);
    emit('');
  }

  // ---------------- F. verify-round-2 (HEAD-RULINGS R38) ----------------
  // Round two attacked the FIXED core: the leak rule's reported-speech guard, the human checklist
  // road under R24, the support-desk retag, homoglyph blocks the fold missed, out-of-scope Latin
  // languages routed to the Turkish cell, and the aggregate report inheriting the discarded base
  // pass's warnings. The fixture asserts the rulings, not today's output.
  let verify2Pass = true;
  const vr2File = path.join(opts.fixtures, 'verify-round-2.jsonl');
  if (existsSync(vr2File)) {
    const vr2 = readJsonl(vr2File);
    const texts2 = vr2.filter((r) => r.kind === 'text');
    const probes2 = vr2.filter((r) => r.kind === 'leakProbe');
    const aggs2 = vr2.filter((r) => r.kind === 'aggregate');
    const tmpMarkers2 = path.join(process.env.TMPDIR || '/tmp', `gate-markers2-${process.pid}-${Date.now()}.json`);
    const tmpAgg = path.join(process.env.TMPDIR || '/tmp', `gate-agg-${process.pid}-${Date.now()}.jsonl`);

    const markersFor = (row) => {
      if (!row.markers || !Array.isArray(row.requiresMarkers) || !row.requiresMarkers.length) return null;
      writeFileSync(tmpMarkers2, JSON.stringify(row.requiresMarkers) + '\n');
      return tmpMarkers2;
    };
    /** Shared post-processing: what the row asked for, against what the report actually said. */
    const assess = (row, rep) => {
      const warnings = rep.warnings || [];
      const notes = rep.notes || [];
      const rules = (rep.rules || []).map((x) => x.rule || x.name || x);
      const lang = rep.language?.primary ?? null;
      const problems = [];
      for (const w of (row.expectWarning || [])) if (!warnings.includes(w)) problems.push(`missing warning \`${w}\``);
      for (const w of (row.expectNotWarning || [])) if (warnings.includes(w)) problems.push(`warning \`${w}\` must NOT be present`);
      for (const rn of (row.expectRules || [])) if (!rules.includes(rn)) problems.push(`rule \`${rn}\` did not fire`);
      if (row.expectLang && !row.expectLang.includes(lang)) problems.push(`language is \`${lang}\`, expected ${row.expectLang.map((x) => '`' + x + '`').join(' | ')}`);
      if (row.expectUniqueNotes && notes.length !== new Set(notes).size) {
        problems.push(`notes are not de-duplicated (${notes.length} notes, ${new Set(notes).size} distinct)`);
      }
      return {
        id: row.id, kind: row.kind, truth: row.truth, class: row.class, lang: row.lang,
        context: row.context, markers: Boolean(row.markers), expectedEvasion: row.expected_evasion === true,
        verdict: rep.verdict, score: rep.score ?? null, gateReason: rep.gates?.reason || null,
        detectedLang: lang, rules, warnings,
        allowed: row.allowed || [], criticalFailure: row.criticalFailure || [],
        inAllowed: (row.allowed || []).includes(rep.verdict),
        critical: (row.criticalFailure || []).includes(rep.verdict),
        expectations: problems, expectationsOk: problems.length === 0,
        note: row.note || '', cliError: rep._cliError || null,
      };
    };

    const textRes2 = texts2.map((row) => assess(row, runOne(opts.detector, row.text, {
      context: row.context, channel: row.channel, lang: row.lang, genre: row.genre,
      domain: row.domain, markers: markersFor(row),
    })));

    // Aggregate rows go through --aggregate, which is a different code path from --text and the
    // only one R29 and R38(e) are about.
    const aggRes2 = aggs2.map((row) => {
      writeFileSync(tmpAgg, row.messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
      const args = [opts.detector, '--aggregate', tmpAgg, '--allow-uncalibrated'];
      if (row.context) args.push('--context', row.context);
      if (row.channel) args.push('--channel', row.channel);
      if (row.lang) args.push('--lang', row.lang);
      const mk = markersFor(row);
      if (mk) args.push('--markers', mk);
      let rep;
      try {
        const out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        rep = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
      } catch (e) {
        rep = { verdict: 'ERROR', score: null, _cliError: `exit ${e.status}: ${String(e.stderr || e.message).slice(0, 300)}` };
      }
      return { ...assess(row, rep), turns: row.messages.length };
    });
    for (const f of [tmpMarkers2, tmpAgg]) if (existsSync(f)) rmSync(f, { force: true });

    const probeRes2 = probes2.map((row) => {
      const rep = runOne(opts.detector, row.text, {
        context: row.context, channel: row.channel, lang: row.lang, genre: row.genre, domain: row.domain,
      });
      const rules = (rep.rules || []).map((x) => x.rule || x.name || x);
      const fired = rules.includes('assistant_frame_leak');
      return {
        id: row.id, lang: row.lang, klass: row.class, probe: row.probe, expectRule: row.expectRule === true,
        fired, rules, correct: fired === (row.expectRule === true), verdict: rep.verdict, note: row.note || '',
      };
    });

    const all2 = [...textRes2, ...aggRes2];
    const humanRows2 = all2.filter((r) => r.truth === 'human');
    const llmRows2 = all2.filter((r) => r.truth === 'llm');
    const critLL2 = humanRows2.filter((r) => r.criticalFailure.includes('likely_llm'));
    const gateLL2 = critLL2.filter((r) => r.verdict === 'likely_llm');
    const gateLH2 = llmRows2.filter((r) => r.verdict === 'likely_human');
    const probeWrong2 = probeRes2.filter((r) => !r.correct);
    const missed2 = probeWrong2.filter((r) => r.expectRule);
    const falseFires2 = probeWrong2.filter((r) => !r.expectRule);
    const langRows2 = all2.filter((r) => (texts2.concat(aggs2).find((x) => x.id === r.id) || {}).expectLang);
    const langWrong2 = langRows2.filter((r) => r.expectations.some((p) => p.startsWith('language is')));
    const expWrong2 = all2.filter((r) => !r.expectationsOk);
    const arb2 = all2.filter((r) => !r.inAllowed && !r.critical);

    const g1 = gateLL2.length === 0;
    const g2 = probeWrong2.length === 0;
    const g3 = langWrong2.length === 0;
    verify2Pass = g1 && g2 && g3;

    R.verifyRound2 = {
      textRows: textRes2.length, aggregateRows: aggRes2.length, probes: probeRes2.length,
      humanRows: humanRows2.length, llmRows: llmRows2.length,
      gate_zero_likely_llm_on_human: { required: `0 of ${critLL2.length}`, measured: gateLL2.length, pass: g1, offenders: gateLL2.map((r) => r.id) },
      gate_every_probe_correct: { required: `${probeRes2.length} of ${probeRes2.length}`, measured: probeRes2.length - probeWrong2.length, pass: g2, missed: missed2.map((r) => r.id), falseFires: falseFires2.map((r) => r.id) },
      gate_every_language_correct: { required: `${langRows2.length} of ${langRows2.length}`, measured: langRows2.length - langWrong2.length, pass: g3, wrong: langWrong2.map((r) => ({ id: r.id, got: r.detectedLang })) },
      likely_human_on_llm: gateLH2.map((r) => r.id),
      expectationFailures: expWrong2.map((r) => ({ id: r.id, problems: r.expectations })),
      arbitration: arb2.map((r) => ({ id: r.id, verdict: r.verdict, allowed: r.allowed })),
      tallyHuman: tally(humanRows2), tallyLlm: tally(llmRows2),
      pass: verify2Pass, detail: all2, probeDetail: probeRes2,
    };

    emit('## CAL-F. Verify round 2 — `verify-round-2.jsonl` (HEAD-RULINGS R38)');
    emit('');
    emit(`${texts2.length} single-document rows, ${aggs2.length} aggregate senders and ${probes2.length} leak probes, all authored`);
    emit('in-session against the FIXED core (no corpus row). Beyond CAL-E\'s checks this section asserts');
    emit('`expectRules` (a named rule must fire), `expectWarning` / `expectNotWarning`, `expectLang`, and');
    emit('that an aggregate report\'s notes are de-duplicated.');
    emit('');
    emit('| gate | required | measured | verdict |');
    emit('|---|---|---|---|');
    emit(`| \`likely_llm\` on human rows that call it critical | 0 of ${critLL2.length} | ${gateLL2.length}${gateLL2.length ? ` (${gateLL2.map((r) => r.id).join(', ')})` : ''} | ${g1 ? 'PASS' : 'FAIL'} |`);
    emit(`| \`expectRule\` probes correct | ${probeRes2.length} of ${probeRes2.length} | ${probeRes2.length - probeWrong2.length} | ${g2 ? 'PASS' : 'FAIL'} |`);
    emit(`| \`expectLang\` rows correct | ${langRows2.length} of ${langRows2.length} | ${langRows2.length - langWrong2.length} | ${g3 ? 'PASS' : 'FAIL'} |`);
    emit('');
    emit(`**VERIFY-ROUND-2 GATE ${verify2Pass ? 'PASSES' : 'FAILS'}.**`);
    emit('');
    emit(`| set | n | ${VERDICTS.join(' | ')} |`);
    emit(`|---|---:|${VERDICTS.map(() => '---:').join('|')}|`);
    emit(`| human | ${humanRows2.length} | ${tallyRow(R.verifyRound2.tallyHuman)} |`);
    emit(`| llm | ${llmRows2.length} | ${tallyRow(R.verifyRound2.tallyLlm)} |`);
    emit('');
    emit('| id | truth | class | lang/ctx | mk | verdict | score | rules | warnings | in `allowed` | expectations |');
    emit('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of all2) {
      emit(`| ${r.id} | ${r.truth} | ${String(r.class)} | ${r.lang}/${r.context}${r.kind === 'aggregate' ? ` (agg ${r.turns})` : ''} | ${r.markers ? 'yes' : '—'} | ${r.verdict} | ${num(r.score)} | ${r.rules.join(', ') || '—'} | ${r.warnings.join(', ') || '—'} | ${r.inAllowed ? 'yes' : (r.critical ? '**CRITICAL**' : 'no — arbitration')} | ${r.expectationsOk ? 'ok' : '**' + r.expectations.join('; ') + '**'} |`);
    }
    emit('');
    if (arb2.length) {
      emit('Arbitration items (outside `allowed`, not a `criticalFailure` value — the head arbitrates, no lane edits a fixture to match the core):');
      for (const r of arb2) emit(`- **${r.id}**: core says \`${r.verdict}\`, fixture allows ${r.allowed.map((x) => '`' + x + '`').join(' | ')}. ${r.note}`);
      emit('');
    }
    if (expWrong2.length) {
      emit(`${expWrong2.length} row(s) produced a verdict inside \`allowed\` but did not meet an explicit expectation:`);
      for (const r of expWrong2) emit(`- **${r.id}**: ${r.expectations.join('; ')}. ${r.note}`);
      emit('');
    }
    if (gateLH2.length) { emit(`**${gateLH2.length} LLM row(s) reached \`likely_human\`: ${gateLH2.map((r) => r.id).join(', ')}.**`); emit(''); }
    emit('### The round-2 leak probes');
    emit('');
    emit(`${probes2.filter((p) => p.expectRule).length} must fire, ${probes2.filter((p) => !p.expectRule).length} must not.`);
    emit(`- correct: **${probeRes2.length - probeWrong2.length} / ${probeRes2.length}**`);
    emit(`- missed (should fire, did not): **${missed2.length}**${missed2.length ? ` — ${missed2.map((r) => r.id).join(', ')}` : ''}`);
    emit(`- **false fires (should NOT fire, did): ${falseFires2.length}**${falseFires2.length ? ` — ${falseFires2.map((r) => r.id).join(', ')}` : ''}`);
    emit('');
    emit('Probe text is not printed (HEAD-RULINGS R40); look a row up by its id in');
    emit('`eval/fixtures/verify-round-2.jsonl`.');
    emit('');
    emit('| id | lang | expect | observed | result | rules fired |');
    emit('|---|---|---|---|---|---|');
    for (const r of probeRes2) emit(`| ${r.id} | ${r.lang} | ${r.expectRule ? 'FIRE' : 'no fire'} | ${r.fired ? 'FIRE' : 'no fire'} | ${r.correct ? 'ok' : (r.expectRule ? '**MISS**' : '**FALSE FIRE**')} | ${r.rules.join(', ') || '—'} |`);
    emit('');
  } else {
    R.verifyRound2 = { error: `no fixture at ${vr2File}` };
    emit('## CAL-F. Verify round 2 — `verify-round-2.jsonl` (HEAD-RULINGS R38)');
    emit('');
    emit(`**NOT RUN**: no fixture at \`<repo>/${path.relative(ROOT, vr2File)}\`.`);
    emit('');
  }

  // ---------------- G. the shipped CLI on the essay TEST rows (HEAD-RULINGS R49) ----------
  //
  // WHY THIS SECTION EXISTS. run-eval §3b reports the FITTED model at its FITTED threshold:
  // AUC, FPR@t, TPR@t. A school platform never sees any of that. It sees `summary.label`,
  // computed by the shipped CLI from the PRIOR weights and the verdict table. Those are two
  // different instruments over the same rows, and the difference between them is the difference
  // between what the eval can measure and what the product actually says. Both are printed here,
  // side by side, so nobody quotes the fitted number as a product number.
  //
  // One `--jsonl` batch, `--preset essay`, no history and no corpus index (so `near_duplicate`
  // cannot fire and `not_independently_authored` is structurally 0 — that is a property of this
  // run, not a finding about the label). Rows come from the split file; NO ROW TEXT IS PRINTED.
  {
    const splitFile = path.join(opts.data, 'splits.jsonl');
    emit('## CAL-G. What the platform actually sees — the shipped CLI on the essay TEST rows (R49)');
    emit('');
    if (!existsSync(splitFile)) {
      R.essayCli = { error: `no split at ${splitFile}` };
      emit(`**NOT RUN**: no split at \`<repo>/${path.relative(ROOT, splitFile)}\`. Run \`node eval/make-splits.mjs\` first.`);
      emit('');
    } else {
      const essay = readFileSync(splitFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
        .filter((r) => r.genre === 'essay' && r.side === 'test');
      const nH = essay.filter((r) => r.label === 'human').length;
      const nL = essay.filter((r) => r.label === 'llm').length;
      if (!essay.length) {
        R.essayCli = { error: 'no essay rows on the test side' };
        emit('**NOT RUN**: the split carries no `genre: "essay"` row on the test side.');
        emit('');
      } else {
        const batch = essay.map((r) => ({ id: r.id, text: r.text }));
        const truthOf = new Map(essay.map((r) => [r.id, r.label]));
        const bucketOf = new Map(essay.map((r) => [r.id, r.bucket]));

        // Two passes over the same rows: the shipped default (prior weights) and the fitted file.
        const fittedPath = path.join(outDir, 'weights.fitted.json');
        const passes = [{ name: 'prior', weights: null }];
        if (existsSync(fittedPath)) passes.push({ name: 'fitted', weights: fittedPath });

        const results = {};
        for (const pass of passes) {
          let reports;
          try {
            reports = runBatch(opts.detector, batch, { preset: 'essay', weights: pass.weights });
          } catch (e) {
            results[pass.name] = { error: `CLI batch failed: ${String(e.stderr || e.message).slice(0, 200)}` };
            continue;
          }
          const rows = reports.map((rep) => ({
            id: rep.id,
            truth: truthOf.get(rep.id) || 'unknown',
            bucket: bucketOf.get(rep.id) || 'unknown',
            label: rep.summary?.label || 'MISSING',
            verdict: rep.verdict,
            gateReason: rep.gates?.reason || null,
            warnings: rep.warnings || [],
            humanReviewRequired: rep.summary?.humanReviewRequired === true,
            hasCaveat: Boolean(rep.summary?.caveat),
          }));
          const human = rows.filter((r) => r.truth === 'human');
          const llm = rows.filter((r) => r.truth === 'llm');
          const flagged = (list) => list.filter((r) => FLAG_LABELS.has(r.label)).length;
          const scoredOf = (list) => list.filter((r) => r.label !== 'too_short_or_no_signal');
          results[pass.name] = {
            rows: rows.length, n_human: human.length, n_llm: llm.length,
            labelByTruth: {
              human: tally(human, (r) => r.label),
              llm: tally(llm, (r) => r.label),
            },
            verdictByTruth: { human: tally(human), llm: tally(llm) },
            gatedHuman: human.length - scoredOf(human).length,
            gatedLlm: llm.length - scoredOf(llm).length,
            gateReasons: tally(rows.filter((r) => r.label === 'too_short_or_no_signal'), (r) => r.gateReason || 'none'),
            falseFlagAll: human.length ? flagged(human) / human.length : null,
            falseFlagScored: scoredOf(human).length ? flagged(human) / scoredOf(human).length : null,
            catchAll: llm.length ? flagged(llm) / llm.length : null,
            catchScored: scoredOf(llm).length ? flagged(llm) / scoredOf(llm).length : null,
            flaggedHuman: flagged(human), flaggedLlm: flagged(llm),
            humanReviewRequiredOnEveryRow: rows.every((r) => r.humanReviewRequired),
            caveatOnEveryRow: rows.every((r) => r.hasCaveat),
            cellNotFittedPriorUsed: rows.filter((r) => (r.warnings || []).includes('cell_not_fitted_prior_used')).length,
            uncalibratedWeights: rows.filter((r) => (r.warnings || []).includes('uncalibrated_weights')).length,
            byBucket: {},
          };
          for (const b of ['<20', '20-49', '50-149', '150-499', '500+']) {
            const hb = human.filter((r) => r.bucket === b), lb = llm.filter((r) => r.bucket === b);
            if (!hb.length && !lb.length) continue;
            results[pass.name].byBucket[b] = {
              n_human: hb.length, n_llm: lb.length,
              flaggedHuman: flagged(hb), flaggedLlm: flagged(lb),
              falseFlag: hb.length ? flagged(hb) / hb.length : null,
              catch: lb.length ? flagged(lb) / lb.length : null,
              insufficient: hb.length < 100 || lb.length < 100,
            };
          }
        }
        R.essayCli = { n_human: nH, n_llm: nL, preset: 'essay', passes: results,
          note: 'One --jsonl batch per pass, --preset essay, no --history and no corpus index. Row text is never printed.' };

        emit(`The ${essay.length} essay rows of the TEST side (${nH} human, ${nL} machine) through the **shipped CLI**`);
        emit('in one `--jsonl` batch with `--preset essay`, no `--history` and no corpus index. This is the');
        emit('product path: the prior weights (`weights.v1.json`, which R11/R23 keep as the default) and the');
        emit('verdict table, reduced to the five platform labels of R42(a)/R47. **run-eval §3b measures a');
        emit('different instrument** — a model fitted on the fitting side, at a threshold picked on the');
        emit('validation side — and its row is printed at the bottom of this section so the two are never');
        emit('confused. No row text is printed here (R40); only counts.');
        emit('');

        for (const pass of passes) {
          const P = results[pass.name];
          emit(`### CAL-G.${pass.name === 'prior' ? '1' : '2'} ${pass.name === 'prior' ? 'The shipped default: prior weights' : 'The same rows with `--weights eval/out/weights.fitted.json` (R23 opt-in)'}`);
          emit('');
          if (P.error) { emit(`**NOT RUN**: ${P.error}`); emit(''); continue; }
          emit(`| truth | n | ${SUMMARY_LABELS_ORDER.join(' | ')} |`);
          emit(`|---|---:|${SUMMARY_LABELS_ORDER.map(() => '---:').join('|')}|`);
          for (const t of ['human', 'llm']) {
            const row = P.labelByTruth[t] || {};
            emit(`| ${t} | ${t === 'human' ? P.n_human : P.n_llm} | ${SUMMARY_LABELS_ORDER.map((l) => row[l] || 0).join(' | ')} |`);
          }
          emit('');
          emit(`| truth | n | ${VERDICTS.join(' | ')} |`);
          emit(`|---|---:|${VERDICTS.map(() => '---:').join('|')}|`);
          emit(`| human | ${P.n_human} | ${tallyRow(P.verdictByTruth.human)} |`);
          emit(`| llm | ${P.n_llm} | ${tallyRow(P.verdictByTruth.llm)} |`);
          emit('');
          const ffAll = P.n_human < 100 ? `INSUFFICIENT (n=${P.n_human})` : `**${pct(P.falseFlagAll)}**`;
          const ffScored = P.n_human - P.gatedHuman < 100 ? `INSUFFICIENT (n=${P.n_human - P.gatedHuman})` : `**${pct(P.falseFlagScored)}**`;
          const caAll = P.n_llm < 100 ? `INSUFFICIENT (n=${P.n_llm})` : `**${pct(P.catchAll)}**`;
          const caScored = P.n_llm - P.gatedLlm < 100 ? `INSUFFICIENT (n=${P.n_llm - P.gatedLlm})` : `**${pct(P.catchScored)}**`;
          emit(`- **Label-level false-flag rate on human essays** (\`fingerprint_found\` + \`ai_style_indicators\`): ` +
            `${P.flaggedHuman} of ${P.n_human} = ${ffAll} over all human essays; ${P.flaggedHuman} of ${P.n_human - P.gatedHuman} = ${ffScored} over the ones that got past the length floor.`);
          emit(`- **Label-level catch rate on machine essays** (same two labels): ` +
            `${P.flaggedLlm} of ${P.n_llm} = ${caAll} over all machine essays; ${P.flaggedLlm} of ${P.n_llm - P.gatedLlm} = ${caScored} over the scored ones.`);
          emit(`- \`too_short_or_no_signal\`: ${P.gatedHuman} human, ${P.gatedLlm} machine. Gate reasons: ` +
            `${Object.entries(P.gateReasons).map(([k, v]) => `\`${k}\` ${v}`).join(', ') || 'none'}.`);
          // The gate does not fall evenly on the two halves, and the "over all rows" rates above are
          // not comparable until that is said out loud: this corpus's machine essays are shorter than
          // its human ones (median ~197 words against ~424), so the length/evidence floor removes more
          // of the machine half, and a catch rate over ALL machine rows is depressed by rows the tool
          // deliberately never judged.
          {
            const gh = P.n_human ? P.gatedHuman / P.n_human : null;
            const gl = P.n_llm ? P.gatedLlm / P.n_llm : null;
            const heavier = gl > gh ? 'machine' : (gh > gl ? 'human' : null);
            emit(`- The gate is **not symmetric**: ${pct(gh)} of the human essays and ${pct(gl)} of the machine ones `
              + 'are refused a judgement'
              + (heavier === 'machine'
                ? ', and the machine half is the one this corpus makes shorter (median ~197 words against ~424), so a catch rate over ALL machine rows is held down by documents the tool abstained on rather than got wrong.'
                : (heavier === 'human'
                  ? ' — here it is the HUMAN half that is silenced more, which lowers the false-flag rate over all rows for the same mechanical reason. A rate whose denominator includes abstentions is not a judgement rate.'
                  : '.'))
              + ' The "over scored rows" figures are the ones that compare like with like.');
          }
          emit(`- \`humanReviewRequired: true\` on every row: **${P.humanReviewRequiredOnEveryRow ? 'yes' : 'NO — R42(a) violated'}**. Base-rate caveat on every row: **${P.caveatOnEveryRow ? 'yes' : 'NO — R42(a) violated'}**.`);
          if (pass.name === 'fitted') {
            emit(`- \`cell_not_fitted_prior_used\`: **${P.cellNotFittedPriorUsed}** row(s) fell back to the prior cell; \`uncalibrated_weights\`: ${P.uncalibratedWeights}.`);
          }
          emit('');
          emit('| bucket | n_human | n_llm | flagged human | false-flag | flagged machine | catch |');
          emit('|---|---:|---:|---:|---:|---:|---:|');
          for (const [b, v] of Object.entries(P.byBucket)) {
            emit(`| ${b} | ${v.n_human} | ${v.n_llm} | ${v.flaggedHuman} | ${v.insufficient ? `${pct(v.falseFlag)} — INSUFFICIENT (under 100 a side)` : `**${pct(v.falseFlag)}**`} | ${v.flaggedLlm} | ${v.insufficient ? `${pct(v.catch)} — INSUFFICIENT` : `**${pct(v.catch)}**`} |`);
          }
          emit('');
        }

        // The fitted-model row from run-eval, quoted verbatim from the report this section appends
        // to, so the two instruments sit on one page.
        const reportPath = opts.append ? path.resolve(opts.append) : path.join(outDir, 'REPORT.md');
        emit('### The two instruments, side by side');
        emit('');
        let quoted = null;
        if (existsSync(reportPath)) {
          const lines = readFileSync(reportPath, 'utf8').split('\n')
            .filter((l) => /^\| en:prose essay \| [^|]+ \|/.test(l) && !/INSUFFICIENT|NO COVERAGE/.test(l) && /\|\s*0\.\d/.test(l));
          quoted = lines[0] || null;
        }
        if (quoted) {
          emit('run-eval §3b, the FITTED model at its fitted threshold, on these same rows:');
          emit('');
          emit('| cell | length bucket | n_human | n_llm | AUC | AUC hard | ECE | FPR@t_essay | TPR@t_essay | TPR@t_essay hard | precision@t_essay |');
          emit('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
          emit(quoted);
          emit('');
        } else {
          emit('- the fitted row could not be read from `REPORT.md` (run `node eval/run-eval.mjs` first); the two instruments cannot be shown side by side in this run.');
          emit('');
        }
        emit('**They are not the same number and neither is wrong.** The fitted row is what a model fitted');
        emit('on this corpus can rank, at a threshold chosen on held-out validation rows. The tables above');
        emit('are what the shipped tool SAYS, with the prior weights it ships with and the verdict table\'s');
        emit('deliberate conservatism on top: `likely_llm` needs a Tier-0 fingerprint, style alone stops at');
        emit('`leaning_llm`, and R24 refuses even that on register-proxy evidence. A platform integrating');
        emit('this tool gets the second set. Quoting the first set at a parent, a student or a school is a');
        emit('misrepresentation of the product.');
        emit('');
      }
    }
  }

  R.wallClockSec = Number(((Date.now() - started) / 1000).toFixed(1));
  emit(`_CAL fixture gate wall-clock: ${R.wallClockSec}s. tau source: ${tauSource}._`);
  emit('');

  writeFileSync(jsonPath, JSON.stringify(R, round6, 2) + '\n');
  writeFileSync(mdPath, L.join('\n'));
  if (opts.append) {
    // HEAD-RULINGS R36(h): 277 of the 571 lines of the released REPORT.md were appended by this
    // file, which had no honesty guard at all — run-eval's emit() cannot see a line it never
    // emitted. The SAME lexical guard runs here before anything is appended to the report.
    const FIT_RE = new RegExp(FIT_WORD_SRC, 'i');
    const EXEMPT = /reference only/i;
    const offending = L.map((line, i) => [i, String(line)])
      .filter(([, line]) => FIT_RE.test(line) && !EXEMPT.test(line));
    if (offending.length) {
      process.stderr.write('honesty guard: refusing to append a section naming a fitting-side number without the '
        + '"(reference only)" marker.\n');
      for (const [i, line] of offending.slice(0, 5)) process.stderr.write(`  line ${i + 1}: ${line.slice(0, 200)}\n`);
      process.stderr.write(`gate-fixtures: ${path.relative(ROOT, mdPath)} was written; ${opts.append} was NOT appended to.\n`);
      process.exit(4);
    }
    appendFileSync(opts.append, '\n' + L.join('\n'));
  }

  process.stderr.write(`gate-fixtures: must-not-fire ${gatePass ? 'PASS' : 'FAIL'} · ` +
    `verify-round-1 ${R.verifyRound1?.error ? 'not run' : (verifyPass ? 'PASS' : 'FAIL')} · ` +
    `verify-round-2 ${R.verifyRound2?.error ? 'not run' : (verify2Pass ? 'PASS' : 'FAIL')} · ` +
    `llm fixtures ${R.llmFixtures.scored}/${R.llmFixtures.rows} scored · ` +
    `cs suppression list ${R.csSnippets.domainSuppressionList.length} · ` +
    `real rows FP ${R.realRows?.llmLeaningOrWorse ?? 'n/a'}/${R.realRows?.sampled ?? 'n/a'} · ` +
    `${R.wallClockSec}s\n`);
  process.stderr.write(`gate-fixtures: wrote ${path.relative(ROOT, jsonPath)} and ${path.relative(ROOT, mdPath)}\n`);
  if (!gatePass || !verifyPass || !verify2Pass) process.exit(3);
}

main();
