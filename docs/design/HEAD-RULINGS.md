# HEAD RULINGS — amendments to SPEC.md (these override SPEC where they conflict)

Reviewed by the head 2026-09-09 after reading SPEC.md in full. SPEC is APPROVED with the following amendments.
Builders read SPEC.md first, then this file. Where they conflict, THIS FILE WINS.

## R1. Tier-0 `assistant_frame_leak` is narrowed to true self-identification / drafting frames
The rule bypasses every gate and is the only road to `likely_llm`, so it must be near-100% precision. Several of SPEC §B.1's patterns are ordinary human chat ("Sure, sounds good!", "let me know if you need anything", "hope this helps", "size nasıl yardımcı olabilirim" is what a human receptionist says). RULING:
- KEEP as rule patterns: `as an AI`, `I'm an AI`, `I am an AI`, `language model`, `my (training data|knowledge cutoff)`, `I (don't|do not) have (access to )?real-time`, `I cannot browse`, `here('s| is) (a|an|the) (draft|revised|rewritten|polished)`, `as of my (last|latest) (update|training)`; TR: `bir yapay zeka (modeli|asistanı)(yım)?`, `yapay zeka dil modeli`, `bilgi kesim tarih`; AR: `كنموذج ذكاء اصطناعي`, `نموذج لغوي`, `بصفتي ذكاء اصطناعي`.
- MOVE to `llm_lexicon_strong` (weight per SPEC, NOT a rule): `^(sure|certainly|absolutely|of course)[,!]`, `I hope (this|that) helps`, `let me know if you (need|have|'d like)`, `would you like me to`, `feel free to (ask|reach out)`, `umarım (bu )?(bilgiler )?yardımcı ol(ur|muştur)`, `başka bir sorunuz olursa`, `size nasıl yardımcı olabilirim`, `نأمل أن (تكون|يكون)`, `هل تود مني`, `لا تتردد في التواصل`. Tag the support-desk ones `domain:'cs'` so `--domain customer_service` zeroes them.
- The quotation/"talking about chatgpt" suppression from SPEC still applies to the rule.

## R2. `markdown_in_chat` — plain dash bullets alone are NOT a rule hit
A human on WhatsApp writes "- 2 yetişkin\n- 1 çocuk" all the time. RULING: the rule fires only on (a) a markdown header `^#{1,6} `, or (b) DOUBLE-asterisk bold, or (c) a fenced code block, or (d) a pipe table, or (e) ≥2 bullet lines AND at least one bullet with a bold lead-in (`- **X:**`). Plain bullet lines alone feed the weak `colon_led_list`/structure signals, never the rule.

## R3. `near_duplicate` proves "not independently authored", not "LLM"
A near-duplicate across senders is template/copy/spam evidence. RULING: it stays a Tier-0 rule (high precision for its own claim) but ALONE it drives the final verdict to `leaning_llm` with `warnings:['templated_or_copied']` and a report line "duplicate of <id> at Jaccard J — template or copy; not proof of LLM authorship". `likely_llm` via near_duplicate requires a SECOND Tier-0 rule.

## R4. Own-bot marker and reference-code formats (verified in the repo, not assumed)
- Marker regex: `/⟡V3(?:-FALLBACK)?⟡/` (the FALLBACK variant exists: backend/src/routes/whatsapp.ts:95).
- Reference codes are `TRV-` + 6 ASCII digits (e.g. TRV-500592). A customer may retype with Arabic-Indic digits and may drop the hyphen. Regex: `/\bTRV-?[0-9٠-٩]{5,7}\b/u`. Never `\d`.

## R5. `detect()` stays pure — the expiry clock comes from the caller
SPEC §D.4 calls `Date.now()` inside scoring while §C.6 says `detect` is pure. RULING: `detect(text, opts)` takes `opts.now` (ms epoch, optional). The CLI passes `Date.now()`; the library default is `now = undefined` ⇒ expiry check skipped and `warnings` gets `expiry_not_checked`. Determinism test runs with a fixed `now`.

## R6. `--domain` default stays `general`
The agent passes `--domain customer_service` only when the caller states the text comes from a support desk / agency staff. README lists failure mode #4 verbatim. No auto-detection of domain this round.

## R7. Customer-service snippet library — B2 authors it
No such file exists in the repo. B2 writes `eval/fixtures/cs-snippets.jsonl`: 30 rows (10 EN / 10 TR / 10 AR) of realistic human support-desk phrases (hotel/travel agency), used as negative control (e). Any row scoring above τ goes on the domain-suppression list in the eval report; B1 is told via the head, not edited by B2.

## R8. PII in committed fixtures — hard rules
- `human-chat.jsonl` is NOT committed. `make-splits.mjs` generates it under `eval/data/` (gitignored) from the pulled corpus at eval time.
- Corpus-derived rows in COMMITTED fixtures (`judge-tests.jsonl`, `must-not-fire.jsonl`) are allowed ONLY from writer R0 (the repository owner's own messages). No R1/R2 rows, no persona rows containing names.
- Every committed row that came from the corpus passes a deny-by-default scrub: any capitalized/proper token that is not in an allowlist (cities, hotel-catalogue words, months, weekdays, room types, function words) becomes `[NAME]`; any `TRV-…` becomes `[REF]`; any digit run ≥7 becomes `[NUM]`. Guest-name-shaped tokens after `isim/isimler/adı/names/الأسماء` are ALWAYS `[NAME]`.
- The head's acceptance grep for phone-shaped digit runs applies to every tracked file under tools/ and .claude/agents/.

## R9. Public-dataset caps (no silent caps)
`fetch-public-datasets.mjs` pulls at most 1,500 rows PER LABEL PER DATASET (MAGE and Fake-Reviews included), pages `/rows` with `length=100`, records the cap and the actual count in `manifest.json`, and prints "capped at N of M" to stderr. Total download must stay under ~60 MB. One attempt at ALHD (Zenodo record 17249602) is permitted: HEAD the file list first; skip and record "skipped: size/unavailable" if any file exceeds 50 MB or the record is not directly downloadable.

## R10. No second generator, no API spend
Hard-mode and humanized fixtures are authored in-session by the builder (Claude-written text IS LLM text). Provenance is recorded per row. This is the substitute for SPEC's "commission a second generator" and it is final.

## R11. Shipped default weights
B1 ships `weights.v1.json` (prior). CAL produces `weights.fitted.json`. The CLI default remains the prior file this round; the head decides after reading the eval report whether the fitted file becomes the default. Nobody flips it unilaterally.

## R12. Determinism across Node versions
Only Node v24.5.0 is installed. `selftest.mjs` asserts byte-identical output across two runs in the same process and across two separate processes; the "two Node minor versions" clause is recorded as NOT VERIFIED in the selftest output, not silently dropped.

## R13. Agent-file model line
`model: opus` — owner ruling 2026-09-03. Not fable, not sonnet, not haiku.

## R14. Sibling-safety for builders (the fleet shares one repo)
- Touch ONLY the files SPEC §I assigns to you. Never `git stash`, `git checkout`, `git add`, `git commit`, `git reset`, never edit `.gitignore` except B2's single line, never touch backend/ or frontend/ or CLAUDE.md.
- Scratch files go under the session scratchpad, never the repo root, never /tmp.
- Do not run jest, gate.sh, live tests or any paid API. `fetch-public-datasets.mjs` is the only file that touches the network and only `datasets-server.huggingface.co` (+ the one ALHD Zenodo attempt in R9).
- The DB read in `pull-messages-corpus.cjs` is a READ; the head has approved one execution by the CAL lane. Builders do not run it.

## R15. Build priority inside B1 (if context runs short, ship in this order)
1. §B.9 pipeline + language ID + segmenter + tokenizer with the Unicode assertions;
2. Tier-0 rules (as amended by R1–R4) and the gates/caps;
3. Tier-1 features, lexicons via build-lexicon.mjs, Aho-Corasick;
4. scorer (two channels, 2-D table, ≥2-features-from-≥2-groups invariant, contribution-sum invariant);
5. CLI flags incl. `--jsonl`, `--aggregate`, `--corpus`, exit codes;
6. selftest.mjs.
Ship a smaller CORRECT tool over a larger broken one; say exactly what was cut.

# PART 2 — OWNER CLARIFICATION 2026-09-09: THIS IS NOT A TRAVELIO FEATURE

The owner: "this is not related with travelio project". Everything below OVERRIDES SPEC.md and Part 1 wherever they assume the Travelio repo or Travelio traffic.

## R16. Location: standalone project `~/Desktop/llm-detect` (its own git repo) + a GLOBAL agent
Nothing is written inside `~/Desktop/travelio-asim-shadow` — not a file, not a .gitignore line, not a scratch probe. Layout of the standalone repo:
```
llm-detect/
  package.json                 { "name":"llm-detect", "type":"module", "private":true, "engines":{"node":">=20"},
                                 "bin":{"llm-detect":"./stylometry.mjs"}, "scripts":{"selftest":"node selftest.mjs","eval":"node eval/run-eval.mjs"} }  NO dependencies field.
  stylometry.mjs  (+ lib/*.mjs local modules allowed)
  lexicon-src/  build-lexicon.mjs  lexicon.v1.json  weights.v1.json  selftest.mjs
  markers.json                 (R17) user-configurable known-machine markers; ships as []
  RUBRIC.md  README.md  LICENSE (MIT, owner's name left as "<owner>")
  agent/llm-text-detector.md   source of truth for the agent (B3)
  install.sh                   copies agent/llm-text-detector.md to ~/.claude/agents/ and prints the LLM_DETECT_HOME line to add to the shell profile (B3)
  eval/  run-eval.mjs  fetch-public-datasets.mjs  make-splits.mjs  README-eval.md
         adapters/supabase-messages.cjs   (R18)
         fixtures/*.jsonl   data/ (gitignored, .gitkeep)   out/
  docs/design/                 the head copies SPEC/HEAD-RULINGS/R1 here after a PII grep (not a builder task)
  .gitignore                   eval/data/  node_modules/  .env  *.log  .DS_Store
```
`tools/llm-detect/...` paths in SPEC map to the repo root of this project. `.claude/agents/llm-text-detector.md` in SPEC maps to `agent/llm-text-detector.md` here, installed globally by install.sh.

## R17. `own_bot_marker` becomes the generic `known_machine_marker` rule
The `⟡V3⟡` / `TRV-` patterns are one product's markers and do NOT ship as defaults. The rule reads `markers.json`: an array of `{ "name": string, "pattern": string (regex source, u-flag applied), "note": string }`, default `[]` ⇒ the rule never fires. `--markers <path>` overrides. Behaviour when a marker matches is unchanged from SPEC §B.1 (`warnings:['pasted_machine_text']`, the report says the string is machine-written and the sender may be forwarding it). README documents the format with a GENERIC example (e.g. a booking reference like `\bREF-[0-9]{6}\b` and a bot signature line); R4's regexes appear nowhere in committed files.

## R18. The corpus pull becomes an optional adapter, with no Travelio paths in committed files
`eval/adapters/supabase-messages.cjs`: flags `--env <path to a .env holding SUPABASE_URL + SUPABASE_SERVICE_KEY>` (required), `--table <name>` (default `messages`), `--human-ids <comma list of user_phone values that are known humans>` (required; mapped to R0..Rn in input order), `--synthetic-prefix <string>` (default `999`), `--out <dir>` (must be gitignored — `git check-ignore -q` guard, exit 2 otherwise), `--dry-run`, `--i-have-approval`. Loads `dotenv` and `@supabase/supabase-js` via `NODE_PATH` (documented: `NODE_PATH=/path/to/some/node_modules node eval/adapters/supabase-messages.cjs …`); if they are not resolvable it prints a one-line instruction and exits 2. Everything else from SPEC §I B2 item 1 (writer_id/persona_id hashing, never a phone number) stands. The CAL lane receives the actual env path and ids on the command line; committed docs and REPORT.md show them as `<env>` and `<ids>`.

## R19. The agent is GLOBAL, so it locates the tool via `LLM_DETECT_HOME`
The agent file resolves the tool at `${LLM_DETECT_HOME:-$HOME/Desktop/llm-detect}` and runs `node "$LLM_DETECT_HOME/stylometry.mjs" …` and reads `"$LLM_DETECT_HOME/RUBRIC.md"`. If the directory or the module is missing it says so and judges alone, capped at `leaning_*` (SPEC's last anti-pattern). Generic wording throughout: replace "our own bot", "our `⟡V3⟡` marker", "a paying customer", "our confirmations" with "a configured known-machine marker (markers.json)", "the sender may be a person forwarding machine-written text". Keep the Arabic-transliteration rule (the owner's terminal reverses RTL — that is about the owner, not the product). `model: opus` stands.

## R20. Generic framing in README and RUBRIC
The tool is for reviews, chat messages, emails and essays in EN/TR/AR. No "this product", "our traffic", "our customers". The in-house corpus facts stay because they are the only chat-length measurement that exists, described as: "a private WhatsApp customer-chat corpus with three human writers, used for calibration and never distributed". The verbatim §G.2 caveats keep their numbers. `--channel whatsapp` and `--domain customer_service` stay as generic options.

## R21. What the previous (stopped) build round left behind
B3 had written a first agent file; it is at `<scratchpad>/build-prev/llm-text-detector.md` — B3 may start from it but must apply R17/R19. Nothing else survived. Any `tools/llm-detect` partial under `<scratchpad>/build-prev/tools-partial` is reference only.
