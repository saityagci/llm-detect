# CLAUDE.md — llm-detect

Standalone project: a zero-dependency Node tool + a global Claude Code agent that judges whether a text
(English and Turkish; reviews, chat messages, emails, essays) was written by a human or generated
by an LLM. **This project is NOT part of Travelio.** Never read from, write to, or run anything inside
`~/Desktop/travelio-asim-shadow`. The only Travelio-derived asset is the private calibration corpus
already sitting in `eval/data/` (gitignored); do not re-pull it.

## Owner rules (Sait) — standing, non-negotiable
- **Reply in Turkish** in chat; code, paths, regex and commit messages stay English.
- **Head-of-agents**: the session organizes, briefs, reviews and approves; agents build. The head owns
  briefs, acceptance checks, commits, pushes and the verdict — not the keyboard.
- **Every agent call names `model: 'opus'`.** `fable`, `sonnet` and `haiku` are forbidden. Fleet SIZE is the
  cost lever: merge adjacent briefs, keep fleets small. Workflows only when the owner has ultracode on or
  asks by name. Never kill running agents to apply a routing change.
- **Zero paid API spend.** No OpenAI, no Anthropic API calls from code, no hosted detectors. The shipped
  tool is zero-dependency and offline; only `eval/fetch-public-datasets.mjs` touches the network
  (Hugging Face datasets-server, unauthenticated, capped).
- **Brutal honesty over optimism.** Never quote an accuracy without its base rate, language, length bucket
  and the three-humans caveat. Report held-out numbers only; label any train number `(train, reference only)`.
  "insufficient_text" is a deliverable, not a failure.
- **Language scope EN + TR only.** Arabic is OUT (owner, 2026-09-09; HEAD-RULINGS R22). No IT/FR/ES/AR rows, corpora or tickets.
- **PII**: `eval/data/` and `docs/design/private/` are gitignored because they hold real chat messages.
  Committed fixtures may contain corpus rows only from writer R0 (the owner's own messages), name-scrubbed.
  Never a phone number in a tracked file (`grep -rE "\+?[0-9]{10,15}"` is an acceptance check).
- **Commit and push without being asked** once a remote exists; a commit that is not pushed did not happen.

## Where the truth lives
- `docs/design/SPEC.md` — the implementation contract (features, CLI/JSON schema, scoring, decision table,
  agent prompt, eval plan, acceptance checks).
- `docs/design/HEAD-RULINGS.md` — head amendments; **they override SPEC where they conflict**, including
  Part 2 (standalone layout) and R22 (Arabic out, generic `known_machine_marker`, `LLM_DETECT_HOME`, the Supabase adapter).
- `docs/design/D1-stylometry.md`, `R1-research.md` — feature computations/lexicons and the evidence brief.
- `docs/design/private/` (gitignored) — D2 rubric + adversarial tests, DATA contrast study, the round-1 agent draft.
- `HANDOFF.md` — current state and the exact next step.

## Layout (target — see HEAD-RULINGS R16)
```
stylometry.mjs (+ lib/)   zero-dep ESM, importable and CLI      selftest.mjs        node selftest.mjs → exit 0
lexicon-src/ build-lexicon.mjs lexicon.v1.json weights.v1.json   markers.json        known machine markers, ships []
agent/llm-text-detector.md   install.sh → ~/.claude/agents/     RUBRIC.md README.md
eval/ run-eval.mjs fetch-public-datasets.mjs make-splits.mjs adapters/supabase-messages.cjs fixtures/ data/ out/
```

## Commands
```bash
node selftest.mjs                                   # unicode + segmenter + goldens + invariants + must-not-fire
node stylometry.mjs --text "..." --allow-uncalibrated --json
node stylometry.mjs --jsonl rows.jsonl --allow-uncalibrated
node eval/run-eval.mjs --quick                       # held-out metrics, hard mode, LOWO, negative controls
./install.sh                                        # installs the global agent; then: "use the llm-text-detector agent on <text|path>"
```
