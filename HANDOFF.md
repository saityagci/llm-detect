# HANDOFF — state as of 2026-09-10, end of build + verify rounds 1–3

## What exists now (all committed, all verified by running)
- `stylometry.mjs` + `lib/` — zero-dependency EN/TR detector, importable and CLI; `node selftest.mjs`
  → 707 assertions, exit 0, no arbitration items; `node eval/selftest-eval.mjs` → 10/10 guard checks. Prior weights (`weights.v1.json`) are the default.
- `eval/` — public-dataset fetcher (5 EN/TR sources, 13,991 rows on disk, sha256-verified),
  group-aware splits, `run-eval.mjs` (held-out metrics, hard mode, leave-one-writer-out, negative
  controls, base-rate table, `weights.fitted.json`), `gate-fixtures.mjs` (fixture gates through the
  shipped CLI), fixtures incl. `verify-round-1.jsonl` (83 rows: 43 authored texts + 40 leak probes).
- `agent/llm-text-detector.md` (898 words, `model: opus`) installed at `~/.claude/agents/` by
  `install.sh`; exercised END TO END through the installed copy on six texts and a six-row batch.
- `README.md`, `RUBRIC.md`, `eval/README-eval.md` (findings log + ruling index), `LICENSE`.
- `docs/design/HEAD-RULINGS.md` Part 3 — R23–R40, the build/verify-round rulings. They override SPEC.

## The honest numbers (TEST only, `eval/out/REPORT.md`; three human writers, R0 holds 92 % of the
## surviving human rows after the Arabic filter — every threshold is valid for them and nobody else)
| cell | bucket | n_h / n_llm | AUC | AUC hard | FPR@t | TPR@t |
|---|---|---|---|---|---|---|
| en:prose | 150–499 tok | 224 / 297 | 0.884 | 0.857 | 7.6 % | 65.0 % |
| en:prose | 50–149 tok | 359 / 356 | 0.739 | 0.623 | 1.1 % | 3.7 % |
| en:prose | <50, 500+ | — | NO COVERAGE / INSUFFICIENT | | | |
| en:chat, tr:prose | all | — | no model (too few rows survive the gates) | | | |
| tr:chat | all | — | INSUFFICIENT / NO COVERAGE; cell-level AUC 0.975 → **0.450 in hard mode** | | | |
Coverage (`insufficient_text` rate): en:chat 98.5 %, tr:chat 91.2 %, tr:prose 97.6 %, en:prose 72.2 %.
Real WhatsApp messages (200, R0/R2, Latin script): 196 `insufficient_text`, 2 `uncertain`, 2 `leaning_human`,
0 false positives — the FPR of silence; 2 % of real chat gets a score at all.
Leave-one-writer-out: R0 25 of 33 scored rows flagged (75.8 %; 2.1 % of all 1,194 rows); R1/R2 INSUFFICIENT (n<20).
Base rate: at a 1 % prior, en:prose 150–499 precision is 0.080 — twelve wrong flags per right one.
Fixture gates: must-not-fire PASS (0/12 `likely_llm`, 0/12 `likely_human`, 24/24 abstained);
verify-round-1 PASS (0/33 human `likely_llm`, 40/40 leak probes); verify-round-2 PASS (0/37, 37/37 probes,
11/11 languages); agent gate `judge-tests.jsonl` 10 PASS / 0 CRITICAL / 3 fixture errors fixed (R39).
Fitted weights NOT promoted (R23).

## Known limits carried forward (read README "What was NOT verified")
- The §F.3 humanization assertion is measurable (9 of 12 pairs) and partly false: transform (b)
  is a no-op in prose, (c) raised one score. R24's chat cost is measured: ten clean assistant
  WhatsApp replies go 10/10 `leaning_llm` → 0/10 after stripping bold and lowercasing four labels
  (7 abstain, 3 flip to `leaning_human`, all Turkish). Documented, not tuned.
- An LLM imitating a telegraphic Turkish writer buys `leaning_human` with 33 tokens and one prompt line;
  an LLM text carrying a marker plus `lol`/lowercase demotes to `uncertain` + `hybrid_suspect` (R28).
- ESL/native connector prose can still lean LLM (A03/A04/A08/A10/A11 in `verify-round-2.jsonl`):
  R24 keeps prose rhythm/connectors out of the proxy set because they survive hard mode.
- Leak rule: an assistant that self-identifies AND mentions "the bot"/"our assistant" elsewhere is a
  miss; `As an AI, the information I provide…` is a miss; "model" next to Gemini/Claude/copilot
  restores suppression. Precision over recall, by ruling (R27, R38).
- Negative controls (b) human-translated and (c) machine-translated: NOT MEASURED (zero-spend rule).
- Three review corpora carry no `pair` key (HC3 does, after one re-pull); their template siblings
  may straddle fit/test and the report says "not measurable". The L2 penalty is scaled by 1/n
  (documented as `lambdaEffective`, not refitted).
- Through the agent: `likely_llm` as a FINAL (T06), the R31(e) artifact route, the CONFLICT block and
  `register_only_evidence` are exercised; `hybrid_suspect`, `homoglyph_suspect`,
  `possible_quotation_or_discussion`, `templated_or_copied` and `domain_suppressed` are not.
  `judge-tests.jsonl` T14 needs `eval/data/` (`requiresEvalData`); a committed-material substitute passed.
- Cross-Node determinism NOT VERIFIED (R12). `fetch-public-datasets.mjs` wedged on re-pulls once;
  run it under a shell watchdog (macOS has no `timeout(1)`).

## Exact next step
1. The owner creates the remote; the head pushes `main`.
2. Owner priority (R41): ENGLISH FIRST. Next round candidates, in order: (a) English agent runs that
   exercise `hybrid_suspect` (a real human turn wrapping a marker), `homoglyph_suspect` and
   `possible_quotation_or_discussion` end to end; (b) English human rows for `en:chat` and the
   `en:prose` 500+ bucket before any fitted cell can be trusted; (c) re-pull the three review corpora
   (English) with the current fetcher to recover pair keys; (d) a committed batch fixture for T14;
   (e) re-decide R23 only when an English cell has ≥100 human rows per bucket AND ≥20 per fairness
   stratum. Turkish: no further work until the owner asks; its gates keep running.

## Do not
- Touch `~/Desktop/travelio-asim-shadow`. Re-pull the corpus. Call any paid API. Use fable/sonnet/haiku.
- Ship product-specific marker patterns as defaults (`markers.json` ships empty; R17).
- Quote any number above without its base rate, language, length bucket and the three-humans caveat.
