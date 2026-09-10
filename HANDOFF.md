# HANDOFF — state as of 2026-09-10, end of the school-platform rounds (R41–R53)

## What exists now (all committed, all verified by running)
- `stylometry.mjs` + `lib/` — zero-dependency EN/TR detector, importable and CLI; `node selftest.mjs`
  → 841 assertions, exit 0, no arbitration items; `node eval/selftest-eval.mjs` → 11/11 guard checks.
  Platform API: `summary.label` (five values incl. `not_independently_authored`, R47), `evidenceSpans`, `--preset essay`, `--history` / `--history-profile`,
  `buildHistoryProfile()`, per-row history in `--jsonl` (R42, R45); samples + commands in `examples/`. Prior weights (`weights.v1.json`) are the default.
- `eval/` — public-dataset fetcher (5 EN/TR sources, 13,991 rows on disk, sha256-verified),
  group-aware splits, `run-eval.mjs` (held-out metrics, hard mode, leave-one-writer-out, negative
  controls, base-rate table, `weights.fitted.json`), `gate-fixtures.mjs` (fixture gates through the
  shipped CLI), fixtures incl. `verify-round-1.jsonl` (83 rows: 43 authored texts + 40 leak probes).
- `agent/llm-text-detector.md` (898 words, `model: opus`) installed at `~/.claude/agents/` by
  `install.sh`; exercised END TO END through the installed copy on six texts and a six-row batch.
- `README.md`, `RUBRIC.md`, `eval/README-eval.md` (findings log + ruling index), `LICENSE`.
- `docs/design/HEAD-RULINGS.md` Part 3 — R23–R53, the build/verify/platform-round rulings. They override SPEC.

## The honest numbers (TEST only, `eval/out/REPORT.md`; three human writers, R0 holds 92 % of the
## surviving human rows after the Arabic filter — every threshold is valid for them and nobody else)
| what | measure | value |
|---|---|---|
| PRODUCT (shipped CLI, prior weights, `--preset essay`) on 650 essay TEST rows | human essays flagged (`fingerprint_found` + `ai_style_indicators`) | 4 of 325 = 1.2 % |
| | machine essays flagged | 51 of 325 = 15.7 % (31.7 % of the 161 scored) |
| | refused a judgement (`too_short_or_no_signal`) | 7.7 % human, 50.5 % machine |
| Fitted model, reference only (§3b) | essay 150–499: AUC / hard / FPR / TPR | 0.941 / 0.965 / 0.4 % / 25.0 % |
| Fitted model, reference only (§3) | en:prose 150–499: AUC / hard / FPR / TPR | 0.887 / 0.870 / 1.4 % / 29.7 % |
| en:chat, tr:prose, tr:chat | | no model / INSUFFICIENT; tr:chat cell AUC 0.975 → 0.450 hard |
Coverage (`insufficient_text` rate): en:chat 98.5 %, tr:chat 91.2 %, tr:prose 97.6 %, en:prose 63.4 % (essays 28.4 %).
Real WhatsApp messages (200, R0/R2, Latin script): 196 `insufficient_text`, 2 `uncertain`, 2 `leaning_human`,
0 false positives — the FPR of silence; 2 % of real chat gets a score at all.
Leave-one-writer-out: R0 27 of 33 scored rows flagged (81.8 %; 2.3 % of all 1,194 rows); R1/R2 INSUFFICIENT (n<20).
Base rate: at a 1 % prior, essay 150–499 precision is 0.390 and general en:prose 0.118; at a 20 % prior 0.940 / 0.768.
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
- Through the installed agent (four E2E rounds): `likely_llm` finals, the artifact route, the CONFLICT
  block, `register_only_evidence`, `hybrid_suspect`, `homoglyph_suspect`, `possible_quotation_or_discussion`,
  history shift/consistency and the platform batch are all exercised and held (R46); `templated_or_copied`
  and `domain_suppressed` are not, and no ⚠ cell arose naturally in rounds 3–4 (engineer one next).
  `judge-tests.jsonl` T14 needs `eval/data/` (`requiresEvalData`); a committed-material substitute passed.
- Cross-Node determinism NOT VERIFIED (R12). `fetch-public-datasets.mjs` wedged on re-pulls once;
  run it under a shell watchdog (macOS has no `timeout(1)`).

## Exact next step
1. The owner creates the remote; the head pushes `main`.
2. Owner priority (R41): ENGLISH FIRST. Next round candidates, in order: (a) an agent run with `--corpus`
   (class-wide duplicates → `templated_or_copied`) and one with `--domain customer_service`, plus a text
   engineered to land in a ⚠ cell; (b) the non-native/ELL essay false-flag rate — searched for and not found on the permitted host (R44
   addendum): either the owner supplies real platform essays with an ELL flag (best) or approves an
   authenticated Hugging Face pull of W&I+LOCNESS with their own free token; then English human rows for
   `en:chat` and the `en:prose` 500+ bucket before any fitted cell can be trusted; (c) re-pull the three review corpora
   (English) with the current fetcher to recover pair keys; (d) a committed batch fixture for T14;
   (e) re-decide R23 only when an English cell has ≥100 human rows per bucket AND ≥20 per fairness
   stratum. Turkish: no further work until the owner asks; its gates keep running.

## Do not
- Touch the owner's other project directory. Re-pull the corpus. Call any paid API. Use fable/sonnet/haiku.
- Ship product-specific marker patterns as defaults (`markers.json` ships empty; R17).
- Quote any number above without its base rate, language, length bucket and the three-humans caveat.
