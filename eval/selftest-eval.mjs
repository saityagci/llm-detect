#!/usr/bin/env node
/**
 * selftest-eval.mjs — does the EVAL HARNESS refuse what it says it refuses?
 *
 * `selftest.mjs` at the repo root tests the detector. Nothing tested the harness that decides
 * whether the detector's numbers may be believed. HEAD-RULINGS R36 added four refusals to
 * `run-eval.mjs` and one to `gate-fixtures.mjs`, and every one of them was verified by READING the
 * branch, because staging a real failure would have meant copying private corpus rows into a
 * scratch directory. This file removes that excuse.
 *
 * It drives the shipped harness over `eval/fixtures/synthetic-split/` — a corpus authored by
 * `generate.mjs`, deterministic, with no corpus row in it — and over deliberately corrupted copies
 * of it written to a scratch directory. It asserts EXIT CODES and STRUCTURE. It never asserts a
 * rate: nothing measured on synthetic text means anything about the detector, and a self-test that
 * pinned an AUC here would be pinning a fiction.
 *
 *   node eval/selftest-eval.mjs [--work <dir>] [--keep]
 *
 * Exit 0 when every check passes, 1 otherwise, with one FAIL line per failed check.
 * It writes only under --work (default .scratch/selftest-eval, HEAD-RULINGS R37(b)) and reads only
 * eval/fixtures/, lib/ and the repo root. It never reads eval/data/ and never touches eval/out/.
 *
 * WHAT A GREEN RUN MEANS (HEAD-RULINGS R37(c)): eleven green checks — R37's ten, plus the R42(e)
 * essay-genre check added with the essay row set — prove the guards refuse planted
 * faults; the correctness of the numbers printed when nothing fires rests on the independent
 * re-derivation of R36, which a fixture cannot replace.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWeightsShape } from '../lib/score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE = path.join(HERE, 'fixtures', 'synthetic-split');
const RUN_EVAL = path.join(HERE, 'run-eval.mjs');
const GATE = path.join(HERE, 'gate-fixtures.mjs');

const argv = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : dflt; };
const WORK = path.resolve(argOf('--work', path.join(ROOT, '.scratch/selftest-eval')));
const KEEP = argv.includes('--keep');

// The fitting word, assembled so this file cannot itself trip the guard it is testing.
const FIT_WORD = ['t', 'r', 'a', 'i', 'n'].join('');

// ---------------------------------------------------------------- harness

const results = [];
let checkStart = 0;
function check(id, what, fn) {
  checkStart = Date.now();
  let ok = false; let why = '';
  try {
    const r = fn();
    if (r === true || r === undefined) ok = true;
    else { ok = false; why = String(r); }
  } catch (e) { ok = false; why = (e && e.message) || String(e); }
  const ms = Date.now() - checkStart;
  results.push({ id, what, ok, why, ms });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(3)} ${what}${ok ? '' : `\n     -> ${why}`}  (${ms} ms)\n`);
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

/** Run a node script; never throws on a non-zero exit. */
function node(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status === null || e.status === undefined ? -1 : e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

const rowsOf = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/**
 * Write a data directory holding a (possibly mutated) copy of the synthetic split.
 * `mutate(rows)` returns the rows to write. splits-report.json is copied unchanged: run-eval reads
 * it for the pair table and the contamination bands, and none of the planted faults live there.
 */
function dataVariant(name, mutate) {
  const dir = path.join(WORK, 'data-' + name);
  mkdirSync(dir, { recursive: true });
  const rows = mutate(rowsOf(path.join(FIXTURE, 'splits.jsonl')));
  writeFileSync(path.join(dir, 'splits.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  cpSync(path.join(FIXTURE, 'splits-report.json'), path.join(dir, 'splits-report.json'));
  return dir;
}

function runEval(dataDir, outName, extra = []) {
  const out = path.join(WORK, 'out-' + outName);
  return { ...node([RUN_EVAL, '--data', dataDir, '--fixtures', FIXTURE, '--out', out, ...extra], { cwd: ROOT }), out };
}

/** A child script, so a function that calls process.exit() can be observed instead of ending us. */
function child(name, source) {
  const f = path.join(WORK, name);
  writeFileSync(f, source, 'utf8');
  return node([f], { cwd: ROOT });
}

// ---------------------------------------------------------------- setup

if (!existsSync(path.join(FIXTURE, 'splits.jsonl'))) {
  process.stderr.write(`no synthetic fixture at ${path.relative(ROOT, FIXTURE)} — run: node eval/fixtures/synthetic-split/generate.mjs\n`);
  process.exit(2);
}
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const t0 = Date.now();
process.stdout.write(`llm-detect eval-harness self-test — node ${process.version}\n`);
process.stdout.write(`fixture: ${path.relative(ROOT, FIXTURE)} (synthetic, no corpus row)  ·  work: ${path.relative(ROOT, WORK)}\n\n`);

// The clean run is shared by checks 1, 9 and 10.
const cleanDir = dataVariant('clean', (rows) => rows);
const clean = runEval(cleanDir, 'clean');

// ---------------------------------------------------------------- 1
check('1', 'clean synthetic data: run-eval exits 0, sections 1-13 present, fitted weights load and score', () => {
  must(clean.code === 0, `run-eval exited ${clean.code}\n${clean.stderr.slice(-600)}`);
  const rep = readFileSync(path.join(clean.out, 'REPORT.md'), 'utf8');
  const seen = new Set((rep.match(/^## (\d+)\./gm) || []).map((h) => Number(h.match(/\d+/)[0])));
  for (let i = 1; i <= 13; i++) must(seen.has(i), `REPORT.md has no section ${i}`);
  const wf = path.join(clean.out, 'weights.fitted.json');
  const w = JSON.parse(readFileSync(wf, 'utf8'));
  validateWeightsShape(w, wf);                       // throws with the field name if it is short one
  must(w.provenance === 'fitted', `provenance is ${JSON.stringify(w.provenance)}`);
  must(/^fitted-/.test(w.weightsId || ''), `weightsId is ${JSON.stringify(w.weightsId)}`);
  const fitted = Object.entries(w.cells).filter(([, c]) => !c.status).map(([k]) => k);
  must(fitted.length >= 1, 'no cell was fitted, so the file proves nothing about the loader');
  // and the CLI must actually load it
  const enProse = rowsOf(path.join(FIXTURE, 'splits.jsonl'))
    .filter((r) => r.lang === 'en' && r.shape === 'prose' && r.tokens >= 150)[0];
  must(enProse, 'the fixture has no long English prose row to score');
  const cli = node([path.join(ROOT, 'stylometry.mjs'), '--weights', wf, '--text', enProse.text,
    '--json', '--context', 'prose', '--genre', 'review'], { cwd: ROOT });
  must(cli.code === 0, `stylometry.mjs --weights <fitted> exited ${cli.code}: ${cli.stderr.slice(0, 300)}`);
  const rep2 = JSON.parse(cli.stdout.trim().split('\n').pop());
  must(rep2.version.provenance === 'fitted', `CLI reported provenance ${rep2.version.provenance}`);
  must(rep2.version.weights === w.weightsId, `CLI reported weightsId ${rep2.version.weights}, file says ${w.weightsId}`);
  return true;
});

// ---------------------------------------------------------------- 2
check('2', 'planted persona straddle (a non-writer group on two sides): run-eval exits 5 and names the kind', () => {
  const dir = dataVariant('persona-straddle', (rows) => {
    const victim = rows.find((r) => r.group === 'persona::P0');
    must(victim, 'the fixture has no persona::P0 group to split');
    victim.side = victim.side === 'test' ? 'val' : 'test';
    return rows;
  });
  const r = runEval(dir, 'persona-straddle');
  must(r.code === 5, `expected exit 5, got ${r.code}\n${r.stderr.slice(-400)}`);
  must(/non-writer group/i.test(r.stderr), 'stderr does not say a non-writer group straddled');
  must(/persona/.test(r.stderr), `stderr does not name the group kind: ${r.stderr.slice(-200)}`);
  const rep = readFileSync(path.join(r.out, 'REPORT.md'), 'utf8');
  must(/are NOT `writer::` groups \(must be 0\)/.test(rep), 'REPORT.md does not carry the by-kind straddle line');
  return true;
});

// ---------------------------------------------------------------- 3
check('3', 'planted duplicate-key straddle (same text, two sides, one label): run-eval exits non-zero naming it', () => {
  const dir = dataVariant('dup-straddle', (rows) => {
    const src = rows.find((r) => r.side === 'fit' && r.label === 'human' && r.tokens >= 150);
    must(src, 'no long fitting-side human row to duplicate');
    rows.push({ ...src, id: src.id + '-dup', side: 'test', group: 'public:synthetic-dup::review::shard17' });
    return rows;
  });
  const r = runEval(dir, 'dup-straddle');
  must(r.code !== 0, 'run-eval exited 0 on a duplicate straddling the split');
  must(r.code === 5, `expected exit 5, got ${r.code}`);
  must(/duplicate group\(s\) straddle two sides/.test(r.stderr), `stderr does not name the duplicate straddle: ${r.stderr.slice(-200)}`);
  const rep = readFileSync(path.join(r.out, 'REPORT.md'), 'utf8');
  must(/duplicate groups straddling two sides: \*\*1\*\*/.test(rep), 'REPORT.md does not count the straddling duplicate');
  return true;
});

// ---------------------------------------------------------------- 4
check('4', 'planted both-label string on two sides: run-eval exits non-zero and reports the cross-label count', () => {
  const dir = dataVariant('both-label', (rows) => {
    const src = rows.find((r) => r.side === 'fit' && r.label === 'human' && r.tokens >= 150);
    rows.push({ ...src, id: src.id + '-xlabel', side: 'test', label: 'llm', generator: 'synthetic-generator-v1', group: 'public:synthetic-dup::review::shard18' });
    return rows;
  });
  const r = runEval(dir, 'both-label');
  must(r.code === 5, `expected exit 5, got ${r.code}`);
  must(/both labels/.test(r.stderr), `stderr does not mention the both-label collision: ${r.stderr.slice(-200)}`);
  const rep = readFileSync(path.join(r.out, 'REPORT.md'), 'utf8');
  must(/duplicate groups appearing under both labels: \*\*1\*\*/.test(rep), 'REPORT.md does not count the both-label group');
  return true;
});

// ---------------------------------------------------------------- 5
check('5', 'headline() rejects a non-test row AND a non-test row set: exit 4 both ways', () => {
  const src = (body) => `import { headline } from ${JSON.stringify(RUN_EVAL)};\n${body}\n`;
  const a = child('h-row.mjs', src('headline({ side: "val", cell: "en:prose", bucket: "150-499" }, []);'));
  must(a.code === 4, `a val-side summary row should exit 4, got ${a.code}`);
  must(/Only test-side numbers may headline/.test(a.stderr), 'no honesty-guard message for the val-side row');
  const b = child('h-rows.mjs', src('headline({ side: "test", cell: "en:prose", bucket: "150-499" }, [{ side: "test" }, { side: "val" }]);'));
  must(b.code === 4, `a test-labelled summary over val-side rows should exit 4, got ${b.code}`);
  must(/summarises 1 of 2 rows measured on "val"/.test(b.stderr), `wrong message: ${b.stderr.slice(0, 300)}`);
  const c = child('h-ok.mjs', src('headline({ side: "test", cell: "en:prose", bucket: "150-499" }, [{ side: "test" }]);\nprocess.stdout.write("ok");'));
  must(c.code === 0, `a genuine test-side summary must pass, got ${c.code}: ${c.stderr.slice(0, 300)}`);
  const d = child('h-noargs.mjs', src('headline({ side: "test", cell: "en:prose", bucket: "150-499" });'));
  must(d.code === 4, `headline() without its rows must exit 4 (it would be validating a literal), got ${d.code}`);
  return true;
});

// ---------------------------------------------------------------- 6
check('6', 'emit() refuses a fitting-side number without "(reference only)" and passes it with the marker: exit 4 / 0', () => {
  const line = (extra) => `\`- ${FIT_WORD}-side AUC 0.912${extra}\``;
  const bad = child('e-bad.mjs', `import { emit } from ${JSON.stringify(RUN_EVAL)};\nemit(${line('')});\nprocess.stdout.write("printed");\n`);
  must(bad.code === 4, `an unmarked fitting-side number should exit 4, got ${bad.code}`);
  must(/honesty guard/.test(bad.stderr), 'no honesty-guard message');
  must(!/printed/.test(bad.stdout), 'emit() returned instead of exiting');
  const good = child('e-good.mjs', `import { emit } from ${JSON.stringify(RUN_EVAL)};\nemit(${line(' (reference only)')});\nprocess.stdout.write("printed");\n`);
  must(good.code === 0, `the marked line should pass, got ${good.code}: ${good.stderr.slice(0, 300)}`);
  must(/printed/.test(good.stdout), 'the marked line did not reach the report');
  return true;
});

// ---------------------------------------------------------------- 7
function gateFixturesDir(name, verifyFile) {
  const dir = path.join(WORK, 'fixtures-' + name);
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(FIXTURE, 'must-not-fire.jsonl'), path.join(dir, 'must-not-fire.jsonl'));
  cpSync(path.join(FIXTURE, verifyFile), path.join(dir, 'verify-round-1.jsonl'));
  return dir;
}
check('7', 'the CAL --append guard is absolute: no probe text reaches the markdown, and a fitting-word line is still refused', () => {
  // HEAD-RULINGS R40. The old shape of this check asserted that three named quoted phrases were
  // EXEMPT from the guard and a fourth was not. That exemption is gone: the probe tables print id,
  // language, expectation, observation, result and rule names, never the probe text, so nothing
  // needs exempting. Both halves are asserted here — the word does not reach the report, and the
  // guard that would have caught it is still live.
  const FIT_RE = new RegExp(FIT_WORD, 'i');

  // (a) a fixture whose probe TEXT and LABEL are full of the word appends cleanly, and the appended
  // section contains no occurrence of it.
  const okDir = gateFixturesDir('append-ok', 'verify-round-1.fitword.jsonl');
  const okAppend = path.join(WORK, 'append-ok.md');
  writeFileSync(okAppend, '# base\n', 'utf8');
  const a = node([GATE, '--fixtures', okDir, '--out', path.join(WORK, 'gf-ok'), '--real', '0', '--append', okAppend], { cwd: ROOT });
  must(a.code !== 4, `the append was refused (exit ${a.code}) although no probe text is printed: ${a.stderr.slice(-300)}`);
  const appended = readFileSync(okAppend, 'utf8');
  must(appended.length > '# base\n'.length, 'nothing was appended');
  must(/SP1/.test(appended) && /SP3/.test(appended), 'the probe rows did not reach the appended section at all');
  const leaked = appended.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => FIT_RE.test(l) && !/reference only/i.test(l));
  must(!leaked.length, `the appended section carries the fitting word on ${leaked.length} line(s): ${leaked.slice(0, 3).map(([i, l]) => `${i}: ${l.slice(0, 90)}`).join(' | ')}`);
  const standalone = readFileSync(path.join(WORK, 'gf-ok', 'gate-fixtures.md'), 'utf8');
  must(!standalone.split('\n').some((l) => FIT_RE.test(l) && !/reference only/i.test(l)),
    'the standalone gate-fixtures.md carries the fitting word — R40 covers it too, not only the appended copy');
  // the row IS in the fixture, so the check is about what is printed, not about what was tested
  must(FIT_RE.test(readFileSync(path.join(okDir, 'verify-round-1.jsonl'), 'utf8')),
    'the fixture itself no longer carries the word, so this check proves nothing');

  // (b) the guard is still live: a row whose `note` names a fitting-side number reaches the
  // arbitration list verbatim, and the whole section must be refused.
  const badDir = gateFixturesDir('append-bad', 'verify-round-1.guardlive.jsonl');
  const badAppend = path.join(WORK, 'append-bad.md');
  writeFileSync(badAppend, '# base\n', 'utf8');
  const b = node([GATE, '--fixtures', badDir, '--out', path.join(WORK, 'gf-bad'), '--real', '0', '--append', badAppend], { cwd: ROOT });
  must(b.code === 4, `a fitting-side number in an emitted line should be refused with exit 4, got ${b.code}: ${b.stderr.slice(-300)}`);
  must(/honesty guard/.test(b.stderr), 'no honesty-guard message');
  must(readFileSync(badAppend, 'utf8') === '# base\n', 'the refused section was appended anyway');
  must(existsSync(path.join(WORK, 'gf-bad', 'gate-fixtures.md')), 'the standalone markdown was not written before the refusal');
  return true;
});

// ---------------------------------------------------------------- 8
check('8', 'a fitted-weights file the shipped loader could not read is never written: run-eval exits 6', () => {
  // Redirect only the PRIOR-weights lookup: run-eval reads weights.v1.json from the detector's own
  // directory to copy each feature's `kind`. A prior whose kinds are not one of the three valid
  // transforms produces a fitted file that passes the copy and fails the loader's contract — which
  // is the corruption this check needs, staged entirely in data.
  const core = path.join(WORK, 'fakecore');
  mkdirSync(core, { recursive: true });
  writeFileSync(path.join(core, 'stylometry.mjs'),
    `export { detect } from ${JSON.stringify(path.join(ROOT, 'stylometry.mjs'))};\n`, 'utf8');
  const prior = JSON.parse(readFileSync(path.join(ROOT, 'weights.v1.json'), 'utf8'));
  for (const c of Object.values(prior.cells)) {
    if (!c.kind) continue;
    for (const f of Object.keys(c.kind)) c.kind[f] = 'bogus-transform';
  }
  writeFileSync(path.join(core, 'weights.v1.json'), JSON.stringify(prior, null, 2) + '\n', 'utf8');
  const out = path.join(WORK, 'out-badweights');
  const r = node([RUN_EVAL, '--data', cleanDir, '--fixtures', FIXTURE, '--out', out,
    '--detector', path.join(core, 'stylometry.mjs')], { cwd: ROOT });
  must(r.code === 6, `expected exit 6, got ${r.code}\n${r.stderr.slice(-500)}`);
  must(/do not satisfy the shipped loader/.test(r.stderr), 'no self-validation message');
  must(/kind/.test(r.stderr), `the failure does not name the offending field: ${r.stderr.slice(-300)}`);
  must(!existsSync(path.join(out, 'weights.fitted.json')), 'a weights file the loader cannot read was written anyway');
  return true;
});

// ---------------------------------------------------------------- 9
check('9', 'determinism: two runs on the same synthetic data are byte-identical apart from the timestamp and the out path', () => {
  // NOT "clean2": "out-clean" is a prefix of "out-clean2", and the path-stripping below would
  // rewrite the first and leave a stray "2" behind, failing on its own bookkeeping.
  const second = runEval(cleanDir, 'rerun');
  must(second.code === 0, `the second run exited ${second.code}`);
  const strip = (p) => readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => !/^generated /.test(l))
    .map((l) => l.split(path.relative(ROOT, clean.out)).join('<OUT>').split(path.relative(ROOT, second.out)).join('<OUT>'))
    .join('\n');
  const a = strip(path.join(clean.out, 'REPORT.md'));
  const b = strip(path.join(second.out, 'REPORT.md'));
  if (a !== b) {
    const la = a.split('\n'); const lb = b.split('\n');
    const i = la.findIndex((x, k) => x !== lb[k]);
    throw new Error(`REPORT.md differs at line ${i + 1}:\n  A: ${la[i]}\n  B: ${lb[i]}`);
  }
  const wa = readFileSync(path.join(clean.out, 'weights.fitted.json'), 'utf8');
  const wb = readFileSync(path.join(second.out, 'weights.fitted.json'), 'utf8');
  must(wa === wb, 'weights.fitted.json is not byte-identical across two runs');
  return true;
});

// ---------------------------------------------------------------- 10
check('10', 'placeholders: an under-100 bucket prints INSUFFICIENT; an all-gated bucket prints NO COVERAGE with a measured confusion', () => {
  const rep = readFileSync(path.join(clean.out, 'REPORT.md'), 'utf8');
  const rows = rep.split('\n').filter((l) => /^\| (en|tr):(chat|prose) \| (<20|20-49|50-149|150-499|500\+) \|/.test(l));
  must(rows.length, 'the headline table has no bucket rows');

  const insuff = rows.filter((l) => /INSUFFICIENT — placeholder, not a measurement/.test(l));
  must(insuff.length >= 1, 'no INSUFFICIENT placeholder row — the fixture should have a bucket under 100 per side');
  for (const l of insuff) {
    const c = l.split('|').map((x) => x.trim());
    const nH = Number(c[3]); const nL = Number(c[4]);
    must(Number.isFinite(nH) && Number.isFinite(nL), `INSUFFICIENT row has no counts: ${l}`);
    must(nH < 100 || nL < 100, `INSUFFICIENT printed for a bucket with ${nH}/${nL} — the rule is nH<100 || nL<100`);
    must(!/%/.test(l), `an INSUFFICIENT placeholder must not carry a rate: ${l}`);
  }

  const nocov = rows.filter((l) => /NO COVERAGE/.test(l));
  must(nocov.length >= 1, 'no NO COVERAGE row — the fixture should have an all-gated bucket with >= 100 per side');
  for (const l of nocov) {
    const c = l.split('|').map((x) => x.trim());
    const nH = Number(c[3]); const nL = Number(c[4]);
    must(nH >= 100 && nL >= 100, `NO COVERAGE printed for ${nH}/${nL}; the INSUFFICIENT rule runs first, so both sides must be >= 100`);
    // The pre-R36 row was `| — | | 0.0% | 0.0% | 0.0% | — |`: an EMPTY ECE cell and a hardcoded
    // TPR-hard of 0.0%. The measured row leaves ECE and TPR-hard as em dashes and prints the
    // confusion it actually computed in FPR@t and TPR@t.
    must(c[7] === '—', `the ECE cell of a NO COVERAGE row should be an em dash, got ${JSON.stringify(c[7])} — that empty cell was the hardcoded shape`);
    must(c[10] === '—', `the TPR@t-hard cell should be an em dash, got ${JSON.stringify(c[10])} — a literal there was the hardcoded 0.0%`);
    must(/^\d+(\.\d+)?%$/.test(c[8]) && /^\d+(\.\d+)?%$/.test(c[9]), `FPR@t and TPR@t must be measured rates: ${l}`);
  }
  return true;
});

// ---------------------------------------------------------------- 11
check('11', 'essay genre (R42(e)): the prompt is the holdout unit, the essay table measures and refuses on its own counts, and a planted prompt straddle exits 5', () => {
  const rep = readFileSync(path.join(clean.out, 'REPORT.md'), 'utf8');

  // (a) section 1 carries the prompt-holdout table and says the unit is the PROMPT.
  must(/\*\*Prompt holdout, per public source\*\*/.test(rep), 'REPORT.md has no prompt-holdout table in section 1');
  // Both the pair table and the prompt table have a row starting with the same source name, so
  // read the prompt one out of the prompt table's own slice of the report.
  const promptSection = rep.slice(rep.indexOf('**Prompt holdout, per public source**'));
  const promptRow = promptSection.split('\n').find((l) => /^\| `public:synthetic-essays` \|/.test(l));
  must(promptRow, 'the prompt-holdout table has no row for the synthetic essay source');
  must(/PROMPT/.test(promptRow), `the essay source's holdout unit should be the PROMPT: ${promptRow}`);
  const straddleCell = promptRow.split('|').map((x) => x.trim())[8];
  must(straddleCell === '0', `prompts straddling two sides should be 0 on a clean fixture, got ${JSON.stringify(straddleCell)}`);

  // (b) the essay section exists, measures its own rows, and refuses the thin bucket.
  must(/^## 3b\. The essay genre/m.test(rep), 'REPORT.md has no section 3b (the essay genre)');
  const essayRows = rep.split('\n').filter((l) => /^\| en:prose essay \| (<20|20-49|50-149|150-499|500\+) \|/.test(l));
  must(essayRows.length >= 2, `the essay table should carry a measured bucket and a refused one, got ${essayRows.length} row(s)`);
  const measured = essayRows.filter((l) => !/INSUFFICIENT|NO COVERAGE/.test(l));
  const refused = essayRows.filter((l) => /INSUFFICIENT — placeholder/.test(l));
  must(measured.length >= 1, 'no measured essay bucket — the fixture should have one over 100 per side');
  must(refused.length >= 1, 'no INSUFFICIENT essay bucket — the essay table must refuse on its own counts, not on the cell\'s');
  for (const l of refused) {
    const c = l.split('|').map((x) => x.trim());
    must(Number(c[3]) < 100 || Number(c[4]) < 100, `essay INSUFFICIENT printed for ${c[3]}/${c[4]}`);
    must(!/%/.test(l), `an essay INSUFFICIENT placeholder must not carry a rate: ${l}`);
  }

  // (c) the essay threshold is re-picked on essay validation rows, and both thresholds are shown.
  must(/t_essay = \*\*/.test(rep), 'the essay section does not report its own re-picked threshold');
  must(/the cell-wide t of section 5 is/.test(rep), 'the essay section does not print the cell-wide t beside t_essay');
  must(/human essays flagged at t \(TEST side only\)/.test(rep), 'the essay section has no negative-control table');
  must(/The non-native stratum is UNMEASURED on essays/.test(rep), 'the essay section does not state that the non-native stratum is unmeasured');

  // (d) the planted fault: one essay row of a prompt moved to another side. The prompt is the
  // shard and the shard is in the group, so this is a non-writer group straddle and run-eval
  // must refuse to publish anything measured over it.
  const dir = dataVariant('prompt-straddle', (rows) => {
    const victim = rows.find((r) => r.genre === 'essay' && r.side === 'test' && r.label === 'llm');
    must(victim, 'the fixture has no test-side essay row to move');
    victim.side = 'fit';
    return rows;
  });
  const r = runEval(dir, 'prompt-straddle');
  must(r.code === 5, `expected exit 5 for an essay prompt on two sides, got ${r.code}\n${r.stderr.slice(-400)}`);
  must(/non-writer group/i.test(r.stderr), 'stderr does not say a non-writer group straddled');
  return true;
});

// ---------------------------------------------------------------- summary

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
process.stdout.write(`\n${passed} of ${results.length} checks passed in ${secs}s.\n`);
if (!failed.length) {
  process.stdout.write('These checks prove the guards REFUSE planted faults. The correctness of the numbers\n'
    + 'printed when nothing fires rests on the independent re-derivation of HEAD-RULINGS R36,\n'
    + 'which a fixture cannot replace.\n');
}
if (failed.length) {
  process.stdout.write(`FAILED: ${failed.map((r) => r.id).join(', ')}\n`);
  process.stdout.write('The eval harness did not refuse something it documents itself as refusing.\n');
}
if (!KEEP && !failed.length) rmSync(WORK, { recursive: true, force: true });
else process.stdout.write(`work kept at ${path.relative(ROOT, WORK)}\n`);
process.exit(failed.length ? 1 : 0);
