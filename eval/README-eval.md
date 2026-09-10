# eval/ — the harness, the fixtures and the corpus adapter

Nothing in here ships. `stylometry.mjs` never imports from this directory; this is the machinery
that decides whether the numbers it prints are allowed to be believed.

Language scope is **English and Turkish**. Arabic is out (HEAD-RULINGS R22): the Arabic public
sources stay in the registry but are disabled and never fetched, Arabic-script corpus rows are
filtered out by `make-splits.mjs` and counted, and there is no `llm-ar.jsonl`.

## The pipeline

```bash
# 1. optional, network: six public corpora into eval/data/public/ (gitignored)
node eval/fetch-public-datasets.mjs                 # --list, --dry-run, --only, --cap
node eval/fetch-public-datasets.mjs --probe <dataset> [--probe-where <expr>] --probe-out <dir>
#   R42(e): ask datasets-server what a CANDIDATE dataset is — configs, splits, field names and
#   types, row counts, declared licence, low-cardinality column value frequencies, and the LENGTHS
#   of two sample field values. It downloads no row set and prints no text. Results are recorded
#   under "probes" in the manifest; --import-probes folds a scratch probe manifest into the
#   manifest of record.

# 2. dedup, cross-label collisions, group-aware fit/val/test split, contamination scan,
#    and the scrubbed human-chat.jsonl. Reads eval/data/corpus_user_messages.json.
node eval/make-splits.mjs                           # writes eval/data/splits.jsonl (gitignored)

# 3. the report
node eval/run-eval.mjs --quick                      # SMOKE RUN — writes eval/out/quick/ (R26)

# 4. the fixture gate, driven through the shipped CLI rather than through detect()
node eval/gate-fixtures.mjs --out .scratch/<lane>/out --real 20     # while developing
```

### Harness self-test

```bash
node eval/selftest-eval.mjs            # ~6 s, exit 0 on pass, 1 with a FAIL line per failed check
```

`selftest.mjs` at the repo root tests the detector. **This tests the harness that decides whether
the detector's numbers may be believed.** It drives the shipped `run-eval.mjs` and
`gate-fixtures.mjs` over `eval/fixtures/synthetic-split/` — an authored, deterministic corpus with
no corpus row in it — and over deliberately corrupted copies written to a scratch directory, and it
asserts **exit codes and structure only**. It never asserts a rate: nothing measured on synthetic
text says anything about the detector, and a self-test that pinned an AUC here would pin a fiction.

**Eleven green checks prove the guards refuse planted faults; the correctness of the numbers
printed when nothing fires rests on the independent re-derivation of R36, which a fixture
cannot replace.** (R37 wrote "ten"; the eleventh is the R42(e) essay check added with the essay
row set. The sentence R37(c) fixes is otherwise unchanged.)

The synthetic **"human" class is shaped to reach code paths**, not to model human writing: its
sentences are capitalised and terminated so the rows clear gate G4 and a model can be fitted at all
(HEAD-RULINGS R37(d)). An all-lowercase pool left fewer than ten scoreable fitting-side humans and
therefore no fitted cell to validate. Nothing about that class resembles a real writer.

The eleven checks: a clean run exits 0 with sections 1-13 and a fitted-weights file the CLI actually
loads · a planted `persona::` straddle exits 5 naming the group kind · a planted duplicate string on
two sides exits 5 · a planted both-label string on two sides exits 5 and reports the cross-label
count · `headline()` exits 4 for a non-test row, for a test-labelled summary over val-side rows, and
for being handed no rows at all · `emit()` exits 4 on an unmarked fitting-side number and passes the
same line with `(reference only)` · the CAL append guard exempts exactly the three named quoted
probe phrases and refuses a fourth · a fitted-weights file the shipped loader could not read is
never written (exit 6) · two runs are byte-identical apart from the timestamp and the out path ·
`INSUFFICIENT` and `NO COVERAGE` placeholders print the counts and the measured confusion they claim ·
the essay genre's holdout unit is the PROMPT, the essay table measures and refuses on its own
counts, its threshold is re-picked on essay validation rows, and an essay row moved off its
prompt's side exits 5 (R42(e)).

It writes only under `--work` (default `.scratch/selftest-eval/`, removed on success, kept with
`--keep`). It never reads `eval/data/` and never touches `eval/out/`.

### Regenerating the release report

```bash
node selftest.mjs && node eval/selftest-eval.mjs \
  && node eval/run-eval.mjs \
  && node eval/gate-fixtures.mjs --real 200 --append eval/out/REPORT.md
```

That is the whole sequence (HEAD-RULINGS R37(a)), and its last two commands are the only things that
may write `eval/out/REPORT.md`. The detector's own selftest runs first, then the harness self-test:
a harness whose guards do not fire has no business publishing a number. **Ten green checks prove the guards refuse planted faults; the correctness of the numbers printed when nothing fires rests on the independent re-derivation of R36, which a fixture cannot replace.**

- **`--quick` never writes there.** A smoke run subsamples the rows, and a subsampled run overwrote
  the release `REPORT.md` and `weights.fitted.json` once this round. `--quick` now defaults its
  output to `eval/out/quick/` unless `--out` is given (HEAD-RULINGS R26), and says so on stderr.
- **`gate-fixtures.mjs --out` is a DIRECTORY** (default `eval/out`), holding `gate-fixtures.json`
  and `gate-fixtures.md`; `--json <path>` and `--md <path>` override the individual files. Point
  `--out` at a scratch directory while developing.
- **`eval/out/REPORT.md` is machine-generated only.** Nothing hand-written survives a regeneration.
  Findings — defects, network wedges, head rulings — live in the "Findings log" at the bottom of
  *this* file, which no command overwrites.
- **`run-eval.mjs` exits non-zero rather than publish numbers measured on a leaked split.** Exit 5
  when a non-`writer::` group straddles two sides (only human writers may, and only because they
  are split chronologically inside a writer); exit 6 when the `weights.fitted.json` it just built
  does not satisfy the shipped loader's own `validateWeightsShape()`; exit 4 for the honesty guard;
  exit 2 for a missing input. `gate-fixtures.mjs` exits 4 rather than append a section that trips
  the same lexical guard (HEAD-RULINGS R36).
- **`node eval/fetch-public-datasets.mjs` has no `timeout` on macOS.** `timeout(1)` is not installed;
  run it under a shell watchdog instead:
  `node eval/fetch-public-datasets.mjs --only <name> & p=$!; (sleep 900; kill -9 $p) & wait $p`.

`run-eval.mjs` imports `detect()` from `../stylometry.mjs`. Point it elsewhere with
`--detector <path>` — that is how the harness was developed before the core existed.

## Why the split sides are called fit / val / test

Because SPEC §D.5 step 8 says a fit-side number may appear only on a line literally marked
`(reference only)`, and it says the harness must **refuse in code** rather than by convention.
`run-eval.mjs` routes every line it prints — terminal and `REPORT.md` alike — through `emit()`,
which exits with code 4 if a line names a fitting-side number without that marker, and
`headline()` exits with code 4 if it is handed a row that was not measured on the test side.
Naming the side "fit" keeps that guard from tripping over the harness's own prose.

## What each file is

| file | what it does |
|---|---|
| `fetch-public-datasets.mjs` | The only file in the project that touches the network, and only `datasets-server.huggingface.co` (plus one documented Zenodo attempt, gated behind `--include-arabic`, which R22 leaves off). Caps at 1500 rows per label per dataset, pages `/rows` at 100, retries with Retry-After-aware backoff on 500/429, writes a manifest with per-file sha256, licence, cap, actual counts and the sampling strategy. A 500 from this API means "the index is loading", not "the dataset is gone". `--probe` (R42(e)) describes a CANDIDATE dataset — configs, splits, fields, row counts, licence, low-cardinality column frequencies and two rows' field-value LENGTHS — without downloading a row set or printing any text; `--probe-where` counts a slice through `/filter`; `--import-probes` folds a scratch probe manifest into the manifest of record. A source may declare `locate` (find a labelled block by paging metadata when `/filter` is unavailable), `crossCheck` (a second, data-side statement of the label mapping that fails the whole source on a contradiction), `promptKey` and `noPairKey`. |
| `make-splits.mjs` | SPEC §D.5 steps 1-3. Normalized-key dedup; cross-label strings forced to one side; group-aware split (writer for humans, persona for generated personas, source row / template family for public corpora, and the ESSAY PROMPT where a source ships one — R42(e), `shardKeyOf` = prompt → pair → normalised text); pair- and prompt-coverage tables with their straddle counts; Arabic-script exclusion with counts; near-duplicate contamination scan; the R8 scrub. |
| `gate-fixtures.mjs` | The CAL lane's gate. Runs the SHIPPED CLI over `must-not-fire.jsonl` (SPEC §I gate), the 50 authored LLM rows (§F.3 verdicts and the humanization delta), the 30 support-desk snippets at both `--domain` settings, a deterministic sample of real corpus messages, and `verify-round-1.jsonl` (R33). Sections A, B, C and E run **one process per row with that row's own flags**; section D is **one shared `--jsonl` batch** with `--channel whatsapp`, and the header now says so (R36(h)). Exits 3 if the §I gate or either R33 gate line fails, 4 if the section it would append to `REPORT.md` trips the honesty guard; a row outside its `allowed` set is reported as arbitration, never silently fixed. `--out` is a directory (default `eval/out`). It fits nothing and never touches the network. |
| `run-eval.mjs` | SPEC §D.5 steps 4-10 and the §G.1 tables. Hand-rolled logistic regression, PAVA isotonic calibration, rank AUC, ECE, fairness-limited threshold, hard mode, leave-one-writer-out, negative controls (a)-(e), base-rate table. Section 3b (R42(e)) restricts the §G.1 table to `genre = essay` rows, re-picks the fairness-limited threshold on the essay validation side, prints hard mode beside it, and carries the essay base rates, the essay negative control and the unmeasured-stratum statement. |
| `adapters/supabase-messages.cjs` | Optional. Rebuilds `corpus_user_messages.json` from a Supabase message table. Not zero-dependency and not in `package.json` — see below. |
| `fixtures/*.jsonl` | Committed. See the table further down. |
| `selftest-eval.mjs` | The harness self-test — see "Harness self-test" above, and step 3 of the release sequence (R37(a)). Drives the shipped harness over a synthetic corpus and asserts the refusals it documents. Zero dependency, ~6 s, default work dir `.scratch/selftest-eval/`. Eleven green checks (R37's ten plus the R42(e) essay check) prove the guards refuse planted faults; the correctness of the numbers printed when nothing fires rests on the independent re-derivation of R36, which a fixture cannot replace. |
| `fixtures/synthetic-split/` | The authored corpus the self-test corrupts, plus its generator. No corpus row, no real text, no result. See its own `README.md`. |
| `data/` | Gitignored. Real chat messages live here. Never commit anything from it. |
| `out/` | Where the release `REPORT.md` and `weights.fitted.json` land. `out/quick/` is where `--quick` lands (R26). |

## The corpus adapter

```bash
NODE_PATH=/path/to/node_modules node eval/adapters/supabase-messages.cjs \
  --env <path to a .env with SUPABASE_URL and SUPABASE_SERVICE_KEY> \
  --human-ids <comma list of sender ids that are known humans> \
  --out eval/data --dry-run
```

`dotenv` and `@supabase/supabase-js` are resolved through `NODE_PATH` on purpose: the shipped
tool has no dependencies and this adapter is not going to be the reason it acquires two. If they
cannot be resolved the script prints one line saying how to point `NODE_PATH` at them and exits 2.

It **never writes a sender id**. Humans become `R0..Rn` by their position in `--human-ids`;
everyone else becomes `persona_id = "p" + sha256(salt + id).slice(0,12)`. The output directory is
checked with `git check-ignore -q` and the script exits 2 if it is not ignored. A real pull needs
`--i-have-approval` and prints "this performs a database read" first; `--dry-run` counts only.

Exit codes: 0 ok, 1 usage, 2 precondition (missing env file, unresolvable modules, output
directory not ignored), 3 refused for want of `--i-have-approval`.

## Fixtures (committed)

| file | rows | what it asserts |
|---|---:|---|
| `must-not-fire.jsonl` | 24 | D1 §7. 12 human-that-looks-LLM rows that must never come out `likely_llm`, 12 LLM-that-looks-human rows that must never come out `likely_human`, with at least 6 of those 12 abstaining. Each row carries an `allowed` verdict set and a `criticalFailure` set. |
| `judge-tests.jsonl` | 14 | D2 §5. Each row carries `expectedFinal` and `criticalFailure` for the agent's final verdict, plus the trap it sets. **No script reads this file** — it is driven by hand through the installed agent. `T14` carries `requiresEvalData: true`: it needs the gitignored `eval/data/human-chat.jsonl`, and any script that ever iterates this fixture MUST SKIP such rows and print a line saying it did (HEAD-RULINGS R39(d)). |
| `llm-en.jsonl` / `llm-tr.jsonl` | 25 each | SPEC §F.3. 15 clean + 10 humanized per language, in the genre mix §F.3 specifies, with `gen`, `prompt`, `postprocess` and `transform` per row. |
| `cs-snippets.jsonl` | 30 | HEAD-RULINGS R7. Human support-desk phrasing, 15 en / 15 tr, used as negative control (e). |
| `verify-round-1.jsonl` | 83 | HEAD-RULINGS R33. The verify round's 43 authored texts (35 human, 8 LLM) and 40 assistant-frame-leak probes. Schema below. |
| `verify-round-2.jsonl` | 117 | HEAD-RULINGS R38. Round two against the FIXED core: 76 single-document rows, 37 leak probes and 4 aggregate senders. Same schema as round one plus `expectRules`, `expectWarning` / `expectNotWarning`, `expectLang`, `expectUniqueNotes`, and a `kind: "aggregate"` row carrying a `messages[]` array. |

### `verify-round-1.jsonl` — schema

Two row kinds share the file; `kind` says which.

**`kind: "text"`** — one of the refuter's authored documents, copied verbatim.

| field | meaning |
|---|---|
| `id` | `H01`–`H35` (human) or `L01`–`L08` (LLM). |
| `source` | `"verify-round-1 refuter, authored in-session, 2026-09-09"`. Every row was written in this session. **No corpus row is in this file**, so R8's writer-R0 rule does not apply to it. |
| `class` | the failure class the text was built to provoke, with its SPEC §H reference. |
| `truth` | `human` \| `llm`. The 8 LLM rows are Claude-written text, which HEAD-RULINGS R10 counts as LLM text. |
| `lang`, `context`, `channel`, `genre`, `domain` | the flags the row is run with — the same ones the refuter used. `channel: "unknown"` and `genre: "auto"` mean the refuter passed no such flag. |
| `markers` | `null`, or `"test"` on the three rows that need a configured machine marker. |
| `requiresMarkers` | present only when `markers` is `"test"`: the array `markers.json` would hold. The gate writes it to a temporary file and passes `--markers`; the shipped `markers.json` stays `[]` (R17). |
| `allowed` | verdicts this row may produce. Human rows: `insufficient_text \| uncertain \| leaning_human`. `H03`/`H04` additionally allow `leaning_llm` — that is the known §G.2 ESL-connector confound and it is documented, not asserted away. Marker rows carry their **with-markers** set (`H17`/`H20`: `likely_llm \| uncertain`; `H19`: `uncertain \| leaning_human`, per R28); their without-markers expectation is the plain human set and is stated in `note`. LLM rows allow everything except `likely_human`. |
| `criticalFailure` | verdicts that are a gate failure. `likely_llm` on a human row; `likely_human` on an LLM row. `H17`/`H20` are the exception — machine-written templates with no human turn, where a marker-driven `likely_llm` is correct — so their critical value is `likely_human`. |
| `expected_evasion` | `true` on `L07`/`L08`: these are *expected* to escape. They document the mimicry cost, they do not assert a fix. |
| `note` | why the row exists, and which ruling covers it. |
| `text` | the document, verbatim. |

**`kind: "leakProbe"`** — one assistant-frame-leak probe.

| field | meaning |
|---|---|
| `id` | `P01`–`P30` (must fire) or `N01`–`N10` (must not). |
| `probe` | what the probe varies. |
| `expectRule` | `true` if `rules[]` must contain `assistant_frame_leak`, `false` if it must not. |
| `note` | the R27 clause or refuter defect it comes from. |
| `text` | the phrase plus a fixed filler so the document clears the length gates. |

The 30 positives are the refuter's `leakprobe.mjs` list (19 of them were misses before R27). The 10
negatives are the precision side: the three shapes that made the rule accuse a human (defects
D1–D3), the quotation-suppression cases that already worked and must keep working, and the two
Turkish cue spellings. **A false fire counts differently from a miss and the gate reports them
separately** — a miss is lost recall, a false fire is an accusation.

`gate-fixtures.mjs` section CAL-E runs the file and adds two gate lines (R33): zero `likely_llm` on
the human rows that name it critical, and every `expectRule` row correct. Either failing exits 3.

### `verify-round-2.jsonl` — what round two adds

Same two row kinds plus a third, and four new expectation fields. CAL-F runs it and adds a **third**
gate line: every `expectLang` row correct.

| field | meaning |
|---|---|
| `expectRules` | a list of rule names (`assistant_frame_leak`, `known_machine_marker`) that must all appear in `rules[]`. Round one only ever asked about the leak rule; the homoglyph rows ask about the marker rule too. |
| `expectWarning` / `expectNotWarning` | warnings that must, or must not, be present. `expectNotWarning` is how the aggregate rows assert R38(e): the aggregate must **not** inherit `register_only_evidence` from the per-document base pass it threw away. |
| `expectLang` | the values `language.primary` may take. R38(h)'s rows live here: French, Italian, Spanish, Azerbaijani and Turkmen must not come back `tr`. |
| `expectUniqueNotes` | the report's `notes[]` must contain no duplicate — R38(e) again, where an aggregate printed the R28 note twice because both passes emitted it and only `warnings` was de-duplicated. |
| `kind: "aggregate"` | the row carries `messages[]` (`{id, sender, text}`) instead of `text`; the gate writes them to a temporary file and drives `--aggregate`, which is a different code path from `--text` and the only one R29 and R38(e) are about. |

Rows the head has accepted as costs rather than defects carry it in `note` and in their expectations:
`N11`/`N12`/`N18` are `expectRule: false` because an assistant that also mentions "the bot" elsewhere
stays suppressed; `B**x1`/`x2`/`x3` carry `expected_evasion: true` for the R24 chat-recall ladder;
`D02` records the spelling-driven R28 demotion. **A cost written into a fixture as an expectation is
still a cost — it is recorded so it cannot later be mistaken for a bug, not asserted away.**

### Arabic rows, and what replaced them

R22 removes Arabic from the project after the fixtures were specified. Rather than shrink the
acceptance gate from 12+12 to 9+10, each Arabic row was **replaced by an EN or TR row that sets
the same trap**, and every replacement names what it stands in for in its `replaces` field:

| dropped | replaced by | the trap that had to survive |
|---|---|---|
| `A4` Arabic MSA journalist prose | EN prose, a careful writer in the standard register of the genre | "correct, standard register carries zero evidence" |
| `A7` Arabic formal MSA chat | TR chat, formal and correct, long enough to clear the gate | "correct orthography earns zero" |
| `A8` Arabic vocalized quotation | EN review quoting the hotel's own marketing copy | "pasted material is not the sender's style" |
| `B3` Arabic dialect on demand | TR chat slang produced on demand | "a register is promptable" |
| `B11` Arabizi on demand | EN chat elongation + emoticons produced on demand | "the highest-precision human marker has no robustness to a prompt" |
| `T01` Arabic dialect floor test | corpus R0 message, 5 words with a real typo | "below the floor is below the floor, however obvious the tells" |
| `T05` Arabic markdown guest list | corpus R0 message: numbered list, em dashes, flawless orthography | the hardest case: a real customer who plausibly used an assistant |
| `T06` product bot output pasted by a user | a generic bot confirmation with a placeholder marker | "the text is machine-written, the sender is a person" |
| `T10` Arabic MSA business email | TR formal business email | "these formulae are older than any language model" |
| `T11` Arabic humanized LLM | TR assistant prose with one chat word painted on | "one casual word is a costume, not a register" |

`T06` also had to lose its product-specific marker: `markers.json` ships empty (R17), so the row
carries a `requiresMarkers` field with a **placeholder** marker and reference format, and the
`known_machine_marker` rule does not fire on it unless you pass `--markers` explicitly.

### PII in committed fixtures (R8)

Corpus-derived rows are allowed **only** from writer R0, the repository owner's own messages.
`judge-tests.jsonl` rows `T01`, `T02`, `T04`, `T05` and `T12` are R0 messages; each says so in
its `source` field and states what the scrub changed. `T12` had three guest names replaced with
`[NAME]`. Everything else in the fixtures was written in-session.

`human-chat.jsonl` is **not committed**. `make-splits.mjs` regenerates it under `eval/data/` at
eval time with a deny-by-default scrub: a token prints only if it is on the allowlist (cities,
hotel-catalogue words, months, weekdays, room types, booking vocabulary), is a stopword, is a
number, or appears in 15 or more distinct corpus messages. Anything after an explicit name cue
(`isim`, `adı`, `names`) is always `[NAME]`. Some innocent rare words print as `[NAME]`; that is
the correct direction to err.

## What the harness refuses to do

- Quote an accuracy computed on a stream where the same string appears on both sides of the
  split. Section 1 of the report prints the residual duplicate count and the straddle count.
- Print a number in a headline table for a cell with fewer than 100 documents on either side.
  It prints `INSUFFICIENT — placeholder, not a measurement` instead.
- Print a rate for a bucket where every row was gated. It prints `NO COVERAGE` and the counts.
- Print an accuracy without the coverage that produced it: `insufficient_text` is a deliverable,
  and the gate rate per cell is section 2 of the report, before any accuracy appears.
- Flip a fitted coefficient whose sign disagrees with the design. It flags it (section 6).
- Claim negative controls (b) and (c) were run. They were not, and the report says why:
  no labelled human-translated corpus, and no machine translation without a paid API.

## Known limitations of this harness

- **Three humans.** The human side of the in-house corpus is R0, R1 and R2. Leave-one-writer-out
  over three writers, two of whom write mostly in a script this build excludes, is a weak test,
  and the report prints the surviving counts rather than a comfortable rate.
- **The chat cells barely have a model.** Over 90% of real chat messages are below the length
  floor, so the fitting side of `en:chat` and `tr:chat` can be too thin to fit anything. That is
  the product, not a harness bug, and the report says so per cell instead of inventing a number.
- **Turkish is one genre.** The only labelled Turkish resource is 1,000 GPT-4 hotel reviews and
  their human counterparts. Every Turkish number is measured on hotel reviews.
- **Most public splits are stratified by a text-hash shard**, not by a prompt template, because
  the templates are not visible in the released data. Near-duplicates cannot straddle the split
  (they share a normalized key and therefore a shard), but genuine template siblings that differ
  in wording can, and that is an upward bias on every public-corpus number here. The one
  exception is the essay source, which ships the assignment prompt: there the holdout unit is the
  PROMPT (R42(e)), and section 1 of `REPORT.md` prints the coverage and the straddle count.
- **The essay genre is one corpus, one unnamed generator family, and no language-background
  labels.** See "Essay genre (R42(e))" below before quoting any essay number.

## Essay genre (R42(e))

The owner's platform receives **student essays**. Every English number this project had before this
round was measured on product reviews and QA answers, so R42(e) asked for the best fetchable
human-essay vs LLM-essay resource, a split by essay prompt, and an `en:prose` essay row with hard
mode beside it. This section is what that produced, including the parts that failed.

### The probe mode

`fetch-public-datasets.mjs --probe <dataset>` asks `datasets-server.huggingface.co` what a
candidate dataset **is**, and downloads no row set:

* `/splits` — configs and splits, and the 401 that means "gated or gone";
* `/info` — declared licence, per-split row counts, download size, the field schema;
* `/statistics` — per column: for a LOW-cardinality column the value frequencies (this is how
  "does this corpus have an essay domain, and what is the label column called" gets answered), for
  a free-text column a character-length summary and never the values;
* `/rows?length=2` — two rows, described as `field=type/length`. **A probe never prints a text
  value.** `--probe-where` counts a labelled slice through `/filter` instead.

Every probe is recorded in `eval/data/public/manifest.json` under `probes` (45 records, 41 distinct
datasets: 21 in the essay-source round, 20 in the non-native round below). `--import-probes` folds a scratch probe manifest into the manifest of record, so probing
can be done in `.scratch/` and imported rather than re-run against the release directory.

**Licences are a known gap in this route.** `datasets-server /info` declared a licence for *none*
of the twenty-one datasets probed — the licence lives on the dataset card, on `huggingface.co`, which
this project does not fetch. Where a licence is stated in the registry it is either carried over
from `docs/design/R1-research.md` (which read the cards in the design round) or marked **UNDECLARED**.
No public row is committed, so this bounds redistribution, not measurement.

### What was probed, and what happened

| dataset | status | why it is in or out |
|---|---|---|
| `dmitva/human_ai_generated_text` | **REGISTERED** as `essays-en-pairs` | 1,000,000 rows; `human_text` / `ai_text` / `instructions` parallel on one row. School-assignment essays, both labels in one dataset, original capitalisation and punctuation, and a shared prompt. |
| `Jinyan1/COLING_2025_MGT_en` | fetchable, **rejected on balance** | `sub_source = outfox` is 43,135 genuine school essays with 11 named modern generators and correct orthography, and its model-vs-label cross-check passed on all 424 rows pulled. But `/filter` answers 502/503/timeout for this dataset, the slice is uniformly interleaved (5 of 81 evenly spaced probes hit it; 424 of 6,000 rows examined = 7.07%, the slice's own share), and only **5.4% of the slice is human** (23 of 424). Reaching 500 human essays needs ~130,000 rows ≈ 220 MB, against R9's 60 MB. Kept in the registry, disabled, with the reason. |
| `andythetechnerd03/AI-human-text` | fetchable, **rejected on form** | 462,873 rows, both labels, right genre — and **both halves are lower-cased with punctuation stripped** (0 of 150 human rows in a verification pull carried a capital or a terminal stop). Every orthography feature would be measuring the corpus builder's normaliser and the segmenter would see one unbounded sentence. Kept in the registry, disabled, with the reason. |
| `SJTU-CL/ArguGPT` | fetchable, not registered | 3,338 essays with `prompt_id`, `exam_type` (gre / toefl / weccl) and 7 generators — but **machine-only**: all 3,338 rows carry a model. Pairing its machine half with another corpus's human half would make the essay cell a source classifier. The best candidate for a future round if a licensed learner-essay human half arrives. |
| `liamdugan/raid` | fetchable, not on task | 2.27M rows, but `domain` is `news` / `poetry` / `abstracts` / `books`. No student essays. |
| `artem9k/ai-text-detection-pile` | fetchable, not on task | 1.39M rows, `source` = `human` or a model name, no genre column; its human head is IvyPanda essays but nothing in the schema separates essays from the rest. |
| `qwedsacf/ivypanda-essays` (128,293), `nid989/EssayFroum-Dataset` (25,571) | fetchable, **human-only** | Essays with no machine half. Usable only by pairing across corpora, which is the confound above. |
| `Ateeqq/AI-and-Human-Generated-Text` | fetchable, not on task | `title` + `abstract` + `label`: academic abstracts, not essays. |
| `Hello-SimpleAI/HC3` | already pulled | QA prose, not essays. |
| `thedrcat/daigt-v2-train-dataset`, `thedrcat/daigt-v4-train-dataset`, `PJMixers/thedrcat_daigt-v2-train-dataset`, `nbroad/persuade_corpus_2.0` (and its `persaude` misspelling), `tasksource/persuade`, `ryuryukke/OUTFOX` (both cases), `MBZUAI-NLP/M4GT-Bench`, `NicolaiSivesind/human-vs-machine` | **HTTP 401** | Gated or gone: "does not exist, or is not accessible without authentication". The DAIGT mirrors and every PERSUADE mirror probed are in this row — which is why the ELL / non-native stratum below is unmeasured. |
| `yaful/DeepfakeTextDetect` | **HTTP 404** | "The dataset has been renamed." Its current name, `yaful/MAGE`, is already registered. |

### The registered essay source

`essays-en-pairs` = `dmitva/human_ai_generated_text`, **licence UNDECLARED through the permitted
host** (no row of it is committed). Pulled under the R9 caps: **1,500 human + 1,500 machine essays**
from 1,500 source rows (15 pages, 6.2 MB), sha256 in the manifest. Human essays run ~424 words at
the median, machine essays ~197 — **the two halves are not the same length**, which is why every
essay number is reported per length bucket and never pooled.

What the pull verified, and what it cannot: datasets-server proves the slice exists, its size, its
balance and its text lengths. The *genre* was verified by inspecting a 150-pair verification pull
locally (school-assignment prompts, human rows carrying capitals, terminal punctuation and student
misspellings) — nothing about the writers, their age or their language background is established,
and the corpus names no generator, so `modelFamiliesCovered` records one unspecified family.

### How the prompt split works

`make-splits.mjs` shards a public row on the first key it has: **prompt → pair → normalised text**
(`shardKeyOf`). The shard fixes the side and is part of the group string, so every essay answering
one prompt lands on one side, human and machine alike; a machine essay is never scored against a
model fitted on the human answer to its own prompt. Measured on this pull: **3,000 rows, 100%
prompt coverage, 1,206 distinct prompts, median 2 essays per prompt (max 4), 1,206 prompts carrying
both labels, 0 prompts straddling two sides** — printed in section 1 of `REPORT.md` beside the pair
table, and 0 non-writer group straddles overall. Sources with no prompt key are unaffected: their
shard is exactly what it was before this ruling.

### The essay numbers (TEST side, `eval/out/REPORT.md` §3b)

| cell | bucket | n_human | n_llm | AUC | AUC hard | ECE | FPR@t | TPR@t | TPR@t hard | precision@t |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| en:prose essay | 150–499 tok | 224 | 248 | 0.936 | **0.967** | 0.121 | 0.4% | 26.2% | 43.5% | 0.985 |
| en:prose essay | 50–149 tok | 6 | 77 | INSUFFICIENT (n<100 per side) | | | | | | |
| en:prose essay | 500+ tok | 95 | 0 | INSUFFICIENT (n<100 per side) | | | | | | |

`t_essay` = 0.911, re-picked on the essay rows' own validation side under the same fairness limit
(≤2% FPR on every binding stratum); the cell-wide t is 0.909, close enough that the two tables
barely differ this round — a property of this corpus, not a guarantee. Coverage: **28.4% of essay
rows are gated** (`insufficient_text`) and count as documents that never fire. Base rates for that
row: **P@50% 0.983 · P@20% 0.936 · P@10% 0.867 · P@5% 0.756 · P@2% 0.545 · P@1% 0.372.**
Negative control, essay flavour: **1 of 325 human essays flagged at t on TEST (0.3%)**; in the
measurable bucket, 1 of 224 (0.4%), with 19 of those 224 gated.

**And none of that is what the platform sees** — the shipped CLI's label-level rates on these same
rows are in CAL-G of `eval/out/REPORT.md` and in finding E15 below: **2 of 325 human essays flagged
(0.6%) and 21 of 325 machine essays caught (6.5%; 14.1% of the ones that got a judgement)**. The
fitted row above is what a fitted model can rank; CAL-G is what the product says.

Read alongside:
- **Hard mode is HIGHER than standard here (0.967 vs 0.936)** — the only cell in this project where
  deleting every orthography and format feature *helps*. Both halves of this corpus are clean,
  capitalised, terminated prose, so the format features carry no signal and cost the fit; what
  separates the classes is rhythm and connectives. It also means the essay signal is **not** the
  spelling signal, which is the one piece of good news in this section.
- **The three-humans caveat still applies to everything else in the report**, and a fourth caveat
  applies here: these essay writers are an unknown number of unknown students, and the threshold is
  still fitted over a corpus whose in-house human side is three people.
- **The non-native stratum is UNMEASURED, after a dedicated search.** See "The non-native / ELL
  stratum: searched for, not found" below — 41 datasets probed, none with a fetchable L1 or
  proficiency column. The literature puts vendor-default false-flag rates on non-native essays at
  up to 61% (R1 §3); this release does not measure it and **nothing here licenses an estimate of
  it**. Negative control (f) is absent, not passed.
- **Not exam answers.** These are take-home-shaped school essays. No exam-answer corpus was
  fetchable at all, so the other half of the owner's product (R42) is unmeasured.
- **One generator family, unnamed.** No per-generator recall, and no claim about any 2025-2026 model.
- **A precision of 0.985 is measured at this corpus's own prior** (≈53% machine in that bucket).
  The base-rate row above is the one to quote at a school's real prior, which nobody has measured.

### The non-native / ELL stratum: searched for, not found

Measuring a false-flag rate needs **human essays only** — no machine half — so the search was for a
fetchable, unauthenticated corpus of English-learner essays carrying an **L1 or proficiency**
column. Twenty further probes, one attempt each, no row set downloaded:

| candidate | result |
|---|---|
| `matejklemen/wi_locness` (W&I+LOCNESS: learner essays with CEFR A/B/C levels plus native LOCNESS essays — exactly the right shape) | **HTTP 501** — "the dataset viewer doesn't support this dataset because it runs arbitrary Python code". It exists and is the best candidate anywhere; it is not reachable through `/rows`. Three mirror names tried (`wi_locness`, `pszemraj/…`, `Rosenberg/…`): 404 / 401 / 401. |
| ELLIPSE / Feedback-Prize-ELL mirrors: `nbroad/feedback-prize-ell`, `tasksource/ellipse`, `ELLIPSE` | HTTP 401 |
| PERSUADE mirrors (carry `ell_status`): `LearningAgencyLab/persuade`, `learning-agency-lab/persuade-corpus-2.0`, `argilla/persuade`, plus round one's `nbroad/persuade_corpus_2.0`, `nbroad/persaude_corpus_2.0`, `tasksource/persuade` | HTTP 401, every one |
| `toefl11`, `tasksource/toefl11`, `icnale`, `efcamdat`, `fce`, `lang8` | HTTP 401 |
| `jfleg`, `nyu-mll/jfleg` | 404 renamed / 401 |
| `jhu-clsp/jfleg` | **fetchable and useless for this**: 755 single SENTENCES (median 84 characters), fields `sentence` + `corrections`, no L1 and no proficiency column. Below the tool's own length floor and not a stratum. |
| `SJTU-CL/ArguGPT` (round one), `SJTU-CL/ArguGPT-sent` | fetchable / 401 — and ArguGPT's `exam_type` (gre / toefl / weccl) labels **machine** essays imitating learner corpora, not learner writing. All 3,338 rows carry a model. |

**Result: nothing was registered, no `control` side was added to `make-splits.mjs`, and negative
control (f) is not implemented.** Writing the plumbing for a corpus that does not exist would be a
switch nobody can turn on; the report says the stratum is unmeasured and names what was tried. The
paths back in, for the head: an authenticated HF pull (outside this project's unauthenticated rule,
not outside its zero-spend rule), the parquet branch of `matejklemen/wi_locness` if someone converts
it, or an owner-supplied set of real non-native student essays, which is the only source that would
also match the platform's own population.

### What the essay rows did to the numbers that were already there

The essay rows join the **fitting** side like any other public source (R42(e)), so the `en:prose`
cell is now fitted and thresholded over a row set that is ~20% essays, and section 3 moved:

| cell / bucket | before the essay rows | after them | after R49's split fixes |
|---|---|---|---|
| en:prose 150–499 AUC / hard | 0.884 / 0.857 | 0.878 / 0.859 | 0.891 / 0.874 |
| en:prose 150–499 FPR@t / TPR@t | 7.6% / 65.0% | 2.5% / 32.5% | **1.2% / 29.7%** |
| en:prose 50–149 AUC / hard | 0.739 / 0.623 | 0.752 / 0.672 | 0.726 / 0.661 |
| en:prose 50–149 FPR@t / TPR@t | 1.1% / 3.7% | 0.8% / 2.8% | 0.3% / 2.1% |
| en:prose essay 150–499 AUC / hard | — | 0.935 / 0.964 | 0.936 / 0.967 |
| en:prose essay 150–499 FPR@t / TPR@t | — | 0.4% / 28.2% | 0.4% / 26.2% |

Ranking barely moved; the **operating point** moved a lot, because t is picked on a validation side
that now contains 522 essay rows. Recall more than halved and the false-flag rate fell by six
sevenths. Neither number is better or worse than the other — they are two points on a curve whose
shape the essay rows changed. Nothing about how the cells are fitted or reported was altered to
produce this. The third column adds R49's split fixes (the recovered MAiDE-up pair key and the
dropped row-id keys), which moved the test set again: read the third column, and read nothing from
the first two except that a threshold is not a property of a detector.


---

# Findings log

`eval/out/REPORT.md` is regenerated from scratch by a command; anything written by hand there is
lost on the next run. This section is the hand-written record, and no command writes to it. Each
entry names what was measured, one line of repro or a pointer, and the ruling that resolved it.

## CAL lane

**E3 — the public-dataset re-pull wedged on a kept-alive socket, four times.**
`node eval/fetch-public-datasets.mjs` succeeded once and then hung on four consecutive re-pulls,
each time on an open, idle connection to `datasets-server.huggingface.co` rather than on a refused
or reset one. The most likely explanation is a per-client rate limit that stops answering instead of
returning 429; **the root cause was not identified**. A 30-second `AbortController` timeout was added
so the process now fails instead of hanging, but that is a symptom fix. **Run the fetcher under an
external watchdog** (`timeout 900 node eval/fetch-public-datasets.mjs`) and do not assume a second
pull will work. **The data of record is the first pull**, whose per-file sha256 sums are in
`eval/data/public/manifest.json` and were verified. No ruling number: this is an operational note,
not a design question.

**E6 — an LLM imitating a telegraphic Turkish writer reaches `leaning_human` at 33 tokens.**
The mimicry transform (d) produced two 33-token Turkish WhatsApp messages with **human channel 0.84
and LLM channel exactly 0.000** — not one LLM-direction feature fired. The four human features it
bought (`human_lexicon`, `tr_chat_morphology`, `tr_asciified_probe`, `all_lowercase`) are a slang
list and a keyboard setting. Reproduce with fixture `tr-wa-8` in `llm-tr.jsonl`, or rows `L07`/`L08`
of `verify-round-1.jsonl`:
`node eval/gate-fixtures.mjs --out .scratch/tmp --real 0` and read CAL-E.
Consequence: **human markers are promptable**, so the human side of the instrument is no harder to
forge than the LLM side. Recorded in README §"Ways this detector will be confidently wrong" #8;
`expected_evasion: true` on both rows so the gate documents it instead of asserting a fix.

**E7 — the G4 dead band: prose between 50 and about 120 tokens abstains.**
34 of the 50 authored LLM fixtures (90–110-token prose) returned `insufficient_text` with G1–G3
passed and `too_few_active_features`, because the rhythm features switch on at 120–250 tokens. The
measured `en:prose` 50–149 bucket says the instrument is barely useful there anyway (AUC 0.739, hard
mode 0.623, TPR 3.7% at 1.1% FPR). **Ruling: HEAD-RULINGS R25** — G4 stays where it is; the band is
documented as abstaining, and the ten prose humanization pairs (five per language) were rewritten at 160–260 tokens on
both sides so the §F.3 collapse assertion became measurable. Measured effect: evaluable prose pairs
went from **1 of 10 to 7 of 10** (total evaluable pairs 3 → 9). Read the `**R25 check**` line in
CAL-B of `gate-fixtures.md`.

**E8 — the shipped segmenter and `Intl.Segmenter` disagree on sentence count for 32.8% of 500
documents**, mean |Δ| 0.75 sentences. Every rhythm feature (`sentence_len_cv`,
`sentence_len_mode_mass`, `paragraph_uniformity`) is computed over that count, so a third of
documents carry a rhythm value that a different, equally defensible segmenter would not produce.
The tool ships its own segmenter on purpose (`Intl.Segmenter` is locale-dependent and would break
determinism across ICU versions), so this is a *measurement of the uncertainty*, not a defect to
fix. It is why `segmentation_suspect` exists. Repro: section 8 of `eval/out/REPORT.md`.

## Essay lane (R42(e))

**E9 — twenty-one datasets probed, three essay corpora fetchable, one usable.** `--probe` (new this
round) reached 21 datasets without downloading a row set. Nine answered **HTTP 401** — every DAIGT
mirror and every PERSUADE mirror tried, which is also why the ELL stratum is unmeasured. Of the
three fetchable school-essay corpora, one is lower-cased and de-punctuated on both halves
(`andythetechnerd03/AI-human-text`), one is 5% human and behind a broken `/filter`
(`Jinyan1/COLING_2025_MGT_en`), and one — `dmitva/human_ai_generated_text` — carries both halves,
original orthography and the assignment prompt. Both rejects stay in the registry, disabled, with
their reason, so the next lane does not spend the attempt again. Repro: `node
eval/fetch-public-datasets.mjs --probe <dataset> --probe-out .scratch/<lane>` and read `probes` in
`eval/data/public/manifest.json`. No ruling number: this is the R42(e) work item, done.

**E10 — `/filter` is not usable on a large dataset from this host.** Four attempts against
`Jinyan1/COLING_2025_MGT_en` (610,767 rows) returned 30-second timeouts, one 502 and one 503, at a
200-second per-request abort as well as the default 30. `/rows`, `/splits`, `/info` and
`/statistics` on the same dataset answered normally throughout, so this is the filter index, not
the rate limiter and not the E3 wedge. Consequence: a labelled slice of a large corpus has to be
LOCATED by paging (`locate` in `pullSource`: single-row metadata requests at evenly spaced offsets,
then a stride inside the window), and a slice that is uniformly interleaved rather than contiguous
cannot be pulled economically at all. That is what killed the outfox essay slice.

**E11 — a corpus that is right in every column can still be unusable, and only the text says so.**
`andythetechnerd03/AI-human-text` passes every metadata check: 462,873 English rows, both labels,
essay-length texts, apache-2.0 on its card. The 150-row verification pull showed **0 of 150 human
rows carrying a capital letter or a terminal stop** — both halves are normalised. A detector whose
features include `terminal_punct_ratio`, `sentence_initial_caps` and three rhythm features computed
over segmented sentences would have measured the corpus builder's `.lower()`. **Rule adopted for
this lane: inspect a small pull locally before registering any source; the probe cannot do it,
because a probe is forbidden to print text.**

**E12 — hard mode is HIGHER than standard on essays (0.967 vs 0.936).** The only cell in this
project where deleting every orthography and format feature improves the fit. Both halves of the
essay corpus are clean capitalised prose, so the format features carry no class signal and cost the
model degrees of freedom; the separation is rhythm and connectives, which survive a prompt change.
Read with R24's warning attached: those same rhythm and connective features are what an L2 essay
built on taught connectors produces for free, and this corpus has no language-background labels to
measure that with.

**E13 — adding the essay corpus moved the `en:prose` operating point by more than it moved the
ranking.** The essay rows join the fitting side like any public source, so the cell's threshold is
now picked on a validation side that is ~20% essays: AUC 0.884 → 0.878 (hard 0.857 → 0.859), but
FPR@t 7.6% → 2.5% and TPR@t 65.0% → 32.5%. Anyone quoting the pre-essay recall of 65% is quoting a
threshold that no longer exists. Both tables are in `eval/out/REPORT.md`; the comparison is in
"Essay genre (R42(e))" above.

**E14 — the non-native/ELL false-flag rate cannot be measured from any corpus this project may
fetch.** Twenty further probes for a HUMAN-ONLY English-learner essay corpus with an L1 or
proficiency column (an FPR needs no machine half) found none. Every ELLIPSE, PERSUADE, TOEFL11,
ICNALE, EFCAMDAT and Feedback-Prize mirror tried is **HTTP 401**; `matejklemen/wi_locness` — learner
essays with CEFR levels, the right corpus — is **HTTP 501**, viewer disabled because it ships a
loading script; the one fetchable learner resource, `jhu-clsp/jfleg`, is 755 single sentences with
no L1 column. **Nothing was registered and negative control (f) was NOT implemented**: plumbing a
`control` split side and an (f) table for a corpus that does not exist would be a switch nobody can
turn on. The finding is the absence, and `REPORT.md` §3b now states it with the probe evidence
rather than as a bare caveat. Repro: the `probes` array in `eval/data/public/manifest.json`.

**E15 — CAL-G: what the platform sees is not what the eval measures.** run-eval §3b reports the
FITTED model at its fitted threshold on the essay TEST rows (AUC 0.935, FPR@t 0.4%, TPR@t 28.2%).
A platform gets the shipped CLI's `summary.label`, computed from the PRIOR weights through the
verdict table. Same 650 rows (325 human / 325 machine), one `--jsonl` batch, `--preset essay`, no
history and no corpus index:

| instrument | human essays flagged | machine essays flagged |
|---|---|---|
| shipped CLI, prior weights (the product) | 2 of 325 = **0.6%** (0.7% of the 298 scored) | 22 of 325 = **6.8%** (14.9% of the 148 scored) |
| shipped CLI, `--weights eval/out/weights.fitted.json` | 22 of 325 = **6.8%** (10.1% of the 218 scored) | 17 of 325 = **5.2%** (6.2% of the 273 scored) |
| run-eval §3b, fitted model at t_essay = 0.911 | 0.4% | 26.2% |

*(Numbers as of this release run. The core lane was editing `lib/features.mjs` while this section
was measured, and two consecutive runs a few minutes apart moved the prior-weights catch count by
one row and the fitted-weights false-flag count by seven. `eval/out/REPORT.md` is internally
consistent — one sequence, one core — and it, not this summary, is the record.)*

Flagged = `fingerprint_found` + `ai_style_indicators`. Three findings, none of them cosmetic:
**(a)** the product catches about **6.5% of machine essays**, not 26% — the verdict table's
conservatism (a Tier-0 fingerprint for `likely_llm`, R24's refusal of register-proxy evidence) sits
on top of the score and removes most of the recall the fitted model can rank; **(b)** loading the
fitted weights into the CLI makes the label-level false-flag rate **an order of magnitude worse**
(0.6% → 6.8%) and catches no more (6.8% → 5.2%), because the CLI's verdict table has FIXED cutoffs and the fitted file's
own tau is not one of them — evidence for R23, not against it; **(c)** the gate is not symmetric — 8.3% of human essays but 54.2% of machine ones are
refused a judgement under the prior weights (and the asymmetry INVERTS under the fitted file: 32.9%
human, 16.0% machine), because this corpus's machine half is its shorter half and the fitted weights
change which rows clear G5; any "over all rows" rate is therefore part abstention and part judgement,
and only the "over scored rows" pair compares like with like. `likely_llm` and `not_independently_authored` are 0 in every cell: no Tier-0 rule fired
and no corpus index was supplied. Repro: section CAL-G of `eval/out/REPORT.md`.

**E16 — a `pair` key that names one document is a row id, and it was removing protection.**
`shardOf()` prefers the `pair` key over `normKey(text)`, so a source that hands every row its own
key does not gain pair protection — it LOSES the near-duplicate protection that R36(e) is about.
Three of the six public sources were shipping exactly that. Measured and fixed this round:

| source | before | after |
|---|---|---|
| `maide-up-tr` | no key at all | **1,000 pairs recovered and verified** — `(Review_Language, Unnamed: 0)` names a real review and the GPT-4 review written for it; the pull checks the claim against the data (both rows must name the same hotel): 1,000 pairs, 1,000 with both label sides, **0 conflicting**. 9 rows lost their counterpart to the length floor and are sharded by text. Registry now declares `pairs: true`. |
| `mage-en` | 3,000 keys, 3,000 distinct — a row id | **3,000 dropped**; sharded by normalised text again |
| `hc3-en` | 3,000 keys, 1,500 distinct | 1,000 singleton keys dropped, **500 real pairs kept**; the report now says "ACTIVE on the 2,000 paired rows" instead of the false "INACTIVE — the file has no key" |
| `fake-reviews-gpt2era`, `modern-fake-reviews` | no key | **no key is recoverable**: `--probe /statistics` shows the released columns are `category`, `rating`, `text`/`text_`, `label` — one document per row and nothing linking two of them. Both now declare `noPairKey: true` so the fetcher cannot invent one. |

The fix is generic (`degeneratePairKeys()` in `make-splits.mjs`), not per-source: a key covering
fewer than two rows is dropped and counted. Straddles stayed 0 throughout, before and after. The
re-pull of `maide-up-tr` returned **all 1,991 rows byte-identical** (id, text, label) to the pull of
record — no drift, only the key added. The two review corpora were NOT re-pulled: a read-only probe
answered the question at lower risk than a fetch (E3's wedge), and the answer is that the key does
not exist. Cost of the fix: the test set changed again, so section 3 moved (see the essay section's
last table).

## Verify round 1

**The refuter — 130 attacks** (the head's count; the refuter's own table records 62 CLI runs plus
the leak, markdown, unicode, suppression-window, batch and aggregate probe suites). Every attack text
was authored in-session; none came from the corpus. Findings, and the ruling that closed each:

- **A human reached `likely_llm` three separate ways, all through `assistant_frame_leak`.** (i) the
  quotation-suppression window was ~100 characters from the match, so one intervening sentence let a
  human retelling what ChatGPT said be accused on 182 words of ordinary prose; (ii) `assistant`,
  `AI` and `LLM` were not suppression cues, so "the assistant my company installed" was accused;
  (iii) the bare common noun `language model` fired as self-identification ("the spreadsheet has
  never once told me it was a language model"). **→ HEAD-RULINGS R27.** Repro: rows `H23`, `N03`,
  `H24`/`N06` of `verify-round-1.jsonl`.
- **A configured machine marker inside a human-written message produced `likely_llm` with a human
  channel of 0.602** — a human WhatsApp turn wrapped around a forwarded booking summary, which is
  the SPEC §H.1 scenario the whole design exists to protect. **→ HEAD-RULINGS R28** (hybrid:
  `uncertain` + `pasted_machine_text` + `hybrid_suspect`). Repro: row `H19`.
- **19 of 30 assistant-leak paraphrases were missed**, including a double space, a single soft line
  break, an NBSP, the hyphenated `knowledge cut-off`, the unhyphenated `real time`, and every
  Turkish phrase written with the circumflex `zekâ`. **→ HEAD-RULINGS R27** (whitespace-normalised
  matching, `zek[aâ]`, the added EN/TR patterns). Repro: rows `P01`–`P30`.
- **Homoglyph and zero-width substitutions flipped `likely_llm` to `insufficient_text` with no
  trace.** A Cyrillic `а`, a fullwidth `Ｈ` or a ZWSP each defeated the rule; the Cyrillic case left
  `language.shares.other = 0.012` as its only evidence and nothing surfaced it. **→ HEAD-RULINGS
  R30** (`homoglyph_suspect` plus a confusable-folded view for rule matching). Detection power
  against a real adversary stays zero and the README keeps saying so.
- **The planned register-only cap would have protected 0 of the 9 human texts that reached
  `leaning_llm`.** The escape hatches were `llm_lexicon_weak` (one ordinary Turkish "ayrıca"),
  `out_of_channel_register` (any ≥400-character two-paragraph WhatsApp message) and the prose
  rhythm/connector trio. **→ HEAD-RULINGS R24**, which grew `REGISTER_PROXY_LLM` accordingly and
  requires two non-proxy LLM signals from two groups before `leaning_llm`.

**The code reviewer** (Unicode / regex / edge cases):

- **Arabic text carrying an English fingerprint scored `likely_llm`** — an R22 violation, because
  Arabic-script input must gate at `G3_lang` and never be scored. **Fixed by FIX-B1 in the core.**
- **A cluster of Turkish `\b` and `//i` regexes.** JavaScript's `\b` is ASCII-only and its `i` flag
  does not do Turkish case folding, so `ı`, `İ`, `ş`, `ğ` sat on the wrong side of a word boundary
  or failed to match. **Core fix.**
- **Curly-apostrophe parity**: `'` and `’` were not treated alike by the contraction features.
- **Turkish ordinal over-splitting**: `3.` in `3. kat` was read as a sentence end.
- **Astral-emoji boundary**: a surrogate pair could be split across a token boundary.
- **An O(k²) overlap pass** in the rule matcher — no catastrophic backtracking, but a super-linear
  path on pathological input.

**The end-to-end test.** The installed agent ran for real from `~/.claude/agents/` through a
headless session, resolved the tool via `LLM_DETECT_HOME`, read `RUBRIC.md`, applied the §E.1 table
correctly on six texts and a six-row batch, and never printed a percentage on a verdict line. **The
agent works end to end.** Its defects — a set-but-invalid `LLM_DETECT_HOME` treated as "fall back"
rather than "missing", batch mode judging `insufficient_text` rows, the unreachable `--dry-run`
branch, `--help` leaking a shell line, caveat labels drifting from the skeleton — are **ruled in
HEAD-RULINGS R31** and fixed in `agent/llm-text-detector.md`, `RUBRIC.md` and `install.sh`. The
`⚠` CONFLICT block was never rendered, because no test text split the two instruments; that path is
recorded as untested.

**Language ID.** A 14-word ASCII-folded Turkish WhatsApp line came back `language.primary = "en"` at
confidence 0.25 with the note `latin_subid_no_votes`. ASCII-folded Turkish is the documented shape of
real Turkish chat, so routing it into the `en` cell with English lexicons is the common case, not an
edge. **→ HEAD-RULINGS R32**: zero-vote Latin is `mixed`, never `en`, and the ASCII-fied Turkish
probe list, the chat-slang list and the folded suffix shapes all count as Turkish votes.

**Second pass over the verify-round fixture (HEAD-RULINGS R34).** Running `verify-round-1.jsonl`
through the fixed core found two remaining `assistant_frame_leak` false fires on human text — the
Turkish common noun "yapay zeka asistanı" (row `N09`; the first-person suffix had been optional) and
the old drafting pattern on "Here is the revised itinerary my colleague sent over" (row `N07`) — five
rewritten email fixtures that abstained with every gate passed and **no `reason`** (the SPEC §D.3
"no evidence either way" cell was silent), and a `code_switch_observed` note counting Turkish words
that happen to be English function words. All three are core fixes under R34. Two measured findings
were **not** tuned away: transform (b) is a no-op in prose on three of five pairs (its targets,
`sentence_initial_caps` and `all_lowercase`, are chat-only features) and transform (c) *raised* one
Turkish email's score; the §F.3 "a humanized variant scores lower" assertion is now measurable and
partly false. Read the R25 check line and the pair table in CAL-B of `gate-fixtures.md`.

**End-to-end round 2 (HEAD-RULINGS R35).** Six engineered texts through the installed agent copy: the
⚠ CONFLICT block rendered for the first time, correctly, on two CLI-`leaning_llm` × judge-`leaning_human`
cells (both sides printed, final `uncertain`, no averaging) and correctly did **not** render on the
`leaning_human` × `leaning_llm` cell, which is plain `uncertain`. R31 (a) tool-missing with no
fallback, (b) unjudged batch abstentions, (c) percentages and (f) judge-first all held; R28's hybrid
marker produced the right provenance caveat. What remained was report discipline — CAVEATS labels
drifting to `-`/bold in two of six runs (a recurrence), a stray `[CONFLICT]` on a non-⚠ batch row,
flags missing from one CLI line, two readings of invariant 4's "pasted template" reason — all ruled
in R35. No run exercised `likely_llm` as a final, the R31(e) artifact route, `register_only_evidence`,
`homoglyph_suspect` or `templated_or_copied` through the agent, and every text was Claude-authored, so
the round measures the report mechanics, not accuracy. Report: `.scratch/e2e2/e2e2-report.md`
(scratch, not committed).

**The eval-harness review (HEAD-RULINGS R36).** An independent reviewer re-derived §3 AUC/FPR/TPR/
precision, §4 hard mode, §5/5b thresholds and strata, §7 leave-one-writer-out, §9 base rates and the
fixture sections **exactly**, and confirmed mu/sigma from the fitting-side human rows only, t on VAL
only, TEST-only headlines, zero duplicate straddles, chronological writer splits and the sha256 of all
five public files. Seventeen defects were reproduced with a probe each
(`.scratch/harness-review/`, scratch, not committed). All seventeen are fixed here and the report was
regenerated. What actually moved:

- **The split leaked at the persona level (D2/D3).** `make-splits.mjs` let the design round's
  per-MESSAGE-ID `data_split.json` override the persona group hash, so 69 personas straddled and
  **135 of 723 in-house TEST llm rows shared a persona with a fitting-side row**. SPEC §D.5 step 3
  says never split by row. The recorded split is now reused at GROUP level or not at all (a group any
  of whose rows was recorded test goes to test entirely), the cross-label collision force is applied
  to the whole group for the same reason, and §1 now breaks the straddle count down by group kind and
  **exits 5** if any non-`writer::` group straddles. Measured after: **0 of 771** in-house test llm
  rows share a persona with a fitting-side row; straddling groups 72 → 3, all three `writer::`.
  Repro: `node eval/make-splits.mjs` then read `group_straddle` in `eval/data/splits-report.json`.
- **§8(a) was not a held-out number (D1).** The pre-2022 false-positive rate was computed over every
  split side — 1 of 1,500 = 0.1%. Held-out only it is **1 of 317 = 0.3%**, and the report now prints
  the fit/val/test composition beside it so the reader can see what was excluded. `emit()` never
  caught it because the line names no fitting word; that is D9's point.
- **HC3's matched-pair protection was a silent no-op (D6).** Four of the five public files predate the
  `pair` field, so `shardOf()` fell back to `normKey(text)` and a human answer and a ChatGPT answer to
  the same question could land on different sides. R36(e) permitted ONE re-pull of `hc3-en`; it
  succeeded (see the CAL E3 note above — the wedge did not recur), the key came back for all 3,000
  rows / 1,500 pairs, and **434 of the 500 multi-row pairs used to straddle**, every one of them
  spanning both labels. Under pair sharding: **0**. `splits-report.json` now records pair-key coverage
  per source and `REPORT.md` §1 prints it; the three sources that still have no key are marked
  "not measurable — no key", because INACTIVE means unknown, not zero. Repro:
  `.scratch/harness-review/` probes, or read the pair table in §1.
- **`weights.fitted.json` could not be loaded at all (D4).** `--weights eval/out/weights.fitted.json`
  was an uncaught `TypeError` on a missing per-feature `kind`. The emitter now writes every field the
  shipped loader dereferences — top-level `provenance`, `weightsId`, `generatedAt`, `expiresAt`, `K`,
  `cells`, and per fitted cell `b0`, `w`, `mu`, `sigma`, `kind` — copies `kind` from the prior file
  (the transform is a property of the feature, and the emitter stops the run if the prior disagrees
  with itself about one), emits a not-fitted cell as an explicit `{status, reason}`, and **validates
  its own output against `lib/score.mjs`'s `validateWeightsShape()` before writing**, exiting 6 if it
  fails. R23's opt-in path is real now: an `en:prose` text scores with `provenance: "fitted"` and no
  `uncalibrated_weights`; a `tr:prose` text falls back to the prior cell and warns
  `cell_not_fitted_prior_used`.
- **`corpusHash` hashed ids only (D5)** — editing the text of every row left it unchanged. It is now
  sha256 over the sorted `id|side|sha256(normKey(text))`.
- **Isotonic regression was not a function of x (D8).** `fitIsotonic` pushed one block per point and
  pooled only PAVA violations, so tied scores survived as several blocks with different y. `tr:chat`'s
  val side has 5 tied values over 19 of its 26 rows. Equal x values are pooled before PAVA now. AUC,
  FPR, TPR and t are rank statistics over the raw score and do not move; **the ECE column does**.
- **Control (d) was measuring itself (D7).** It split sentences with an ad-hoc
  `split(/(?<=[.!?])\s+/)` that agreed with the shipped segmenter on 237 of 295 documents, then
  rejoined with a single space — so `space_hygiene` moved in 9 of the 10 largest deltas and the
  published max |delta| 0.425 was substantially an artefact. It now uses `lib/segment.mjs`, preserves
  the original inter-sentence separators, counts the documents that became gated after the shuffle
  (3, previously dropped silently), and names the features that moved on the top-5 deltas.
- **The honesty guard was shallow (D9).** `headline()` validated an object literal written at its one
  call site — a constant checking itself; it now takes the ROWS and asserts every one is test-side.
  277 of the released report's 571 lines were appended by `gate-fixtures.mjs`, which had no guard at
  all; the same lexical guard now runs there and exits 4 rather than append. Three leak-probe labels
  quote an assistant-frame phrase containing the watched word; they carry a recorded per-line
  exemption, disclosed in the section itself.
- **Smaller, all fixed:** NO-COVERAGE rows print the measured confusion instead of a literal `0.0%`
  (D10); §7 states that the fold model pools all four cells and its threshold is not §5's per-cell t
  (D11); the LOWO fallback threshold set now excludes the held-out writer — it never fired this round,
  but a thinner corpus would have picked t on the writer the fold is blind to (D12); §1 prints the
  contamination bands and the pair table out of the gitignored `splits-report.json` (D13); the §1
  integrity audit uses `make-splits`' own `normKey`, which finds 111 duplicate rows where the local
  weaker key found 108 (D14); `gate-fixtures.mjs`'s header now says section D is a batch run (D15);
  `assertMageMapping()` also asserts `maide-up-tr` (source 0=human/1=gpt-4, unknown → null) and
  `hc3-en` (`human_answers`→human, `chatgpt_answers`→llm with generator `chatgpt`, empty row → no
  rows) (D16); the L2 penalty's effective scale is documented as `lambdaEffective` = lambda/n per
  cell and **not refitted** (D17).
- **Not a defect, recorded:** the reviewer's own prediction that `tr:chat` cell AUC would move
  0.975 → ~0.980 once the leak was removed did NOT reproduce. Removing the leak by REASSIGNING the
  rows (what the fix does) is not the same experiment as deleting them (what the estimate did); at
  three decimals the cell AUC is unchanged.

**The harness had no self-test, and its refusals were verified by reading them (R36 follow-up).**
Every branch R36 added to `run-eval.mjs` — exit 5 on a leaked split, exit 4 on the honesty guard,
exit 6 on an unloadable fitted-weights file — plus the CAL append guard in `gate-fixtures.mjs` was
asserted by code reading, because staging a real failure would have meant copying private chat
messages into a scratch directory. `eval/fixtures/synthetic-split/` (624 authored rows, one seeded
PRNG, no corpus row) and `eval/selftest-eval.mjs` (10 checks, ~6 s) close that. Running them changed
three things in the harness itself:

- **`run-eval.mjs` now exits 5 on a duplicate straddling the split.** §1's prose already said "the
  harness rejects any accuracy computed on a stream where the same string appears on both sides of
  the split" and then printed the numbers anyway. It rejects it now, and reports the cross-label
  count beside it. The real corpus is 0 and 0, so no published number moves. Repro: check 3 / 4.
- **The CAL append exemption was too wide.** It was registered for every line of the leak-probe
  table; it was narrowed to a closed list of three phrases, and then **deleted entirely under
  HEAD-RULINGS R40** when a fourth fixture label broke the release append. The probe tables print
  id, language, expectation, observation, result and rule names, never the probe text — the text
  lives in the fixture and a reader looks it up by id — so there is nothing left to exempt and the
  guard is absolute. Repro: check 7, which asserts both halves (a fixture whose probe text is full
  of the word appends with no occurrence of it; a fitting-side number in an emitted note is still
  refused with exit 4).
- **`run-eval.mjs` is importable.** `main()` used to run on import, so `emit()` and `headline()`
  could not be exercised in a child process. It is behind the same entry-point guard
  `make-splits.mjs` already used, and both functions are exported.

Recorded, and now ruled (HEAD-RULINGS R37): the self-test joins the release sequence, its work dir
is lane-neutral, and two sentences travel with every citation of it. **Ten green checks prove the guards refuse planted faults; the correctness of the numbers printed when nothing fires rests on the independent re-derivation of R36, which a fixture cannot replace.**
And the synthetic "human" class is shaped to reach code paths — capitalised, terminated sentences so
gate G4 passes — and models nothing about human writing (R37(d)).

**Refuter round 2 (R38).** 111 authored texts and 4 aggregate senders through the FIXED core. No
crash, no NaN, deterministic across separate processes, 200,000 characters in 0.25 s. R29 (aggregate
gates) and R32 (ASCII-folded Turkish votes Turkish) both confirmed on their own targets. What it
found, and what the head ruled:

- **Four new roads from human prose to `likely_llm`, all through the leak rule** (R38(a), (b)):
  reported speech using `it` rather than `he` (`N26` and `N27` differ by two characters and only one
  was suppressed); one noun between the frame and the subject (`as an AI system he had no way…`,
  three human court and procurement reports accused); a reporting clause before the frame with no
  quotation marks and no product name (`The reply began As an AI I cannot access your booking` — a
  customer complaining about a chatbot, with neither suppression route available to her); and three
  cue words that are also ordinary words or names — "Gemini season", "Claude Bernard", "the copilot
  on the second leg" — each *disabling* the rule on a text that genuinely self-identified.
- **Fourteen of twenty new self-identification paraphrases missed, including all six Turkish ones**
  (R38(c) adds twenty patterns). Two Turkish misses are R34's own doing: `Bir yapay zekâ olarak`, the
  commonest Turkish opener in the wild, was excluded by R34's mandatory `(modeli|asistanı)` head
  noun, and `gerçek zamanlı verilere erişimim bulunmuyor` missed because agglutination puts
  morphology between the two words R27's pattern wanted adjacent.
- **Two homoglyph blocks the fold missed** (R38(d)): Mathematical Alphanumeric Symbols defeated both
  the leak rule and the marker rule outright, and fullwidth digits inside a reference code folded
  correctly but raised **no warning at all** — the scan walks word tokens and a digit run is not a
  word. The warning is the whole defence, so silent manipulation is the defect.
- **The human checklist road under R24** (R38(f)): on eighteen authored human-register texts —
  guest lists, wedding plans, agency room lists — `llm_lexicon_strong` (13), `bold_lead_in_list` (11)
  and `colon_led_list` (10) were what carried ordinary people toward `leaning_llm`.
  `bold_lead_in_list` now requires actual `**bold**`; the plain capitalised-lead shape moves to
  `colon_led_list`, which joins `REGISTER_PROXY_LLM`.
- **The support-desk mitigation did not fire on the failure mode** (R38(g)): three human
  support-desk texts leaned LLM *with* `--domain customer_service` set, because the phrases carrying
  them were never tagged `cs`. Retagged. Fixture rows `A05cs`, `A13cs`, `A15cs` now watch the
  mitigation rather than the flag.
- **Out-of-scope Latin routed into the Turkish cell** (R38(h)): a French formal letter came back
  `tr` at confidence 0.70 because `de`, `ne`, `en`, `ce`, `la` sit on the Turkish stopword list; it
  abstained on gate luck (G4), not on language ID. Azerbaijani and Turkmen came back `tr` with no
  note at all and would have been scored against Turkish μ/σ and the Turkish lexicon.
- **The aggregate report inherited the discarded base pass** (R38(e)): six assistant replies carried
  `register_only_evidence` although the aggregate decision never applied R24 — the aggregate evidence
  has two non-proxy LLM signals from two groups, which is what R24 requires. README and RUBRIC §8
  both tell the judge to act on that warning, so a false one propagates into the agent's report. A
  second aggregate printed the R28 note twice because `warnings` was de-duplicated and `notes` was not.

**The two mitigations' measured costs**, now in README §H and in the fixture as expectations rather
than as bugs: R24 takes ten clean assistant WhatsApp replies from **10/10 `leaning_llm` to 0/10**
once the bold is stripped and four labels are lowercased — seven abstain and **three flip to
`leaning_human`, all Turkish**. R28 demotes a marker-bearing assistant reply from `likely_llm` to
`uncertain` + `hybrid_suspect` for about six tokens of slang and a lowercase pass; the human channel
moves 0.000 → 0.816 on a text whose **content did not change**, so the demotion is spelling-driven,
not evidence-driven. And the accepted miss stays accepted: an assistant that self-identifies *and*
mentions "the bot on their website" anywhere else is suppressed, which is not an edge case.

**Agent gate, first run (R39).** `judge-tests.jsonl` had never actually been run. Fourteen rows
through the installed agent copy: **10 PASS / 0 CRITICAL / 3 OUTSIDE**, and the head ruled all three
OUTSIDE rows fixture errors rather than agent errors. What the run established, and what it changed:

- **Every §E.1 cell recomputed by hand matched the printed FINAL**, and `likely_llm` appeared as a
  FINAL **for the first time in the project** — `T06`, the CLI's `known_machine_marker` crossing the
  judge's artifact route (R31(e)). The `LL x LL` cell is reachable in practice, not only on paper.
- **RUBRIC §8 was observed working:** the judge withdrew a pre-CLI evidence bullet on reading
  `register_only_evidence`. CAVEATS labels were exact 13/13, `[CONFLICT]` never over-fired (`T08` is
  the `EH x EL` cell, which is `uncertain` untagged), no gated row was judged, and judge-first held
  14/14 by tool-call order. No round-1 or round-2 defect recurred.
- **`T03`, `T07` and `T11` expected `likely_llm` from style alone, which the decision table cannot
  produce.** Under SPEC §D.3 the FINAL reaches `likely_llm` only in `LL x LL`, and the CLI reaches
  `LL` only through a Tier-0 rule; D2's draft predates that decision. `expectedFinal` is now
  `leaning_llm | uncertain` for the three, `likely_llm` acceptable only if a rule fires;
  `criticalFailure` keeps `leaning_human | likely_human`, because a human-leaning final on
  unhumanized assistant output is still the failure those rows exist to catch.
- **`T11` was untestable at its own stated shape.** It declares `prose` and carried 55 tokens, and
  R25 documents `insufficient_text` as the CORRECT answer for 50-120-token prose — so the row's
  `criticalFailure` listed the right answer as a failure. The authored Turkish text is lengthened to
  **166 tokens**, same trap (one chat vocative painted onto flawless assistant prose) and same
  register; `insufficient_text` is dropped from its `criticalFailure`. Measured at authoring time,
  core in flux: `--context prose --lang tr` -> `leaning_llm`, score 0.729, all five gates passed.
- **Flag mapping was the largest single source of disagreement.** Five of thirteen runs mapped a
  stated shape differently from each other, and on `T11` that was the only thing between OUTSIDE and
  CRITICAL. Two runs printed `domain=general` on a command that never passed `--domain` — a flag
  that was assumed, printed as one that was passed. RUBRIC gains **§9 "Caller statements → CLI
  flags"** as a table, the agent file points at it, and the CLI line now copies the flags ACTUALLY
  PASSED from the command.
- **`T14` cannot run from committed material** — it needs `eval/data/human-chat.jsonl`, gitignored
  under R8 and produced by `make-splits.mjs` at eval time. It now carries `requiresEvalData: true`.
  The **substitute run on committed material** (49 rows: the `llm-tr` and `must-not-fire` fixtures in
  place of the corpus half) came out **20 `insufficient_text` / 25 `uncertain` / 4 `leaning_human` /
  0 `leaning_llm` / 0 `likely_llm`**, and met all three of `T14`'s `criticalFailure` clauses: no row
  the CLI floored was judged, no "final score" was produced, and no more than two long rows reached
  `likely_llm` — zero did. It is a substitute, not the test: it has no real chat traffic in it.
- **Minor, ruled:** a gated row must have **no `JUDGE:` line at all** (one run printed
  `JUDGE: not rendered`), and the report skeleton is printed plain, never inside code fences —
  CAVEATS labels stop being parseable at the top of a code block.

Recorded, not fixed: `hybrid_suspect`, `homoglyph_suspect`, `possible_quotation_or_discussion`,
`templated_or_copied` and `domain_suppressed` are **still unexercised through the agent**, and no
genuine ⚠ cell arose in this round. Ten passes on fourteen hand-driven rows is a first run, not a
measurement of the judge.

## Ruling index

| finding | ruling |
|---|---|
| fitted weights not promoted to default | R23 |
| register-proxy evidence cannot carry `leaning_llm` | R24 |
| G4 dead band; prose pairs rewritten at 160–260 tokens | R25 |
| 12-decimal printing; `--quick` output directory; REPORT.md machine-generated only | R26 |
| `assistant_frame_leak` precision and recall | R27 |
| machine marker inside a human message is a hybrid | R28 |
| aggregate-mode gates and features | R29 |
| homoglyph / non-ASCII-Latin evasion warning | R30 |
| agent, RUBRIC and installer defects from the E2E run | R31 |
| zero-vote Latin is `mixed`; ASCII-fied Turkish votes Turkish | R32 |
| the verify-round texts become a committed fixture and part of the gate | R33 |
| second-pass leak-rule precision, silent abstention reason, code-switch note; transform (b)/(c) findings | R34 |
| agent report discipline after the CONFLICT block first rendered | R35 |
| eval-harness review: persona-level split leak, held-out control (a), loadable fitted weights, real corpusHash, HC3 pair key, tie-pooled isotonic, honest control (d), deeper honesty guard | R36 |
| the harness self-test joins the release sequence; it proves refusal, not correctness | R37 |
| refuter round 2: reported-speech suppression, name-cues, 20 new self-identification patterns, math/fullwidth homoglyphs, the human checklist road, the support-desk retag, out-of-scope Latin | R38 |
| the agent gate's first run: judge `likely_llm` is a column not a final, the flag-mapping table, T11's length, T14's eval-data dependency | R39 |
| the probe tables print rule names, never probe text; the honesty guard's exemption list is deleted | R40 |
| English first; Turkish supported but unscheduled | R41 |
| the school-platform round: essay calibration, `--probe`, the by-prompt split, the essay-genre report row | R42, R42(e) |
| the non-native/ELL essay stratum: 41 datasets probed, none fetchable with an L1 or proficiency column; control (f) absent, not passed | R42(e) follow-up (head to number) |
| CAL-G, the shipped CLI on the essay test rows: the product's label-level rates are a different instrument from the fitted model's; the fitted weights make the CLI's false-flag rate worse; the review corpora's pair keys | R49 |
