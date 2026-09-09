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
  --dry-run            resolve configs/splits and row counts, fetch no rows`;

// ---------------------------------------------------------------- registry (SPEC §F.1)

const REGISTRY = [
  {
    name: 'maide-up-tr', dataset: 'MichiganNLP/MAiDE-up', licence: 'MIT',
    role: 'The Turkish anchor: hotel reviews, the exact genre. source 0 = real human, 1 = GPT-4.',
    lang: 'tr', genre: 'hotel_review', enabled: true, needsFullScan: true,
    // Turkish only. Both labels come from the same file, so one pass fills both.
    // The languages sit in contiguous blocks, so this source is scanned in full rather
    // than sampled: 19,985 rows at 100 per page. That is also how F.4's demand to VERIFY
    // the Turkish source=0 count at pull time, rather than assume it, is satisfied.
    keep: (r) => String(r.Review_Language || '').toLowerCase() === 'turkish',
    label: (r) => (Number(r.source) === 1 ? 'llm' : (Number(r.source) === 0 ? 'human' : null)),
    text: (r) => [r.Upside_Review, r.Downside_Review].filter((s) => s && String(s).trim()).join('\n\n'),
    generator: (r) => (Number(r.source) === 1 ? 'gpt-4' : null),
    note: 'F.4: the source=0 counterpart returned HTTP 500 on the design-round re-check. The count is verified at pull time and recorded below, not assumed.',
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
    note: 'field is `text_` with a trailing underscore; label OR = human, CG = machine.',
  },
  {
    name: 'fake-reviews-gpt2era', dataset: 'theArijitDas/Fake-Reviews-Dataset', licence: 'apache-2.0',
    role: 'EN reviews, GPT-2-era machine half: natively short text, so the honest place to measure the short-text ceiling, and a control for generation drift.',
    lang: 'en', genre: 'product_review', enabled: true,
    keep: () => true,
    label: (r) => (Number(r.label) === 1 ? 'llm' : (Number(r.label) === 0 ? 'human' : null)),
    text: (r) => r.text,
    generator: (r) => (Number(r.label) === 1 ? 'gpt-2-era' : null),
    note: '0 = human, 1 = machine. The human half also serves as negative control (a): it predates 2022.',
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
const REQUEST_TIMEOUT_MS = 30000;   // CAL: no request may hang the run forever

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
  return 'MAGE 0=machine/1=human asserted; the other three datasets asserted non-inverted';
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

  const pageBudget = src.needsFullScan ? 1000 : MAX_PAGES_PER_SOURCE;
  const maxPages = Math.min(pageBudget, total ? Math.ceil(total / PAGE) : pageBudget);
  // Spread the sampled offsets across the WHOLE split. The obvious formula,
  // floor(total / (maxPages*PAGE)) * PAGE, collapses to PAGE (i.e. plain sequential paging)
  // whenever the split is smaller than maxPages*PAGE, which silently confines a 60k-row
  // dataset to its first 30k rows — and MAGE is ordered by generator, so that is a
  // single-generator sample wearing the name of a many-generator corpus.
  const stride = src.stride && total ? Math.max(PAGE, Math.floor(total / maxPages)) : PAGE;

  for (let p = 0; p < maxPages; p++) {
    const offset = src.stride ? Math.min((total || 0) - 1, p * stride) : p * PAGE;
    let batch;
    if (p === 0 && !src.stride) batch = first;
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
      const items = src.expand ? src.expand(r) : [{ text: src.text(r), label: src.label(r), generator: src.generator ? src.generator(r) : null }];
      const pair = `${src.name}#${examined}`;   // every item from ONE source row shares this key
      for (const it of items) {
        if (!it.label || !it.text) continue;
        const text = String(it.text).trim();
        if (text.length < 20) continue;
        if (kept[it.label].length >= opts.cap) continue;
        kept[it.label].push({
          id: `${src.name}-${it.label}-${kept[it.label].length}`,
          dataset: src.dataset, text, label: it.label, lang: src.lang, genre: src.genre,
          generator: it.generator || null, pair,
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
  const opts = { out: 'eval/data/public', only: null, cap: CAP_PER_LABEL, includeArabic: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
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
