#!/usr/bin/env node
// stylometry.mjs — llm-detect: deterministic stylometric triage for EN/TR text.
// Importable (`import { detect } from './stylometry.mjs'`) AND a CLI. Zero runtime dependencies.
//
// READ THIS BEFORE READING A VERDICT:
//   This is a triage instrument that ranks strings, not a verdict instrument that judges people.
//   `likely_llm` is reachable only behind a Tier-0 artifact rule (a fingerprint), never from
//   style alone. `likely_human` is reachable only in --aggregate mode. `insufficient_text` is the
//   correct answer for most real chat traffic and is a deliverable, not a failure.
//   EXIT CODE 0 MEANS "A REPORT WAS PRODUCED". It never means "the text is human".
import { loadResources, readText, readStdinSync, readJsonl, existsSync, isMain } from './lib/io.mjs';
import {
  detect as coreDetect, detectBatch as coreBatch, aggregate as coreAggregate,
  buildCorpusIndex, configure, DETECTOR_VERSION,
  buildHistoryProfile as coreBuildHistoryProfile,
} from './lib/detect.mjs';
import { validateWeightsShape } from './lib/score.mjs';
import { authorOf } from './lib/rules.mjs';

// One-time resource load (SPEC §I B1 item 3: the Aho-Corasick trie is built once at module load).
const RES = loadResources();
configure(RES);

export const VERSION = {
  detector: DETECTOR_VERSION,
  lexicon: RES.lexicon.version,
  weights: RES.weights.weightsId,
  provenance: RES.weights.provenance,
  expiresAt: RES.weights.expiresAt,
};

export const detect = coreDetect;
export const detectBatch = coreBatch;
export const aggregate = coreAggregate;
export const buildHistoryProfile = coreBuildHistoryProfile;
export { buildCorpusIndex };

// ===========================================================================
// CLI
// ===========================================================================
const USAGE = `llm-detect ${DETECTOR_VERSION} — human-vs-LLM text triage (EN/TR)

  node stylometry.mjs [input] [options]

INPUT (exactly one)
  --file <path>            one document
  --text <string>          one document, inline
  (none)                   read stdin
  --jsonl <path>           batch: NDJSON in, NDJSON out (one report per line, id passed through)
  --aggregate <path>       NDJSON grouped by "sender"; one aggregate report per sender

OPTIONS
  --context chat|prose|auto      what the text LOOKS like              (default auto)
  --channel whatsapp|web|email|form|unknown   where it ARRIVED         (default unknown)
  --lang auto|en|tr                                                    (default auto)
  --genre auto|review|email|chat|essay|formal_letter|marketing         (default auto)
  --preset essay                 = --context prose --genre essay --lang en (R42c)
  --history <path>         NDJSON {id,text} of the SAME author's PRIOR submissions (R42d)
  --history-profile <path> a profile built by --build-history-profile, instead of --history
  --build-history-profile <path>   print the history profile JSON for those priors and exit 0
  --domain general|customer_service                                    (default general)
  --corpus <path>          NDJSON {id,sender,text} index enabling near_duplicate
                           (rows may use "student" instead of "sender"; sender wins)
  --markers <path>         known-machine markers (default ./markers.json, ships as [])
  --weights <path>         override weights.v1.json
  --allow-uncalibrated     REQUIRED to emit any verdict from prior weights
  --explain                include inactive features in signals[] with value null
  --pretty                 human-readable text instead of JSON
  --json                   emit JSON (the default; accepted for symmetry)
  --version                print { detector, lexicon, weights, node } and exit 0
  --help

EXIT CODES
  0 one or more reports emitted — SAYS NOTHING ABOUT THE VERDICT
  1 usage error   2 input error   3 refused to score (uncalibrated)   4 invariant violation

Arabic is out of scope (HEAD-RULINGS R22): Arabic-script text returns insufficient_text with
gates.failed ["G3_lang"] and reason "unsupported_language". It is never scored.
`;

const FLAGS_WITH_VALUE = new Set(['--file', '--text', '--jsonl', '--aggregate', '--context',
  '--channel', '--lang', '--genre', '--domain', '--corpus', '--weights', '--markers',
  '--preset', '--history', '--history-profile', '--build-history-profile']);
const BOOL_FLAGS = new Set(['--allow-uncalibrated', '--explain', '--pretty', '--json',
  '--version', '--help', '-h']);

function fail(code, msg) {
  process.stderr.write(`llm-detect: ${msg}\n`);
  if (code === 1) process.stderr.write(USAGE);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { bools: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS_WITH_VALUE.has(a)) {
      if (i + 1 >= argv.length) fail(1, `missing argument for ${a}`);
      const k = a.slice(2);
      if (o[k] !== undefined) fail(1, `${a} given twice`);
      o[k] = argv[++i];
    } else if (BOOL_FLAGS.has(a)) {
      o.bools.add(a);
    } else {
      fail(1, `unknown flag or stray argument: ${a}`);
    }
  }
  return o;
}

// R42(c): a preset supplies DEFAULTS. An explicit flag always wins, wherever it sits on the
// command line — a preset that could be silently overridden by argument order would be worse
// than no preset at all.
const PRESETS = { essay: { context: 'prose', genre: 'essay', lang: 'en' } };

export function applyPreset(a) {
  if (a.preset === undefined) return a;
  const p = PRESETS[a.preset];
  if (!p) fail(1, `--preset must be one of: ${Object.keys(PRESETS).join('|')}`);
  for (const [k, v] of Object.entries(p)) if (a[k] === undefined) a[k] = v;
  return a;
}

function optsFrom(a) {
  const shape = a.context ?? 'auto';
  if (!['auto', 'chat', 'prose'].includes(shape)) fail(1, `--context must be chat|prose|auto`);
  const lang = a.lang ?? 'auto';
  if (!['auto', 'en', 'tr'].includes(lang)) {
    fail(1, '--lang must be auto|en|tr (Arabic is out of scope, HEAD-RULINGS R22)');
  }
  const channel = a.channel ?? 'unknown';
  if (!['whatsapp', 'web', 'email', 'form', 'unknown'].includes(channel)) fail(1, 'bad --channel');
  const genre = a.genre ?? 'auto';
  if (!['auto', 'review', 'email', 'chat', 'essay', 'formal_letter', 'marketing'].includes(genre)) fail(1, 'bad --genre');
  const domain = a.domain ?? 'general';
  if (!['general', 'customer_service'].includes(domain)) fail(1, 'bad --domain');
  return {
    shape, lang, channel, genre, domain,
    allowUncalibrated: a.bools.has('--allow-uncalibrated'),
    explain: a.bools.has('--explain'),
    now: Date.now(),
  };
}

function pretty(r) {
  const L = [];
  const pad = (s, n) => String(s).padEnd(n);
  // R42(a): the platform-facing label comes first, before the verdict vocabulary.
  if (r.summary) {
    L.push(`SUMMARY: ${r.summary.label}   (human review required: ${r.summary.humanReviewRequired})`);
    if (r.summary.matched.length) for (const m of r.summary.matched) L.push(`  matched: ${m}`);
    if (r.summary.reason) L.push(`  reason: ${r.summary.reason}`);
  }
  L.push(`VERDICT: ${r.verdict}${r.mode === 'aggregate' ? '   (aggregate over ' + r.messageCount + ' messages)' : ''}`);
  const ch = r.channels ?? { human: 0, llm: 0 };
  L.push(`  score: ${r.score === null ? 'n/a' : r.score.toFixed(3)}   `
    + `channels: human ${ch.human.toFixed(3)} / llm ${ch.llm.toFixed(3)}`);
  L.push(`  lang=${r.language.primary} (conf ${r.language.confidence}) shape=${r.shape} `
    + `channel=${r.channel} genre=${r.genre} domain=${r.domain}`);
  L.push(`  counts: ${r.counts.tokens} tokens, ${r.counts.chars} chars, ${r.counts.sentences} sentences`);
  L.push(`  gates passed: ${r.gates.passed.join(', ') || '(none)'}`
    + (r.gates.failed.length ? `   FAILED: ${r.gates.failed.join(', ')} (${r.gates.reason})` : ''));
  if (r.caps) L.push(`  caps: band ${r.caps.band}, maxDeviation ${r.caps.maxDeviation}, applied ${r.caps.applied}`);
  if (r.perMessage) L.push(`  perMessage: ${r.perMessage.map((m) => `${m.id}:${m.verdict}`).join(', ')}`);
  L.push('');
  L.push('RULES FOUND (artifact matches — high precision, printed separately from the score)');
  if (r.rules.length === 0) L.push('  none');
  else for (const x of r.rules) L.push(`  - ${x.name} [${x.precision}]: ${JSON.stringify(x.matched)}`);
  L.push('');
  L.push('SIGNALS (weak style priors — sorted by |contribution|)');
  const shown = r.signals.filter((s) => s.value !== null).slice(0, 12);
  if (shown.length === 0) L.push('  none active');
  for (const s of shown) {
    L.push(`  ${pad(s.name, 28)} ${pad(s.direction, 6)} value=${pad(String(s.value), 10)} `
      + `w=${pad(s.weight, 5)} z=${pad(String(s.z), 8)} contrib=${s.contribution.toFixed(4)} [${s.confidence}]`);
    if (s.matched) L.push(`      matched: ${String(s.matched).slice(0, 90)}`);
  }
  if (r.warnings.length) { L.push(''); L.push('WARNINGS'); for (const w of r.warnings) L.push('  - ' + w); }
  if (r.notes.length) { L.push(''); L.push('NOTES'); for (const n of r.notes) L.push('  - ' + n); }
  L.push('');
  L.push('CAVEATS');
  for (const c of r.caveats) L.push('  - ' + c);
  L.push('');
  L.push('Exit code 0 means a report was produced. It never means "the text is human".');
  return L.join('\n');
}

/**
 * D-07: a markers file that is a valid JSON array but contains an INVALID REGEX used to be
 * dropped silently by knownMachineMarker's `catch { continue; }` — the operator believed a marker
 * was armed when it was not. Every pattern is compiled at load time; a bad one exits 2.
 */
function validateMarkers(markers, where) {
  if (!Array.isArray(markers)) fail(2, `markers file must be a JSON array of {name,pattern,note}: ${where}`);
  markers.forEach((m, i) => {
    if (!m || typeof m.pattern !== 'string') {
      fail(2, `marker ${i} in ${where} has no string "pattern"`);
    }
    try { new RegExp(m.pattern, 'u'); }
    catch (e) { fail(2, `marker ${i} ("${m.name ?? '(unnamed)'}") in ${where} is not a valid u-flag regex: ${e.message}`); }
  });
  return markers;
}

/**
 * R36(c): every field lib/detect.mjs and lib/score.mjs dereference is required, and a violation
 * exits 4 naming the file, the cell and the field — never a stack trace. S-04's expiresAt check
 * (a malformed expiry used to mean the weights NEVER expire) is folded into the same contract.
 */
function validateWeights(w, where) {
  try { return validateWeightsShape(w, where); }
  catch (e) { fail(4, e.message); }
  return w;
}

function guardUncalibrated(o) {
  if (RES.weights.provenance === 'prior' && !o.allowUncalibrated) {
    fail(3, 'refusing to score with uncalibrated prior weights — pass --allow-uncalibrated '
      + '(and read what that means in README.md)');
  }
}

function assertContributionSum(r) {
  if (r.score === null) return;
  const sum = r.signals.filter((s) => s.value !== null)
    .reduce((a, s) => a + s.contribution, 0) + r.scoring.b0Effective;
  if (Math.abs(sum - r.scoring.logit) > 1e-9) {
    fail(4, `contribution-sum invariant violated: sum+b0Effective=${sum} logit=${r.scoring.logit}`);
  }
}

function main() {
  const a = applyPreset(parseArgs(process.argv.slice(2)));
  if (a.bools.has('--help') || a.bools.has('-h')) { process.stdout.write(USAGE); process.exit(0); }
  if (a.bools.has('--version')) {
    process.stdout.write(JSON.stringify({ ...VERSION, node: process.version }, null, 2) + '\n');
    process.exit(0);
  }

  const inputs = ['file', 'text', 'jsonl', 'aggregate'].filter((k) => a[k] !== undefined);
  if (inputs.length > 1) fail(1, `exactly one input allowed, got: ${inputs.join(', ')}`);

  const o = optsFrom(a);
  if (a.markers) {
    if (!existsSync(a.markers)) fail(2, `markers file not found: ${a.markers}`);
    try { o.markers = JSON.parse(readText(a.markers)); }
    catch (e) { fail(2, `markers file is not valid JSON: ${e.message}`); }
    validateMarkers(o.markers, a.markers);
  } else {
    validateMarkers(RES.markers, 'markers.json');
  }
  // R45 addendum (1): `--build-history-profile` emits no verdict and no score, so the
  // uncalibrated refusal has nothing to refuse. The weights SHAPE is still validated — a broken
  // file must still exit 4 — but the exit-3 guard is skipped for this mode only. Every scoring
  // mode is unchanged and still exits 3 without --allow-uncalibrated.
  const scoresNothing = a['build-history-profile'] !== undefined;
  if (a.weights) {
    try { o.weights = JSON.parse(readText(a.weights)); }
    catch (e) { fail(2, `weights file unreadable: ${e.message}`); }
    validateWeights(o.weights, a.weights);
    if (!scoresNothing && o.weights.provenance === 'prior' && !o.allowUncalibrated) {
      fail(3, 'refusing to score with uncalibrated prior weights — pass --allow-uncalibrated');
    }
  } else {
    validateWeights(RES.weights, 'weights.v1.json');
    if (!scoresNothing) guardUncalibrated(o);
  }

  const readHistoryRows = (path, what) => {
    if (!existsSync(path)) fail(2, `${what} file not found: ${path}`);
    const rows = readJsonl(path);
    const bad = rows.filter((r) => !r.ok).length;
    const texts = rows.filter((r) => r.ok).map((r) => r.row.text)
      .filter((t) => typeof t === 'string' && t.length > 0);
    if (texts.length === 0) fail(2, `${what} file has no usable {id,text} rows: ${path}`);
    if (bad) process.stderr.write(`llm-detect: ${bad} malformed ${what} line(s) skipped\n`);
    return texts;
  };

  // R45: build a reusable per-author profile and exit. No scoring, no verdict.
  if (a['build-history-profile'] !== undefined) {
    const texts = readHistoryRows(a['build-history-profile'], 'history');
    process.stdout.write(JSON.stringify(coreBuildHistoryProfile(texts, o), null, 2) + '\n');
    process.exit(0);
  }
  if (a['history-profile'] !== undefined) {
    if (!existsSync(a['history-profile'])) fail(2, `history profile not found: ${a['history-profile']}`);
    try { o.historyProfile = JSON.parse(readText(a['history-profile'])); }
    catch (e) { fail(2, `history profile is not valid JSON: ${e.message}`); }
    if (!o.historyProfile || typeof o.historyProfile !== 'object' || Array.isArray(o.historyProfile)) {
      fail(2, 'history profile must be a JSON object built by --build-history-profile');
    }
  }
  if (a.history !== undefined) {
    if (!existsSync(a.history)) fail(2, `history file not found: ${a.history}`);
    const rows = readJsonl(a.history);
    const bad = rows.filter((r) => !r.ok).length;
    o.history = rows.filter((r) => r.ok).map((r) => r.row.text)
      .filter((t) => typeof t === 'string' && t.length > 0);
    if (o.history.length === 0) fail(2, `history file has no usable {id,text} rows: ${a.history}`);
    if (bad) process.stderr.write(`llm-detect: ${bad} malformed history line(s) skipped\n`);
  }

  if (a.corpus) {
    if (!existsSync(a.corpus)) fail(2, `corpus not found: ${a.corpus}`);
    const rows = readJsonl(a.corpus).filter((r) => r.ok).map((r) => r.row);
    o.corpusIndex = buildCorpusIndex(rows);
  }

  const emit = (r) => {
    assertContributionSum(r);
    process.stdout.write((a.bools.has('--pretty') ? pretty(r) : JSON.stringify(r)) + '\n');
  };

  // ---- batch ------------------------------------------------------------
  if (a.jsonl !== undefined) {
    if (!existsSync(a.jsonl)) fail(2, `file not found: ${a.jsonl}`);
    const parsed = readJsonl(a.jsonl);
    let bad = 0;
    for (const p of parsed) {
      if (!p.ok) {
        bad++;
        process.stdout.write(JSON.stringify({ id: null, error: `malformed JSON on line ${p.lineNo}: ${p.error}` }) + '\n');
        continue;
      }
      if (p.row.text !== undefined && p.row.text !== null && typeof p.row.text !== 'string') {
        bad++;
        process.stdout.write(JSON.stringify({ id: p.row.id ?? null, error: 'row.text must be a string' }) + '\n');
        continue;
      }
      try {
        const r = coreDetect(p.row.text ?? '', {
          // R51(b): rows may name the author as `sender` or `student`; `sender` wins.
          ...o, id: p.row.id, sender: authorOf(p.row),
          lang: p.row.lang ?? o.lang, shape: p.row.context ?? o.shape,
          // R45: a row may carry the SAME author's priors, or a pre-built profile.
          history: p.row.history ?? o.history,
          historyProfile: p.row.historyProfile ?? o.historyProfile,
        });
        assertContributionSum(r);
        process.stdout.write(JSON.stringify(r) + '\n');
      } catch (e) {
        bad++;
        process.stdout.write(JSON.stringify({ id: p.row.id ?? null, error: String(e.message) }) + '\n');
      }
    }
    if (bad) process.stderr.write(`llm-detect: ${bad} input line(s) produced an error line\n`);
    process.exit(0);
  }

  // ---- aggregate --------------------------------------------------------
  if (a.aggregate !== undefined) {
    if (!existsSync(a.aggregate)) fail(2, `file not found: ${a.aggregate}`);
    const parsed = readJsonl(a.aggregate);
    const bySender = new Map();
    let bad = 0;
    for (const p of parsed) {
      if (!p.ok) { bad++; continue; }
      const s = authorOf(p.row) ?? '(unknown)';
      if (!bySender.has(s)) bySender.set(s, []);
      bySender.get(s).push(p.row);
    }
    for (const sender of [...bySender.keys()].sort()) {
      const r = coreAggregate(bySender.get(sender), { ...o, sender });
      if (r.score !== null && r.scoring) assertContributionSum(r);
      process.stdout.write((a.bools.has('--pretty') ? pretty(r) : JSON.stringify(r)) + '\n');
    }
    if (bad) process.stderr.write(`llm-detect: ${bad} malformed input line(s) skipped\n`);
    process.exit(0);
  }

  // ---- single document --------------------------------------------------
  let text;
  if (a.file !== undefined) {
    if (!existsSync(a.file)) fail(2, `file not found: ${a.file}`);
    try { text = readText(a.file); } catch (e) { fail(2, e.message); }
  } else if (a.text !== undefined) {
    text = a.text;
  } else {
    text = readStdinSync();
  }
  if (text === undefined || text.length === 0) fail(2, 'empty input');

  emit(coreDetect(text, o));
  process.exit(0);
}

if (isMain(import.meta.url)) main();
