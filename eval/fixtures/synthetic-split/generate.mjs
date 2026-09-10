#!/usr/bin/env node
/**
 * generate.mjs — the synthetic split fixture for eval/selftest-eval.mjs.
 *
 * WHY THIS EXISTS. run-eval.mjs refuses, in code, to publish numbers measured on a leaked split:
 * it exits 5 on a non-`writer::` group straddle, 4 on the honesty guard, 6 on a fitted-weights file
 * the shipped loader could not read. Those branches were verified by reading them, because staging
 * a real failure would have meant copying private corpus rows into a scratch directory. This file
 * removes that excuse: a corpus that is entirely synthetic, deterministic, and shaped exactly like
 * `eval/data/splits.jsonl`, which the harness self-test can corrupt in a controlled way.
 *
 * NOT A MEASUREMENT. Nothing generated here resembles real human or real LLM writing; the two
 * classes are separated by templates chosen to make a model fit at all. No number computed on this
 * corpus means anything about the detector's accuracy, and `selftest-eval.mjs` asserts structure
 * and exit codes only, never a rate.
 *
 * NO CORPUS ROWS. Every string below is authored in this file. Nothing is read from eval/data/.
 *
 * Deterministic: one seeded mulberry32, no clock, no RNG from the platform. Re-running rewrites
 * byte-identical files.
 *
 *   node eval/fixtures/synthetic-split/generate.mjs [--out <dir>]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normKey } from '../../make-splits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
const rnd = mulberry32(20260910);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pickN = (arr, n) => { const out = []; for (let i = 0; i < n; i++) out.push(pick(arr)); return out; };

// ---------------------------------------------------------------- sentence pools
// Deliberately bland and repetitive. The "llm" pool leans on connectives, balanced contrast and
// summary moves; the "human" pool leans on contractions, dropped apostrophes and asides. That is
// enough separation for a logistic fit to converge, and it is not a claim about real text.

const EN_LLM = [
  'The property offers a comprehensive range of amenities that cater to both leisure and business travellers.',
  'Furthermore, the location provides convenient access to the principal transport connections in the district.',
  'It is worth noting that the staff demonstrated a consistently high standard of professionalism throughout.',
  'While the rooms are somewhat compact, the thoughtful design ensures that space is used efficiently.',
  'The breakfast selection includes both regional specialities and familiar international options.',
  'In addition, the reception team was able to accommodate an early arrival without any difficulty.',
  'Moreover, the soundproofing performs admirably given the building age and the surrounding streets.',
  'The overall impression is one of careful management and attention to detail at every level.',
  'In conclusion, this establishment represents excellent value within its category and price band.',
  'Guests seeking a quiet retreat may wish to request a room facing the interior courtyard instead.',
  'The cleaning standards were maintained diligently, and the linen was changed on a daily basis.',
  'On the other hand, the parking arrangements require some advance planning during peak periods.',
];
const EN_HUMAN = [
  'We stayed three nights and honestly it was better than we expected for the price.',
  'The shower took forever to warm up but once it did it was fine, no complaints really.',
  'Breakfast is good, theres a lot of choice and the coffee is actually drinkable, which is rare.',
  'Staff were lovely and one of them walked us to the tram stop when we got lost on the first day.',
  'The bed was comfy but the pillows are those weird flat ones, so ask for extra if you care.',
  'Wifi dropped a few times in the room but worked fine downstairs in the bar area.',
  'Its a bit of a walk from the station with bags, maybe twelve minutes, uphill at the end.',
  'We didnt use the gym so I cant say anything about it, it looked small from the corridor.',
  'Would go back, though next time id ask for a room at the back away from the street.',
  'Checkout was quick and nobody argued about the minibar, which is more than I can say for the last place.',
  'The lift is tiny, like two people and a suitcase tiny, but the stairs are fine.',
  'Ask them about the roof terrace, its not on the website and its honestly the best bit.',
  'I think the pictures undersell the room, it felt bigger than it looked online.',
  'Maybe bring earplugs, the street outside gets loud around eleven on a Friday.',
];
const TR_LLM = [
  'Otelin konumu, şehrin başlıca ulaşım hatlarına kolay erişim sağlaması bakımından oldukça avantajlıdır.',
  'Ayrıca personelin misafirlere karşı gösterdiği ilgi ve nezaket konaklama boyunca istikrarlı biçimde sürmüştür.',
  'Belirtmek gerekir ki odalar görece kompakt olmakla birlikte, alan son derece verimli kullanılmıştır.',
  'Kahvaltıda hem yerel lezzetlere hem de uluslararası seçeneklere yer verilmektedir.',
  'Bunun yanı sıra resepsiyon ekibi erken girişi herhangi bir güçlük çıkarmadan karşılamıştır.',
  'Sonuç olarak bu tesis, bulunduğu kategori ve fiyat bandı içinde başarılı bir tercih olarak değerlendirilebilir.',
  'Sessiz bir konaklama arayan misafirlerin iç avluya bakan odaları talep etmesi yerinde olacaktır.',
  'Temizlik standartları özenle korunmuş ve nevresimler her gün değiştirilmiştir.',
];
const TR_HUMAN = [
  'Uc gece kaldik ve fiyatina gore beklentimizin oldukca uzerindeydi.',
  'Dus bir turlu isinmadi ama sonra duzeldi, cok da sorun olmadi acikcasi.',
  'Kahvalti guzel, secenek bol ve kahve de icilir cinsten.',
  'Personel cok ilgiliydi, bir tanesi bizi tramvay duragina kadar getirdi.',
  'Yatak rahat ama yastiklar ince, ekstra isteyin derim.',
  'Wifi odada bir kac kere kesildi, asagida barda hic sorun yok.',
  'Istasyondan valizle yurumek biraz zor, son kisim yokus.',
  'Tekrar gideriz ama arka tarafta oda isteriz, sokak tarafi sesli.',
  'Bence fotograflar odayi kucuk gosteriyor, gercekte daha genis.',
  'Kulak tikaci getirin, cuma aksamlari sokak on birden sonra hareketleniyor.',
];

const SHORT_EN = ['thanks', 'ok sounds good', 'see you then', 'no problem at all', 'got it thanks', 'will do', 'perfect thank you', 'yes please'];
const SHORT_TR = ['tamam', 'olur tesekkurler', 'gorusuruz', 'sorun degil', 'anladim', 'peki', 'harika tesekkurler', 'evet lutfen'];

const doc = (pool, nMin, nMax) => {
  const n = nMin + Math.floor(rnd() * (nMax - nMin + 1));
  return pickN(pool, n).join(' ');
};

const wordsOf = (s) => (String(s).match(/[\p{L}\p{Nd}]+/gu) || []);
const bucketOf = (n) => (n < 20 ? '<20' : n < 50 ? '20-49' : n < 150 ? '50-149' : n < 500 ? '150-499' : '500+');

// Public rows are assigned to a side by a SHARD, exactly as make-splits.mjs does, so that a group
// can never hold two sides. run-eval exits 5 on a non-`writer::` group straddle, and the clean
// variant of this fixture must not trip it — the self-test plants that straddle deliberately, in a
// scratch copy, and asserts the exit.
const SHARDS = { fit: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], val: [12, 13, 14, 15], test: [16, 17, 18, 19] };
const shardFor = (side, i) => SHARDS[side][i % SHARDS[side].length];

// Every text in this fixture is UNIQUE under make-splits' own normKey. That is not decoration:
// checks 3 and 4 of the harness self-test plant a duplicate-key straddle and a both-label straddle
// and assert the harness refuses them, which is only meaningful if the clean fixture has none. The
// short chat pools repeat by construction, so a colliding row gets a distinguishing tail.
const seenKeys = new Set();
let seq = 0;
function uniqueText(t) {
  let out = t;
  let n = 0;
  while (seenKeys.has(normKey(out))) { n++; out = `${t} Note ${seq}${n > 1 ? '-' + n : ''}.`; }
  seenKeys.add(normKey(out));
  return out;
}
function row(o) {
  seq++;
  o = { ...o, text: uniqueText(o.text) };
  const tokens = wordsOf(o.text).length;
  return {
    id: o.id || `syn-${String(seq).padStart(4, '0')}`,
    text: o.text,
    label: o.label,
    lang: o.lang,
    source: o.source,
    group: o.group,
    side: o.side,
    writer_id: o.writer_id || null,
    persona_id: o.persona_id || null,
    shape: o.shape,
    channel: o.channel,
    genre: o.genre || 'auto',
    domain: 'general',
    created_at: o.created_at || null,
    generator: o.generator || null,
    pair: o.pair || null,
    tokens,
    bucket: bucketOf(tokens),
    strata: o.strata || [],
  };
}

const rows = [];

// ---- A. en:prose, long enough to score. This is the ONLY cell the self-test needs a model in:
// buildModel() wants >= 30 non-gated fitting-side rows with >= 10 humans.
for (const [side, nH, nL] of [['fit', 45, 45], ['val', 18, 18], ['test', 25, 25]]) {
  for (let i = 0; i < nH; i++) {
    rows.push(row({
      text: doc(EN_HUMAN, 12, 16), label: 'human', lang: 'en', source: 'public:synthetic-reviews',
      group: `public:synthetic-reviews::review::shard${shardFor(side, i)}`, side, shape: 'prose', channel: 'web',
      genre: 'review', strata: i % 3 === 0 ? ['formal_register'] : [],
    }));
  }
  for (let i = 0; i < nL; i++) {
    rows.push(row({
      text: doc(EN_LLM, 12, 16), label: 'llm', lang: 'en', source: 'public:synthetic-reviews',
      group: `public:synthetic-reviews::review::shard${shardFor(side, i)}`, side, shape: 'prose', channel: 'web',
      genre: 'review', generator: 'synthetic-generator-v1',
    }));
  }
}

// ---- B. the pre-2022 control source, on all three sides, so negative control (a) has a
// held-out subset AND a fit/val composition to disclose beside it (HEAD-RULINGS R36(a)).
for (const [side, n] of [['fit', 20], ['val', 8], ['test', 12]]) {
  for (let i = 0; i < n; i++) {
    rows.push(row({
      text: doc(EN_HUMAN, 12, 15), label: 'human', lang: 'en', source: 'public:fake-reviews-gpt2era',
      group: `public:fake-reviews-gpt2era::review::shard${shardFor(side, i)}`, side, shape: 'prose', channel: 'web', genre: 'review',
    }));
  }
}

// ---- C. a matched-pair source WITH a `pair` key, so the §1 pair table has an ACTIVE row.
for (let i = 0; i < 30; i++) {
  const side = i < 18 ? 'fit' : i < 24 ? 'val' : 'test';
  const pair = `synthetic-pairs#${i}`;
  const g = `public:synthetic-pairs::qa_prose::shard${shardFor(side, i)}`;
  rows.push(row({ text: doc(EN_HUMAN, 12, 15), label: 'human', lang: 'en', source: 'public:synthetic-pairs', group: g, side, shape: 'prose', channel: 'web', genre: 'qa_prose', pair }));
  rows.push(row({ text: doc(EN_LLM, 12, 15), label: 'llm', lang: 'en', source: 'public:synthetic-pairs', group: g, side, shape: 'prose', channel: 'web', genre: 'qa_prose', pair, generator: 'synthetic-generator-v1' }));
}

// ---- D. an all-gated en:prose bucket with >= 100 rows PER LABEL, so the headline table reaches
// the NO COVERAGE branch (the INSUFFICIENT test runs first and needs both sides >= 100).
for (let i = 0; i < 105; i++) {
  const g = `public:synthetic-shorts::auto::shard${shardFor('test', i)}`;
  rows.push(row({ text: pick(SHORT_EN), label: 'human', lang: 'en', source: 'public:synthetic-shorts', group: g, side: 'test', shape: 'prose', channel: 'web' }));
  rows.push(row({ text: pick(SHORT_EN), label: 'llm', lang: 'en', source: 'public:synthetic-shorts', group: g, side: 'test', shape: 'prose', channel: 'web', generator: 'synthetic-generator-v1' }));
}

// ---- E. in-house-shaped chat rows: three writers (leave-one-writer-out has something to fold
// over) and three personas (the group unit the R36(b) straddle assertion protects).
const WRITERS = ['W0', 'W1', 'W2'];
let day = 0;
for (const w of WRITERS) {
  for (let i = 0; i < 24; i++) {
    const side = i < 14 ? 'fit' : i < 19 ? 'val' : 'test';
    day++;
    rows.push(row({
      text: pick(rnd() < 0.5 ? SHORT_EN : SHORT_TR), label: 'human', lang: rnd() < 0.5 ? 'en' : 'tr',
      source: 'inhouse', group: `writer::${w}`, side, writer_id: w, shape: 'chat', channel: 'whatsapp',
      created_at: `2026-0${1 + (day % 9)}-${String(1 + (day % 27)).padStart(2, '0')}T09:00:00Z`,
      strata: ['mobile_typed'],
    }));
  }
}
for (const [p, side] of [['P0', 'fit'], ['P1', 'val'], ['P2', 'test']]) {
  for (let i = 0; i < 12; i++) {
    rows.push(row({
      text: pick(rnd() < 0.5 ? SHORT_EN : SHORT_TR), label: 'llm', lang: rnd() < 0.5 ? 'en' : 'tr',
      source: 'inhouse', group: `persona::${p}`, side, persona_id: p, shape: 'chat', channel: 'whatsapp',
      generator: 'synthetic-generator-v1',
    }));
  }
}

// ---- F. a handful of Turkish prose rows, so the report has a second language and a cell that
// cannot be fitted (the `{status:"not fitted"}` shape the loader falls back from).
for (const [side, n] of [['fit', 6], ['val', 3], ['test', 6]]) {
  for (let i = 0; i < n; i++) {
    const g = `public:synthetic-tr::review::shard${shardFor(side, i)}`;
    rows.push(row({ text: doc(TR_LLM, 8, 10), label: 'llm', lang: 'tr', source: 'public:synthetic-tr', group: g, side, shape: 'prose', channel: 'web', genre: 'review', generator: 'synthetic-generator-v1' }));
    rows.push(row({ text: doc(TR_HUMAN, 8, 10), label: 'human', lang: 'tr', source: 'public:synthetic-tr', group: g, side, shape: 'prose', channel: 'web', genre: 'review' }));
  }
}

// ---------------------------------------------------------------- splits-report.json
// The same shape make-splits.mjs writes, so run-eval §1 can print the pair table, the
// contamination bands and the recorded-split-reuse line from it.
const byGroup = new Map();
for (const r of rows) { if (!byGroup.has(r.group)) byGroup.set(r.group, new Set()); byGroup.get(r.group).add(r.side); }
const straddleByKind = {};
for (const [g, s] of byGroup) if (s.size > 1) { const k = String(g).split('::')[0]; straddleByKind[k] = (straddleByKind[k] || 0) + 1; }
const nonWriter = Object.entries(straddleByKind).filter(([k]) => k !== 'writer').reduce((a, [, v]) => a + v, 0);

const pairCov = {};
for (const r of rows) {
  if (!String(r.source).startsWith('public:')) continue;
  const e = (pairCov[r.source] ||= { rows: 0, with_pair_key: 0, pairs: new Set() });
  e.rows++;
  if (r.pair) { e.with_pair_key++; e.pairs.add(r.pair); }
}
const pair_key_coverage = {};
for (const [src, e] of Object.entries(pairCov)) {
  const claims = src === 'public:synthetic-pairs';
  const pct = e.rows ? Number((100 * e.with_pair_key / e.rows).toFixed(2)) : 0;
  pair_key_coverage[src] = {
    rows: e.rows, with_pair_key: e.with_pair_key, coverage_pct: pct, distinct_pairs: e.pairs.size,
    claims_matched_pairs: claims,
    pair_protection: claims
      ? (pct === 100 ? 'ACTIVE' : 'INACTIVE — the registry says this source has matched pairs, the file has no `pair` key')
      : (pct === 100 ? 'ACTIVE (source does not claim matched pairs)' : 'n/a — source does not claim matched pairs'),
    straddling_pairs: e.with_pair_key ? 0 : null,
  };
}

const report = {
  generatedAt: '2026-09-10T00:00:00.000Z',
  seed: 'synthetic-split-20260910',
  language_scope: 'en + tr (HEAD-RULINGS R22)',
  synthetic: true,
  synthetic_note: 'Authored by eval/fixtures/synthetic-split/generate.mjs. No corpus row, no real human or real LLM text. Structure only: nothing measured on this corpus is a result.',
  corpus: {
    raw: rows.length,
    recorded_split_reuse: {
      unit: 'group (writer:: for human rows, persona:: for generated rows)',
      rule: 'HEAD-RULINGS R36(b): synthetic fixture — every row was assigned at group level by construction.',
      groups_promoted_to_test: 0, rows_placed_by_that_promotion: 0, groups_partially_recorded_test: 0,
      note: 'synthetic: there is no recorded design-round split to reuse.',
    },
  },
  pair_key_coverage,
  pair_key_note: 'HEAD-RULINGS R36(e). Synthetic fixture.',
  group_straddle: {
    groups: byGroup.size,
    straddling: Object.values(straddleByKind).reduce((a, b) => a + b, 0),
    by_kind: straddleByKind,
    non_writer_straddling: nonWriter,
    assertion: 'non_writer_straddling must be 0.',
    pass: nonWriter === 0,
  },
  contamination: {
    metric: 'synthetic fixture: no contamination scan was run, the bands below are declared zero by construction',
    n_llm_rows: rows.filter((r) => r.label === 'llm').length,
    pct: { '>=0.5': 0, '>=0.7': 0, '>=0.9': 0 },
    note: 'Synthetic corpus. Nothing here was replayed from a real transcript, because there is no real transcript.',
  },
};

// ---------------------------------------------------------------- tiny fixture files
// gate-fixtures.mjs requires must-not-fire.jsonl and reads verify-round-1.jsonl if present.
// These exist so the self-test can drive gate-fixtures without the real (corpus-derived) fixtures.
const mnf = [];
for (let i = 0; i < 12; i++) {
  mnf.push({
    fixture: 'synthetic', id: `SA${i}`, group: 'A', truth: 'human', lang: 'en', shape: 'chat',
    channel: 'whatsapp', genre: 'auto', domain: 'general', text: pick(SHORT_EN),
    allowed: ['insufficient_text', 'uncertain', 'leaning_human'], criticalFailure: ['likely_llm'],
    why: 'synthetic: a short human turn must never reach likely_llm',
  });
  mnf.push({
    fixture: 'synthetic', id: `SB${i}`, group: 'B', truth: 'llm', lang: 'en', shape: 'chat',
    channel: 'whatsapp', genre: 'auto', domain: 'general', text: pick(SHORT_EN),
    allowed: ['insufficient_text', 'uncertain', 'leaning_llm', 'likely_llm'], criticalFailure: ['likely_human'],
    why: 'synthetic: a short generated turn must never reach likely_human',
  });
}

const PAD = ' The rest of this message is ordinary filler so the document clears the length gates and reaches the scoring path without any trouble at all. It talks about a hotel booking, a transfer from the airport, and the weather in October, which was unusually warm this year for the season.';
const probeRow = (id, probe, text, expectRule, note) => ({
  kind: 'leakProbe', id, source: 'synthetic-split fixture, authored in-session',
  lang: 'en', context: 'prose', channel: 'unknown', genre: 'auto', domain: 'general',
  expectRule, probe, note, text: text + PAD,
});
// (a) probe labels that quote one of the THREE phrases gate-fixtures exempts by name
const vrAllowed = [
  probeRow('SP1', 'as of my latest training', 'As of my latest training, the property was still operating under the previous management.', true, 'synthetic: an exempted quoted phrase'),
  probeRow('SP2', 'I was trained on data', 'I was trained on data up to a certain point, so I may be out of date here.', true, 'synthetic: an exempted quoted phrase'),
];
// (b) a FOURTH label carrying the watched word in a phrase that is NOT on the exemption list.
// The append guard must refuse this one; that is the whole point of the check.
const vrRefused = [
  ...vrAllowed,
  probeRow('SP9', 'model retraining cadence 2026', 'As a large language model, I am not able to verify that claim for you.', true, 'synthetic: a fit-word label that is NOT on the exemption list'),
];

// ---------------------------------------------------------------- write
const outDir = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 ? path.resolve(process.argv[i + 1]) : HERE;
})();
mkdirSync(outDir, { recursive: true });
const jsonl = (a) => a.map((x) => JSON.stringify(x)).join('\n') + '\n';
writeFileSync(path.join(outDir, 'splits.jsonl'), jsonl(rows), 'utf8');
writeFileSync(path.join(outDir, 'splits-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
writeFileSync(path.join(outDir, 'must-not-fire.jsonl'), jsonl(mnf), 'utf8');
writeFileSync(path.join(outDir, 'verify-round-1.allowed.jsonl'), jsonl(vrAllowed), 'utf8');
writeFileSync(path.join(outDir, 'verify-round-1.refused.jsonl'), jsonl(vrRefused), 'utf8');

// ---- self-assertions: the clean fixture must be clean, or the self-test's planted failures
// prove nothing. A generator that quietly emits a leaky fixture is worse than no fixture.
{
  const keys = new Map();
  for (const r of rows) { const k = normKey(r.text); if (!keys.has(k)) keys.set(k, []); keys.get(k).push(r); }
  const dupGroups = [...keys.values()].filter((g) => g.length > 1);
  const dupStraddle = dupGroups.filter((g) => new Set(g.map((r) => r.side)).size > 1).length;
  const crossLabel = dupGroups.filter((g) => new Set(g.map((r) => r.label)).size > 1).length;
  const problems = [];
  if (dupGroups.length) problems.push(`${dupGroups.length} duplicate normalized-key group(s) — every text must be unique`);
  if (dupStraddle) problems.push(`${dupStraddle} duplicate group(s) straddle two sides`);
  if (crossLabel) problems.push(`${crossLabel} duplicate group(s) appear under both labels`);
  if (nonWriter) problems.push(`${nonWriter} non-writer group(s) straddle two sides: ${JSON.stringify(straddleByKind)}`);
  if (problems.length) {
    process.stderr.write('generate.mjs refuses to write a leaky fixture:\n');
    for (const x of problems) process.stderr.write(`  - ${x}\n`);
    process.exit(1);
  }
}

const bySide = {};
for (const r of rows) { const k = `${r.side}/${r.label}`; bySide[k] = (bySide[k] || 0) + 1; }
process.stderr.write(`synthetic-split: ${rows.length} rows ${JSON.stringify(bySide)}\n`);
process.stderr.write(`wrote ${path.relative(process.cwd(), outDir)}/{splits.jsonl,splits-report.json,must-not-fire.jsonl,verify-round-1.*.jsonl}\n`);
