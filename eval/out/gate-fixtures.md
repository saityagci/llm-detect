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
(HEAD-RULINGS R22), out of a pool of 1946, run as a **single `--jsonl` batch process** with
`--channel whatsapp` — unlike sections A/B/C/E, which run one process per row with that row's own
flags. The two paths were checked against each other and agreed 6/6 on verdict, score and gate reason.
**Every one of these is a
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

Three probe labels below quote an assistant-frame phrase that contains the word this report's
honesty guard watches for. They are quotations of the INPUT, not statistics: this file fits
nothing and has no fitting side. Those three lines carry a recorded, per-line exemption from the
guard that appends this section to `REPORT.md`; no other line does.

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

_CAL fixture gate wall-clock: 19.1s. tau source: the neutral 0.5, NOT the fitted tau: the CLI scores with the shipped PRIOR weights (R11), and run-eval's tau belongs to the fitted model. Read the verdict column, not the score column.._
