#!/usr/bin/env node
/**
 * fetch-public-datasets.mjs — SPEC §F.1, HEAD-RULINGS R9 and R22.
 *
 * THE ONLY FILE IN THIS PROJECT THAT TOUCHES THE NETWORK. It talks to exactly one host,
 * https://datasets-server.huggingface.co, unauthenticated, and (only behind --include-arabic)
 * makes a single documented HEAD attempt at one Zenodo record. No paid API, ever.
 *
 * R9 caps: at most 1500 rows PER LABEL PER DATASET. Pages /rows with length=100. Records the
 * cap and the ACTUAL count in manifest.json, and prints "capped at N of M" to stderr.
 *
 * R22 (Arabic out of scope): the two KFUPM Arabic datasets and ALHD stay in the registry —
 * so that a later re-scope is a one-line change — but are DISABLED and are never fetched.
 * They appear in the manifest as skipped, with the reason. Nothing Arabic is downloaded.
 *
 * Output: <out>/<name>.jsonl, one row per line:
 *   { id, dataset, text, label: "human"|"llm", lang, genre, generator }
 * plus <out>/manifest.json with per-file sha256, licence, cap, actual counts and the
 * sampling strategy. <out> must be gitignored.
 *
 * Exit codes: 0 ok · 1 usage · 2 precondition (out dir not ignored) · 5 every source failed.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const HOST = 'https://datasets-server.huggingface.co';
const CAP_PER_LABEL = 1500;        // R9
const PAGE = 100;                  // R9
const MAX_PAGES_PER_SOURCE = 400;  // hard stop: 400 * 100 = 40k rows examined, ~ tens of MB
const MAX_BYTES_TOTAL = 60 * 1024 * 1024; // R9: stay under ~60 MB

const USAGE = `usage: node eval/fetch-public-datasets.mjs [options]
  --out <dir>          output directory, must be gitignored (default eval/data/public)
  --only <name,...>    fetch only these registry names
  --cap <n>            rows per label per dataset (default ${CAP_PER_LABEL}; R9 says do not raise it silently)
  --include-arabic     re-enable the Arabic sources and the one ALHD attempt (OFF: Arabic is out per R22)
  --list               print the registry and exit
  --dry-run            resolve configs/splits and row counts, fetch no rows
  --probe <dataset>    HEAD-RULINGS R42(e): ask datasets-server what a candidate dataset IS —
                       configs, splits, field names and types, row counts, declared licence, and
                       the field-value LENGTHS of two sample rows. Never prints a text value and
                       never downloads a row set. Repeatable; results are recorded in the manifest
                       under "probes". Combine with --probe-out <dir> to keep them out of the
                       release manifest.
  --probe-where <expr> applies to the --probe it follows: count and sample that SLICE through
                       /filter (e.g. --probe-where "\"sub_source\"='outfox' AND \"label\"=0"),
                       which is how a labelled slice of a large corpus is counted without paging it
  --probe-out <dir>    where a --probe run records its manifest (default: --out)
  --import-probes <f>  merge the "probes" array of another manifest (e.g. a scratch one) into the
                       manifest in --out. Probing is read-only and its result is a note, so a probe
                       run may be done in a scratch directory and imported rather than re-run.
  --probe-timeout <s>  per-request abort for a probe (default 30). datasets-server builds a
                       DuckDB index the first time a large dataset is filtered, and that first
                       /filter can outlast the default abort.`;

// ---------------------------------------------------------------- registry (SPEC §F.1)

const REGISTRY = [
  {
    name: 'maide-up-tr', dataset: 'MichiganNLP/MAiDE-up', licence: 'MIT',
    role: 'The Turkish anchor: hotel reviews, the exact genre. source 0 = real human, 1 = GPT-4.',
    lang: 'tr', genre: 'hotel_review', enabled: true, needsFullScan: true, pairs: true,   // R49: pair key recovered and verified
    // Turkish only. Both labels come from the same file, so one pass fills both.
    // The languages sit in contiguous blocks, so this source is scanned in full rather
    // than sampled: 19,985 rows at 100 per page. That is also how F.4's demand to VERIFY
    // the Turkish source=0 count at pull time, rather than assume it, is satisfied.
    keep: (r) => String(r.Review_Language || '').toLowerCase() === 'turkish',
    label: (r) => (Number(r.source) === 1 ? 'llm' : (Number(r.source) === 0 ? 'human' : null)),
    text: (r) => [r.Upside_Review, r.Downside_Review].filter((s) => s && String(s).trim()).join('\n\n'),
    generator: (r) => (Number(r.source) === 1 ? 'gpt-4' : null),
    // HEAD-RULINGS R36(e) follow-up (R49): the matched-pair key, recovered from the schema rather
    // than invented. `Unnamed: 0` is the within-language row index (0-999) and each language block
    // holds 1,000 real reviews and 1,000 GPT-4 ones, so (Review_Language, Unnamed: 0) names a real
    // review and the generated review written FOR it. That is a claim about the data, so the pull
    // checks it against the data: both rows of a pair must name the same hotel, and if they do not
    // the key is dropped rather than trusted (`pairAudit` in pullSource).
    pairFromRow: (r) => (r['Unnamed: 0'] === undefined || r['Unnamed: 0'] === null
      ? null
      : `maide-${String(r.Review_Language || 'xx').toLowerCase()}#${r['Unnamed: 0']}`),
    pairAudit: (r) => ({ key: String(r['Hotel Name'] || '').trim().toLowerCase(), side: Number(r.source) }),
    note: 'F.4: the source=0 counterpart returned HTTP 500 on the design-round re-check. The count is verified at pull time and recorded below, not assumed. R49: the pair key is (Review_Language, `Unnamed: 0`), verified at pull time by hotel name.',
  },
  {
    name: 'kfupm-ar-posts', dataset: 'KFUPM-JRCAI/arabic-generated-social-media-posts', licence: 'none declared',
    role: 'Arabic short-form human vs LLM, five parallel columns.', lang: 'ar', genre: 'social_post',
    enabled: false, disabledReason: 'Arabic is out of scope (HEAD-RULINGS R22). Kept in the registry so a re-scope is a one-line change.',
  },
  {
    name: 'kfupm-ar-abstracts', dataset: 'KFUPM-JRCAI/arabic-generated-abstracts', licence: 'none declared',
    role: 'Arabic long prose, four generators, including the by_polishing light-polish threat model.', lang: 'ar', genre: 'abstract',
    enabled: false, disabledReason: 'Arabic is out of scope (HEAD-RULINGS R22). Kept in the registry so a re-scope is a one-line change.',
  },
  {
    name: 'modern-fake-reviews', dataset: 'Flowerly/modern-fake-reviews', licence: 'cc-by-4.0',
    role: 'EN reviews vs a MODERN generator. Both halves ASCII-normalized, which is itself the proof that smart quotes and em dashes evaporate for free.',
    lang: 'en', genre: 'product_review', enabled: true,
    keep: () => true,
    label: (r) => (r.label === 'CG' ? 'llm' : (r.label === 'OR' ? 'human' : null)),
    text: (r) => r.text_,           // trailing underscore, verified
    generator: (r) => (r.label === 'CG' ? 'modern-unspecified' : null),
    // R49: NO PAIR KEY EXISTS. The card says each fake is grounded on a paired real review, but the
    // released columns are `category`, `rating`, `label`, `text_` — nothing links the two rows
    // (verified by --probe /statistics, recorded in the manifest). Handing every row a synthetic
    // per-row key would be worse than nothing: shardOf() would stop falling back to normKey(text)
    // and near-duplicates would become free to straddle the split. So this source declares no key
    // and is sharded by its text, which is the protection it can actually have.
    noPairKey: true,
    note: 'field is `text_` with a trailing underscore; label OR = human, CG = machine. R49: no pair key exists in the released schema; sharded by normalised text.',
  },
  {
    name: 'fake-reviews-gpt2era', dataset: 'theArijitDas/Fake-Reviews-Dataset', licence: 'apache-2.0',
    role: 'EN reviews, GPT-2-era machine half: natively short text, so the honest place to measure the short-text ceiling, and a control for generation drift.',
    lang: 'en', genre: 'product_review', enabled: true,
    keep: () => true,
    label: (r) => (Number(r.label) === 1 ? 'llm' : (Number(r.label) === 0 ? 'human' : null)),
    text: (r) => r.text,
    generator: (r) => (Number(r.label) === 1 ? 'gpt-2-era' : null),
    // R49: NO PAIR KEY EXISTS — released columns are `category`, `rating`, `text`, `label`, one
    // document per row and nothing linking two of them. Same reasoning as modern-fake-reviews:
    // declaring no key keeps the normKey(text) shard, which is a real protection; a per-row key
    // would silently remove it.
    noPairKey: true,
    note: '0 = human, 1 = machine. The human half also serves as negative control (a): it predates 2022. R49: no pair key exists in the released schema; sharded by normalised text.',
  },
  {
    name: 'hc3-en', dataset: 'Hello-SimpleAI/HC3', licence: 'cc-by-sa-4.0', config: 'all',
    role: 'EN matched-pair QA prose. One row yields both a human answer and a ChatGPT answer.',
    lang: 'en', genre: 'qa_prose', enabled: true, pairs: true,
    keep: () => true,
    expand: (r) => {
      const out = [];
      for (const t of (r.human_answers || [])) out.push({ text: t, label: 'human', generator: null });
      for (const t of (r.chatgpt_answers || [])) out.push({ text: t, label: 'llm', generator: 'chatgpt' });
      return out;
    },
    note: 'matched pairs: the same question answered by a human and by ChatGPT.',
  },
  {
    name: 'mage-en', dataset: 'yaful/MAGE', licence: 'apache-2.0',
    role: 'EN at scale, many generators.',
    lang: 'en', genre: 'mixed', enabled: true, stride: true,
    keep: () => true,
    // *** 0 = machine, 1 = human. INVERTED relative to every other dataset here. ***
    label: (r) => (Number(r.label) === 0 ? 'llm' : (Number(r.label) === 1 ? 'human' : null)),
    text: (r) => r.text,
    generator: (r) => (Number(r.label) === 0 ? String(r.src || 'unknown') : null),
    note: 'LABEL IS INVERTED: 0 = machine, 1 = human. assertMageMapping() below is the unit test SPEC §F.1 demands; getting it backwards is the likeliest silent bug in the eval.',
  },
  {
    // ---- HEAD-RULINGS R42(e): THE ESSAY SOURCE. -------------------------------------------
    // The school platform's genre is student essays; every English number this project had
    // before this round was measured on product reviews and QA answers. Twenty-one candidates were
    // probed (`--probe`, all recorded in the manifest under `probes`); this is the one that is
    // fetchable unauthenticated, carries BOTH labels in ONE dataset, is school-essay genre, keeps
    // its original capitalisation and punctuation, and ships a shared PROMPT for the two halves.
    //
    // Row shape: `human_text` and `ai_text` are parallel columns on one row, both answering the
    // `instructions` on that row — so one source row yields a matched pair, and `instructions`
    // is the essay prompt the R42(e) split holds out.
    //
    // WHAT WAS VERIFIED, AND HOW (nothing here is assumed):
    //   · fetchable, 1,000,000 rows, fields id/human_text/ai_text/instructions — probe, in the manifest;
    //   · genre and orthography — a 150-pair pull inspected locally before this entry was enabled:
    //     school-assignment prompts ("write a persuasive essay on…", "advantages of a four-day
    //     school week"), 150/150 human rows carrying capitals and 149/150 terminal punctuation,
    //     student misspellings intact. Two rival candidates failed exactly this check and stay
    //     below, disabled, so the check is not repeated by the next lane.
    //   · length: human median ~424 words, machine median ~197. THE TWO HALVES ARE NOT THE SAME
    //     LENGTH, which is why every essay number is reported per length bucket and never pooled.
    // WHAT IS NOT VERIFIED: who wrote the human half, when, or by what selection; the licence
    // (datasets-server declares none for it).
    name: 'essays-en-pairs', dataset: 'dmitva/human_ai_generated_text',
    licence: 'NOT DECLARED through datasets-server /info, and this project does not fetch huggingface.co to read a card. Treat as undeclared: usable for a local measurement, NOT cleared for redistribution, and no row of it is committed.',
    role: 'EN school essays, human vs LLM, matched on the assignment prompt — the school-platform genre (HEAD-RULINGS R42(e)).',
    lang: 'en', genre: 'essay', enabled: true, stride: true, pairs: true,
    keep: () => true,
    // No numeric label column at all: the label is the FIELD NAME, exactly as in hc3-en. A renamed
    // column would therefore yield rows of one class labelled as the other, which is what the
    // expand() assertion in assertMageMapping() exists to catch.
    expand: (r) => {
      const out = [];
      if (r.human_text && String(r.human_text).trim()) out.push({ text: r.human_text, label: 'human', generator: null });
      if (r.ai_text && String(r.ai_text).trim()) out.push({ text: r.ai_text, label: 'llm', generator: 'unspecified-essay-generator' });
      return out;
    },
    // The holdout unit R42(e) asks for: every essay answering one prompt lands on one side.
    // Hashed, because the raw instruction is a long string that would be repeated on every row.
    promptKey: (r) => (r.instructions && String(r.instructions).trim()
      ? 'prompt:' + createHash('sha256').update(String(r.instructions).replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex').slice(0, 16)
      : null),
    note: 'parallel columns human_text / ai_text on one row, both answering `instructions`. The machine half records one unspecified generator family — the dataset names no model, and inventing one would be a fiction in modelFamiliesCovered.',
  },
  {
    // Probed, pulled small, INSPECTED, and rejected — recorded so the next lane does not spend the
    // attempt again. 462,873 EN rows, `generated` 0/1, both labels in one dataset, and the genre is
    // right (school essays). But BOTH HALVES ARE LOWER-CASED AND STRIPPED OF PUNCTUATION: a
    // 150-row inspection found 0 capitals and no terminal punctuation on either side. Every
    // orthography feature this detector has is destroyed identically on both halves, the sentence
    // segmenter sees one unbounded sentence, and the rhythm features that follow from it are
    // computed over a segmentation the source text does not have. A number measured there would be
    // measured on a corpus no school platform will ever receive.
    name: 'ai-human-essays-en-normalized', dataset: 'andythetechnerd03/AI-human-text',
    licence: 'apache-2.0 per the dataset card as recorded in docs/design/R1-research.md §6.1(8)',
    role: 'EN essays, human vs LLM — REJECTED: text is case- and punctuation-normalised.',
    lang: 'en', genre: 'essay', enabled: false,
    disabledReason: 'Both halves are lower-cased with punctuation stripped (verified on a 150-row pull: 0 of 150 human rows carry a capital or a terminal stop). The detector\'s orthography and rhythm features would be measuring the corpus builder\'s normaliser, not the writer.',
  },
  {
    // Probed, pulled, cross-checked and rejected for BALANCE, not for quality — recorded so the
    // next lane does not spend the attempt again. `sub_source = 'outfox'` inside a 610,767-row
    // multi-source English corpus is a genuine school-essay slice with correct orthography and
    // eleven named modern generators (gpt4o, llama3-70b, mixtral-8x7b, gemma, cohere, …), and the
    // pull's model-vs-label cross-check passed on all 424 rows it reached.
    // What killed it: /filter answers 502/503/timeout for this dataset, the slice is UNIFORMLY
    // INTERLEAVED through the corpus (5 of 81 evenly spaced probes hit it; 424 of 6,000 rows
    // examined = 7.07%, the slice's own share of the corpus), and only 5.4% of the slice is human
    // (23 of 424). Reaching 500 human essays would mean paging ~130,000 rows ≈ 220 MB, over R9's
    // 60 MB budget by a factor of four, for one of the two halves.
    name: 'coling-mgt-essays-en', dataset: 'Jinyan1/COLING_2025_MGT_en',
    licence: 'not declared through datasets-server /info',
    role: 'EN school essays, human vs 11 generators — REJECTED: the human half is 5% of the slice and unreachable under the R9 byte budget.',
    lang: 'en', genre: 'essay', enabled: false,
    disabledReason: 'The human half is ~5% of the outfox slice and the slice is uniformly interleaved through a 610k-row corpus whose /filter endpoint is unavailable (502/503/timeout). A balanced pull would need ~220 MB of paging, against R9\'s 60 MB budget. The 424 rows one pass reached (23 human / 401 machine) are not a measurable cell and are not kept.',
    locate: { field: 'sub_source', value: 'outfox', probes: 80, maxPages: 60 },
    keep: (r) => String(r.sub_source) === 'outfox' && String(r.lang || 'en') === 'en',
    // 0 = human, 1 = machine — the ordinary direction, NOT MAGE's. Kept and asserted even though
    // the source is disabled: a re-enable must not have to re-derive it.
    label: (r) => (Number(r.label) === 1 ? 'llm' : (Number(r.label) === 0 ? 'human' : null)),
    text: (r) => r.text,
    generator: (r) => (Number(r.label) === 1 ? String(r.model || 'unknown') : null),
    crossCheck: (r) => {
      const isHumanModel = String(r.model || '').toLowerCase() === 'human';
      const isHumanLabel = Number(r.label) === 0;
      return isHumanModel === isHumanLabel
        ? null
        : `row with model="${r.model}" carries label=${r.label}: the model column and the label column disagree about who wrote it`;
    },
    note: 'PASSED its model-vs-label cross-check on 424 rows before being rejected for balance. If a future round gets /filter working for this dataset, this entry pulls a genuinely multi-generator essay set.',
  },
];

const ALHD = {
  name: 'alhd', source: 'Zenodo record 17249602', lang: 'ar',
  note: 'R9 permits exactly one attempt: HEAD the file list first, skip if any file exceeds 50 MB or the record is not directly downloadable.',
};

// ---------------------------------------------------------------- http with backoff

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bytesDownloaded = 0;
let lastRequestAt = 0;
// The unauthenticated datasets-server rate-limits hard. Paced requests plus a long,
// Retry-After-aware backoff on 429 is the difference between "dataset gone" and "wait".
let PACE_MS = 500;
let REQUEST_TIMEOUT_MS = 30000;   // CAL: no request may hang the run forever (--probe-timeout raises it)

async function getJson(url, { attempts = 7, label = '' } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    if (i) {
      const wait = lastErr && lastErr.retryAfterMs
        ? lastErr.retryAfterMs
        : (lastErr && lastErr.rateLimited ? Math.min(120000, 5000 * 2 ** (i - 1)) : Math.min(30000, 800 * 2 ** (i - 1)));
      process.stderr.write(`  retry ${i}/${attempts - 1} in ${Math.round(wait / 100) / 10}s ${label}${lastErr && lastErr.rateLimited ? ' (rate limited)' : ''}\n`);
      await sleep(wait);
    }
    const gap = Date.now() - lastRequestAt;
    if (gap < PACE_MS) await sleep(PACE_MS - gap);
    lastRequestAt = Date.now();
    // CAL fix: fetch() has no default timeout. A connection that opens and then stalls hangs the
    // ONLY network step in this project forever, with no output and no retry — observed live:
    // the process sat 8 minutes past its last log line while a curl to the same endpoint answered
    // in 0.49s. The abort makes a stall look like what it is, a retryable network error.
    const ac = new AbortController();
    const killer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'llm-detect-eval/1.0' },
        signal: ac.signal,
      });
      const body = await res.text();
      bytesDownloaded += Buffer.byteLength(body);
      if (res.ok) return JSON.parse(body);
      // A 500 from this API usually means "the dataset index is loading", NOT "dataset gone".
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`);
        lastErr.rateLimited = res.status === 429;
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) lastErr.retryAfterMs = Math.min(180000, ra * 1000 + 500);
        if (lastErr.rateLimited) PACE_MS = Math.min(4000, PACE_MS * 2); // slow down for the rest of the run
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
    } catch (e) {
      lastErr = (e && e.name === 'AbortError')
        ? new Error(`request timeout after ${REQUEST_TIMEOUT_MS / 1000}s (no response) ${label}`)
        : e;
      if (!/HTTP 5|HTTP 429|fetch failed|ETIMEDOUT|ECONNRESET|terminated|request timeout/.test(String(lastErr.message))) throw lastErr;
    } finally {
      clearTimeout(killer);
    }
  }
  throw lastErr || new Error('unreachable');
}

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function resolveSplit(dataset, preferConfig) {
  const j = await getJson(`${HOST}/splits?${q({ dataset })}`, { label: dataset });
  const all = j.splits || [];
  if (!all.length) throw new Error('no splits reported');
  const pool = preferConfig ? all.filter((s) => s.config === preferConfig) : all;
  const list = pool.length ? pool : all;
  // prefer a split literally named "test", else the first one; SPEC's own group-aware
  // re-split happens later in make-splits.mjs, so which one we pull from matters little.
  const pick = list.find((s) => s.split === 'test') || list[0];
  return { config: pick.config, split: pick.split, available: all.map((s) => `${s.config}/${s.split}`) };
}

async function fetchRows(dataset, config, split, offset, length) {
  const j = await getJson(`${HOST}/rows?${q({ dataset, config, split, offset, length })}`, { label: `${dataset} @${offset}` });
  return { rows: (j.rows || []).map((r) => r.row), total: j.num_rows_total ?? null };
}

// ---------------------------------------------------------------- --probe (HEAD-RULINGS R42(e))

/**
 * Describe a candidate dataset without downloading it and WITHOUT PRINTING ANY TEXT.
 *
 * The essay round needs to know, for a dozen candidates, whether a dataset is fetchable at all,
 * what its label column is called, whether it carries an essay PROMPT id (the holdout unit the
 * split needs) and roughly how long its texts are. Every one of those questions is answerable
 * from /splits, /info and two rows — and the answer to the last one is a NUMBER, not a sample.
 * So this prints field names, types and value LENGTHS, never a value. Nothing here writes a
 * corpus file; a probe is a note in the manifest.
 */
function describeValue(v) {
  if (v === null || v === undefined) return { type: v === null ? 'null' : 'undefined', length: null };
  if (typeof v === 'string') return { type: 'string', length: v.length, words: (v.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) || []).length };
  if (Array.isArray(v)) {
    const inner = v.length ? describeValue(v[0]) : null;
    return { type: `array[${v.length}]`, length: v.length, first_item: inner };
  }
  if (typeof v === 'object') return { type: 'object', length: Object.keys(v).length, keys: Object.keys(v).slice(0, 12) };
  if (typeof v === 'number') return { type: 'number', length: null, value_is_small_int: Number.isInteger(v) && Math.abs(v) < 1000 ? v : null };
  return { type: typeof v, length: null };
}

async function probeDataset(dataset, where = null) {
  const rec = { dataset, where: where || null, probedAt: new Date().toISOString(), status: 'unknown' };
  process.stderr.write(`- probe ${dataset}${where ? ` WHERE ${where}` : ''}\n`);

  // 1. /splits — the cheapest liveness check, and the one that reports auth walls.
  try {
    const j = await getJson(`${HOST}/splits?${q({ dataset })}`, { attempts: 3, label: `${dataset} /splits` });
    rec.splits = (j.splits || []).map((s) => ({ config: s.config, split: s.split }));
  } catch (e) {
    rec.status = 'unavailable';
    rec.reason = `/splits failed: ${String(e.message).slice(0, 200)}`;
    process.stderr.write(`  UNAVAILABLE: ${rec.reason}\n`);
    return rec;
  }
  if (!rec.splits.length) {
    rec.status = 'unavailable';
    rec.reason = '/splits returned no splits';
    process.stderr.write(`  UNAVAILABLE: ${rec.reason}\n`);
    return rec;
  }
  rec.configs = [...new Set(rec.splits.map((s) => s.config))];

  // 2. /info — declared licence, per-split row counts, download size, field schema.
  try {
    const j = await getJson(`${HOST}/info?${q({ dataset })}`, { attempts: 3, label: `${dataset} /info` });
    const infos = j.dataset_info || {};
    rec.info = {};
    for (const [cfg, di] of Object.entries(infos)) {
      rec.info[cfg] = {
        licence: di.license || null,
        features: Object.keys(di.features || {}),
        feature_types: Object.fromEntries(Object.entries(di.features || {}).map(([k, v]) => [k, v && (v.dtype || v._type || (Array.isArray(v) ? 'sequence' : typeof v))])),
        splits: Object.fromEntries(Object.entries(di.splits || {}).map(([s, v]) => [s, v.num_examples ?? null])),
        download_size_bytes: di.download_size ?? null,
        dataset_size_bytes: di.dataset_size ?? null,
      };
    }
    const lic = Object.values(rec.info).map((i) => i.licence).find(Boolean);
    rec.licence = lic || 'not declared in /info — read the dataset card before redistributing';
  } catch (e) {
    rec.info_error = `/info failed: ${String(e.message).slice(0, 200)}`;
    rec.licence = 'unknown (/info failed)';
  }

  // 3. two rows, described by LENGTH. Prefer a train-ish split of the first config.
  const pickCfg = rec.configs[0];
  const inCfg = rec.splits.filter((s) => s.config === pickCfg);
  const pickSplit = (inCfg.find((s) => s.split === 'train') || inCfg[0]).split;
  rec.sampled = { config: pickCfg, split: pickSplit };
  try {
    // With --probe-where the slice is counted through /filter, which reports num_rows_total for
    // the FILTERED set — that is how "how many essay rows does this 610k-row corpus actually hold,
    // per label" is answered without paging 6,000 times.
    const url = where
      ? `${HOST}/filter?${q({ dataset, config: pickCfg, split: pickSplit, where, offset: 0, length: 2 })}`
      : `${HOST}/rows?${q({ dataset, config: pickCfg, split: pickSplit, offset: 0, length: 2 })}`;
    const j = await getJson(url, { attempts: 3, label: `${dataset} ${where ? '/filter' : '/rows'}` });
    const rowsR = (j.rows || []).map((r) => r.row);
    rec.rows_total = j.num_rows_total ?? null;
    rec.fields = rowsR.length ? Object.keys(rowsR[0]) : [];
    rec.sample_field_shapes = rowsR.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, describeValue(v)])));
    rec.status = 'fetchable';
  } catch (e) {
    rec.status = 'rows_unavailable';
    rec.reason = `/rows failed: ${String(e.message).slice(0, 200)}`;
    process.stderr.write(`  ROWS UNAVAILABLE: ${rec.reason}\n`);
    return rec;
  }

  // 4. /statistics — the column summary. For a LOW-CARDINALITY column datasets-server returns the
  // value frequencies (`string_label` / `class_label`), which is how a probe answers "does this
  // corpus have an essay domain, and what is its label column called" without reading a document.
  // For a free-text column it returns a LENGTH histogram and never the values, which is exactly
  // the contract this probe wants: categories yes, prose no.
  try {
    if (where) throw new Error('/statistics does not accept a filter; skipped for a --probe-where probe');
    const j = await getJson(`${HOST}/statistics?${q({ dataset, config: pickCfg, split: pickSplit })}`,
      { attempts: 2, label: `${dataset} /statistics` });
    rec.column_stats = {};
    for (const c of (j.statistics || [])) {
      const s = c.column_statistics || {};
      if (c.column_type === 'string_label' || c.column_type === 'class_label' || c.column_type === 'bool') {
        rec.column_stats[c.column_name] = { type: c.column_type, n_unique: s.n_unique ?? null, frequencies: s.frequencies || null };
      } else if (c.column_type === 'string_text') {
        rec.column_stats[c.column_name] = { type: 'string_text (character counts, no values)', min: s.min, max: s.max, mean: s.mean, median: s.median };
      } else {
        rec.column_stats[c.column_name] = { type: c.column_type, min: s.min ?? null, max: s.max ?? null, n_unique: s.n_unique ?? null };
      }
    }
    for (const [k, v] of Object.entries(rec.column_stats)) {
      if (v.frequencies) process.stderr.write(`  stats ${k}: ${v.n_unique} distinct — ${Object.entries(v.frequencies).slice(0, 24).map(([kk, n]) => `${kk}=${n}`).join(' ')}\n`);
      else process.stderr.write(`  stats ${k}: ${v.type}${v.min === undefined || v.min === null ? '' : ` min=${v.min} median=${v.median ?? '—'} max=${v.max}`}\n`);
    }
  } catch (e) {
    rec.statistics_error = `/statistics failed: ${String(e.message).slice(0, 160)}`;
    process.stderr.write(`  /statistics unavailable: ${rec.statistics_error}\n`);
  }

  // 5. the two questions this round actually asks of a candidate.
  const f = rec.fields.map((x) => x.toLowerCase());
  const has = (re) => rec.fields.filter((x) => re.test(x.toLowerCase()));
  rec.looks_like = {
    label_like_fields: has(/^(label|generated|is_ai|ai|human|class|target|source|src|model|generator)$/),
    text_like_fields: has(/(text|essay|answer|content|body|abstract|response|completion|document)/),
    prompt_key_fields: has(/(prompt|topic|question|task|assignment|title|instruction|essay_?id|source_?text)/),
    lang_fields: has(/(lang|language)/),
    l1_or_native_fields: has(/(l1|native|nationality|country|proficiency|esl|efl)/),
  };
  rec.usable_note = null;
  process.stderr.write(`  ${rec.status}: ${rec.configs.length} config(s), ${rec.rows_total} rows in ${pickCfg}/${pickSplit}, `
    + `fields ${rec.fields.join(',')}\n`);
  process.stderr.write(`  licence: ${rec.licence}\n`);
  if (rec.looks_like.prompt_key_fields.length) process.stderr.write(`  prompt-key candidates: ${rec.looks_like.prompt_key_fields.join(',')}\n`);
  for (const [i, shapes] of rec.sample_field_shapes.entries()) {
    process.stderr.write(`  row ${i} value lengths: ${Object.entries(shapes).map(([k, d]) => `${k}=${d.type}${d.length === null ? '' : `/${d.length}`}`).join(' ')}\n`);
  }
  return rec;
}

// ---------------------------------------------------------------- the MAGE unit test

function assertMageMapping() {
  const src = REGISTRY.find((s) => s.name === 'mage-en');
  const machine = src.label({ label: 0 });
  const human = src.label({ label: 1 });
  if (machine !== 'llm' || human !== 'human') {
    throw new Error(`MAGE label mapping is wrong: 0 -> ${machine}, 1 -> ${human}. It must be 0 -> llm, 1 -> human.`);
  }
  // and the OTHER datasets must NOT be inverted
  const fr = REGISTRY.find((s) => s.name === 'fake-reviews-gpt2era');
  if (fr.label({ label: 0 }) !== 'human' || fr.label({ label: 1 }) !== 'llm') {
    throw new Error('Fake-Reviews-Dataset label mapping is wrong: it is 0 = human, 1 = machine.');
  }
  const mf = REGISTRY.find((s) => s.name === 'modern-fake-reviews');
  if (mf.label({ label: 'OR' }) !== 'human' || mf.label({ label: 'CG' }) !== 'llm') {
    throw new Error('modern-fake-reviews label mapping is wrong: OR = human, CG = machine.');
  }
  // HEAD-RULINGS R36(h): the two sources that were NOT asserted. maide-up-tr's `source` column is
  // the label and it is the only Turkish resource in the project, so an inversion there inverts
  // every Turkish number in the report with nothing to catch it. hc3-en carries no label column at
  // all — expand() reads the label off the FIELD NAME, so a renamed field silently yields rows of
  // one class labelled as the other.
  const mu = REGISTRY.find((s) => s.name === 'maide-up-tr');
  if (mu.label({ source: 0 }) !== 'human' || mu.label({ source: 1 }) !== 'llm') {
    throw new Error('maide-up-tr label mapping is wrong: source 0 = human (real review), 1 = llm (GPT-4).');
  }
  if (mu.label({ source: 2 }) !== null) {
    throw new Error('maide-up-tr label mapping is wrong: an unrecognised `source` value must map to null, not to a class.');
  }
  const hc3 = REGISTRY.find((s) => s.name === 'hc3-en');
  const expanded = hc3.expand({ human_answers: ['H1', 'H2'], chatgpt_answers: ['C1'] });
  const hOut = expanded.filter((x) => x.label === 'human').map((x) => x.text).sort();
  const lOut = expanded.filter((x) => x.label === 'llm').map((x) => x.text).sort();
  if (expanded.length !== 3 || hOut.join(',') !== 'H1,H2' || lOut.join(',') !== 'C1') {
    throw new Error('hc3-en expand() is wrong: human_answers must yield label "human" and chatgpt_answers label "llm". '
      + `Got ${JSON.stringify(expanded)}.`);
  }
  if (expanded.some((x) => x.label === 'llm' && x.generator !== 'chatgpt')) {
    throw new Error('hc3-en expand() is wrong: the machine half must record generator "chatgpt".');
  }
  if (hc3.expand({}).length !== 0) {
    throw new Error('hc3-en expand() is wrong: a row with neither answer field must yield no rows, not a throw and not a mislabelled one.');
  }
  // HEAD-RULINGS R42(e): the essay source. Like hc3-en it has NO label column — the label is the
  // field name — so a renamed column yields rows of one class wearing the other's label with
  // nothing else to catch it. Its prompt key is the split's holdout unit, so it is asserted too:
  // two rows carrying the same instruction must produce the same key, and a row without an
  // instruction must produce null rather than a key every prompt-less row would share.
  const es = REGISTRY.find((s) => s.name === 'essays-en-pairs');
  const esOut = es.expand({ human_text: 'H', ai_text: 'A', instructions: 'Task: write an essay' });
  if (esOut.length !== 2
    || esOut.filter((x) => x.label === 'human').map((x) => x.text).join() !== 'H'
    || esOut.filter((x) => x.label === 'llm').map((x) => x.text).join() !== 'A') {
    throw new Error(`essays-en-pairs expand() is wrong: human_text must yield label "human" and ai_text label "llm". Got ${JSON.stringify(esOut)}.`);
  }
  if (es.expand({}).length !== 0 || es.expand({ human_text: '   ' }).length !== 0) {
    throw new Error('essays-en-pairs expand() is wrong: a row with no usable text must yield no rows, not a blank one.');
  }
  if (esOut.some((x) => x.label === 'human' && x.generator !== null)) {
    throw new Error('essays-en-pairs expand() is wrong: the human half must record no generator.');
  }
  const k1 = es.promptKey({ instructions: 'Task:  Write an essay\n on school ' });
  const k2 = es.promptKey({ instructions: 'task: write an essay on school' });
  if (!k1 || k1 !== k2) {
    throw new Error('essays-en-pairs promptKey() is wrong: two rows carrying the same instruction, differing only in case and whitespace, must share a prompt key — that key is the holdout unit for the essay split.');
  }
  if (es.promptKey({}) !== null || es.promptKey({ instructions: '   ' }) !== null) {
    throw new Error('essays-en-pairs promptKey() is wrong: a row with no instruction must yield null, not a key that every prompt-less row would share (which would put them all on one side).');
  }
  // The two rejected essay candidates keep their mappings asserted so that re-enabling either one
  // is a one-line change and not a re-derivation.
  const cm = REGISTRY.find((s) => s.name === 'coling-mgt-essays-en');
  if (cm.label({ label: 0 }) !== 'human' || cm.label({ label: 1 }) !== 'llm' || cm.label({ label: 7 }) !== null) {
    throw new Error('coling-mgt-essays-en label mapping is wrong: 0 = human, 1 = machine — the OPPOSITE of MAGE, which lives in this same file.');
  }
  if (cm.crossCheck({ model: 'human', label: 0 }) !== null || cm.crossCheck({ model: 'gpt-35', label: 1 }) !== null
    || !cm.crossCheck({ model: 'human', label: 1 }) || !cm.crossCheck({ model: 'gpt-35', label: 0 })) {
    throw new Error('coling-mgt-essays-en crossCheck is wrong: it must pass an agreeing row and report a row whose model column and label column disagree.');
  }
  if (cm.keep({ sub_source: 'reddit', lang: 'en' }) || !cm.keep({ sub_source: 'outfox', lang: 'en' })) {
    throw new Error('coling-mgt-essays-en keep() is wrong: it must accept ONLY the essay slice (sub_source = outfox).');
  }
  const disabledEssay = REGISTRY.filter((s) => s.genre === 'essay' && !s.enabled).map((s) => s.name);
  if (!disabledEssay.includes('ai-human-essays-en-normalized') || !disabledEssay.includes('coling-mgt-essays-en')) {
    throw new Error('the two rejected essay candidates must stay in the registry, disabled, with their reason — that record is what stops the next lane spending the attempt again.');
  }
  return 'MAGE 0=machine/1=human asserted; fake-reviews-gpt2era 0=human/1=machine, modern-fake-reviews OR=human/CG=machine, '
    + 'maide-up-tr source 0=human/1=gpt-4, hc3-en human_answers=human/chatgpt_answers=llm and '
    + 'essays-en-pairs human_text=human/ai_text=llm (plus its prompt key) all asserted non-inverted; '
    + 'the two rejected essay candidates keep their mappings asserted while disabled';
}

// ---------------------------------------------------------------- one source

async function pullSource(src, opts) {
  const rec = {
    name: src.name, dataset: src.dataset, licence: src.licence, lang: src.lang, genre: src.genre,
    role: src.role, note: src.note || null,
    cap_per_label: opts.cap, sampling: src.stride ? 'strided (evenly spaced offsets across the split)' : 'sequential from offset 0',
  };
  if (!src.enabled) {
    rec.status = 'skipped';
    rec.reason = src.disabledReason;
    process.stderr.write(`- ${src.name}: skipped — ${src.disabledReason}\n`);
    return { rec, rows: [] };
  }

  process.stderr.write(`- ${src.name} (${src.dataset})\n`);
  let split;
  try {
    split = await resolveSplit(src.dataset, src.config);
  } catch (e) {
    rec.status = 'failed';
    rec.reason = `could not resolve a split: ${e.message}`;
    process.stderr.write(`  FAILED: ${rec.reason}\n`);
    return { rec, rows: [] };
  }
  rec.config = split.config; rec.split = split.split; rec.splits_available = split.available;
  process.stderr.write(`  config=${split.config} split=${split.split}\n`);

  const kept = { human: [], llm: [] };
  let examined = 0, total = null, matchedFilter = 0, pages = 0;

  const first = await fetchRows(src.dataset, split.config, split.split, 0, PAGE).catch((e) => { rec.status = 'failed'; rec.reason = e.message; return null; });
  if (!first) { process.stderr.write(`  FAILED: ${rec.reason}\n`); return { rec, rows: [] }; }
  total = first.total;
  rec.split_num_rows = total;
  if (opts.dryRun) {
    rec.status = 'dry-run';
    rec.fields_seen = first.rows.length ? Object.keys(first.rows[0]) : [];
    process.stderr.write(`  dry-run: ${total} rows in split, fields ${rec.fields_seen.join(',')}\n`);
    return { rec, rows: [] };
  }

  // ---- R42(e): locate a labelled BLOCK inside a large multi-source split without /filter.
  // Single-row requests at evenly spaced offsets read one metadata field and nothing else; the
  // first and last hit bound a window, and the pull then strides inside that window. This is how
  // a 43k-row essay slice is taken out of a 610k-row corpus when the server's filter endpoint
  // answers 502/503 (recorded in the manifest as `locate`), instead of paging the whole split.
  let window = null;
  if (src.locate && total) {
    const nProbes = src.locate.probes || 80;
    const step = Math.max(1, Math.floor(total / nProbes));
    const hits = [];
    let probed = 0, probeErr = null;
    for (let off = 0; off < total; off += step) {
      let b;
      try { b = await fetchRows(src.dataset, split.config, split.split, off, 1); }
      catch (e) { probeErr = `${e.message} at offset ${off}`; break; }
      probed++;
      const r0 = b.rows[0];
      if (r0 && String(r0[src.locate.field]) === src.locate.value) hits.push(off);
    }
    rec.locate = {
      field: src.locate.field, value: src.locate.value,
      offsets_probed: probed, probe_step: step, hits: hits.length,
      first_hit: hits[0] ?? null, last_hit: hits.at(-1) ?? null,
      error: probeErr,
      method: 'single-row metadata requests at evenly spaced offsets; the window is [first hit - step, last hit + step]. /filter was unavailable for this dataset (502/503/timeout), and paging the whole split would have blown the R9 byte budget.',
    };
    if (!hits.length) {
      rec.status = 'failed';
      rec.reason = `locate: no row with ${src.locate.field}="${src.locate.value}" found in ${probed} probes across ${total} rows`;
      process.stderr.write(`  FAILED: ${rec.reason}\n`);
      return { rec, rows: [] };
    }
    window = [Math.max(0, hits[0] - step), Math.min(total, hits.at(-1) + step)];
    rec.locate.window = window;
    process.stderr.write(`  locate ${src.locate.field}=${src.locate.value}: ${hits.length} of ${probed} probe offsets hit; window ${window[0]}..${window[1]} of ${total}\n`);
  }

  const pageBudget = src.needsFullScan ? 1000 : (src.locate ? (src.locate.maxPages || 60) : MAX_PAGES_PER_SOURCE);
  const maxPages = Math.min(pageBudget, total ? Math.ceil(total / PAGE) : pageBudget);
  // Spread the sampled offsets across the WHOLE split. The obvious formula,
  // floor(total / (maxPages*PAGE)) * PAGE, collapses to PAGE (i.e. plain sequential paging)
  // whenever the split is smaller than maxPages*PAGE, which silently confines a 60k-row
  // dataset to its first 30k rows — and MAGE is ordered by generator, so that is a
  // single-generator sample wearing the name of a many-generator corpus.
  const stride = window
    ? Math.max(PAGE, Math.floor((window[1] - window[0]) / maxPages))
    : (src.stride && total ? Math.max(PAGE, Math.floor(total / maxPages)) : PAGE);

  const dupKeys = new Set();
  const pairAudit = new Map();
  let intraSourceDuplicates = 0, crossCheckFailures = [];

  for (let p = 0; p < maxPages; p++) {
    const offset = window
      ? Math.min(window[1] - 1, window[0] + p * stride)
      : (src.stride ? Math.min((total || 0) - 1, p * stride) : p * PAGE);
    let batch;
    if (p === 0 && !src.stride && !window) batch = first;
    else {
      try { batch = await fetchRows(src.dataset, split.config, split.split, offset, PAGE); }
      catch (e) { rec.partial_error = `stopped at offset ${offset}: ${e.message}`; break; }
    }
    pages++;
    if (!batch.rows.length) break;
    for (const r of batch.rows) {
      examined++;
      if (src.keep && !src.keep(r)) continue;
      matchedFilter++;
      // A second, independent statement of the label mapping, checked against the DATA. A registry
      // entry can be wrong in a way no unit test sees; a corpus that carries both a generator name
      // and a numeric label can contradict itself, and if it does, this source is not usable at all.
      if (src.crossCheck) {
        const bad = src.crossCheck(r);
        if (bad) { crossCheckFailures.push(bad); continue; }
      }
      const items = src.expand ? src.expand(r) : [{ text: src.text(r), label: src.label(r), generator: src.generator ? src.generator(r) : null }];
      // A source with no matched-pair or prompt key gets NO `pair` key, so make-splits shards it by
      // normalised text and two identical documents cannot land on two sides. Handing every row a
      // unique synthetic pair key would silently disable that fallback.
      const pair = src.noPairKey
        ? null
        : (src.pairFromRow ? src.pairFromRow(r) : `${src.name}#${examined}`);   // every item from ONE source row shares this key
      // R49: a pair key recovered from a schema column is a CLAIM about the data (that these two
      // rows are the same review, one real and one generated). The claim is checked here: every
      // audit key seen under one pair key must agree, or the key is dropped for the whole source.
      if (pair && src.pairAudit) {
        const a = src.pairAudit(r);
        if (!pairAudit.has(pair)) pairAudit.set(pair, { keys: new Set(), sides: new Set() });
        pairAudit.get(pair).keys.add(a.key);
        pairAudit.get(pair).sides.add(a.side);
      }
      const prompt = src.promptKey ? src.promptKey(r) : null;          // the essay-prompt holdout unit, when the dataset has one
      for (const it of items) {
        if (!it.label || !it.text) continue;
        const text = String(it.text).trim();
        if (text.length < 20) continue;
        if (kept[it.label].length >= opts.cap) continue;
        if (src.noPairKey) {
          // Within-source dedup on a cheap normalised key: an exact repeat of a document already
          // kept is dropped and counted. Duplicates are the one thing that can force run-eval to
          // exit 5 (a duplicate group straddling the split), so they are removed at the source.
          const k = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{Nd}]+/gu, ' ').trim();
          if (dupKeys.has(k)) { intraSourceDuplicates++; continue; }
          dupKeys.add(k);
        }
        kept[it.label].push({
          id: `${src.name}-${it.label}-${kept[it.label].length}`,
          dataset: src.dataset, text, label: it.label, lang: src.lang, genre: src.genre,
          generator: it.generator || null, pair, prompt,
        });
      }
    }
    if (kept.human.length >= opts.cap && kept.llm.length >= opts.cap) break;
    if (bytesDownloaded > MAX_BYTES_TOTAL) { rec.partial_error = 'global download budget reached'; break; }
  }

  // CAL fix: a source that stopped early (retries exhausted against a 429/500, or the byte
  // budget) was still recorded as 'ok' with the reason demoted to a note. A truncated pull that
  // says "ok" is exactly the silent cap R9 forbids: the Turkish anchor is a full scan, so a stop
  // at offset 5300 of 19985 yields a fifth of the rows under an unchanged status word.
  if (crossCheckFailures.length) {
    // Not a warning. A corpus whose two label columns disagree cannot be used as ground truth,
    // and a source that fails this check is dropped whole rather than pulled with the bad rows
    // filtered out — the disagreement says the mapping is not understood.
    rec.status = 'failed';
    rec.reason = `label cross-check failed on ${crossCheckFailures.length} of ${matchedFilter} matching rows: ${crossCheckFailures[0]}`;
    rec.label_cross_check = { failures: crossCheckFailures.length, examples: crossCheckFailures.slice(0, 3) };
    process.stderr.write(`  FAILED: ${rec.reason}\n`);
    return { rec, rows: [] };
  }
  if (src.crossCheck) {
    rec.label_cross_check = { failures: 0, rule: 'every kept row satisfies (model === "human") === (label === 0)', rows_checked: matchedFilter };
  }
  if (src.noPairKey) rec.intra_source_duplicates_dropped = intraSourceDuplicates;
  if (src.pairAudit && pairAudit.size) {
    const conflicting = [...pairAudit.values()].filter((e) => e.keys.size > 1).length;
    const bothSides = [...pairAudit.values()].filter((e) => e.sides.size > 1).length;
    rec.pair_key_audit = {
      rule: 'a pair key names one review; every row under it must agree on the audit key (the hotel name), and a complete pair carries both label sides',
      distinct_pairs: pairAudit.size,
      pairs_with_both_sides: bothSides,
      pairs_with_conflicting_audit_key: conflicting,
      verdict: conflicting === 0 && bothSides > 0
        ? 'ACCEPTED — the recovered key groups a real review with the generated review written for it'
        : 'REJECTED — the key does not group what it claims to; it was stripped from the rows and the source is sharded by text instead',
    };
    if (!(conflicting === 0 && bothSides > 0)) {
      for (const lab of ['human', 'llm']) for (const row of kept[lab]) row.pair = null;
      process.stderr.write(`  pair key REJECTED: ${conflicting} of ${pairAudit.size} pairs disagree about the audit key, ${bothSides} carry both sides\n`);
    } else {
      process.stderr.write(`  pair key accepted: ${pairAudit.size} pairs, ${bothSides} with both sides, 0 conflicting\n`);
    }
  }
  rec.status = rec.partial_error ? 'partial' : 'ok';
  rec.pages_fetched = pages;
  rec.rows_examined = examined;
  rec.rows_matching_filter = matchedFilter;
  rec.actual = { human: kept.human.length, llm: kept.llm.length };
  rec.capped = { human: kept.human.length >= opts.cap, llm: kept.llm.length >= opts.cap };
  for (const lab of ['human', 'llm']) {
    const msg = rec.capped[lab]
      ? `  ${lab}: capped at ${kept[lab].length} of ${matchedFilter} matching rows examined (split holds ${total})\n`
      : `  ${lab}: ${kept[lab].length} rows (cap ${opts.cap} not reached; ${examined} rows examined of ${total})\n`;
    process.stderr.write(msg);
  }
  if (rec.partial_error) process.stderr.write(`  note: ${rec.partial_error}\n`);
  return { rec, rows: [...kept.human, ...kept.llm] };
}

// ---------------------------------------------------------------- ALHD (R9), gated by R22

async function tryAlhd() {
  const rec = { ...ALHD };
  process.stderr.write('- alhd (Zenodo 17249602): one permitted attempt\n');
  try {
    const j = await getJson('https://zenodo.org/api/records/17249602', { attempts: 2, label: 'zenodo' });
    const files = (j.files || []).map((f) => ({ key: f.key, size: f.size }));
    rec.files = files;
    const tooBig = files.find((f) => f.size > 50 * 1024 * 1024);
    if (!files.length) { rec.status = 'skipped'; rec.reason = 'skipped: size/unavailable — the record lists no directly downloadable files'; }
    else if (tooBig) { rec.status = 'skipped'; rec.reason = `skipped: size/unavailable — ${tooBig.key} is ${(tooBig.size / 1048576).toFixed(1)} MB, over the 50 MB limit`; }
    else { rec.status = 'available'; rec.reason = 'record is directly downloadable and under the size limit; NOT downloaded (Arabic is out of scope per R22)'; }
  } catch (e) {
    rec.status = 'skipped';
    rec.reason = `skipped: size/unavailable — ${e.message}`;
  }
  process.stderr.write(`  ${rec.status}: ${rec.reason}\n`);
  return rec;
}

// ---------------------------------------------------------------- main

function requireIgnored(dir) {
  const abs = path.resolve(dir);
  try { execFileSync('git', ['check-ignore', '-q', abs], { stdio: 'ignore' }); }
  catch {
    process.stderr.write(`refusing to write: ${abs} is not gitignored — public corpora are not committed to this repo\n`);
    process.exit(2);
  }
  return abs;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { out: 'eval/data/public', only: null, cap: CAP_PER_LABEL, includeArabic: false, dryRun: false, probe: [], probeOut: null, importProbes: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--probe') opts.probe.push({ dataset: String(argv[++i]), where: null });
    else if (a === '--probe-where') {
      const w = String(argv[++i]);
      if (!opts.probe.length) { process.stderr.write('--probe-where must follow a --probe\n'); process.exit(1); }
      opts.probe[opts.probe.length - 1].where = w;   // applies to the probe it follows
    }
    else if (a === '--probe-out') opts.probeOut = argv[++i];
    else if (a === '--import-probes') opts.importProbes = argv[++i];
    else if (a === '--probe-timeout') { const t = Number(argv[++i]); if (!Number.isFinite(t) || t < 1) { process.stderr.write('--probe-timeout must be seconds\n'); process.exit(1); } REQUEST_TIMEOUT_MS = t * 1000; }
    else if (a === '--only') opts.only = String(argv[++i]).split(',').map((s) => s.trim());
    else if (a === '--cap') opts.cap = Number(argv[++i]);
    else if (a === '--include-arabic') opts.includeArabic = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--list') {
      for (const s of REGISTRY) process.stdout.write(`${s.name.padEnd(22)} ${s.enabled ? 'enabled ' : 'DISABLED'} ${s.dataset}\n`);
      process.stdout.write(`${'alhd'.padEnd(22)} DISABLED Zenodo 17249602 (one attempt permitted by R9, gated by R22)\n`);
      return;
    } else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); return; }
    else { process.stderr.write(`unknown flag: ${a}\n${USAGE}\n`); process.exit(1); }
  }
  if (!Number.isFinite(opts.cap) || opts.cap < 1) { process.stderr.write('--cap must be a positive integer\n'); process.exit(1); }

  // ---- --import-probes: fold a scratch probe manifest into the manifest of record.
  if (opts.importProbes) {
    const pDir = requireIgnored(opts.out);
    mkdirSync(pDir, { recursive: true });
    const dstPath = path.join(pDir, 'manifest.json');
    const src = JSON.parse(readFileSync(opts.importProbes, 'utf8'));
    let dst = {};
    try { dst = JSON.parse(readFileSync(dstPath, 'utf8')); } catch { dst = { generatedAt: new Date().toISOString(), host: HOST, sources: [], files: [] }; }
    const incoming = Array.isArray(src.probes) ? src.probes : [];
    const keyOf = (x) => `${x.dataset}|${x.where || ''}`;
    const seen = new Set(incoming.map(keyOf));
    dst.probes = [...(Array.isArray(dst.probes) ? dst.probes : []).filter((x) => !seen.has(keyOf(x))), ...incoming];
    dst.probes_note = src.probes_note || dst.probes_note || null;
    dst.probes_imported_from = path.relative(process.cwd(), path.resolve(opts.importProbes));
    writeFileSync(dstPath, JSON.stringify(dst, null, 2) + '\n', 'utf8');
    process.stderr.write(`imported ${incoming.length} probe record(s) into ${dstPath}\n`);
    return;
  }

  // ---- --probe: describe candidates, download nothing, record the result in a manifest.
  if (opts.probe.length) {
    const pDir = requireIgnored(opts.probeOut || opts.out);
    mkdirSync(pDir, { recursive: true });
    const pPath = path.join(pDir, 'manifest.json');
    let mf = {};
    try { mf = JSON.parse(readFileSync(pPath, 'utf8')); } catch { mf = { generatedAt: new Date().toISOString(), host: HOST, sources: [], files: [] }; }
    mf.probes = Array.isArray(mf.probes) ? mf.probes : [];
    mf.probes_note = 'HEAD-RULINGS R42(e): a probe asks datasets-server what a candidate dataset is (configs, splits, '
      + 'fields, row counts, declared licence, and the LENGTHS of two sample field values). No row set is downloaded and '
      + 'no text value is ever printed or stored. A probe is a note, not data.';
    for (const d of opts.probe) {
      const rec = await probeDataset(d.dataset, d.where);
      mf.probes = mf.probes.filter((p) => !(p.dataset === d.dataset && (p.where || null) === (d.where || null)));
      mf.probes.push(rec);
      mf.bytes_downloaded_probing = bytesDownloaded;
      writeFileSync(pPath, JSON.stringify(mf, null, 2) + '\n', 'utf8');   // flush after every probe
    }
    process.stderr.write(`\n${opts.probe.length} probe(s) recorded in ${pPath}; ~${(bytesDownloaded / 1024).toFixed(0)} KB read, no rows downloaded\n`);
    return;
  }

  const outDir = requireIgnored(opts.out);
  mkdirSync(outDir, { recursive: true });

  const assertion = assertMageMapping();
  process.stderr.write(`label-mapping unit test: ${assertion}\n`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    host: HOST,
    cap_per_label: opts.cap,
    page_size: PAGE,
    caps_rule: 'HEAD-RULINGS R9: at most 1500 rows per label per dataset; the cap and the actual count are both recorded here',
    language_scope: 'en + tr only (HEAD-RULINGS R22). Arabic sources are in the registry but disabled and never fetched.',
    label_mapping_assertion: assertion,
    sources: [],
    files: [],
  };

  // Merge with whatever a previous run recorded, so a --only re-run repairs one source instead
  // of erasing the record of the others, and so an interrupted run does not lose the manifest.
  const mfPath = path.join(outDir, 'manifest.json');
  let prior = null;
  try { prior = JSON.parse(readFileSync(mfPath, 'utf8')); } catch { /* first run */ }
  if (prior) {
    manifest.sources = (prior.sources || []).filter((r) => !opts.only || !opts.only.includes(r.name));
    manifest.files = (prior.files || []).filter((f) => !opts.only || !opts.only.some((n) => f.file.endsWith(`${n}.jsonl`)));
    if (prior.alhd) manifest.alhd = prior.alhd;
  }
  const flushManifest = () => {
    manifest.bytes_downloaded = bytesDownloaded;
    writeFileSync(mfPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  };

  let any = false;
  for (const src of REGISTRY) {
    if (opts.only && !opts.only.includes(src.name)) continue;
    const enabled = src.enabled || (opts.includeArabic && src.lang === 'ar');
    const { rec, rows } = await pullSource({ ...src, enabled }, opts);
    manifest.sources.push(rec);
    if (rows.length) {
      any = true;
      const file = path.join(outDir, `${src.name}.jsonl`);
      const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
      writeFileSync(file, body, 'utf8');
      manifest.files.push({
        file: path.relative(process.cwd(), file),
        rows: rows.length,
        human: rows.filter((r) => r.label === 'human').length,
        llm: rows.filter((r) => r.label === 'llm').length,
        bytes: Buffer.byteLength(body),
        sha256: createHash('sha256').update(body).digest('hex'),
      });
    }
    flushManifest();   // after EVERY source, so an interrupted run still leaves a record
  }

  if (opts.includeArabic && (!opts.only || opts.only.includes('alhd'))) {
    manifest.alhd = await tryAlhd();
  } else {
    manifest.alhd = { ...ALHD, status: 'not attempted', reason: 'Arabic is out of scope (HEAD-RULINGS R22). Pass --include-arabic to spend the single attempt R9 permits.' };
  }

  flushManifest();
  process.stderr.write(`\nmanifest: ${mfPath}\ndownloaded ~${(bytesDownloaded / 1048576).toFixed(1)} MB (budget ${(MAX_BYTES_TOTAL / 1048576).toFixed(0)} MB)\n`);
  if (!any && !opts.dryRun) { process.stderr.write('every enabled source failed\n'); process.exit(5); }
}

// The registry is importable so run-eval.mjs can read the label mappings without refetching.
export { REGISTRY, assertMageMapping };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fetch-public-datasets.mjs')) {
  main().catch((e) => { process.stderr.write(`fatal: ${e.stack || e.message}\n`); process.exit(5); });
}
