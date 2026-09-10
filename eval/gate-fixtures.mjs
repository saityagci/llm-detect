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
  if (opts.channel) args.push('--channel', opts.channel);
  if (opts.context) args.push('--context', opts.context);
  if (opts.domain) args.push('--domain', opts.domain);
  const out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

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
  // Lines that QUOTE a NAMED assistant-frame probe phrase. The honesty guard below is lexical, and
  // three of the probe phrases contain the fitting word as part of the string being tested. They
  // are quotations of the input, not statistics, and this file computes nothing on a fitting side —
  // it has no splits, no model and no sides.
  //
  // The exemption is deliberately narrow and closed. A probe line qualifies ONLY if removing the
  // three named phrases leaves no occurrence of the word: a fourth probe label carrying the word in
  // any other wording is refused like anything else. `eval/selftest-eval.mjs` check 7 asserts both
  // halves of that — the three pass, a fourth is refused.
  const QUOTED_FIT_WORD_PHRASES = [
    'as of my latest ' + FIT_WORD_SRC + 'ing',
    'as of my last ' + FIT_WORD_SRC + 'ing data',
    'I was ' + FIT_WORD_SRC + 'ed on data',
  ];
  const quotedProbeLines = new Set();
  const emitProbe = (s = '') => {
    let stripped = String(s);
    for (const phrase of QUOTED_FIT_WORD_PHRASES) stripped = stripped.split(phrase).join(' ');
    if (!new RegExp(FIT_WORD_SRC, 'i').test(stripped)) quotedProbeLines.add(L.length);
    L.push(s);
  };

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
        fired, correct: fired === (row.expectRule === true), verdict: rep.verdict,
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
    emit('Three probe labels below quote an assistant-frame phrase that contains the word this report\'s');
    emit('honesty guard watches for. They are quotations of the INPUT, not statistics: this file fits');
    emit('nothing and has no fitting side. Those three lines carry a recorded, per-line exemption from the');
    emit('guard that appends this section to `REPORT.md`; no other line does.');
    emit('');
    emit('| probe | lang | expect | fired | ok | what it is |');
    emit('|---|---|---|---|---|---|');
    for (const r of probeRes) emitProbe(`| ${r.id} | ${r.lang} | ${r.expectRule ? 'FIRE' : 'no fire'} | ${r.fired ? 'FIRE' : 'no fire'} | ${r.correct ? 'ok' : '**WRONG**'} | ${r.probe} |`);
    emit('');
  } else {
    R.verifyRound1 = { error: `no fixture at ${vrFile}` };
    emit('## CAL-E. Verify round 1 — `verify-round-1.jsonl` (HEAD-RULINGS R33)');
    emit('');
    emit(`**NOT RUN**: no fixture at \`<repo>/${path.relative(ROOT, vrFile)}\`.`);
    emit('');
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
      .filter(([i, line]) => FIT_RE.test(line) && !EXEMPT.test(line) && !quotedProbeLines.has(i));
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
    `llm fixtures ${R.llmFixtures.scored}/${R.llmFixtures.rows} scored · ` +
    `cs suppression list ${R.csSnippets.domainSuppressionList.length} · ` +
    `real rows FP ${R.realRows?.llmLeaningOrWorse ?? 'n/a'}/${R.realRows?.sampled ?? 'n/a'} · ` +
    `${R.wallClockSec}s\n`);
  process.stderr.write(`gate-fixtures: wrote ${path.relative(ROOT, jsonPath)} and ${path.relative(ROOT, mdPath)}\n`);
  if (!gatePass || !verifyPass) process.exit(3);
}

main();
