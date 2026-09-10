# HANDOFF — state as of 2026-09-09, end of build + verify round 1

## What exists now (all committed, all verified by running)
- `stylometry.mjs` + `lib/` — zero-dependency EN/TR detector, importable and CLI; `node selftest.mjs`
  → 584 assertions, exit 0, no arbitration items. Prior weights (`weights.v1.json`) are the default.
- `eval/` — public-dataset fetcher (5 EN/TR sources, 13,991 rows on disk, sha256-verified),
  group-aware splits, `run-eval.mjs` (held-out metrics, hard mode, leave-one-writer-out, negative
  controls, base-rate table, `weights.fitted.json`), `gate-fixtures.mjs` (fixture gates through the
  shipped CLI), fixtures incl. `verify-round-1.jsonl` (83 rows: 43 authored texts + 40 leak probes).
- `agent/llm-text-detector.md` (898 words, `model: opus`) installed at `~/.claude/agents/` by
  `install.sh`; exercised END TO END through the installed copy on six texts and a six-row batch.
- `README.md`, `RUBRIC.md`, `eval/README-eval.md` (findings log + ruling index), `LICENSE`.
- `docs/design/HEAD-RULINGS.md` Part 3 — R23–R34, the build/verify-round rulings. They override SPEC.

## The honest numbers (TEST only, `eval/out/REPORT.md`; three human writers, R0 holds 92 % of the
## surviving human rows after the Arabic filter — every threshold is valid for them and nobody else)
| cell | bucket | n_h / n_llm | AUC | AUC hard | FPR@t | TPR@t |
|---|---|---|---|---|---|---|
| en:prose | 150–499 tok | 224 / 297 | 0.884 | 0.858 | 7.6 % | 65.0 % |
| en:prose | 50–149 tok | 359 / 356 | 0.747 | 0.648 | 1.1 % | 3.7 % |
| en:prose | <50, 500+ | — | NO COVERAGE / INSUFFICIENT | | | |
| en:chat, tr:prose | all | — | no model (too few rows survive the gates) | | | |
| tr:chat | all | — | INSUFFICIENT / NO COVERAGE; cell-level AUC 0.975 → **0.450 in hard mode** | | | |
Coverage (`insufficient_text` rate): en:chat 98.5 %, tr:chat 91.2 %, tr:prose 97.7 %, en:prose 72.1 %.
Real WhatsApp messages (200, R0/R2, Latin script): 196 `insufficient_text`, 2 `uncertain`, 2 `leaning_human`,
0 false positives — the FPR of silence; 2 % of real chat gets a score at all.
Leave-one-writer-out: R0 25 of 33 scored rows flagged (75.8 %; 2.1 % of all 1,194 rows); R1/R2 INSUFFICIENT (n<20).
Base rate: at a 1 % prior, en:prose 150–499 precision is 0.080 — twelve wrong flags per right one.
Fixture gates: must-not-fire PASS (0/12 `likely_llm`, 0/12 `likely_human`, 24/24 abstained);
verify-round PASS (0/33 human `likely_llm`, 40/40 leak probes). Fitted weights NOT promoted (R23).

## Known limits carried forward (read README "What was NOT verified")
- The §F.3 humanization assertion is measurable now (9 of 12 pairs) and partly false: transform (b)
  is a no-op in prose, (c) raised one score. Documented, not tuned.
- An LLM imitating a telegraphic Turkish writer buys `leaning_human` with 33 tokens and one prompt line.
- ESL connector essays can still lean LLM (R24 keeps prose rhythm/connectors out of the proxy set).
- Negative controls (b) human-translated and (c) machine-translated: NOT MEASURED (zero-spend rule).
- The agent's CONFLICT (⚠) block rendered correctly in end-to-end round 2 (R35); `likely_llm` as a FINAL
  through the agent, the R31(e) artifact route and `register_only_evidence` via the agent remain unexercised.
  Cross-Node determinism NOT VERIFIED (R12).
- `fetch-public-datasets.mjs` wedged on re-pulls after the first success; run it under a watchdog.

## Exact next step
1. The owner creates the remote; the head pushes `main` (commit `build+verify round 1`).
2. Next round candidates, in order: (a) a human-written text carrying a genuine artifact (not a declared
   paste) so `likely_llm` as a final and the R31(e) route are exercised through the agent; (b) more human rows for `tr:chat` / `en:chat` before any fitted cell can be trusted;
   (c) re-decide R23 only when a cell has ≥100 human rows per bucket AND ≥20 per fairness stratum.

## Do not
- Touch `~/Desktop/travelio-asim-shadow`. Re-pull the corpus. Call any paid API. Use fable/sonnet/haiku.
- Ship product-specific marker patterns as defaults (`markers.json` ships empty; R17).
- Quote any number above without its base rate, language, length bucket and the three-humans caveat.
