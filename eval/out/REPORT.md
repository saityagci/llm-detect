# LLM-detect evaluation report

generated 2026-09-09T11:03:42.881Z · node v24.5.0 · detector `stylometry.mjs`

Language scope is **English and Turkish only** (HEAD-RULINGS R22). Arabic-script rows were
excluded upstream by make-splits.mjs and are never scored.

## 1. Dedup and split integrity (SPEC §D.5 steps 1-3)

- rows loaded: **17160**
- residual duplicate rows after make-splits: **108** (0.63%)
- duplicate groups straddling two sides: **0** (must be 0)
- duplicate groups appearing under both labels: **0**
- groups straddling two sides: **72** of 1380 — the human writers are split chronologically inside a writer, by design (SPEC §F.2)

## 2. Coverage: how much of the stream the detector refuses to score

`insufficient_text` is a deliverable, not a failure. Every accuracy below is computed on the
scored remainder, and the coverage that produced it is printed beside it.

| cell | rows | scored | gated (`insufficient_text`) | gate rate |
|---|---:|---:|---:|---:|
| en:chat | 613 | 9 | 604 | 98.5% |
| en:prose | 12024 | 3347 | 8677 | 72.2% |
| tr:chat | 2522 | 223 | 2299 | 91.2% |
| tr:prose | 2001 | 39 | 1962 | 98.1% |

## 3. Held-out results (TEST only) — SPEC §G.1

Every cell with fewer than 100 documents on either side prints `INSUFFICIENT` instead of a
number. A precision computed from three positives is a rounding artefact wearing a decimal point.

| cell | length bucket | n_human | n_llm | AUC | AUC hard | ECE | FPR@t | TPR@t | TPR@t hard | precision@t |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| en:chat | <20 | 84 | 62 | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |
| en:chat | 20-49 | 8 | 2 | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |
| en:chat | 50-149 | 0 | 5 | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |
| en:prose | <20 | 189 | 190 | NO COVERAGE — 379 of 379 rows are below the floor and were never scored | — | | 0.0% | 0.0% | 0.0% | — |
| en:prose | 20-49 | 383 | 356 | NO COVERAGE — 739 of 739 rows are below the floor and were never scored | — | | 0.0% | 0.0% | 0.0% | — |
| en:prose | 50-149 | 355 | 343 | 0.757 | 0.603 | 0.137 | 1.1% | 4.7% | 5.0% | 0.800 |
| en:prose | 150-499 | 217 | 281 | 0.887 | 0.859 | 0.052 | 7.4% | 64.8% | 68.7% | 0.919 |
| en:prose | 500+ | 53 | 31 | INSUFFICIENT — placeholder, not a measurement | | | | | | |
| tr:chat | <20 | 146 | 586 | NO COVERAGE — 731 of 732 rows are below the floor and were never scored | — | | 0.0% | 0.0% | 0.0% | — |
| tr:chat | 20-49 | 25 | 84 | INSUFFICIENT — placeholder, not a measurement | | | | | | |
| tr:chat | 50-149 | 1 | 0 | INSUFFICIENT — placeholder, not a measurement | | | | | | |
| tr:prose | <20 | 95 | 39 | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |
| tr:prose | 20-49 | 74 | 151 | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |
| tr:prose | 50-149 | 21 | 41 | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |
| tr:prose | 150-499 | 1 | 0 | INSUFFICIENT — no model for this cell: too few documents survived the gates on the fitting side | | | | | | |

`AUC hard` and `TPR@t hard` are the same bucket under the hard-mode model (section 4): every
orthographic and format feature deleted, the model and the threshold refitted from scratch.
A cell whose hard-mode column is far below its standard column is a cell whose signal is
spelling, and spelling is one line of prompt away from gone.

`FPR` / `TPR` / `precision` are computed over **all** rows in the bucket, with a gated row
counted as a document that never fires. That is the number a deployment sees. AUC and ECE are
computed on the scored subset only, because an abstention has no score to rank.

## 4. Hard mode — the headline number for any adversary who is trying

Hard mode deletes every orthographic and format feature that a one-line prompt change would
erase, and refits everything from scratch. The easy number is the footnote; this is the number.

Deleted in hard mode: `terminal_punct_ratio`, `sentence_initial_caps`, `all_lowercase`, `tr_asciified_probe`, `tr_apostrophe_absent`, `tr_mixed_orthography`, `tr_bare_capital_I`, `em_dash_in_chat`, `space_hygiene`, `emoji_repeat_run`, `ellipsis_hand_typed`, `multi_exclam`, `repeated_punct_emoticon`

| cell | AUC standard | AUC hard mode | TPR@t standard | TPR@t hard mode |
|---|---:|---:|---:|---:|
| en:chat | — | — | — | — |
| en:prose | 0.843 | 0.798 | 17.5% | 18.2% |
| tr:chat | 0.975 | 0.443 | 11.5% | 2.2% |
| tr:prose | — | — | — | — |

## 5. Threshold selection is fairness-limited, not accuracy-maximizing

t is the smallest threshold whose false-positive rate stays at or under 2% on the non-native
stratum, the formal-register stratum, and each of `en` and `tr` separately. Whatever recall
falls out is reported without editorializing.

| cell | t | stratum | n (human, val) | FPR@t | binding? |
|---|---:|---|---:|---:|---|
| en:prose | 0.705 | non_native_en | 0 | — | no — fewer than 20 rows, it cannot limit anything |
| en:prose | 0.705 | formal_register | 7 | 0.0% | no — fewer than 20 rows, it cannot limit anything |
| en:prose | 0.705 | lang:en | 1212 | 2.0% | yes |
| en:prose | 0.705 | lang:tr | 0 | — | no — fewer than 20 rows, it cannot limit anything |
| tr:chat | 1.000 | non_native_en | 22 | 0.0% | yes |
| tr:chat | 1.000 | formal_register | 0 | — | no — fewer than 20 rows, it cannot limit anything |
| tr:chat | 1.000 | lang:en | 0 | — | no — fewer than 20 rows, it cannot limit anything |
| tr:chat | 1.000 | lang:tr | 164 | 0.0% | yes |

- `tr:chat`: t = 1.000 is a real candidate from the validation set, not the give-up value — but the flag rule is `p >= t` and the isotonic map saturates at exactly 1.0, so this threshold still flags every saturated row. Read its recall as "only the rows the calibrator pinned at certainty".

Strata are defined by documented proxies, not by self-report:
- `non_native_en` — a message the language ID called English, written by one of the Turkish-speaking corpus writers. This is a real non-native stratum, not a guess.
- `formal_register` — 30+ tokens, 2+ lines, over 90% of lines terminated.
- `mobile_typed` — carries an emoji, a letter elongation, or is entirely lowercase.
- `machine_translated` — **not measured. No labelled machine-translated corpus is available offline, and producing one would require a translation API, which the zero-spend rule forbids.** SPEC §D.5 asks for it; this release does not have it.

## 5b. Per-stratum false-positive rate, TEST side

Section 5 is the validation-side FPR that picked t. This is the held-out one: human rows only,
a gated row counted as a document that never fires. Under 100 rows it is an anecdote and says so.

| cell | stratum | human rows (test) | gated | scored | flagged at t | FPR |
|---|---|---:|---:|---:|---:|---:|
| en:prose | formal_register | 15 | 14 | 1 | 0 | 0.0% — INSUFFICIENT (n<100), an anecdote |
| en:prose | mobile_typed | 32 | 20 | 12 | 0 | 0.0% — INSUFFICIENT (n<100), an anecdote |
| en:prose | lang:en | 1185 | 916 | 269 | 25 | **2.1%** |
| en:prose | ALL | 1197 | 928 | 269 | 25 | **2.1%** |
| tr:chat | non_native_en | 13 | 13 | 0 | 0 | 0.0% — INSUFFICIENT (n<100), an anecdote |
| tr:chat | mobile_typed | 136 | 131 | 5 | 0 | **0.0%** |
| tr:chat | lang:tr | 172 | 156 | 16 | 0 | **0.0%** |
| tr:chat | writer:R0 | 162 | 146 | 16 | 0 | **0.0%** |
| tr:chat | writer:R1 | 9 | 9 | 0 | 0 | 0.0% — INSUFFICIENT (n<100), an anecdote |
| tr:chat | writer:R2 | 1 | 1 | 0 | 0 | 0.0% — INSUFFICIENT (n<100), an anecdote |
| tr:chat | ALL | 172 | 156 | 16 | 0 | **0.0%** |

A stratum whose rows are all gated shows 0.0% for the same reason a switched-off smoke alarm
shows no fire. Read the gated column first.

## 6. Fitted coefficients whose sign disagrees with the design

A fitted coefficient whose sign is opposite to §B is **not flipped**. It is flagged here,
investigated, and either explained or the feature is dropped. A sign flip usually means a
corpus artefact.

- `en:prose` · `content_word_repeat` expected human-direction, fitted coefficient 0.806
- `en:prose` · `ellipsis_hand_typed` expected human-direction, fitted coefficient 0.515
- `en:prose` · `human_lexicon` expected human-direction, fitted coefficient 0.127
- `en:prose` · `letter_elongation` expected human-direction, fitted coefficient 0.618
- `en:prose` · `parallel_openers` expected llm-direction, fitted coefficient -0.392
- `en:prose` · `repeated_punct_emoticon` expected human-direction, fitted coefficient 0.882
- `en:prose` · `terminal_punct_ratio` expected llm-direction, fitted coefficient -0.164
- `tr:chat` · `tr_chat_morphology` expected human-direction, fitted coefficient 0.260

## 7. Leave-one-writer-out — the binding limit on every threshold

The model and the threshold are refitted inside each fold. This is re-measured every release,
because it is the test the design has already failed once: with one writer removed, the model
learned that "human" means "writes the way the remaining writers write".

| held-out writer | human rows | below the floor | scored | flagged at the fold threshold | flag rate over scored | flag rate over all |
|---|---:|---:|---:|---:|---:|---:|
| R0 | 1194 | 1161 | 33 | 25 | 75.8% | 2.1% |
| R1 | 93 | 86 | 7 | 2 | INSUFFICIENT (n<20) | 2.2% |
| R2 | 16 | 16 | 0 | 0 | INSUFFICIENT (n<20) | 0.0% |


The fold model is fitted on every other document in the corpus, public rows included, with
this writer removed; mu/sigma, the coefficients and the threshold are all refitted inside the
fold. "below the floor" is this writer's messages that never reach a score at all — for a
WhatsApp corpus that is most of them, and it caps how much this test can ever say.

Counts, not comfort: after the R22 Arabic filter the surviving human rows are heavily
concentrated in one writer. A flag rate computed over fewer than 100 rows is an anecdote.
R22 anticipated leave-one-writer-out running over R0 and R2; the script filter actually leaves
R0 with the bulk of the rows and R1/R2 with very few, and the table above says exactly which.

**Any threshold in this tool is valid for the writers it was fitted on and for nobody else.**

## 8. Negative controls (a)-(e)

### (a) pre-2022 human text

- en:prose: 1 of 1500 flagged = **0.1%**
- Source: the human half of the GPT-2-era review corpus, which predates the 2022 assistant era. It is a proxy for "text that cannot possibly be LLM-written", not a certified pre-2022 sample.

### (b) human-translated text

- **NOT MEASURED.** No labelled corpus of human-translated text in English or Turkish was available to this build. The control is not silently dropped: it is missing, and the missing measurement is the finding.

### (c) machine-translated human text

- **NOT MEASURED.** Producing this control requires running human text through a translation system. Every available one is a paid API, and the zero-spend rule forbids it. R1 and D1 both predict this class WILL be flagged, because MT and LLM decoding share a rhythm; the fixture `must-not-fire.jsonl` row `A9` is one hand-authored example of the class, which is an illustration and not a rate.

### (d) shuffled-sentence control

- 291 documents re-scored with their sentences shuffled.
- calibrated p: mean |delta| **0.029** · median **0.000** · max **0.425**
- pre-isotonic score: mean |delta| **0.028** · max **0.448** (isotonic calibration is a step function and flattens small moves, so this is the sensitive one)
- The score should barely move. A large move means the segmenter is order-dependent and the features are reading document order rather than style.

### (e) the support-desk snippet library, scored as human text

- 30 human support-desk snippets (15 en / 15 tr), each scored twice: once at `--domain general` and once at `--domain customer_service`.
- at `--domain general`: 17 gated by the length floor, 13 scored.
- en:chat: no fitted model for that cell, so those snippets could not be checked against a threshold at all. That gap is the result, not a pass.
- **no snippet scored at or above t in either domain setting.**

## 9. Base-rate table — printed next to every precision figure

Precision recomputed from this release's own measured FPR and recall at the priors a caller
might actually face. A detector that is right about the ranking can still be wrong about four
flags in five.

| cell | bucket | FPR | recall | P@50% | P@20% | P@10% | P@5% | P@2% | P@1% |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| en:prose | 50-149 | 1.1% | 4.7% | 0.805 | 0.509 | 0.315 | 0.179 | 0.078 | 0.040 |
| en:prose | 150-499 | 7.4% | 64.8% | 0.898 | 0.687 | 0.494 | 0.316 | 0.152 | 0.081 |

For reference, the design round measured precision **0.183 at a 1% prior** on this corpus at the
strictest threshold it tested: four of five flags wrong. Nothing below should be read without it.

## 10. Authored LLM fixtures and the humanization collapse

| fixture | variant | transform | verdict | p | delta vs its clean sibling |
|---|---|---|---|---:|---:|
| en-hr-1 | clean | — | insufficient_text | — |  |
| en-hr-2 | clean | — | uncertain | 0.953 |  |
| en-hr-3 | clean | — | insufficient_text | — |  |
| en-hr-4 | clean | — | leaning_llm | 0.373 |  |
| en-hr-5 | humanized | b | insufficient_text | — |  |
| en-hr-6 | humanized | c | uncertain | 0.964 | 0.011 |
| en-hr-7 | humanized | a | insufficient_text | — |  |
| en-pr-1 | clean | — | insufficient_text | — |  |
| en-pr-2 | clean | — | insufficient_text | — |  |
| en-pr-3 | humanized | b | insufficient_text | — |  |
| en-wa-1 | clean | — | insufficient_text | — |  |
| en-wa-2 | clean | — | insufficient_text | — |  |
| en-wa-3 | clean | — | uncertain | — |  |
| en-wa-4 | clean | — | uncertain | — |  |
| en-wa-5 | clean | — | leaning_llm | — |  |
| en-wa-6 | humanized | a | uncertain | — |  |
| en-wa-7 | humanized | c | uncertain | — |  |
| en-wa-8 | humanized | d | insufficient_text | — |  |
| en-em-1 | clean | — | insufficient_text | — |  |
| en-em-2 | clean | — | insufficient_text | — |  |
| en-em-3 | humanized | b | insufficient_text | — |  |
| en-em-4 | humanized | c | insufficient_text | — |  |
| en-es-1 | clean | — | leaning_llm | 0.694 |  |
| en-es-2 | clean | — | insufficient_text | — |  |
| en-es-3 | humanized | a | insufficient_text | — |  |
| tr-hr-1 | clean | — | insufficient_text | — |  |
| tr-hr-2 | clean | — | insufficient_text | — |  |
| tr-hr-3 | clean | — | insufficient_text | — |  |
| tr-hr-4 | clean | — | insufficient_text | — |  |
| tr-hr-5 | humanized | b | insufficient_text | — |  |
| tr-hr-6 | humanized | c | insufficient_text | — |  |
| tr-hr-7 | humanized | a | insufficient_text | — |  |
| tr-pr-1 | clean | — | insufficient_text | — |  |
| tr-pr-2 | clean | — | insufficient_text | — |  |
| tr-pr-3 | humanized | b | insufficient_text | — |  |
| tr-wa-1 | clean | — | insufficient_text | — |  |
| tr-wa-2 | clean | — | insufficient_text | — |  |
| tr-wa-3 | clean | — | uncertain | 1.000 |  |
| tr-wa-4 | clean | — | uncertain | 1.000 |  |
| tr-wa-5 | clean | — | leaning_llm | 1.000 |  |
| tr-wa-6 | humanized | a | uncertain | 0.404 |  |
| tr-wa-7 | humanized | c | uncertain | 1.000 | 0.000 |
| tr-wa-8 | humanized | d | leaning_human | 0.000 |  |
| tr-em-1 | clean | — | insufficient_text | — |  |
| tr-em-2 | clean | — | insufficient_text | — |  |
| tr-em-3 | humanized | b | insufficient_text | — |  |
| tr-em-4 | humanized | c | insufficient_text | — |  |
| tr-es-1 | clean | — | uncertain | — |  |
| tr-es-2 | clean | — | insufficient_text | — |  |
| tr-es-3 | humanized | a | insufficient_text | — |  |

- humanization transforms (b) and (c) were applied to 2 scored pairs; the score dropped in **0** of them.
- The point of this table is to document the collapse in CI, not to pretend it is prevented. A humanized row that still scores high is luck, not robustness.

## 11. Segmenter cross-check against `Intl.Segmenter`

- 500 documents compared. Sentence count differed on **165** (33.0%); mean absolute difference **0.76** sentences.
- `Intl.Segmenter` is an oracle here and nowhere else: its behaviour depends on the ICU version compiled into the host binary, which is exactly why the shipped path may not use it.

## 12. Fixture gates (`must-not-fire.jsonl`)

The release gate itself lives in `selftest.mjs`, which B1 owns. This section reports what
the detector under test actually did with the 24 rows, so the head does not have to take the
selftest's word for it.

| gate | required | observed | |
|---|---|---:|---|
| `likely_llm` on the 12 human-that-looks-LLM rows | 0 | 0 | PASS |
| `likely_human` on the 12 LLM-that-looks-human rows | 0 | 0 | PASS |
| abstention on the LLM-that-looks-human rows | at least 6 | 12 | PASS |

- every row landed inside its `allowed` verdict set.

Abstention is the deliverable, not the consolation prize.

## 13. Output

- `eval/out/weights.fitted.json` — provenance `fitted`, corpusHash `0aeb94c044408487`, expires 2027-03-08 (180 days).
- Per HEAD-RULINGS R11 the shipped CLI default remains `weights.v1.json`. Whether the fitted file becomes the default is the head's call after reading this report.

## What this report does not say

- It does not quote an accuracy without its base rate, its language, its length bucket and the
  three-humans caveat. The human side of the in-house corpus is three people, not a sample of humanity.
- It reports held-out numbers only. Nothing on the fitting side appears in a headline table, and
  emit() exits with code 4 rather than print one. (This paragraph is the reference only exemption.)
- `insufficient_text` on most of the real chat stream is the product, not a bug to tune away.

## CAL-A. Fixture gate — `must-not-fire.jsonl` through the CLI

SPEC §I Gate: **zero `likely_llm`** on the 12 human-that-looks-LLM rows, **zero `likely_human`**
on the 12 LLM-that-looks-human rows, and **at least 6 of those 12 abstaining**. Every row was run
as its own CLI process with its own `--context/--channel/--lang/--genre/--domain`.

| gate | required | measured | verdict |
|---|---|---|---|
| `likely_llm` on group A (human) | 0 of 12 | 0 | PASS |
| `likely_human` on group B (LLM) | 0 of 12 | 0 | PASS |
| group B abstained | >= 6 of 12 | 12 | PASS |

**GATE PASSES.**

| id | grp | truth | lang/shape | verdict | score | gate reason | in `allowed` |
|---|---|---|---|---|---|---|---|
| A1 | A | human | en/prose | insufficient_text | null | too_few_active_features | yes |
| A2 | A | human | en/prose | insufficient_text | null | too_few_active_features | yes |
| A3 | A | human | tr/prose | insufficient_text | null | below_token_floor | yes |
| A4 (repl. A4 (Arabic MSA journalist prose — dropped per R22)) | A | human | en/prose | insufficient_text | null | too_few_active_features | yes |
| A5 | A | human | en/chat | uncertain | 0.650 | — | yes |
| A6 | A | human | tr/chat | insufficient_text | null | below_char_floor | yes |
| A7 (repl. A7 (Arabic formal MSA chat — dropped per R22)) | A | human | tr/chat | uncertain | 0.650 | — | yes |
| A8 (repl. A8 (Arabic vocalized quotation — dropped per R22)) | A | human | en/prose | insufficient_text | null | too_few_active_features | yes |
| A9 | A | human | en/prose | insufficient_text | null | too_few_active_features | yes |
| A10 | A | human | en/prose | insufficient_text | null | too_few_active_features | yes |
| A11 | A | human | en/chat | insufficient_text | null | below_char_floor | yes |
| A12 | A | human | tr/prose | uncertain | 0.200 | — | yes |
| B1 | B | llm | tr/chat | insufficient_text | null | below_char_floor | yes |
| B2 | B | llm | en/chat | insufficient_text | null | below_char_floor | yes |
| B3 (repl. B3 (Arabic Levantine dialect on demand — dropped per R22)) | B | llm | tr/chat | insufficient_text | null | below_char_floor | yes |
| B4 | B | llm | en/prose | insufficient_text | null | too_few_active_features | yes |
| B5 | B | hybrid | en/prose | insufficient_text | null | too_few_active_features | yes |
| B6 | B | llm | en/chat | insufficient_text | null | below_char_floor | yes |
| B7 | B | llm | en/prose | insufficient_text | null | too_few_active_features | yes |
| B8 | B | llm | tr/prose | insufficient_text | null | too_few_active_features | yes |
| B9 | B | llm | tr/chat | insufficient_text | null | below_char_floor | yes |
| B10 | B | llm | en/prose | insufficient_text | null | too_few_active_features | yes |
| B11 (repl. B11 (Arabizi on demand — dropped per R22)) | B | llm | en/chat | insufficient_text | null | below_char_floor | yes |
| B12 | B | hybrid | en/prose | insufficient_text | null | too_few_active_features | yes |

How the gate passed matters: **24 of 24 rows abstained** (21 `insufficient_text` + 3 `uncertain`), and only 3 produced a score at all (A5, A7, A12). A gate cleared mostly by abstention is a test of the gates, not of the scorer — the traps these rows were built to set were never sprung, because the detector declined to answer.

## CAL-B. Authored LLM fixtures — `llm-en.jsonl` + `llm-tr.jsonl` (50 rows)

These are LLM text (HEAD-RULINGS R10: written in-session; Claude-written text IS LLM text).
Every row scoring below tau = 0.500 is a miss; every gated row is a document the tool declined to judge.

| set | n | insufficient_text | uncertain | leaning_human | leaning_llm | likely_human | likely_llm |
|---|---:|---:|---:|---:|---:|---:|---:|
| lang **en** | 25 | 11 | 6 | 1 | 7 | 0 | 0 |
| lang **tr** | 25 | 10 | 9 | 1 | 5 | 0 | 0 |
| transform `none` | 30 | 14 | 7 | 0 | 9 | 0 | 0 |
| transform `b` | 6 | 2 | 2 | 0 | 2 | 0 | 0 |
| transform `c` | 6 | 0 | 4 | 1 | 1 | 0 | 0 |
| transform `a` | 6 | 4 | 2 | 0 | 0 | 0 | 0 |
| transform `d` | 2 | 1 | 0 | 1 | 0 | 0 | 0 |

Scored (not gated): 29 of 50. At or above tau: 21.

### The humanization assertion (§F.3)

§F.3 asserts a humanized variant scores LOWER than its clean twin. The assertion is only
evaluable where BOTH sides produced a score; a gated side makes the pair unmeasurable, which
is itself the finding.

- pairs with a humanized variant: **12**
- pairs where both sides were scored (evaluable): **9**
- of those, score dropped: **2**; mean delta: **-0.0176**

**R25 check** — the prose humanization pairs were rewritten at 160-260 tokens on both sides so the §F.3 collapse assertion would stop landing in the 50-~120-token dead band. Measured: **7 of 10** prose pairs are evaluable, **2** of those dropped, mean delta **-0.0227**. A pair that is evaluable and does NOT drop is a real result about transform (b)/(c), not a fixture bug.

| pair | lang | transform | clean | humanized | delta |
|---|---|---|---|---|---:|
| en-hr-1 | en | b | 0.870 (leaning_llm) | 0.802 (uncertain) | -0.068 |
| en-hr-2 | en | c | 0.850 (leaning_llm) | 0.753 (uncertain) | -0.098 |
| en-pr-1 | en | b | 0.762 (leaning_llm) | 0.762 (leaning_llm) | 0.000 |
| en-wa-3 | en | c | 0.754 (uncertain) | 0.754 (uncertain) | 0.000 |
| tr-hr-1 | tr | b | 0.700 (leaning_llm) | 0.700 (leaning_llm) | 0.000 |
| tr-hr-2 | tr | c | 0.306 (uncertain) | 0.306 (uncertain) | 0.000 |
| tr-pr-1 | tr | b | 0.537 (uncertain) | 0.537 (uncertain) | 0.000 |
| tr-wa-3 | tr | c | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| tr-em-2 | tr | c | 0.270 (leaning_llm) | 0.276 (leaning_llm) | +0.006 |

3 pair(s) are NOT measurable because at least one side was gated:
- en-em-3 vs en-em-1 (en, `b`): clean insufficient_text null / humanized insufficient_text null
- en-em-4 vs en-em-2 (en, `c`): clean insufficient_text null / humanized leaning_human 0.102
- tr-em-3 vs tr-em-1 (tr, `b`): clean insufficient_text null / humanized insufficient_text null

8 humanized row(s) have NO clean twin by construction (transforms `a` and `d`:
the humanization is in the prompt, so there is nothing to subtract from). They are reported as
verdicts, never as a passed assertion:
- en-hr-7 (en, `a`): insufficient_text null
- en-wa-6 (en, `a`): uncertain 0.213
- en-wa-8 (en, `d`): insufficient_text null
- en-es-3 (en, `a`): insufficient_text null
- tr-hr-7 (tr, `a`): insufficient_text null
- tr-wa-6 (tr, `a`): uncertain 0.350
- tr-wa-8 (tr, `d`): leaning_human 0.350
- tr-es-3 (tr, `a`): insufficient_text null

## CAL-C. Negative control (e) — `cs-snippets.jsonl`, 30 human support-desk lines

Every row is a human writing support-desk phrasing (HEAD-RULINGS R7, 15 en / 15 tr). Run twice:
`--domain general` and `--domain customer_service`. R7 puts any row above tau on the
domain-suppression list; since tau here is the neutral 0.5 against prior-weight scores, the list
is built from the **verdict** (`leaning_llm` or worse in either setting) and the score-based count
is printed beside it.

| setting | insufficient_text | uncertain | leaning_human | leaning_llm | likely_human | likely_llm | gated | at/above tau |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `--domain general` | 17 | 13 | 0 | 0 | 0 | 0 | 17 | 13 |
| `--domain customer_service` | 17 | 13 | 0 | 0 | 0 | 0 | 17 | 13 |

Rows scored under both settings: 13. Mean score change from the domain flag: **-0.0061**.

| id | lang | general | customer_service | delta |
|---|---|---|---|---:|
| cs-en-02 | en | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| cs-en-03 | en | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| cs-en-05 | en | 0.611 (uncertain) | 0.611 (uncertain) | 0.000 |
| cs-en-06 | en | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| cs-en-07 | en | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| cs-en-08 | en | 0.611 (uncertain) | 0.611 (uncertain) | 0.000 |
| cs-en-09 | en | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| cs-en-10 | en | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| cs-en-11 | en | 0.650 (uncertain) | 0.611 (uncertain) | -0.039 |
| cs-en-12 | en | 0.611 (uncertain) | 0.611 (uncertain) | 0.000 |
| cs-en-13 | en | 0.611 (uncertain) | 0.611 (uncertain) | 0.000 |
| cs-en-14 | en | 0.650 (uncertain) | 0.650 (uncertain) | 0.000 |
| cs-en-15 | en | 0.650 (uncertain) | 0.611 (uncertain) | -0.039 |

Gated rows by language: en 2, tr 15.
Rows at or above 0.5 by score: 13 general / 13 customer_service.

**Domain-suppression list (R7): EMPTY by verdict this round.** Read it weakly — see the gated count above; a control that never gets scored cannot exonerate anything.

## CAL-D. The production shape — real human WhatsApp messages

200 REAL rows sampled deterministically (seed `cal-2026-09-09`) from writers R0/R2, Latin script only
(HEAD-RULINGS R22), out of a pool of 1946, run with `--channel whatsapp`. **Every one of these is a
human message**, so every `leaning_llm` / `likely_llm` here is a false positive and every score at or
above tau is a flag against a real person.

| insufficient_text | uncertain | leaning_human | leaning_llm | likely_human | likely_llm | gated | scored | at/above tau | FP (leaning_llm+) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 196 | 2 | 2 | 0 | 0 | 0 | 196 | 4 | 0 | 0 |

Writers: R0 197, R2 3. Languages: tr 150, en 50.
Gate reasons: `below_char_floor` 188, `below_token_floor` 5, `too_few_active_features` 3.
Coverage is the headline: **2.0%** of real chat messages get a score at all.
False-positive rate over ALL sampled rows: **0.0%**; over the scored subset: **0.0%**.

## CAL-E. Verify round 1 — `verify-round-1.jsonl` (HEAD-RULINGS R33)

35 human texts and 8 LLM texts written in-session by the verify-round refuter
(no corpus row, provenance per row), plus the assistant-frame-leak probe list. Every row runs as its
own CLI process with its own flags; the three marker rows run against a temporary markers file built
from their `requiresMarkers` field, because `markers.json` ships as `[]` (R17) and this file never edits it.

| gate | required | measured | verdict |
|---|---|---|---|
| `likely_llm` on human rows that call it critical | 0 of 33 | 0 | PASS |
| `expectRule` probes correct | 40 of 40 | 40 | PASS |

**VERIFY-ROUND GATE PASSES.** H17 and H20 are excluded from the first line by their own
`criticalFailure` set: they are machine-written templates with no human turn, so a marker-driven
`likely_llm` is correct there (R28 downgrades only the hybrid case, H19).

| set | n | insufficient_text | uncertain | leaning_human | leaning_llm | likely_human | likely_llm |
|---|---:|---:|---:|---:|---:|---:|---:|
| human (H01-H35) | 35 | 11 | 18 | 2 | 2 | 0 | 2 |
| llm (L01-L08) | 8 | 1 | 0 | 2 | 5 | 0 | 0 |

| id | truth | class | lang/ctx | mk | verdict | score | rules | warnings | in `allowed` |
|---|---|---|---|---|---|---|---|---|---|
| H01 | human | non_native_en_formal | en/prose | — | uncertain | 0.444 | — | register_only_evidence, uncalibrated_weights | yes |
| H02 | human | non_native_en_formal | en/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H03 | human | non_native_en_formal | en/prose | — | leaning_llm | 0.194 | — | uncalibrated_weights, score_table_disagreement | yes |
| H04 | human | non_native_en_formal | en/prose | — | leaning_llm | 0.840 | — | uncalibrated_weights | yes |
| H05 | human | non_native_en_formal | en/chat | — | uncertain | 0.650 | — | uncalibrated_weights | yes |
| H06 | human | non_native_en_formal | en/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H07 | human | careful_tr_orthography | tr/chat | — | uncertain | 0.650 | — | register_only_evidence, uncalibrated_weights | yes |
| H08 | human | careful_tr_orthography | tr/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H09 | human | careful_tr_orthography | tr/prose | — | uncertain | 0.385 | — | uncalibrated_weights | yes |
| H10 | human | careful_tr_orthography | tr/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H11 | human | careful_tr_orthography | tr/chat | — | uncertain | 0.650 | — | uncalibrated_weights | yes |
| H12 | human | careful_tr_orthography | tr/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H13 | human | support_desk_snippet | en/chat | — | uncertain | 0.800 | — | register_only_evidence, uncalibrated_weights | yes |
| H14 | human | support_desk_snippet | en/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H15 | human | support_desk_snippet | tr/chat | — | uncertain | 0.650 | — | register_only_evidence, uncalibrated_weights | yes |
| H16 | human | support_desk_snippet | tr/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H17 | human | pasted_machine_template | en/prose | yes | likely_llm | 0.200 | known_machine_marker | pasted_machine_text, uncalibrated_weights, score_table_disagreement | yes |
| H18 | human | forwarded_template_by_a_human | en/chat | — | uncertain | 0.448 | — | register_only_evidence, uncalibrated_weights | yes |
| H19 | human | forwarded_template_by_a_human | tr/chat | yes | uncertain | 0.350 | known_machine_marker | pasted_machine_text, hybrid_suspect, uncalibrated_weights | yes |
| H20 | human | pasted_machine_template | en/prose | yes | likely_llm | 0.200 | known_machine_marker | pasted_machine_text, uncalibrated_weights, score_table_disagreement | yes |
| H21 | human | human_discussing_an_assistant | en/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H22 | human | human_discussing_an_assistant | tr/chat | — | uncertain | 0.650 | — | uncalibrated_weights | yes |
| H23 | human | human_discussing_an_assistant | en/prose | — | uncertain | 0.320 | — | uncalibrated_weights | yes |
| H24 | human | human_discussing_an_assistant | en/prose | — | uncertain | 0.482 | — | register_only_evidence, uncalibrated_weights | yes |
| H25 | human | marketing_register_human | tr/prose | — | uncertain | 0.437 | — | register_only_evidence, uncalibrated_weights | yes |
| H26 | human | marketing_register_human | en/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H27 | human | machine_translated_looking_human | en/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H28 | human | machine_translated_looking_human | tr/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| H29 | human | native_speaker_control | en/chat | — | uncertain | 0.350 | — | uncalibrated_weights | yes |
| H30 | human | native_speaker_control | en/prose | — | uncertain | 0.236 | — | uncalibrated_weights | yes |
| H31 | human | native_speaker_control | tr/chat | — | leaning_human | 0.350 | — | uncalibrated_weights | yes |
| H32 | human | native_speaker_control | en/prose | — | uncertain | 0.358 | — | uncalibrated_weights | yes |
| H33 | human | careful_tr_orthography | tr/chat | — | uncertain | 0.800 | — | uncalibrated_weights | yes |
| H34 | human | non_native_en_formal | en/chat | — | uncertain | 0.800 | — | register_only_evidence, uncalibrated_weights | yes |
| H35 | human | careful_tr_orthography | tr/chat | — | leaning_human | 0.350 | — | uncalibrated_weights | yes |
| L01 | llm | llm_base | en/prose | — | leaning_llm | 0.889 | — | uncalibrated_weights | yes |
| L02 | llm | llm_base | en/chat | — | leaning_llm | 0.800 | markdown_in_chat | register_only_evidence, uncalibrated_weights | yes |
| L03 | llm | llm_base | tr/chat | — | leaning_llm | 0.800 | markdown_in_chat | uncalibrated_weights | yes |
| L04 | llm | llm_transform_a | en/prose | — | insufficient_text | null | — | uncalibrated_weights | yes |
| L05 | llm | llm_transform_b | en/prose | — | leaning_llm | 0.889 | — | uncalibrated_weights | yes |
| L06 | llm | llm_transform_c | en/prose | — | leaning_llm | 0.684 | — | uncalibrated_weights | yes |
| L07 | llm | llm_transform_d_mimicry | tr/chat | — | leaning_human | 0.350 | — | uncalibrated_weights | yes |
| L08 | llm | llm_transform_d_mimicry | tr/chat | — | leaning_human | 0.350 | — | uncalibrated_weights | yes |

2 LLM row(s) reached a human-leaning verdict: L07 (leaning_human, expected_evasion), L08 (leaning_human, expected_evasion). L07/L08 are the measured mimicry cost (33 tokens and one prompt line); an unexpected one is a new finding.

### The `assistant_frame_leak` probe list (R27)

40 probes: 30 that must fire (self-identification or drafting frames)
and 10 that must NOT (a human quoting or discussing an assistant, and the bare common noun).
A false fire is the worst output this tool has; a miss is only lost recall. They are counted separately.

- correct: **40 / 40**
- missed (should fire, did not): **0**
- **false fires (should NOT fire, did): 0**

| probe | lang | expect | fired | ok | what it is |
|---|---|---|---|---|---|
| P01 | en | FIRE | FIRE | ok | as a large language model |
| P02 | en | FIRE | FIRE | ok | I'm just an AI |
| P03 | en | FIRE | FIRE | ok | I am merely an AI assistant |
| P04 | en | FIRE | FIRE | ok | my knowledge cut-off (hyphen) |
| P05 | en | FIRE | FIRE | ok | my knowledge cutoff |
| P06 | en | FIRE | FIRE | ok | as of my last update |
| P07 | en | FIRE | FIRE | ok | as of my latest training |
| P08 | en | FIRE | FIRE | ok | as of my last training data |
| P09 | en | FIRE | FIRE | ok | real time (no hyphen) |
| P10 | en | FIRE | FIRE | ok | real-time (hyphen) |
| P11 | en | FIRE | FIRE | ok | no access to the internet |
| P12 | en | FIRE | FIRE | ok | unable to browse the web |
| P13 | en | FIRE | FIRE | ok | here is a revised draft |
| P14 | en | FIRE | FIRE | ok | here's your revised version |
| P15 | en | FIRE | FIRE | ok | I have rewritten it below |
| P16 | en | FIRE | FIRE | ok | I was trained on data |
| P17 | tr | FIRE | FIRE | ok | bir yapay zeka modeli olarak |
| P18 | tr | FIRE | FIRE | ok | bir yapay zekâ modeli olarak (circumflex) |
| P19 | tr | FIRE | FIRE | ok | yapay zeka asistanıyım |
| P20 | tr | FIRE | FIRE | ok | yapay zekâ asistanıyım (circumflex) |
| P21 | tr | FIRE | FIRE | ok | bilgi kesim tarihim |
| P22 | tr | FIRE | FIRE | ok | bilgi kesim tarihi |
| P23 | tr | FIRE | FIRE | ok | eğitim verilerim |
| P24 | tr | FIRE | FIRE | ok | bir dil modeli olarak |
| P25 | tr | FIRE | FIRE | ok | gerçek zamanlı erişimim yok |
| P26 | en | FIRE | FIRE | ok | split across a line break |
| P27 | en | FIRE | FIRE | ok | double spaces |
| P28 | en | FIRE | FIRE | ok | NBSP between words |
| P29 | en | FIRE | FIRE | ok | language model across a line break |
| P30 | tr | FIRE | FIRE | ok | yapay zeka split across a line break |
| N01 | en | no fire | no fire | ok | quoted directly, cue adjacent |
| N02 | en | no fire | no fire | ok | cue one sentence away (refuter D1 / H23 shape) |
| N03 | en | no fire | no fire | ok | cue word "assistant" |
| N04 | en | no fire | no fire | ok | cue word "AI" |
| N05 | en | no fire | no fire | ok | cue word "LLM" |
| N06 | en | no fire | no fire | ok | bare common-noun "language model" (refuter D3 / H24 shape) |
| N07 | en | no fire | no fire | ok | human self-identification frame is NOT present |
| N08 | en | no fire | no fire | ok | curly-quoted leak inside human prose |
| N09 | tr | no fire | no fire | ok | human discussing yapay zeka |
| N10 | tr | no fire | no fire | ok | human discussing a bot with the circumflex spelling |

_CAL fixture gate wall-clock: 17.9s. tau source: the neutral 0.5, NOT the fitted tau: the CLI scores with the shipped PRIOR weights (R11), and run-eval's tau belongs to the fitted model. Read the verdict column, not the score column.._
