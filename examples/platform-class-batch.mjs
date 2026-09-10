#!/usr/bin/env node
/**
 * platform-class-batch.mjs — scoring a whole class in one pass, the way a platform should.
 *
 *   node examples/platform-class-batch.mjs <class.jsonl> [--corpus <archive.jsonl>]
 *   node examples/platform-class-batch.mjs --build-profile <prior.jsonl> [--out profile.json]
 *
 * `--history` costs one detect() per prior submission on every call. A platform holds every
 * student's prior work and scores thousands of submissions, so it does the comparison the other way
 * round (HEAD-RULINGS R45): build ONE profile per student when a submission is accepted, store it
 * next to the student, and pass it back on every later submission. A profile is pure JSON and
 * `buildHistoryProfile()` is pure, so it can live in a database column.
 *
 * The class file is JSONL, one submission per line:
 *
 *   {"id":"sub-1041","student":"s-77","text":"…","historyProfile":{…}}
 *   {"id":"sub-1042","student":"s-81","text":"…","history":["…prior essay…"]}
 *   {"id":"sub-1043","student":"s-90","text":"…"}
 *
 * A row's `historyProfile` (or `history`) wins over anything on the command line. A row with
 * neither is scored without history and says so — a student's first submission is not a problem to
 * be worked around.
 *
 * A profile is valid ONLY for the cell and weights id it was built in. If either differs the core
 * warns `history_profile_mismatch` and makes NO comparison, rather than a silently wrong one; this
 * script surfaces that per row, because a stale profile is exactly the bug a platform would not
 * notice.
 *
 * TWO STUDENTS HANDING IN THE SAME ESSAY is a corpus question, not a stylometry one (HEAD-RULINGS
 * R46(c)). The `near_duplicate` rule compares a document against an index and only ever fires
 * across DIFFERENT senders, so it needs the rest of the class to look at. This script therefore
 * builds the index from the batch itself by default — every row is both a document to score and a
 * document to compare against — and `--corpus <archive.jsonl>` adds an archive of earlier
 * submissions ({id, sender, text}) so this term's work is checked against last term's too.
 *
 * A near-duplicate is `templated_or_copied`: it proves the text was NOT INDEPENDENTLY AUTHORED —
 * template, copy or shared source — and is never evidence of LLM authorship (R3). Two students with
 * the same essay is a thing to look into; which of them wrote it, and whether either did, is not
 * something this tool can tell you.
 *
 * Zero dependencies. The label is a review flag, never a grade input — see README.md
 * § "Using this in a school platform".
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { detectBatch, buildHistoryProfile, buildCorpusIndex } from '../stylometry.mjs';

const PRESET = { shape: 'prose', genre: 'essay', lang: 'en' };   // --preset essay (R42(c))
const BASE = { ...PRESET, allowUncalibrated: true, explain: true };

const argv = process.argv.slice(2);
const usage = (code) => {
  process.stderr.write(`usage:
  node examples/platform-class-batch.mjs <class.jsonl> [--corpus <archive.jsonl>]
      score every submission in one pass; one label line per row.
      The class file is ALWAYS its own near-duplicate index; --corpus adds an archive of
      earlier submissions ({"id","sender","text"} per line) to compare against as well.

  node examples/platform-class-batch.mjs --build-profile <prior.jsonl> [--out <profile.json>]
      build one student's history profile from their prior submissions and print it

class.jsonl rows: {"id","text"} plus optionally "student" and one of
  "historyProfile": <a profile built by --build-profile>      (cheap: no re-scoring of priors)
  "history": ["prior text", …] or [{"id","text"}, …]          (costs one detect() per prior)
`);
  process.exit(code);
};
if (!argv.length || argv.includes('-h') || argv.includes('--help')) usage(argv.length ? 0 : 1);

// ---------------------------------------------------------------- build-profile mode
if (argv[0] === '--build-profile') {
  const src = argv[1];
  if (!src) usage(1);
  if (!existsSync(src)) { process.stderr.write(`no such file: ${src}\n`); process.exit(2); }
  const rows = readFileSync(src, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const profile = buildHistoryProfile(rows, BASE);
  const oIdx = argv.indexOf('--out');
  const json = JSON.stringify(profile, null, 2) + '\n';
  if (oIdx > 0 && argv[oIdx + 1]) {
    writeFileSync(argv[oIdx + 1], json);
    process.stderr.write(`wrote ${argv[oIdx + 1]}\n`);
  } else {
    process.stdout.write(json);
  }
  process.stderr.write(`profile: ${profile.priorDocs} of ${profile.inputRows} prior submission(s) usable, `
    + `${Object.keys(profile.features).length} features, cell ${profile.cell}, weights ${profile.weightsId}\n`);
  if (profile.skippedRows && profile.skippedRows.length) {
    process.stderr.write(`skipped: ${profile.skippedRows.length} row(s) under ${profile.minTokensPerDoc} tokens — `
      + 'a profile needs at least 2 prior documents of that length or the core reports history_insufficient\n');
  }
  process.exit(0);
}

// ---------------------------------------------------------------- score a class
const file = argv[0];
if (!existsSync(file)) { process.stderr.write(`no such file: ${file}\n`); process.exit(2); }
const cIdx = argv.indexOf('--corpus');
const archiveFile = cIdx >= 0 ? argv[cIdx + 1] : null;
if (cIdx >= 0 && !archiveFile) usage(1);
if (archiveFile && !existsSync(archiveFile)) { process.stderr.write(`no such archive: ${archiveFile}\n`); process.exit(2); }
const rows = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
  try { return JSON.parse(l); } catch (e) { process.stderr.write(`${file}:${i + 1}: ${e.message}\n`); process.exit(2); }
});

// The near-duplicate index: this class, plus any archive. `sender` is what stops the rule matching a
// document against itself or against the same student's own earlier draft — so a row without a
// `student` gets its own id as its sender, which is the conservative reading (never a false pair).
const archive = archiveFile
  ? readFileSync(archiveFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  : [];
const corpusIndex = buildCorpusIndex([
  ...rows.map((r) => ({ id: r.id, sender: r.student ?? r.sender ?? r.id, text: r.text })),
  ...archive.map((r) => ({ id: r.id, sender: r.student ?? r.sender ?? r.id, text: r.text })),
]);
BASE.corpusIndex = corpusIndex;

// ONE pass. Per-row history/historyProfile ride along on the row (R45); everything else is shared.
const reports = detectBatch(rows.map((r) => ({
  id: r.id,
  text: r.text,
  ...(r.historyProfile ? { historyProfile: r.historyProfile } : {}),
  ...(r.history ? { history: r.history } : {}),
})), BASE);

// 'not_independently_authored' is 26 characters (R47); the column is sized for the longest label
// so a five-value output still lines up.
const LABEL_W = 28;
const duplicateOf = (rep) => {
  const r = (rep.rules || []).find((x) => (x.rule || x.name) === 'near_duplicate');
  return r ? String(r.matched || '') : null;
};
const historyOf = (rep) => {
  const w = rep.warnings || [];
  if (w.includes('history_profile_mismatch')) return 'PROFILE STALE — no comparison made';
  if (w.includes('history_insufficient')) return 'history too thin to use';
  if (w.includes('style_shift_vs_history')) {
    const n = (rep.history && rep.history.shifted && rep.history.shifted.length) || 0;
    return `style shift on ${n} feature(s) — a reason to look`;
  }
  if ((rep.notes || []).some((n) => String(n).startsWith('consistent_with_history'))) {
    return `consistent with ${rep.history ? rep.history.priorDocs : '?'} prior submission(s)`;
  }
  return 'no history supplied';
};

process.stdout.write(`${'submission'.padEnd(14)}${'student'.padEnd(10)}${'label'.padEnd(LABEL_W)}${'verdict'.padEnd(18)}history\n`);
process.stdout.write('-'.repeat(110) + '\n');

const tally = {};
let mismatches = 0;
let dups = 0;
for (let i = 0; i < reports.length; i++) {
  const rep = reports[i];
  const row = rows[i];
  const label = (rep.summary && rep.summary.label) || 'ERROR';
  tally[label] = (tally[label] || 0) + 1;
  if ((rep.warnings || []).includes('history_profile_mismatch')) mismatches++;
  process.stdout.write(
    `${String(row.id ?? i).padEnd(14)}${String(row.student ?? '—').padEnd(10)}${label.padEnd(LABEL_W)}`
    + `${String(rep.verdict).padEnd(18)}${historyOf(rep)}\n`,
  );
  for (const m of ((rep.summary && rep.summary.matched) || [])) {
    process.stdout.write(`${' '.repeat(24)}matched: ${m}\n`);
  }
  const dup = duplicateOf(rep);
  if (dup) {
    dups++;
    process.stdout.write(`${' '.repeat(24)}templated_or_copied: ${dup}\n`);
    process.stdout.write(`${' '.repeat(24)}  -> not independently authored. NOT evidence of LLM authorship (R3).\n`);
  }
}

process.stdout.write('\n' + Object.entries(tally).sort().map(([k, v]) => `${k}: ${v}`).join('  ·  ') + '\n');
process.stdout.write(`${reports.length} submission(s) in one pass, indexed against ${corpusIndex.length} document(s)`
  + `${archive.length ? ` (${rows.length} in this class + ${archive.length} archived)` : ''}. `
  + 'Every row needs a human before anything happens to a student.\n');
if (dups) {
  process.stdout.write(`${dups} row(s) near-duplicate another submission by a DIFFERENT student. That is "not\n`
    + 'independently authored" — template, copy or a shared source — and says nothing about whether\n'
    + 'any of them was machine-written (HEAD-RULINGS R3).\n');
}
if (mismatches) {
  process.stderr.write(`${mismatches} row(s) carried a profile built for a different cell or weights file. `
    + 'No comparison was made for them — rebuild those profiles.\n');
}
process.exit(0);
