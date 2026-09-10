#!/usr/bin/env node
/**
 * platform-essay.mjs — the shape a school platform's backend calls, in about a hundred lines.
 *
 *   node examples/platform-essay.mjs <essay.txt> [--history prior.jsonl | --history-profile p.json]
 *
 * It imports `detect()` from the shipped module — no child process, no network, no dependencies —
 * and prints the four things a teacher-facing UI needs and nothing it does not:
 *
 *   1. summary.label      one of four values, NEVER a yes/no and never a grade input
 *   2. the verdict        the six-value detector verdict the label is derived from
 *   3. evidenceSpans[]    where the tool looked, as [start,end] offsets into the RAW text
 *   4. summary.caveat     the base-rate sentence, which travels with every label
 *
 * `humanReviewRequired` is true on every report this tool produces. A label is a REVIEW FLAG: it
 * says "a person should read this", never "this student cheated". Read
 * README.md § "Using this in a school platform" before wiring it to anything a student sees.
 *
 * HEAD-RULINGS R42. Written against the field names R42 rules; where a field is not present in the
 * installed core yet, this script says so on stderr and degrades rather than crashing, so it stays
 * runnable while the core catches up.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../stylometry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The label a platform shows, derived from the verdict (R42(a)). The core emits `summary` itself;
// this map is the fallback for an older build, and it is here so a reader can see the derivation
// rather than take it on trust. There are four values and there is never a fifth.
const LABEL_OF = {
  likely_llm: 'fingerprint_found',
  leaning_llm: 'ai_style_indicators',
  uncertain: 'no_reliable_indicators',
  leaning_human: 'no_reliable_indicators',
  likely_human: 'no_reliable_indicators',
  insufficient_text: 'too_short_or_no_signal',
};

const WHAT_TO_SHOW = {
  fingerprint_found: 'Show the matched string. This is the only label backed by a near-100%-precision rule — and it still means "a machine wrote this string", not "this student did not write this essay". A pasted confirmation, a quoted reply and a forwarded draft all land here.',
  ai_style_indicators: 'Show it as a prompt to read the essay, with the evidence spans highlighted and the base rate beside them. This label is a weak style prior and it is biased against careful and non-native writers.',
  no_reliable_indicators: 'Show nothing, or show "no indicators". This is NOT evidence the essay is human-written; it is the absence of evidence either way, which is the normal outcome.',
  too_short_or_no_signal: 'Show the reason, not a verdict. Below the length floor, or above it with nothing to read. Do not let the UI round this to "clean".',
};

function usage(code) {
  process.stderr.write(`usage: node examples/platform-essay.mjs <essay.txt> [--history prior-submissions.jsonl]

  <essay.txt>   the submission, as plain UTF-8 text
  --history           JSONL of the same student's PRIOR submissions, one {"id","text"} per line
                      (R42(d): >= 2 prior documents of >= 150 tokens, or the tool says so and stops
                      using them). Costs one detect() per prior, on every call.
  --history-profile   a profile built once and stored, instead of re-reading the priors (R45).
                      Byte-identical output, and the shape a platform should use:
                        node stylometry.mjs --build-history-profile prior.jsonl \\
                          --preset essay --allow-uncalibrated > profile.json
                      A profile is valid only for the cell and weights id it was built in; a
                      mismatch warns history_profile_mismatch and makes NO comparison.

History can move a lean toward "uncertain", never away from it.
`);
  process.exit(code);
}

const argv = process.argv.slice(2);
if (!argv.length || argv.includes('-h') || argv.includes('--help')) usage(argv.length ? 0 : 1);
const file = argv[0];
const hIdx = argv.indexOf('--history');
const historyFile = hIdx >= 0 ? argv[hIdx + 1] : null;
if (hIdx >= 0 && !historyFile) usage(1);
const pIdx = argv.indexOf('--history-profile');
const profileFile = pIdx >= 0 ? argv[pIdx + 1] : null;
if (pIdx >= 0 && !profileFile) usage(1);
if (historyFile && profileFile) { process.stderr.write('pass --history or --history-profile, not both\n'); usage(1); }
if (!existsSync(file)) { process.stderr.write(`no such file: ${file}\n`); process.exit(2); }

const text = readFileSync(file, 'utf8');
let history = null;
if (historyFile) {
  if (!existsSync(historyFile)) { process.stderr.write(`no such history file: ${historyFile}\n`); process.exit(2); }
  history = readFileSync(historyFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
let historyProfile = null;
if (profileFile) {
  if (!existsSync(profileFile)) { process.stderr.write(`no such profile: ${profileFile}\n`); process.exit(2); }
  historyProfile = JSON.parse(readFileSync(profileFile, 'utf8'));
}

// The essay preset (R42(c)) is `--context prose --genre essay --lang en`. Passing it through the
// library means naming the three options; a CLI caller writes `--preset essay` instead.
const opts = {
  shape: 'prose', genre: 'essay', lang: 'en', channel: 'unknown', domain: 'general',
  allowUncalibrated: true,      // the shipped weights are priors; see README "Status: uncalibrated"
  explain: true,
  now: Date.now(),              // enables the weights-expiry check (R5); omit it and detect() stays pure
  ...(history ? { history } : {}),
  ...(historyProfile ? { historyProfile } : {}),
};

let report;
try {
  report = detect(text, opts);
} catch (e) {
  process.stderr.write(`detect() threw: ${e.message}\n`);
  process.exit(3);
}

const summary = report.summary || {
  label: LABEL_OF[report.verdict] || 'no_reliable_indicators',
  humanReviewRequired: true,
  matched: (report.rules || []).map((r) => `${r.name}: ${JSON.stringify(r.matched)}`),
  reason: report.gates?.reason || null,
  caveat: (report.caveats || [])[0] || null,
};
if (!report.summary) {
  process.stderr.write('note: this build does not emit `summary`; the label above was derived locally from the verdict.\n');
}

const out = [];
out.push('=== what the platform shows ===');
out.push(`label:                ${summary.label}`);
out.push(`humanReviewRequired:  ${summary.humanReviewRequired === false ? 'false  <-- this should never happen' : 'true'}`);
if (summary.reason) out.push(`reason:               ${summary.reason}`);
if (summary.matched && summary.matched.length) {
  out.push('matched (quote these verbatim, they are the whole basis of the label):');
  for (const m of summary.matched) out.push(`  - ${m}`);
}
out.push('');
out.push(`ui guidance:          ${WHAT_TO_SHOW[summary.label] || '(unknown label — do not render it)'}`);
out.push('');
out.push('=== the detector verdict the label came from ===');
out.push(`verdict:  ${report.verdict}`);
out.push(`score:    ${report.score === null ? 'null (not scored)' : Number(report.score).toFixed(6)}   <- a ranking number, NOT a probability`);
out.push(`tokens:   ${report.counts?.tokens ?? '?'}   gates failed: ${(report.gates?.failed || []).join(', ') || 'none'}`);
out.push(`warnings: ${(report.warnings || []).join(', ') || 'none'}`);
if ((report.warnings || []).includes('history_profile_mismatch')) {
  out.push('          ^ the profile was built for a different cell or weights file. NO history');
  out.push('            comparison was made — rebuild it rather than trusting a stale one.');
}
for (const n of (report.notes || [])) out.push(`note:     ${n}`);
out.push('');

out.push('=== evidence spans: where the tool looked ===');
const spans = report.evidenceSpans;
if (!Array.isArray(spans)) {
  out.push('(this build does not emit `evidenceSpans` yet — R42(b). Falling back to the rule matches');
  out.push(' and the named signals, which carry no offsets.)');
  for (const r of (report.rules || [])) out.push(`  rule   ${r.name}: ${JSON.stringify(r.matched)}`);
  for (const s of (report.signals || [])) {
    if (s.matched) out.push(`  signal ${s.name}: ${JSON.stringify(String(s.matched).slice(0, 80))}`);
  }
} else if (!spans.length) {
  out.push('  none. Every feature that fired is a rhythm statistic with no literal span.');
} else {
  for (const s of spans) {
    out.push(`  [${s.start},${s.end}] ${s.source}/${s.name} (${s.direction}): ${JSON.stringify(text.slice(s.start, s.end))}`);
  }
  out.push('');
  out.push('  A span is where the tool looked. It is never "this sentence is AI".');
}
out.push('');

out.push('=== the caveat that travels with the label ===');
out.push(summary.caveat ? '  ' + summary.caveat : '  (none emitted — do not ship a label without one)');
out.push('');
out.push('  A label is a review flag, never a grade input, and never proof about a person.');

process.stdout.write(out.join('\n') + '\n');
process.exit(0);
