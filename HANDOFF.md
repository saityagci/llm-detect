# HANDOFF — state as of 2026-09-09 (moved out of the Travelio session)

## Done
1. Design round (5 opus agents): D1 stylometry design, D2 judge+agent design, R1 research (7 fetchable HF
   datasets verified), DATA contrast study on the private corpus, SPEC synthesis. All under `docs/design/`.
2. Head review of SPEC → `docs/design/HEAD-RULINGS.md` Part 1 (R1–R15: narrowed the likely_llm rules,
   markdown rule, near-duplicate semantics, purity of detect(), PII rules, dataset caps, no API spend).
3. Owner clarified this is NOT a Travelio feature → HEAD-RULINGS Part 2 (R16–R21): standalone repo here,
   global agent via `LLM_DETECT_HOME`, generic `known_machine_marker` (markers.json), Supabase pull is an
   optional adapter with no Travelio paths. Everything written inside Travelio was reverted (verified clean).
4. Private calibration corpus re-pulled WITH persona ids: `eval/data/corpus_user_messages.json`
   (17,944 rows; fields id,label∈{REAL,SYNTH,OTHER},writer_id R0–R2|null,persona_id hash|null,content,
   created_at,language). 2,712 REAL from three humans, 14,785 SYNTH from 1,285 GPT personas. No phone numbers.
   `eval/data/data_split.json` is DATA's leakage-safe split by message id.

## Scope change 2026-09-09: ARABIC IS OUT — English + Turkish only (HEAD-RULINGS R22)

## Not done — the next step is the BUILD ROUND
Run `docs/design/workflow-build.js` with the Workflow tool:
  Workflow({ scriptPath: "<abs path>/docs/design/workflow-build.js",
             args: { repo: "/Users/sfaai/Desktop/llm-detect" } })
It launches B1 (core), B2 (eval+fixtures), B3 (agent+docs) in parallel — disjoint file ownership — then the
CAL lane (selftest → public datasets → splits → run-eval → fixture gates → eval/out/REPORT.md). Every agent
is `model: 'opus'`. Then the head runs SPEC §I acceptance checks 1–12 (paths relative to this repo root),
launches a verify round (adversarial refuter, code review of Unicode/regex handling, end-to-end agent test),
copies the fitted weights decision into HEAD-RULINGS, commits.

## Do not
- Touch `~/Desktop/travelio-asim-shadow`. Re-pull the corpus. Call any paid API. Use fable/sonnet/haiku.
- Ship `⟡V3⟡` / `TRV-` patterns as defaults (they belong to one product; markers.json ships empty).
