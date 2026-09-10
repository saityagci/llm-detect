export const meta = {
  name: 'llm-detect-build',
  description: 'Build llm-detect (stylometry core, eval harness + fixtures, global agent + docs) from docs/design/SPEC.md + HEAD-RULINGS.md, then run calibration/eval',
  phases: [
    { title: 'Build', detail: 'B1 core, B2 eval+fixtures, B3 agent+docs — disjoint file ownership' },
    { title: 'Calibrate', detail: 'public datasets, splits, run-eval, fixture gates, honest report' },
  ],
}

const REPO = args.repo
const SCR = args.scr || `${REPO}/.scratch`
const DESIGN = `${REPO}/docs/design`
const PRIVATE = `${REPO}/docs/design/private`

const COMMON = `
PROJECT ROOT: ${REPO} (a standalone repo — NOT the owner's other project; never touch anything outside this repo). Read ${REPO}/CLAUDE.md, then ${DESIGN}/SPEC.md (the contract), then ${DESIGN}/HEAD-RULINGS.md in full — Part 1, Part 2 and R22 (ARABIC OUT) OVERRIDE SPEC wherever they conflict (Part 2 moves everything to this repo root: SPEC's tools/llm-detect/X is ${REPO}/X, SPEC's .claude/agents file is ${REPO}/agent/llm-text-detector.md, own_bot_marker is the generic known_machine_marker with markers.json, the corpus pull is eval/adapters/supabase-messages.cjs, the agent finds the tool via LLM_DETECT_HOME).
Supporting docs: ${DESIGN}/D1-stylometry.md (feature computations, lexicons, must-not-fire fixtures §7), ${PRIVATE}/D2-judge-agent.md (rubric C01-C20, adversarial tests §5 — PRIVATE: quotes real chat rows), ${DESIGN}/R1-research.md, ${PRIVATE}/DATA-contrast.md (+ contrast.mjs, contrast-results.json).
Private calibration corpus (gitignored, already pulled, DO NOT re-pull): ${REPO}/eval/data/corpus_user_messages.json — JSON array, fields id, label ∈ {REAL,SYNTH,OTHER}, writer_id (R0..R2 for the three humans, else null), persona_id (p-prefixed hash for generated personas), content, created_at, language. ${REPO}/eval/data/data_split.json is DATA's split by id.
STANDING RULES: zero paid API calls; network only in eval/fetch-public-datasets.mjs against datasets-server.huggingface.co (+ the single ALHD Zenodo attempt of R9); no git commands that change state (no add/commit/stash/checkout/reset); touch ONLY the files your builder id owns (SPEC §I mapped by R16); scratch under ${SCR}/<your-id>/; Node v24.5.0, ESM, zero runtime dependencies in the shipped tool; language scope EN + TR ONLY — Arabic is out per HEAD-RULINGS R22 (build nothing Arabic-specific; Arabic script ⇒ unsupported_language abstain); no Arabic lexicons or features are built (R22).
Verify by RUNNING (node), not by reading. Report exactly what you built, what you cut, every deviation with its reason. Final answer = structured output; long content goes in files.
`

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } },
    cut: { type: 'array', items: { type: 'string' } },
    verified: { type: 'array', items: { type: 'string' }, description: 'commands run and observed results' },
    open_for_head: { type: 'array', items: { type: 'string' } },
  },
  required: ['files', 'summary', 'deviations', 'cut', 'verified'],
}

const B1 = `${COMMON}
YOU ARE BUILDER B1 — the stylometry core. You own: ${REPO}/stylometry.mjs (+ ${REPO}/lib/*.mjs local modules), lexicon-src/*.txt, build-lexicon.mjs, lexicon.v1.json, weights.v1.json, markers.json (ships as []), selftest.mjs, package.json (per R16: no dependencies field).
Implement SPEC §B (features, amended by R1–R4 and R17), §B.9 pipeline (re-assert the Unicode facts in selftest), §C (CLI, JSON schema, --jsonl, --aggregate, --corpus, --markers, exit codes 0–4, pure detect() per R5), §D (gates, caps, two channels, 2-D verdict table, ≥2-features-from-≥2-groups invariant, rule-gated likely_llm, aggregate-gated likely_human, ship-time guard, six weight cells). Priorities per R15.
selftest.mjs: everything in SPEC §I B1 item 6 (Unicode assertions, segmenter fixtures, one golden per feature, contribution-sum invariant, determinism per R12, an inline copy of ≥6 must-not-fire fixtures from D1 §7, and all 24 if ${REPO}/eval/fixtures/must-not-fire.jsonl exists when you run). Exit non-zero on any failure.
Before finishing: run SPEC §I acceptance checks 1–7 (paths relative to ${REPO}) and paste observed output into 'verified'; then run the CLI on 10 varied inputs of your own (EN/TR chat and prose, plus one Arabic-script text that must come back unsupported_language, a leaked-assistant text, a text containing a marker you put in a temporary markers file, a formal non-native email) and include a verdict table in your summary confirming §D.3 behaviour.`

const B2 = `${COMMON}
YOU ARE BUILDER B2 — eval harness, fixtures, adapter. You own everything under ${REPO}/eval/ (fixtures, adapters, run-eval.mjs, fetch-public-datasets.mjs, make-splits.mjs, README-eval.md, out/.gitkeep). Do not touch .gitignore (already correct).
Deliver: eval/adapters/supabase-messages.cjs per R18 (DO NOT run it for real; a --dry-run against a nonexistent env must exit 2 with the one-line instruction); fetch-public-datasets.mjs (SPEC §F.1 seven sources + R9 caps + one ALHD attempt; you MAY run it once to prove it works, into eval/data/); make-splits.mjs (SPEC §F.2, §D.5 steps 1–3, reading the existing corpus file and data_split.json; generates eval/data/human-chat.jsonl per R8 — never committed); run-eval.mjs (SPEC §D.5 all ten steps, §G.1 tables, hard mode, leave-one-writer-out, per-stratum FPR, negative controls a–e, base-rate table, writes eval/out/weights.fitted.json + eval/out/REPORT.md; refuses IN CODE to print a train number in the headline table; zero-dependency logistic regression + isotonic calibration; Intl.Segmenter only as an offline oracle). It imports detect() from ../stylometry.mjs — B1 is building it concurrently: code against SPEC §C.3/§C.6 and stub the output shape under ${SCR}/B2/ if the module is absent when you test. Never edit B1's files.
Fixtures (committed): must-not-fire.jsonl (D1 §7, 24 rows, \`allowed\` verdict set each), judge-tests.jsonl (D2 §5, 14 rows, expectedFinal + criticalFailure — any row quoting an R1/R2 corpus message must be REPLACED by an R0 message of the same shape or your own text, and say which), llm-en.jsonl and llm-tr.jsonl (25 rows each per SPEC §F.3; no Arabic file — write the texts yourself in-session; record gen/prompt/transform per row), cs-snippets.jsonl (R7, 30 rows). Apply R8 scrubbing ([NAME]/[REF]/[NUM]) to every corpus-derived row.
Before finishing: run acceptance checks 8, 11, 12 (11/12 against your stub if B1 is not ready), \`git status --porcelain\` to confirm nothing under eval/data/ is tracked, and paste observed output into 'verified'.`

const B3 = `${COMMON}
YOU ARE BUILDER B3 — agent, rubric, README, installer. You own: ${REPO}/agent/llm-text-detector.md, ${REPO}/install.sh, ${REPO}/README.md, ${REPO}/RUBRIC.md, ${REPO}/LICENSE.
1. Agent file: SPEC §E.5 as amended by R13 (model: opus), R6, R17 (markers.json wording), R19 (LLM_DETECT_HOME resolution, generic wording). A round-1 draft exists at ${PRIVATE}/agent-draft-B3-round1.md — start from it, apply R17/R19. Keep < 900 words including frontmatter (cut Procedure, never Anti-patterns); report the actual wc -w.
2. install.sh: copies agent/llm-text-detector.md to ~/.claude/agents/ (mkdir -p; refuses to overwrite a differing file without --force), prints the \`export LLM_DETECT_HOME=<repo>\` line for the shell profile, runs \`node selftest.mjs\` if present and prints the result. Executable bit set.
3. RUBRIC.md: D2's C01–C20 with FP traps and the banned-inference list copied (not paraphrased) from ${PRIVATE}/D2-judge-agent.md — but NO private corpus rows may be copied into this public file; SPEC §E.1 table + four invariants, §E.2, §E.3 skeleton (no Arabic reporting rule — R22), §E.4 signal-name map verbatim incl. the no-CLI-counterpart list, and R1–R3/R17 as they change what a rule means.
4. README.md: SPEC §0 honest statement (generic framing per R20); four-tier threat model; BOTH §G.2 caveats verbatim (checks grep "86% of R0's real messages" and "61.22% of 91 TOEFL essays"); §G.3 base-rate table; §H all 12 + Non-goals; usage (CLI, library, batch, aggregate, corpus index, markers.json format with a GENERIC example, the agent: "use the llm-text-detector agent on <text|path>"); exit-code note; eval pointer; "what was NOT verified this round" from SPEC §F.4 + R12.
5. LICENSE: MIT with "<owner>" as the name.
Run acceptance checks 9 and 10; paste observed output into 'verified'.`

phase('Build')
const builders = [
  { key: 'B1', prompt: B1, effort: 'xhigh' },
  { key: 'B2', prompt: B2, effort: 'high' },
  { key: 'B3', prompt: B3, effort: 'high' },
]
const built = await parallel(builders.map(b => () =>
  agent(b.prompt, { label: `build:${b.key}`, phase: 'Build', model: 'opus', effort: b.effort, schema: BUILD_SCHEMA })
    .then(r => ({ key: b.key, ...(r || {}) }))))
const ok = built.filter(r => r && r.files)
log(`builders done: ${ok.map(r => r.key).join(', ')} (${builders.length - ok.length} failed)`)

phase('Calibrate')
const CAL = `${COMMON}
YOU ARE THE CALIBRATION LANE (CAL). The builders finished; their reports: ${JSON.stringify(ok.map(r => ({ key: r.key, files: r.files, summary: r.summary, deviations: r.deviations, cut: r.cut, open_for_head: r.open_for_head })))}.
Run the eval pipeline end-to-end and write the honest report. You OWN ${REPO}/eval/** for this lane (fix harness bugs there). You do NOT edit the core (stylometry.mjs, lib/, lexicons, weights.v1.json, selftest.mjs), the agent, README or RUBRIC — defects there go into 'open_for_head' with a minimal repro command.
Steps: (1) node selftest.mjs — record. (2) node eval/fetch-public-datasets.mjs within R9 caps; record manifest counts; retry/backoff on HTTP 500. (3) DO NOT run the Supabase adapter — the corpus is already at eval/data/corpus_user_messages.json. (4) node eval/make-splits.mjs — record dedup, contamination, split sizes. (5) node eval/run-eval.mjs (--quick first, then full): TEST-only headline table with hard mode beside every row, leave-one-writer-out, per-stratum FPR, negative controls a–e, base-rate table, INSUFFICIENT placeholders where n<100. (6) Fixture gates: all 24 must-not-fire rows through the CLI (SPEC §I Gate: zero likely_llm on the 12 human-looks-LLM rows, zero likely_human on the 12 LLM-looks-human rows, ≥6 of those 12 insufficient_text/uncertain); the 50 llm-*.jsonl rows (verdict distribution per language and per transform — humanized transforms b/c are EXPECTED to lower the score; report by how much); the 30 cs-snippets with and without --domain customer_service; 200 random REAL rows (R0/R2 — Latin-script only per R22) from eval/data with --channel whatsapp (the production false-positive shape). (7) Write ${REPO}/eval/out/REPORT.md (committed: NO PII, redact per R8; local paths shown as <repo>) with every table, the exact commands, wall-clock, and "Defects found" with repros; write eval/out/weights.fitted.json (assert no PII inside).
Structured answer: headline per language×bucket with hard mode beside, LOWO flag rates, fixture-gate pass/fail with counts, the 200-real-rows distribution, cs-snippets result, open_for_head.`
const cal = await agent(CAL, { label: 'calibrate:eval', phase: 'Calibrate', model: 'opus', effort: 'xhigh', schema: {
  type: 'object',
  properties: {
    selftest: { type: 'string' },
    manifest: { type: 'string' },
    headline: { type: 'array', items: { type: 'string' } },
    lowo: { type: 'array', items: { type: 'string' } },
    fixture_gate: { type: 'string' },
    llm_fixtures: { type: 'string' },
    real_rows: { type: 'string' },
    cs_snippets: { type: 'string' },
    report_path: { type: 'string' },
    open_for_head: { type: 'array', items: { type: 'string' } },
    harness_fixes: { type: 'array', items: { type: 'string' } },
  },
  required: ['selftest', 'headline', 'fixture_gate', 'real_rows', 'report_path', 'open_for_head'],
} })
return { builders: ok, failed: builders.length - ok.length, cal }
