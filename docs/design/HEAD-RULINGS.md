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

## R22. ARABIC IS OUT OF SCOPE (owner, 2026-09-09: "there is no arabic")
Language scope for this project is **English + Turkish**. This overrides every "EN/TR/AR" and "Arabic first" line in SPEC.md, Part 1 and Part 2, and in the lane documents.
- Do NOT build: `ar_dialect_markers`, `ar_orthographic_shortcuts`, `arabizi`, `ar_tashkeel_band`, `ar_tatweel`, the AR lexicons (`lexicon-src/ar.txt`, `human-ar.txt`, `arabizi.txt`), the AR rows of every shared lexicon/regex (assistant_frame_leak AR patterns, AR openers/closers/hedges/politeness), `llm-ar.jsonl`, the two KFUPM Arabic datasets, the Arabic rubric criteria, the Arabic reporting rule, the Arabic caveat texts.
- Weight cells become `{en,tr} × {chat,prose}` (four, not six).
- Language ID still recognises Arabic script — only to return `language.primary = "unsupported"` and `insufficient_text` with `gates.failed: ["G3_lang"]` and `reason: "unsupported_language"`. Never score it.
- The private corpus: rows whose dominant script is Arabic (writer R1, many personas) are EXCLUDED from calibration by make-splits.mjs (script filter, reported as a count). Leave-one-writer-out therefore runs over R0 and R2 only; say so in the report.
- `must-not-fire.jsonl`: drop the Arabic rows; the gate applies to the rows that remain (report the counts).
- The Unicode facts of SPEC §B.9 that concern Arabic (AR_LETTER, tatweel in WORD_RE, `\p{Nd}` for Arabic-Indic digits) stay in the tokenizer/selftest because they protect script detection and the no-`\d` rule; they are not features.
- Any SPEC or lane text about Arabic that is not listed here is reference material, not a deliverable.

# PART 3 — BUILD-ROUND RULINGS 2026-09-09 (after B1/B2/B3 + CAL, before the verify round closed)

## R23. `eval/out/weights.fitted.json` does NOT become the default — `weights.v1.json` (prior) stays
Measured, not hoped: the fitted file covers only two of the four cells (`en:prose`, `tr:chat`); `en:chat` and `tr:prose` say "not fitted — too few rows survived the gates". The fairness-constrained threshold could not be evaluated on the non-native or formal-register strata in either fitted cell (fewer than 20 human rows each), so the R11 condition "passes the fairness-constrained thresholds in both languages" is not met — it is not measurable. `tr:chat`'s fitted t is 1.000 (flags only rows the isotonic map pinned at certainty) and its hard-mode AUC is 0.443, below chance. Eight fitted coefficients in `en:prose` carry the opposite sign to §B (including `terminal_punct_ratio` at −0.175), which SPEC §D.5 step 5 says to investigate, not ship. RULING: the CLI default remains the prior file; `--weights eval/out/weights.fitted.json` stays available for the caller who wants the fitted `en:prose` cell and accepts the report's caveats. Re-decide when a cell has ≥100 human rows per length bucket on the test side AND ≥20 rows in each fairness stratum.

## R24. Register-proxy LLM evidence cannot carry `leaning_llm` on its own (arbitration of fixture A7, revised after the refuter)
Fixture `must-not-fire` A7 (a polite, correctly spelled Turkish guest booking message, 45 tokens, WhatsApp) came out `leaning_llm` on `terminal_punct_ratio` (z 2.17 — 59 % of the LLM channel on its own), `sentence_initial_caps`, `greeting_signoff_frame`, `politeness_formula`, with a human channel of exactly 0 because §B.4 deliberately gives correct orthography weight zero. CAL showed it is not one fixture (three of the 30 support-desk lines lean LLM at `--domain general`), and the verify-round refuter reproduced it on 9 of 35 authored human texts: careful Turkish and native-English formal WhatsApp guests (A7 class), un-flagged support-desk lines, an L2 TOEFL essay, a human forwarding an itinerary. The mechanism is SPEC §0 / §H.2–H.4 on schedule: the LLM-direction features that a formal, careful or non-native human produces for free, measured against μ/σ guessed from three telegraphic WhatsApp writers. A first draft of this ruling (proxy set = hard-mode set + the two politeness formulas) was tested against those 9 texts and would have protected 0 of 9, because `llm_lexicon_weak` (one ordinary "ayrıca"), `out_of_channel_register` (any ≥400-char two-paragraph WhatsApp message) and the prose rhythm/connector trio let every one of them escape. RULING (amends §D.3; it re-states the "≥2 features from ≥2 groups" invariant over non-proxy features):
- `REGISTER_PROXY_LLM = { terminal_punct_ratio, sentence_initial_caps, em_dash_in_chat, exclam_single_regular, emoji_bullet_led, politeness_formula, greeting_signoff_frame, tr_formal_copula, out_of_channel_register, llm_lexicon_weak }`. These may contribute to the score and the LLM channel (they still rank a queue) but never to the verdict on their own.
- `leaning_llm` requires at least TWO LLM-direction signals with `contribution > 0` that are NOT in `REGISTER_PROXY_LLM`, from at least two different groups. Otherwise the table's `leaning_llm` becomes `uncertain`, `warnings` gets `register_only_evidence`, `notes` names the proxy features that fired and how many non-proxy ones were found. Score, channels, Tier-0 rules and the human side are untouched; a rule still yields `likely_llm`.
- Consequence, stated: in single-message CHAT shape a style-only `leaning_llm` now needs a strong-lexicon hit plus a structure signal (`bold_lead_in_list`, `colon_led_list`, `balanced_contrast_frame`) or a rule. No chat-length human-vs-LLM corpus exists (SPEC §F.4), Turkish chat detection measured as format-only (AUC 0.975 → 0.443 in hard mode), and the design's own chat answer is `--aggregate`; the recall given up here was keyboard detection. In PROSE the rhythm and connector features (`sentence_len_mode_mass`, `parallel_openers`, `closing_summary_move`, `balanced_contrast_frame`, `enumerated_openers`, `hedge_density`) stay non-proxy because they survive hard mode (en:prose 150–499: AUC 0.887 → 0.859); an L2 essay built on taught connectors can therefore still lean LLM. That is the §G.2 bias, it stays documented, and the judge's C10 is its mitigation, not the CLI.
- Rejected alternatives: raising `mu` for `terminal_punct_ratio` (a guess replacing a guess; the table row `llm 0.25–0.6 × human < 0.25` still yields `leaning_llm`), narrowing `greeting_signoff_frame` alone (A7 stays at llm 0.62 without it), widening the fixture's `allowed` set (the fixture encodes the design's promise).
- selftest: A7 → `uncertain` with `register_only_evidence`; the `**Location:**` review (lexicon-strong + structure) → still `leaning_llm` without that warning; the refuter's H01/H07/H13/H15/H34 (`.scratch/refuter/texts/`, copied into the committed fixtures as head-approved authored rows) → `uncertain`; H03/H04 may stay `leaning_llm` and are recorded as the known ESL confound.

## R25. G4 (≥ 6 active features for prose) stays; the 50–119-token prose band abstains and says so
34 of the 50 authored LLM fixtures (90–110-token prose) return `insufficient_text` with G1–G3 passed and `too_few_active_features`, because the rhythm features switch on at 120–250 tokens. The measured `en:prose` 50–149 bucket says the scorer is barely useful there anyway (AUC 0.757, hard mode 0.603, TPR 4.7 % at 1.1 % FPR). RULING: do not lower G4 to score a band where the instrument is weakest. Instead: (a) README "what was not verified" and REPORT state that prose between 50 and ~120 tokens mostly abstains; (b) B2 rewrites the six prose humanization PAIRS per language (clean + `b`/`c` twin: hr, pr, em) at 160–260 tokens both sides so the §F.3 collapse assertion is measurable — same genre mix, provenance and transform recorded, row count unchanged; chat pairs stay as they are; (c) gate-fixtures reports how many pairs became measurable and the delta.

## R26. Housekeeping rulings from the head's acceptance run
- `score`, `channels.*` and `scoring.scoreUncapped` are printed at 12 decimals (contributions already are), so acceptance check 7 (`Σcontribution + b0Effective == logit(score)` within 1e-9) holds from the JSON alone; 6-decimal rounding put it at 1.3e-6.
- `run-eval.mjs --quick` writes to `eval/out/quick/` unless `--out` is given. A smoke run overwrote the release `REPORT.md` and `weights.fitted.json` once this round; the release report is regenerated by `node eval/run-eval.mjs && node eval/gate-fixtures.mjs --real 200 --append eval/out/REPORT.md`.
- `eval/out/REPORT.md` is machine-generated only. Hand-written findings (defects, the CAL network wedge, head rulings) live in `eval/README-eval.md` under "Findings log", so a regeneration cannot lose them.
- The phone-shaped-digit acceptance grep covers the deliverables (repo root minus `docs/design/`); the one tree-wide hit is a news-article id inside a URL in `docs/design/R1-research.md`, not a phone number, and it stays.
- `HANDOFF.md` is rewritten by the head at the end of the round in generic wording (no product marker strings).

## R27. `assistant_frame_leak` precision and recall fixes (refuter defects D1–D3, D5, D6, 19 misses)
The rule bypasses every gate and is the main road to `likely_llm`, so a false fire is the worst output the tool has. The refuter made it accuse a human three ways and slip past it nineteen ways. RULING:
- Quotation/discussion suppression: the cue search runs over the WHOLE document (raw), not a 100-char window, and the cue list becomes `chatgpt | claude | gemini | copilot | gpt(-\d)? | llm | chat ?bot | bot | assistant | asistan | \bAI\b | yapay zek[aâ] | dil modeli`. A cue that overlaps the matched span or sits within one token of it does not count (so "As an AI assistant, I cannot…" still fires and the rule cannot suppress itself). When suppressed: `notes` gets `possible_quotation_or_discussion: <cue>` and the rule does not fire. Precision over recall: an LLM text that both discusses AI and self-identifies is a miss we accept.
- Common-noun guard: bare `language model` no longer fires. It fires only in a self-identification frame: `(as|i'?m|i am|being|since i am) (just |merely |only )?an? (ai|large|artificial intelligence)? ?(language model|llm)`.
- Whitespace: rule patterns match on a whitespace-normalised copy of raw (`\s+` and NBSP collapsed to one space; line breaks included) and report the matched string from raw. Double spaces, a soft wrap and NBSP defeated every pattern.
- Turkish: `zek[aâ]` everywhere; add `bir (yapay zek[aâ] )?dil modeli(yim| olarak)`, `yapay zek[aâ] (modeli|asistanı)(yım|yim)?( olarak)?`, `eğitim verilerim`, `bilgi kesim tarih`, `gerçek zamanlı (erişim|veri)\w* (yok|bulunm)`.
- English: `i'?m (just |merely |only )?an? ai\b`, `i am (just |merely |only )?an? ai\b`, `my knowledge cut-?off`, `real[- ]time`, `(don'?t|do not|cannot|can'?t|am unable to) (have )?(access to|browse) (the )?(internet|web)`, `i (was|am|have been) trained on data`, `here'?s (your|a|an|the) (revised|rewritten|polished|updated) (version|draft|text)`, `i have (rewritten|revised|drafted|polished) (it|this|the)`. Every added pattern must be a first-person self-identification or a drafting frame; each ships with one positive and one human-negative selftest line (the refuter's `.scratch/refuter/leakprobe.mjs` list is the source).

- Implementation amendments accepted from FIX-B1 (2026-09-09): (i) "within one token" is implemented as "0 word tokens and ≤16 raw characters from the frame span" — the literal reading let `the bot said: As an AI…` accuse a human, and whitespace normalisation made a cue 90 spaces away look adjacent; `As an AI assistant, I cannot…` still fires. (ii) A third-person subject immediately after the frame (`…that as an AI he could not…`) suppresses it as reported speech; `As an AI, they/she/he …` is an accepted miss. (iii) Suppression is reported as note `assistant_frame_suppressed: "<match>" — possible_quotation_or_discussion: <cue>`. (iv) `gates.reason` stays `language_unknown` for unknown scripts and `unsupported_language` for Arabic-dominant text; both are equally non-bypassable by any rule (`language_gate_not_bypassable` note when a rule matched anyway).

## R28. `known_machine_marker` inside a human-written message is a hybrid, not a machine text (refuter D4)
A marker match proves that a machine-written segment is present, not that the message is machine-written. When the marker is the only Tier-0 rule and the human channel is > 0.6 (or ≥2 human-direction signals from ≥2 groups fire), the verdict is `uncertain` with `warnings: ['pasted_machine_text', 'hybrid_suspect']` and a note "machine-written segment inside a human-written message; the sender may be forwarding it". Otherwise SPEC §B.1 stands (`likely_llm` + `pasted_machine_text`). Mirrors G6.

## R29. Aggregate mode gates and features (refuter's aggregate observations)
The concatenation of a sender's turns is an artefact: its "paragraphs" are messages. RULING: `out_of_channel_register` and `paragraph_uniformity` do not run in aggregate mode. Aggregate gates are the 5-message floor plus the CHAT floors on the concatenation (100 chars, 20 tokens, 3 active features), not the prose floors — six typical WhatsApp turns (~190 chars) must produce a report, not `below_char_floor`. `likely_human` keeps its own requirements (≥3 human features incl. one expensive-to-fake, no rule, band ≥ 150 tokens).

## R30. Homoglyph and non-ASCII-Latin evasion gets a warning (refuter D8, SPEC §H.9)
A Cyrillic "а" or a fullwidth "Ｈ" inside an English word flipped `likely_llm` to `insufficient_text` with no trace. RULING: any word token that mixes scripts, or contains code points from Halfwidth/Fullwidth Forms or Mathematical Alphanumeric Symbols, adds `warnings: ['homoglyph_suspect']` with the count; rules and lexicon matching additionally run on a confusable-folded copy (a small explicit table: fullwidth → ASCII, the common Cyrillic/Greek look-alikes → Latin) so the leak rule still fires. Detection power against a real adversary stays zero and the README keeps saying so; the fix is the warning, not a defence.

## R31. Agent, RUBRIC and installer rulings from the end-to-end test
The installed agent ran for real from `~/.claude/agents/` through a headless session, resolved the tool via `LLM_DETECT_HOME`, read RUBRIC.md, applied the §E.1 table correctly on six texts and a six-row batch, and never printed a percentage on a verdict line. Defects and gaps, ruled:
- (a) `LLM_DETECT_HOME` set but invalid ⇒ the tool is MISSING. No second lookup path. The agent judges alone, capped at `leaning_*`, and says so on the CLI line. The `${LLM_DETECT_HOME:-$HOME/Desktop/llm-detect}` default applies only when the variable is unset.
- (b) A CLI `insufficient_text` row never receives a JUDGE verdict or band, in single or batch mode. At most one line, labelled "what little can be seen (not a verdict)". RUBRIC §3 and the agent file say the same thing.
- (c) Percentages: never as this text's confidence, band or probability. A published FPR / base-rate citation may appear only in CAVEATS, with its source named.
- (d) `--context` and `--channel` are passed only when the caller states them; otherwise `--context auto --channel unknown`. The CLI line prints the flags used and, on `insufficient_text`, the gate reason (`below_char_floor` vs `too_few_active_features` are different findings).
- (e) Judge-side `likely_llm` (§E.2) gains the artifact route: ONE artifact-class criterion quoted verbatim from the text (leaked assistant frame, markdown in a non-markdown channel, a configured machine marker, a near-duplicate) at ≥20 words is sufficient, mirroring the CLI's rule-gated path. Without it a fingerprinted text (CLI LL) landed on the same final as a style-only text (CLI EL), which inverts the design.
- (f) Judge-first is a protocol, not a promise: the agent writes its judgement file BEFORE invoking the CLI (procedure steps reordered; the CLI JSON is opened only after the judgement file exists).
- (g) CAVEATS labels are exactly `• length:`, `• language:`, `• writer:`, `• provenance:` (machine-parseable).
- (h) `install.sh --dry-run` never exits non-zero (the dry branch precedes the refusal branch); `--help` prints no stray script text.
- Untested this round and recorded for the next: the CONFLICT (⚠) block never rendered because no text split the two instruments.

## R32. Language ID: zero-vote Latin text is `mixed`, and ASCII-fied Turkish votes Turkish (core)
A 14-word ASCII-folded Turkish WhatsApp line came back `language.primary = "en"` at confidence 0.25 with the note `latin_subid_no_votes`. SPEC §B.9 already says the two Latin sub-IDs within one vote ⇒ `mixed`; zero votes each is within one vote. RULING: zero-vote Latin ⇒ `mixed` (script-agnostic feature set, `mixed_language_reduced_features`), never `en`. The `tr_asciified_probe` word list (icin, cok, degil, kisiyiz…), the Turkish chat slang list (naber, reis, abi, hocam…) and ASCII-fied Turkish suffix shapes (`-yiz`, `-iz`, `-siniz`, `-lar/-ler`, `-dan/-den`, `-ca/-ce`) count as Turkish votes. Folded Turkish is the documented shape of real Turkish chat and must not route into the `en` cell with English lexicons.

## R33. The verify-round texts become a committed fixture and part of the gate
`eval/fixtures/verify-round-1.jsonl`: the refuter's 35 human and 8 LLM texts (authored in-session, no corpus rows, provenance per row), each with `allowed` / `criticalFailure` per R24, R27, R28 (human rows: `insufficient_text | uncertain | leaning_human`, critical `likely_llm`; the two ESL-connector essays additionally allow `leaning_llm` and carry `note: "known §G.2 confound"`; the marker rows carry `requiresMarkers`; LLM rows forbid `likely_human`, and the two mimicry rows carry `expected_evasion: true`), plus the assistant-frame-leak probe list as rows with `expectRule: true|false`. `selftest.mjs` reads it if present (B1 ships an inline subset), `gate-fixtures.mjs` reports it, and the gate adds: zero `likely_llm` on its human rows, every `expectRule` row correct.

## R34. Second-pass leak-rule precision, silent abstention, code-switch note (from the verify-round fixture run)
- `assistant_frame_leak`, Turkish: the first-person marker is mandatory — `bir yapay zek[aâ] (modeli|asistanı)(yım|yim)` / `yapay zek[aâ] (modeli|asistanı) olarak` / `bir (yapay zek[aâ] )?dil modeli(yim| olarak)`; the bare common noun "yapay zeka asistanı" never fires. English: R27's tighter drafting frame REPLACES R1's `here('s| is) (a|an|the) (draft|revised|rewritten|polished)`; "Here is the revised itinerary my colleague sent over" is human. Both false fires came from `eval/fixtures/verify-round-1.jsonl` rows N07/N09, which stay in the gate as human-negatives.
- Every `insufficient_text` report carries a non-empty `reason`. The SPEC §D.3 bottom-left cell (llm < 0.25 and human < 0.25) reports `reason: "no_evidence_either_way"` with both channel values in a note; five rewritten email fixtures had abstained with all five gates passed and no explanation.
- `code_switch_observed` counts only English function words that are not also Turkish tokens (TR stopwords, the ASCII probe list and single letters excluded) and needs ≥3 hits and ≥10 % of tokens; an all-Turkish text had reported 24 "English function words".
- `gate-fixtures.mjs` exits 3 on a verify-round gate failure as well as a §I failure; that is the intended release signal.
- Findings recorded, not tuned: transform (b) is a measured no-op in prose on three of five pairs (its two targets are chat-only features) and transform (c) raised one Turkish email's score; the §F.3 "humanized scores lower" assertion is now measurable and partly false.

## R35. Agent report discipline, from end-to-end round 2 (the CONFLICT block rendered for the first time)
Through the installed copy, six engineered texts: the ⚠ CONFLICT block rendered correctly on the two EL×EH cells with both sides printed and no averaging; R31 (a) tool-missing (no fallback, capped `leaning_*`), (b) batch abstentions unjudged, (c) percentages, (f) judge-first all PASS; R28's hybrid marker produced the right provenance caveat. Remaining defects are report discipline, ruled:
- (a) CAVEATS labels get their OWN line in the agent file: exactly `• length:` `• language:` `• writer:` `• provenance:` and an optional fifth `• calibration:` — bullet `•`, no dash, no bold. Two of six runs wrote `- length:` / `- **length:**` after R31(g) had said the same thing inside a longer step; a parser misses a third of reports.
- (b) `[CONFLICT]` is printed ONLY in the six ⚠ cells of §E.1 — CLI LL×judge EH, LL×LH, EL×EH, EL×LH, EH×LL, LH×LL. CLI EH × judge EL is `uncertain` WITHOUT the tag. RUBRIC lists the six cells; the agent file points at that list. A batch run tagged an EH×EL row.
- (c) The CLI line always names the flags used (`context`, `channel`, `lang`, `domain`, `markers` when passed); one of five runs omitted them.
- (d) Invariant 4's reason "the text is a pasted template or machine output" applies only when the whole text, or all of it but a greeting line, is the paste; a message that merely contains one pasted line does not qualify. Single and batch runs had read this differently on the same bytes.
- (e) The judgement file is written once and never reopened; anything the agent wants to note after seeing the CLI goes to a second file, so an mtime audit of judge-first cannot give a false failure.
- (f) Between judging and invoking the CLI the agent reads only RUBRIC.md and the text — never the instrument's source (one run grepped `lib/` for "whatsapp").
- Recorded, not fixed: no run exercised `likely_llm` as a final, R31(e)'s artifact route, `register_only_evidence`, `homoglyph_suspect` or `templated_or_copied` through the agent; all six texts were Claude-authored, so the round measures the report mechanics, not accuracy.
