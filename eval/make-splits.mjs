#!/usr/bin/env node
/**
 * make-splits.mjs — SPEC §F.2 and §D.5 steps 1-3, as amended by HEAD-RULINGS R8 and R22.
 *
 * Reads (all gitignored, none committed):
 *   eval/data/corpus_user_messages.json   the private calibration corpus
 *   eval/data/data_split.json             the design round's leakage-safe split by message id
 *   eval/data/public/ *.jsonl             whatever fetch-public-datasets.mjs pulled
 * Reads (committed):
 *   eval/fixtures/llm-en.jsonl, llm-tr.jsonl
 *
 * Writes (all gitignored):
 *   eval/data/splits.jsonl        one row per document, with its side, group and strata
 *   eval/data/splits-report.json  dedup rates, exclusions, contamination, group counts
 *   eval/data/human-chat.jsonl    R8: the human chat rows, deny-by-default scrubbed.
 *                                 NEVER COMMITTED. Regenerated here at eval time.
 *
 * Sides are named fit / val / test. 60 / 20 / 20, group-aware: the holdout unit is the
 * WRITER for real humans, the PERSONA for generated personas, and the dataset-plus-generator
 * for public corpora. Never the row: a random row split leaks template siblings across the
 * boundary and inflates AUC by 10-20 points.
 *
 * R22: rows whose dominant script is Arabic are EXCLUDED from calibration and the count is
 * reported. Leave-one-writer-out therefore runs over the writers that survive that filter.
 *
 * Exit codes: 0 ok · 1 usage · 2 missing input or output dir not gitignored.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const USAGE = `usage: node eval/make-splits.mjs [options]
  --data <dir>       data directory (default eval/data)
  --fixtures <dir>   fixture directory (default eval/fixtures)
  --seed <string>    hash salt for the group assignment (default "llm-detect-v1")
  --no-contamination skip the Jaccard contamination scan (it is the slow part)`;

const die = (code, msg) => { process.stderr.write(msg + '\n'); process.exit(code); };

// ---------------------------------------------------------------- normalization (DATA §1.1)

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu;
const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const TR_FOLD = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };

function arabicIndicToAscii(s) {
  return s.replace(/[٠-٩]/g, (c) => String(c.codePointAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.codePointAt(0) - 0x06F0));
}

/** The dedup key. Any accuracy quoted on a non-deduped stream is rejected by the harness. */
export function normKey(s) {
  let t = String(s).normalize('NFKC');
  t = t.replace(TASHKEEL, '').replace(TATWEEL, '');
  t = arabicIndicToAscii(t);
  t = t.replace(/[آأإٱ]/g, 'ا')   // alef fold
    .replace(/ى/g, 'ي')                          // alef maqsura -> ya
    .replace(/ة/g, 'ه');                         // ta marbuta -> ha
  t = t.replace(EMOJI, '');
  t = t.toLocaleLowerCase('tr').replace(/[çğıİöşüâîû]/g, (c) => TR_FOLD[c] || c).toLowerCase();
  t = t.replace(/[^\p{L}\p{Nd}]+/gu, ' ').trim();
  return t;
}

const WORD_RE = /(?!ـ)[\p{L}\p{M}][\p{L}\p{M}ـ'’-]*/gu;
const wordsOf = (s) => String(s).match(WORD_RE) || [];

function arabicShare(s) {
  const letters = String(s).match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  let n = 0;
  for (const c of letters) if (/\p{Script=Arabic}/u.test(c)) n++;
  return n / letters.length;
}

// deterministic 32-bit FNV-1a, used for every group assignment so a rerun reproduces the split
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const sideOf = (group, seed) => { const r = fnv1a(seed + '|' + group) / 0xffffffff; return r < 0.6 ? 'fit' : (r < 0.8 ? 'val' : 'test'); };

// Public corpora are split by a STRATIFIED group shard: the shard comes from the source row
// (matched pairs) or from the normalized text (so near-duplicates cannot straddle), and the
// shard-to-side map is FIXED and shared by both labels. Hashing each (family, label) group
// independently is what put a whole label on one side of the split in the first draft.
const SHARDS = 20;
const shardOf = (r) => fnv1a('shard|' + (r.pair || normKey(r.text))) % SHARDS;
const sideOfShard = (sh) => (sh < 12 ? 'fit' : (sh < 16 ? 'val' : 'test'));

// ---------------------------------------------------------------- R8 scrub

const ALLOW = new Set([
  // months (tr + en) and weekdays
  'ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // cities and regions that appear as booking destinations
  'istanbul', 'ankara', 'izmir', 'antalya', 'kapadokya', 'cappadocia', 'trabzon', 'bursa', 'konya', 'taksim',
  'sultanahmet', 'kadikoy', 'urgup', 'goreme', 'nevsehir', 'bodrum', 'fethiye', 'turkiye', 'turkey', 'alanya', 'side', 'kemer', 'belek',
  // hotel-catalogue and room vocabulary
  'hotel', 'otel', 'oda', 'odalar', 'room', 'rooms', 'suite', 'standart', 'standard', 'deluxe', 'superior', 'family',
  'aile', 'twin', 'double', 'single', 'triple', 'sea', 'view', 'garden', 'cave', 'magara', 'spa', 'resort', 'palace',
  'grand', 'central', 'old', 'town', 'beach', 'boutique', 'inn', 'plaza', 'park', 'terrace', 'bosphorus', 'marina',
  'classic', 'economy', 'balkon', 'balcony', 'kahvalti', 'breakfast', 'transfer', 'check', 'in', 'out',
  // booking function words
  'gece', 'gun', 'gunluk', 'gecelik', 'giris', 'cikis', 'kisi', 'kisilik', 'kisiyiz', 'yetiskin', 'cocuk', 'cocuklar',
  'bebek', 'yasinda', 'yas', 'fiyat', 'fiyati', 'ucret', 'toplam', 'rezervasyon', 'tur', 'turu', 'program', 'tarih',
  'adult', 'adults', 'child', 'children', 'night', 'nights', 'price', 'total', 'booking', 'reservation', 'trip', 'tour', 'date', 'dates',
]);

const TR_STOP = new Set(['ve', 'ile', 'bir', 'bu', 'su', 'o', 'da', 'de', 'ki', 'mi', 'mu', 'ama', 'icin', 'gibi', 'daha', 'cok', 'az', 'var', 'yok', 'evet', 'hayir', 'tamam', 'olsun', 'olacak', 'lazim', 'istiyorum', 'merhaba', 'selam', 'naber', 'reis', 'abi', 'sonra', 'once', 'simdi', 'yine', 'ayni', 'diger', 'birinci', 'ikinci', 'ucuncu', 'sadece', 'bize', 'bana', 'sana', 'biz', 'ben', 'sen', 'hangi', 'kac', 'ne', 'nasil', 'nerede', 'lutfen', 'tesekkurler', 'sagol', 'iyi', 'gunler', 'peki', 'yani', 'pardon']);
const EN_STOP = new Set(['the', 'and', 'is', 'are', 'of', 'to', 'we', 'you', 'a', 'an', 'in', 'for', 'it', 'was', 'this', 'that', 'with', 'on', 'at', 'from', 'i', 'my', 'our', 'want', 'need', 'please', 'thanks', 'thank', 'hello', 'hi', 'yes', 'no', 'ok', 'okay', 'have', 'has', 'be', 'will', 'would', 'can', 'could', 'do', 'does', 'lets']);

/**
 * Deny-by-default redaction (R8). A token prints only if it is in the allowlist, a stopword,
 * a number, or common vocabulary in the corpus itself. Some innocent rare words print as
 * [NAME]; that is the correct direction to err.
 */
function makeScrubber(commonTokens) {
  const known = (w) => {
    const k = normKey(w);
    return !k || ALLOW.has(k) || TR_STOP.has(k) || EN_STOP.has(k) || commonTokens.has(k) || /^[0-9]+$/.test(k);
  };
  return function scrub(text) {
    let t = String(text);
    let refs = 0, nums = 0, names = 0;
    t = t.replace(/\b[A-Z]{2,5}-?[0-9]{4,8}\b/g, () => { refs++; return '[REF]'; });
    t = t.replace(/\+?[0-9٠-٩۰-۹]{7,}/gu, () => { nums++; return '[NUM]'; });
    const out = t.split('\n').map((line) => {
      // guest-name-shaped tokens after an explicit name cue are ALWAYS redacted
      const cue = /\b(isim|isimler|isimleri|adi|adı|adlari|adları|names?|name)\b\s*:?/i;
      const m = line.match(cue);
      const head = m ? line.slice(0, m.index + m[0].length) : '';
      const tail = m ? line.slice(m.index + m[0].length) : line;
      const redactTail = (s, always) => {
        const parts = s.split(/(\P{L}+)/u);
        let run = 0;
        return parts.map((p) => {
          if (!/\p{L}/u.test(p)) return p;
          if (always) { names++; return '[NAME]'; }
          if (known(p)) { run = 0; return p; }
          run++;
          names++;
          return '[NAME]';
        }).join('');
      };
      return (m ? redactTail(head, false) : '') + redactTail(tail, Boolean(m));
    }).join('\n');
    return { text: out.replace(/(\[NAME\]\s+){2,}/g, (s) => s), redactions: { refs, nums, names } };
  };
}

// ---------------------------------------------------------------- load

function loadCorpus(dataDir) {
  const f = path.join(dataDir, 'corpus_user_messages.json');
  if (!existsSync(f)) die(2, `no corpus at ${f} — run eval/adapters/supabase-messages.cjs, or point --data elsewhere`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

function loadRecordedSplit(dataDir) {
  const f = path.join(dataDir, 'data_split.json');
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const side = new Map();
  for (const label of ['REAL', 'SYNTH']) {
    if (!j[label]) continue;
    for (const id of (j[label].test || [])) side.set(id, 'test');
    for (const id of (j[label][Object.keys(j[label]).find((k) => k !== 'test')] || [])) if (!side.has(id)) side.set(id, 'fit-or-val');
  }
  return { side, meta: j.meta || null };
}

function loadPublic(dataDir) {
  const dir = path.join(dataDir, 'public');
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      rows.push({
        id: r.id, text: r.text, label: r.label, lang: r.lang, genre: r.genre,
        source: 'public:' + path.basename(f, '.jsonl'),
        // Group-aware, and it must CUT ACROSS labels or a whole label lands on one side.
        // The leakage unit is the source row (matched pairs) and the template family
        // (generator/category); within that, near-duplicates share a normKey and therefore a
        // shard, so no near-duplicate pair straddles the boundary.
        group: 'public:' + path.basename(f, '.jsonl') + '::' + (r.generator || r.genre || 'na')
          + '::shard' + shardOf(r),
        shard: shardOf(r),
        pair: r.pair || null,
        generator: r.generator || null,   // feeds modelFamiliesCovered in weights.fitted.json
        shape: 'prose', channel: 'web',
      });
    }
  }
  return rows;
}

function loadFixtures(fixDir) {
  const rows = [];
  for (const f of ['llm-en.jsonl', 'llm-tr.jsonl']) {
    const p = path.join(fixDir, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      rows.push({
        id: r.id, text: r.text, label: 'llm', lang: r.lang, genre: r.genre,
        source: 'fixture:' + path.basename(f, '.jsonl'),
        // prompt-template holdout: a humanized row and the clean row it came from share a group
        group: 'fixture::' + r.genre + '::' + (r.pairId || r.id),
        shape: r.shape, channel: r.channel, variant: r.variant, transform: r.transform, pairId: r.pairId,
        forceSide: 'test',
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- strata (documented proxies)

function strataFor(r) {
  const s = [];
  const t = r.text;
  const nt = wordsOf(t).length;
  if (r.label === 'human') {
    // non-native EN: an English-classified message written by one of the Turkish-speaking
    // corpus writers. This is a REAL non-native stratum, not a guess.
    if (r.source === 'inhouse' && r.lang === 'en' && r.writer_id) s.push('non_native_en');
    // formal register (proxy): everything terminated, long enough to mean something
    const lines = t.split('\n').filter((l) => l.trim());
    const ended = lines.filter((l) => /[.!?]\s*$/.test(l)).length;
    if (nt >= 30 && lines.length >= 2 && ended / lines.length > 0.9) s.push('formal_register');
    // mobile typed (proxy): emoji, elongation, or fully lowercase
    if (/[\p{Extended_Pictographic}]/u.test(t) || /(\p{L})\1{2,}/u.test(t) || (t === t.toLocaleLowerCase('tr') && /\p{L}/u.test(t))) s.push('mobile_typed');
  }
  return s;
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const opts = { data: 'eval/data', fixtures: 'eval/fixtures', seed: 'llm-detect-v1', contamination: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') opts.data = argv[++i];
    else if (a === '--fixtures') opts.fixtures = argv[++i];
    else if (a === '--seed') opts.seed = argv[++i];
    else if (a === '--no-contamination') opts.contamination = false;
    else if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); return; }
    else die(1, `unknown flag: ${a}\n${USAGE}`);
  }

  const dataDir = path.resolve(opts.data);
  mkdirSync(dataDir, { recursive: true });
  try { execFileSync('git', ['check-ignore', '-q', dataDir], { stdio: 'ignore' }); }
  catch { die(2, `refusing to write: ${dataDir} is not gitignored — it holds real chat messages (R8)`); }

  const report = { generatedAt: new Date().toISOString(), seed: opts.seed, language_scope: 'en + tr (HEAD-RULINGS R22)' };

  // ---- 1. in-house corpus: load, filter script, dedup
  const corpus = loadCorpus(dataDir);
  const recorded = loadRecordedSplit(dataDir);
  report.corpus = { raw: corpus.length };

  const arabicExcluded = { REAL: 0, SYNTH: 0, OTHER: 0, byWriter: {} };
  const outOfScopeLang = {};
  const other = corpus.filter((r) => r.label === 'OTHER').length;
  const usable = [];
  for (const r of corpus) {
    if (r.label !== 'REAL' && r.label !== 'SYNTH') continue;
    if (!r.content || !r.content.trim()) continue;
    if (r.language && r.language !== 'en' && r.language !== 'tr' && r.language !== 'ar') {
      outOfScopeLang[r.language] = (outOfScopeLang[r.language] || 0) + 1;   // R22: en + tr only
      continue;
    }
    if (arabicShare(r.content) >= 0.2) {              // R22 script filter
      arabicExcluded[r.label]++;
      if (r.writer_id) arabicExcluded.byWriter[r.writer_id] = (arabicExcluded.byWriter[r.writer_id] || 0) + 1;
      continue;
    }
    usable.push(r);
  }
  report.corpus.label_OTHER_excluded = other;
  report.corpus.arabic_script_excluded = arabicExcluded;
  report.corpus.out_of_scope_language_excluded = outOfScopeLang;
  report.corpus.arabic_exclusion_note = 'HEAD-RULINGS R22: Arabic-script rows are never scored. They are dropped here and counted, not silently skipped.';

  // dedup, per label, on the normalized key; report the rate
  const dedup = { REAL: { raw: 0, unique: 0 }, SYNTH: { raw: 0, unique: 0 } };
  const seen = new Map();               // normKey -> first row
  const keyLabels = new Map();          // normKey -> Set(label)
  const unique = [];
  for (const r of usable) {
    const k = normKey(r.content);
    dedup[r.label].raw++;
    if (!keyLabels.has(k)) keyLabels.set(k, new Set());
    keyLabels.get(k).add(r.label);
    if (seen.has(k)) continue;
    seen.set(k, r);
    dedup[r.label].unique++;
    unique.push({ ...r, _key: k });
  }
  for (const l of ['REAL', 'SYNTH']) {
    dedup[l].duplicate_rate_pct = dedup[l].raw ? Number((100 * (1 - dedup[l].unique / dedup[l].raw)).toFixed(2)) : 0;
  }
  report.corpus.dedup = dedup;

  // ---- 2. texts occurring under BOTH labels: force onto the same side
  const collisions = [...keyLabels.entries()].filter(([, s]) => s.size > 1).map(([k]) => k);
  report.corpus.cross_label_collisions = collisions.length;
  report.corpus.cross_label_note = 'These strings are irreducible: no feature set separates them. They are forced onto one side so they cannot be counted as both a hit and a miss.';
  const collisionSide = new Map(collisions.map((k) => [k, sideOf('collision::' + k, opts.seed)]));

  // ---- 3. group-aware assignment
  const rows = [];
  let reusedFromRecorded = 0;
  for (const r of unique) {
    const isHuman = r.label === 'REAL';
    const group = isHuman ? ('writer::' + r.writer_id) : ('persona::' + (r.persona_id || 'unknown'));
    let side;
    if (collisionSide.has(r._key)) side = collisionSide.get(r._key);
    else if (recorded && recorded.side.get(r.id) === 'test') { side = 'test'; reusedFromRecorded++; }
    else side = sideOf(group, opts.seed);
    // the design round's split only had two sides; anything it put on the fit side may still
    // become val here, which is what the 60/20/20 group hash decides.
    if (side === 'fit-or-val') side = sideOf(group, opts.seed) === 'test' ? 'val' : sideOf(group, opts.seed);
    rows.push({
      id: r.id, text: r.content, label: isHuman ? 'human' : 'llm', lang: r.language === 'en' ? 'en' : 'tr',
      source: 'inhouse', group, side,
      writer_id: r.writer_id || null, persona_id: r.persona_id || null,
      shape: 'chat', channel: 'whatsapp', genre: 'chat', domain: 'general',
      created_at: r.created_at || null,
    });
  }
  report.corpus.reused_recorded_test_ids = reusedFromRecorded;

  // Human rows are additionally split CHRONOLOGICALLY per writer (SPEC §F.2): every held-out
  // human message is later than that writer's fitting messages. This overrides the group hash
  // for REAL rows, because with three writers a writer-level hash puts a whole writer on one side.
  const byWriter = {};
  for (const r of rows) if (r.source === 'inhouse' && r.label === 'human') (byWriter[r.writer_id] ||= []).push(r);
  report.corpus.writers = {};
  for (const [w, list] of Object.entries(byWriter)) {
    list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const nFit = Math.floor(list.length * 0.6), nVal = Math.floor(list.length * 0.2);
    list.forEach((r, i) => { r.side = i < nFit ? 'fit' : (i < nFit + nVal ? 'val' : 'test'); });
    report.corpus.writers[w] = {
      n: list.length, fit: nFit, val: nVal, test: list.length - nFit - nVal,
      span: [list[0]?.created_at?.slice(0, 10), list.at(-1)?.created_at?.slice(0, 10)],
    };
  }

  // ---- public + fixtures
  const pub = loadPublic(dataDir);
  for (const r of pub) r.side = sideOfShard(r.shard);
  const fix = loadFixtures(path.resolve(opts.fixtures));
  for (const r of fix) r.side = r.forceSide;
  const all = [...rows, ...pub, ...fix];
  for (const r of all) {
    r.tokens = wordsOf(r.text).length;
    r.bucket = r.tokens < 20 ? '<20' : r.tokens < 50 ? '20-49' : r.tokens < 150 ? '50-149' : r.tokens < 500 ? '150-499' : '500+';
    r.strata = strataFor(r);
    r.domain ||= 'general';
    r.genre ||= 'auto';
  }

  report.sources = {};
  for (const r of all) {
    const k = r.source;
    (report.sources[k] ||= { fit: { human: 0, llm: 0 }, val: { human: 0, llm: 0 }, test: { human: 0, llm: 0 } });
    report.sources[k][r.side][r.label]++;
  }
  report.buckets = {};
  for (const r of all) {
    const k = `${r.lang}/${r.bucket}`;
    (report.buckets[k] ||= { human: 0, llm: 0 });
    report.buckets[k][r.label]++;
  }

  // ---- contamination (SPEC §F.2): how many generated messages are near-copies of a real one
  if (opts.contamination) {
    const humans = rows.filter((r) => r.label === 'human').map((r) => new Set(wordsOf(normKey(r.text))));
    const inverted = new Map();
    humans.forEach((set, i) => { for (const w of set) { if (!inverted.has(w)) inverted.set(w, []); inverted.get(w).push(i); } });
    const bands = { '>=0.5': 0, '>=0.7': 0, '>=0.9': 0 };
    const llmRows = rows.filter((r) => r.label === 'llm');
    for (const r of llmRows) {
      const set = new Set(wordsOf(normKey(r.text)));
      if (!set.size) continue;
      const overlap = new Map();
      for (const w of set) for (const i of (inverted.get(w) || [])) overlap.set(i, (overlap.get(i) || 0) + 1);
      let best = 0;
      for (const [i, inter] of overlap) {
        const j = inter / (set.size + humans[i].size - inter);
        if (j > best) best = j;
      }
      if (best >= 0.5) bands['>=0.5']++;
      if (best >= 0.7) bands['>=0.7']++;
      if (best >= 0.9) bands['>=0.9']++;
    }
    report.contamination = {
      metric: 'token-set Jaccard of a generated message against every deduplicated real message (short chat turns make 5-gram shingles degenerate)',
      n_llm_rows: llmRows.length,
      pct: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, llmRows.length ? Number((100 * v / llmRows.length).toFixed(2)) : 0])),
      note: 'The generated side was built by replaying real transcripts, so a nonzero rate here is expected and is a ceiling on any honest accuracy claim.',
    };
  }

  // ---- R8: human-chat.jsonl, scrubbed, gitignored, never committed
  const freq = new Map();
  for (const r of rows) {
    for (const w of new Set(wordsOf(r.text).map(normKey))) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const common = new Set([...freq.entries()].filter(([, n]) => n >= 15).map(([w]) => w));
  const scrub = makeScrubber(common);
  const humanChat = [];
  const red = { refs: 0, nums: 0, names: 0 };
  for (const r of rows) {
    if (r.label !== 'human') continue;
    const s = scrub(r.text);
    red.refs += s.redactions.refs; red.nums += s.redactions.nums; red.names += s.redactions.names;
    humanChat.push({ id: r.id, text: s.text, label: 'human', lang: r.lang, writer_id: r.writer_id, side: r.side, tokens: r.tokens, bucket: r.bucket, shape: 'chat', channel: 'whatsapp' });
  }
  const hcFile = path.join(dataDir, 'human-chat.jsonl');
  writeFileSync(hcFile, humanChat.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  report.human_chat = {
    file: path.relative(process.cwd(), hcFile), rows: humanChat.length, redactions: red,
    policy: 'R8 deny-by-default: a token prints only if it is on the allowlist, is a stopword, is a number, or appears in 15+ distinct corpus messages. Some innocent rare words print as [NAME]; that is the correct direction to err.',
    committed: false,
  };
  const leaked = humanChat.filter((r) => /\+?[0-9]{10,15}/.test(r.text));
  if (leaked.length) die(2, `internal guard: ${leaked.length} scrubbed rows still carry a phone-shaped digit run — refusing to continue`);

  // ---- write
  const splitFile = path.join(dataDir, 'splits.jsonl');
  writeFileSync(splitFile, all.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const repFile = path.join(dataDir, 'splits-report.json');
  writeFileSync(repFile, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const n = (side, label) => all.filter((r) => r.side === side && r.label === label).length;
  process.stderr.write(`rows: ${all.length}  fit ${n('fit', 'human')}h/${n('fit', 'llm')}l  val ${n('val', 'human')}h/${n('val', 'llm')}l  test ${n('test', 'human')}h/${n('test', 'llm')}l\n`);
  process.stderr.write(`in-house dedup: human ${dedup.REAL.duplicate_rate_pct}% duplicate, generated ${dedup.SYNTH.duplicate_rate_pct}% duplicate\n`);
  process.stderr.write(`Arabic-script rows excluded (R22): human ${arabicExcluded.REAL}, generated ${arabicExcluded.SYNTH}  per writer ${JSON.stringify(arabicExcluded.byWriter)}\n`);
  if (report.contamination) process.stderr.write(`contamination of the generated side against real messages: ${JSON.stringify(report.contamination.pct)}\n`);
  process.stderr.write(`wrote ${splitFile}\nwrote ${repFile}\nwrote ${hcFile} (gitignored, never committed)\n`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('make-splits.mjs')) main();
