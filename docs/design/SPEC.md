# SPEC — `tools/llm-detect` : LLM-text detection for EN / TR / AR

Status: **IMPLEMENTATION CONTRACT.** Three builders code from this without asking questions.
Synthesized from four lanes: D1 (stylometric core), D2 (judge + agent), R1 (research evidence), DATA (empirical REAL-vs-SYNTH contrast on 17,944 in-house messages).
Runtime: Node ≥ 20 (developed and verified on v24.5.0), ESM, **zero runtime dependencies** in the shipped tool.
Everything in this document that is a threshold and not a Unicode fact is a **prior guess** and is labelled `prior`. §D.5 is the procedure that replaces them.

Where the lanes disagreed I decided, and every decision carries a one-line reason marked **DECIDED:**.

---

## 0. The one-paragraph honest statement

This is a **triage instrument that ranks strings**, not a verdict instrument that judges people. On the traffic this product actually sees, the correct output is `insufficient_text` about 92% of the time (measured: 207 of 2,712 real customer messages reach 20 words). The only outputs that carry real precision are the **artifact rules** — leaked assistant boilerplate, markdown arriving in a non-markdown channel, our own bot's output pasted back, near-duplicate text across senders — which are near-100%-precision rules with low recall. The **stylometric score** is a weak ranking prior that tops out at `leaning_*`, is biased against non-native and formal writers in a direction nobody has ever measured for Turkish or Arabic, and collapses to roughly chance the moment a generator is told "write like a WhatsApp user" (measured in-house: AUC 0.992 → 0.833, recall at 5% FPR 0.997 → 0.504).

Low recall at near-perfect precision is a shippable product. Medium recall at 10% FPR is not. Build the first one.

---

## A. DELIVERABLE LAYOUT

```
tools/llm-detect/
  stylometry.mjs                 B1  zero-dep ESM. Importable (`export function detect`) AND CLI.
  lexicon.v1.json                B1  generated artifact, \uXXXX-escaped (see §B.8)
  lexicon-src/en.txt tr.txt ar.txt human-en.txt human-tr.txt human-ar.txt arabizi.txt
                                 B1  plain-text human-editable lexicon sources
  build-lexicon.mjs              B1  lexicon-src/*.txt -> lexicon.v1.json (escape + validate)
  weights.v1.json                B1  { provenance:"prior", ... }  — see §D.1
  selftest.mjs                   B1  unicode + segmenter + feature-golden + determinism + fixture gate
  README.md                      B3  §G verbatim caveats live here
  RUBRIC.md                      B3  D2's 20 criteria + decision table + the §E.4 signal map
  eval/
    run-eval.mjs                 B2  calibration + held-out metrics; writes weights.fitted.json
    fetch-public-datasets.mjs    B2  HF datasets-server pulls (§F.1), retry-aware
    pull-messages-corpus.cjs     B2  reads backend/.env, writes gitignored data dir, PII-safe
    make-splits.mjs              B2  group-aware splitting (§F.4)
    fixtures/
      must-not-fire.jsonl        B2  D1 §7 — 24 rows, the release gate
      judge-tests.jsonl          B2  D2 §5 — 14 rows, the agent gate
      llm-en.jsonl llm-tr.jsonl llm-ar.jsonl        B2  agent-authored, 25 rows each (§F.3)
      human-chat.jsonl                              B2  from our corpus, deny-by-default redacted
    data/                        B2  GITIGNORED. Never committed. Customer PII lives only here.
      .gitkeep
.claude/agents/llm-text-detector.md   B3  the judge agent (§E.5)
.gitignore                            B2  adds exactly one line: `tools/llm-detect/eval/data/`
```

Nothing else in the repo is touched. No file has two owners.

**PII rule, enforced in code, not by convention:** `pull-messages-corpus.cjs` runs `git check-ignore -q <outdir>` before its first write and **exits 2 with an error if the directory is not ignored**. It never writes a phone number: `user_phone` becomes `writer_id` (`R0`/`R1`/`R2`) for the three real customers and `persona_id = sha256(phone + PULL_SALT).slice(0,12)` for everything else.

---

## B. FINAL FEATURE LIST

### B.0 How to read this

Every row has: **id · direction · langs · scope · min · weight · computation**.

- **direction** — `LLM↑` (higher ⇒ more LLM-like) or `HUMAN↑`. There is no "both arms" feature. Where D1 proposed a two-armed feature, the arm that could accuse a careful human has been amputated (§B.6).
- **scope** — `DOMAIN-TRANSFERABLE` (the direction holds outside this corpus and this domain; the *magnitude* still does not) or `CHAT-ONLY` (only meaningful in short conversational turns) or `PROSE-ONLY` or `AGGREGATE-ONLY`.
- **min** — word tokens below which the feature emits `null`. `null` is **omitted from the sum**, never treated as 0.
- **weight** — the `prior` coefficient shipped in `weights.v1.json`. All of them are guesses. §D.5 replaces them.
- **evidence** — every feature that fires produces an `Evidence` object with a `note` naming its own worst confounder. A feature with no confounder note is a bug.

### B.1 Tier 0 — ARTIFACT RULES (not stylometry)

These are **rules**, reported in `rules[]`, separate from `score`. R1 §5.5: they are near-100% precision and language-agnostic; the stylometric score is neither. **A rule is the only way to reach `likely_llm`** (§D.3).

| id | dir | langs | min | detection |
|---|---|---|---|---|
| `assistant_frame_leak` | LLM↑ | any | **0** | Any of: `/\bas an ai\b/i`, `/\bi'?m an ai\b/i`, `/\blanguage model\b/i`, `/\bmy (training\|knowledge) (data\|cutoff)\b/i`, `/\bi hope (this\|that) helps\b/i`, `/\blet me know if you (need\|have\|'d like)\b/i`, `/\bwould you like me to\b/i`, `/\bfeel free to (ask\|reach out)\b/i`, `/\bhere('?s\| is) (a\|an\|the) (draft\|revised\|rewritten)\b/i`, `/^(sure\|certainly\|absolutely\|of course)[,!]/i`; TR `/\bumarım (bu )?(bilgiler )?(yardımcı )?ol(ur\|muştur)\b/i`, `/\bbaşka bir sorunuz olursa\b/i`, `/\bsize nasıl yardımcı olabilirim\b/i`, `/\bbir yapay zeka\b/i`; AR `نأمل أن (تكون|يكون)`, `هل تود مني`, `كنموذج ذكاء اصطناعي`, `لا تتردد في التواصل`. **Suppressed** (→ `note:'possible_quotation'`, rule does not fire) when the match is inside quotation marks or within 100 chars of `chatgpt\|yapay zeka\|bot\|ذكاء اصطناعي\|claude\|gpt`. |
| `markdown_in_chat` | LLM↑ | any | 0 | Only when `shape==='chat' \|\| channel==='whatsapp'`. Fires on ≥1 of: `/^\s{0,3}#{1,6}\s+\S/m` (header — **the space is mandatory**, `#hashtag` is human), `/\*\*[^*\n]{2,80}\*\*/` (**DOUBLE** asterisk), `/^\s{0,3}[-*+]\s+\S/m` on ≥2 lines, `` /^```/m ``, `/^\s{0,3}\|.*\|/m`. **WhatsApp trap, do not invert:** WhatsApp's own bold is a *single* `*bold*` — that is a human WhatsApp user, weak HUMAN↑ (feature `wa_single_asterisk`, §B.4). Double asterisk is a model that did not know where it was writing. |
| `own_bot_marker` | LLM↑ + provenance | any | 0 | `<the product's bot-marker regex>` or `<its reference-code regex>` (both kept out of this public repo; see HEAD-RULINGS R17: the shipped rule is the generic `known_machine_marker` reading `markers.json`). **Mandatory** `warnings:['pasted_machine_text']` and the report must say: the string is machine-written, the sender is a customer forwarding it. (DATA §4.1: the single highest-scoring "human" in the held-out set was a customer pasting our own confirmation back. This is the most likely wrongful flag in production.) |
| `near_duplicate` | LLM↑ | any | 20 words | Requires `--corpus <index.jsonl>`. 5-gram word shingles over `foldedLex`, 64-bit FNV-1a hashes, Jaccard ≥ **0.80** against any document with a *different* `sender`. Reports the matched id and the Jaccard. R1: "the single thing most worth building first" — language-agnostic, length-tolerant, adversary-resistant. |
| `invisible_chars` | LLM↑ (**corroborator only**) | any | 0 | Count of `[​‌‍⁠﻿­]` **excluding** ZWJ inside emoji sequences, ZWNJ/ZWJ adjacent to Arabic letters, and U+200E/200F in any text containing Arabic; plus `[    ]`. **Never fires alone** — it is a "passed through a rich-text surface" fact (Word, Notion, a webpage), not an LLM fact. Requires ≥1 other rule or ≥2 LLM-direction features to appear in `rules[]` at all; otherwise it is a `note`. |

### B.2 Tier 1 — RHYTHM (PROSE-ONLY)

| id | dir | langs | scope | min | w | computation |
|---|---|---|---|---|---|---|
| `sentence_len_cv` | HUMAN↑ | any | PROSE-ONLY | 120 tok, ≥8 sentences | 0.35 | `sd(sentenceTokenCounts)/mean(...)`, sample sd. **Suppressed** when >60% of sentences are list items (a packing list is structurally uniform) or when any sentence >120 tokens (`warnings:['segmentation_suspect']`). |
| `sentence_len_mode_mass` | LLM↑ | any | PROSE-ONLY | 120 tok, ≥8 sentences | 0.25 | fraction of sentences with token count in [12,22]. |
| `paragraph_uniformity` | LLM↑ | any | PROSE-ONLY | 250 tok, ≥4 paragraphs | 0.20 | `1 - clamp(sd(paraTokenCounts)/mean(...), 0, 1)`. |
| `content_word_repeat` | HUMAN↑ | any | PROSE-ONLY | 150 tok | 0.25 | `1 - uniqueTypes(content)/content.length` where `content` = tokens not in `STOPWORDS[lang]` with length ≥4. **TR/AR:** compare on a prefix key — TR `slice(0, min(6, len-2))`; AR strip leading `[وفبكل]`/`ال` and trailing `ها|هم|كم|نا|ه|ة|ي|ين|ون|ات`. Documented as crude. |

Direction note: `content_word_repeat` is HUMAN↑ — humans repeat "hotel … hotel", models reach for a synonym. This is the opposite of the folk claim "LLMs have poor vocabulary", and R1 §3.5 shows the folk claim came from an unmatched corpus (32,730 vs 7,735 unique words between the two halves).

### B.3 Tier 1 — PUNCTUATION AND TYPOGRAPHY

| id | dir | langs | scope | min | w | computation |
|---|---|---|---|---|---|---|
| `terminal_punct_ratio` | LLM↑ | any | DOMAIN-TRANSFERABLE (direction only) | 20 tok **and** ≥2 lines-or-sentences | **0.60** | fraction of non-empty lines (≥1 word token) ending, after stripping trailing whitespace and emoji, in `[.!?؟۔]`. |
| `sentence_initial_caps` | LLM↑ | en, tr | CHAT-ONLY | 20 tok, ≥3 sentences | 0.30 | fraction of sentences whose first letter-token starts uppercase. **≥3 sentences is mandatory** — keyboards auto-capitalize the first letter of a message, so 1.0 on a single sentence is meaningless. |
| `all_lowercase` | HUMAN↑ | en, tr | CHAT-ONLY | 20 tok | 0.45 | `lowercaseLetters/letters > 0.98`. Plus `loneLowerI` = count of `/\bi\b/` in EN. |
| `ellipsis_hand_typed` | HUMAN↑ | any | DOMAIN-TRANSFERABLE | 0 (needs ≥1) | 0.30 | count of runs `/\.{2}(?!\.)/` or `/\.{4,}/`. **The `…`-glyph and exact-`...` arms are DROPPED** — iOS/Android substitute `…` for `...` automatically, so they measure a keyboard. |
| `repeated_punct_emoticon` | HUMAN↑ | any | DOMAIN-TRANSFERABLE | 0 | 0.55 | `count(/[!?؟]{2,}/) + count(/:\)|:\(|:D|:'\(|<3|xD|:-\)/)`. High precision, **near-zero recall** — DATA measured 0.002 vs 0.000 per message; it fires on <1% of traffic. That is fine: it is evidence when present and silence otherwise. |
| `letter_elongation` | HUMAN↑ | any | DOMAIN-TRANSFERABLE | 3 tok | 0.60 | matches of `/(\p{L})\1{2,}/gu`, plus Arabic tatweel runs `/ـ{2,}/`. "pleaseee", "çoook", "مبرووووك". Works at 9 characters, which almost nothing else does. Same near-zero-recall note. |
| `space_hygiene` | HUMAN↑ | any | DOMAIN-TRANSFERABLE | 20 tok | 0.25 | `count(/\S {2,}\S/) + count(/\s+[,.;:!?،؛؟]/) + count(/[,.;:،؛](?=\p{L})/gu)` minus decimals/URLs/abbrevs, `+ trailingSpaceLines`, per 100 tokens. |
| `multi_exclam` | HUMAN↑ | any | DOMAIN-TRANSFERABLE | 0 | 0.35 | `count(/!{2,}/)`. |
| `exclam_single_regular` | LLM↑ | any | PROSE-ONLY | ≥4 sentences | 0.15 | `singles/sentences ∈ [0.25, 0.75]` **and** `multiExclam === 0`. The assistant's enthusiasm register. |
| `em_dash_in_chat` | LLM↑ | en, tr | CHAT-ONLY, binary | 0 | **0.15** | `count(/—/g) ≥ 1 && count(/ - /g) === 0`. |
| `wa_single_asterisk` | HUMAN↑ | any | CHAT-ONLY | 0 | 0.25 | `/(?<!\*)\*[^*\n]{2,60}\*(?!\*)/` — WhatsApp's own bold markup. |
| `emoji_repeat_run` | HUMAN↑ | any | DOMAIN-TRANSFERABLE | 0 | 0.30 | ≥1 run of 2+ **identical adjacent** emoji, or any skin-tone modifier `\u{1F3FB}-\u{1F3FF}`. |
| `emoji_bullet_led` | LLM↑ | any | DOMAIN-TRANSFERABLE | 0 | 0.30 | ≥2 lines matching `/^\s*\p{RGI_Emoji}\s+\p{Lu}/v` — emoji used as a section marker. |

**`em_dash_in_chat` is deliberately near-worthless (w 0.15) and prose em-dash rate is DROPPED entirely.** R1's only direct measurement: human baseline 3.23 per 1,000 words with a range of **0.33–17.12** that *fully contains* the model range; two shipping models sit at **0.00**; and modern review corpora ASCII-normalize dashes on ingest so the tell evaporates for free. **DECIDED:** the em dash is folklore at document scale. It survives only as a chat binary, only as a corroborator.

### B.4 Tier 1 — LANGUAGE-SPECIFIC ORTHOGRAPHY (all HUMAN-direction)

**DECIDED — the amputation rule.** D1 proposed several two-armed orthography features ("ASCII-fied ⇒ human / correct ⇒ LLM"). DATA proved the LLM arm is a corpus artifact that encodes *which keyboard and which schooling the writer has* (`tr_diacritic_ratio` AUC 0.939, `apostrophe_suffix` AUC 0.919 on n=69) and D1's own fixture A6 shows an iPhone with a Turkish keyboard produces flawless orthography. **Every orthography arm that points at LLM is deleted. What remains is one-armed and human-direction only — and a human-direction feature cannot produce a false accusation, which is why no separate "safe mode" flag is needed.**

| id | dir | langs | scope | min | w | computation |
|---|---|---|---|---|---|---|
| `tr_asciified_probe` | HUMAN↑ | tr | DOMAIN-TRANSFERABLE | 8 tok | 0.50 | Closed ASCII-fied-stopword probe (`icin, cok, degil, gecen, yasinda, cocuk, buyuk, kucuk, sey, oyle, boyle, tesekkurler, gunaydin, gorusuruz, ogrenci, dogru, yarin, bugun, sabah, aksam, ucret, ucus, gelecegim, gidecegim, yapacagim, olacagim, kalacagiz, calisiyorum, guzel, kotu, insallah, nasilsin, naber, tamamdir, sagol, oncelikle, ozellikle, sonrasinda, kisiyiz, giris, gece`) vs the same words correctly spelled. `value = asciiHits/(asciiHits+diacHits+1)`. Fires HUMAN↑ when `value > 0.5 && asciiHits ≥ 2`. **Ratio-based diacritic counting is forbidden** — you cannot know where a diacritic should have been without a lexicon. |
| `tr_mixed_orthography` | HUMAN↑ | tr | DOMAIN-TRANSFERABLE | 8 tok | 0.35 | `asciiHits > 0 && diacHits > 0`. Mixture is a human typing across two devices. |
| `tr_bare_capital_I` | HUMAN↑ | tr | DOMAIN-TRANSFERABLE | 8 tok | 0.30 | count of tokens `/^I(?=[a-zçğıöşü])/` (`Istanbul`, `Izmir`, `Iyi`). The `İstanbul`-is-correct arm carries **0**. |
| `tr_apostrophe_absent` | HUMAN↑ | tr | DOMAIN-TRANSFERABLE | 12 tok, ≥2 hits | 0.20 | tokens that (a) start uppercase, (b) ≥6 chars, (c) end in a Turkish case suffix, (d) contain no apostrophe, **and (e)** whose stem also appears elsewhere in the text or is in a small city list (`Istanbul, Ankara, Izmir, Antalya, Turkiye, Trabzon, Bursa, Konya, Kapadokya, Taksim`) in either orthography. Condition (e) is mandatory; without it ordinary sentence-initial words are misread as suffixed proper nouns. |
| `tr_chat_morphology` | HUMAN↑ | tr | CHAT-ONLY | 3 tok | **0.60** | tokens `/\p{L}+(cam\|cem\|cak\|cek\|caz\|cez\|ceksin\|caksin\|icem\|icam\|icez\|icaz)$/iu` (gelicem, yapcam, bakcaz, gidicez) **+** `/\b(bi\|bii\|napıyon\|napiyon\|valla\|aynen\|hadi\|abi\|abicim\|reis\|hocam\|kanka\|eyvallah\|tmm\|slm\|mrb\|nbr\|sagol\|sağol)\b/i`. Highest-precision TR human marker. |
| `ar_dialect_markers` | HUMAN↑ | ar | DOMAIN-TRANSFERABLE | 3 tok | **0.60** | Lexicon match on `foldedLex` (§B.8) over the dialect list, **plus** structural markers: b-present `/^ب[يتنأا]?\p{L}{2,}/`, ha-future `/^ح\p{L}{3,}/` or `/^رح\s/`, `-sh` negation `/\p{L}+ش$/`, `/\bمش\b\|\bمو\b\|\bما\s?في\b/`. **The absence of dialect (i.e. MSA) carries weight ZERO in every context.** All published Arabic prose is MSA; business Arabic is MSA; a careful MSA writer is not a bot. |
| `ar_orthographic_shortcuts` | HUMAN↑ | ar | DOMAIN-TRANSFERABLE | 15 tok | 0.50 | Closed table of high-frequency words with an expected orthography, counting the *shortcut* variant: `أنا→انا`, `أنت→انت`, `إلى→الى/الي`, `على→علي`, `أو→او`, `إن/أن→ان`, `أيضًا→ايضا`, `شيء→شي`, `الذي→اللي`, `هذه→هاي/هذي`, `مساءً→مساء`, word-final `ة→ه`. `value = shortcut/(shortcut+correct+1)`. **The "correct orthography ⇒ LLM" arm carries 0.** |
| `arabizi` | HUMAN↑ | ar, mixed | CHAT-ONLY | 2 tok | 0.55 | tokens `/^[a-z']*[234567890][a-z']+$/i` **and** membership in the Arabizi lexicon, or ≥2 lexicon hits. Guard against English leetspeak by requiring the lexicon hit or an `ar`/`mixed` language context. |
| `ar_tashkeel_band` | three-band | ar | DOMAIN-TRANSFERABLE | 20 tok | 0.45 / 0.30 | `tashkeelRate = count(/[ً-ْٰٓ-ٕ]/)/arabicLetters`. **LLM↑ (w 0.45)** when `0.005 < rate < 0.08`. **HUMAN↑ (w 0.30)** when `rate > 0.25` (a pasted vocalized quotation — scripture, poetry, children's material). Zero otherwise. DATA-supported: 0.6% of applicable human messages carry tashkeel vs 17.2% of generated ones. Nobody types vowel marks on a phone; a model emits them for free. |
| `ar_tatweel` | HUMAN↑ | ar | DOMAIN-TRANSFERABLE | 0 | 0.35 | `count(/ـ/g)/arabicLetters > 0.002` — kashida stretching (`الســـلام`) is a purely human decorative act. |
| `tr_formal_copula` | LLM↑ | tr | PROSE-ONLY | 100 tok | 0.20 | tokens `/(makta\|mekte)(dır\|dir)$/` or `/(malı\|meli)dır$/`, per 100 tokens. **Disabled entirely when `genre==='formal_letter'`** — Turkish officialese *is* this register (D1 fixture A3, a lawyer's complaint letter). |

### B.5 Tier 1 — STRUCTURE AND REGISTER

| id | dir | langs | scope | min | w | computation |
|---|---|---|---|---|---|---|
| `bold_lead_in_list` | LLM↑ | any | DOMAIN-TRANSFERABLE | 20 tok | **0.50** | lines `/^\s*[-*•\d.)]+\s*\*\*[^*]{2,40}\*\*\s*[:：-]/` **+** lines `/^\s*[-*•]\s*\p{Lu}[^:\n]{2,40}:\s+\S/u`. The `- **Location:** Central and well connected.` shape. Highest-precision structural tell for unaware paste. Near-zero human base rate outside technical docs. |
| `colon_led_list` | LLM↑ | any | DOMAIN-TRANSFERABLE | 20 tok | 0.25 | lines matching `/:\s*$/` immediately followed by a line matching `/^\s*[-*•\d]/`. |
| `enumerated_openers` | LLM↑ | any | PROSE-ONLY | ≥6 sentences | 0.40 | ≥3 in sequence from: EN `First,/Second,/Third,/Finally,`; TR `Öncelikle/İkinci olarak/Ardından/Son olarak`; AR `أولاً/ثانياً/وأخيرًا`. |
| `parallel_openers` | LLM↑ | any | PROSE-ONLY | 120 tok, ≥6 sentences | 0.20 | `1 - unique(firstTokens)/firstTokens.length`, bonus when ≥3 openers come from the CONNECTOR set (`Furthermore/Moreover/Additionally` · `Ayrıca/Bunun yanı sıra/Ek olarak` · `بالإضافة إلى ذلك/علاوة على ذلك`). **Known ESL bias** — L2 writers are explicitly taught connector lists. Carried into the fairness report (§G.3). |
| `closing_summary_move` | LLM↑ | any | PROSE-ONLY | 120 tok | 0.25 | final paragraph opens with a CLOSER (`In conclusion/Overall/In summary/All in all` · `Sonuç olarak/Özetle/Kısacası/Genel olarak` · `في الختام/باختصار/بشكل عام`). |
| `balanced_contrast_frame` | LLM↑ | any | DOMAIN-TRANSFERABLE | 100 tok | 0.30 | EN `not only…but also`, `whether you('re\| are)…or`, `on the one hand`; TR `hem…hem de`, `sadece…değil, aynı zamanda`, `ister…ister`; AR `ليس فقط…بل أيضًا`, `سواء كنت…أو`, `من ناحية…من ناحية أخرى`. |
| `out_of_channel_register` | LLM↑ | any | DOMAIN-TRANSFERABLE | 0 | **0.45** | `channel==='whatsapp' && chars > 400 && paragraphs ≥ 2`. A 15-word question channel receiving a four-paragraph essay is structural, not lexical, and it survives translation and paraphrase. |
| `greeting_signoff_frame` | LLM↑ | any | out-of-register only | 30 tok | 0.25 | opener (`Dear/Hello/Greetings/Good morning` · `Sayın/Merhaba/İyi günler` · `السلام عليكم/تحية طيبة`) **and** closer (`Best regards/Sincerely/Kind regards` · `Saygılarımla/İyi çalışmalar` · `مع خالص التقدير/وتفضلوا بقبول فائق الاحترام`). **Active only when `genre==='review'` or `shape==='chat'`.** In an email corpus it is worthless — humans write letter frames all day. |
| `llm_lexicon_strong` | LLM↑ | per-lang | DOMAIN-TRANSFERABLE | 0 | **0.55** | Aho-Corasick pass over `foldedLex` against `strong` rows (§B.8). |
| `llm_lexicon_weak` | LLM↑ | per-lang | DOMAIN-TRANSFERABLE | 40 tok | 0.20 | same, `weak` rows, `log1p`-transformed density per 100 tokens, clipped at the calibration p95. |
| `politeness_formula` | LLM↑ | any | DOMAIN-TRANSFERABLE | 0 | 0.30 | Disjoint from the lexicon: greeting/thanks/apology/offer formulae only (`thank you for`, `I'd be happy to`, `please let me know`, `teşekkür ederim`, `rica ederim`, `yardımcı olabilirim`, `شكرًا لك`, `يسعدني`, `من فضلك`). DATA-supported: 2.2% of human vs 19.9% of generated messages. Survives paraphrase better than punctuation because it is lexical-pragmatic, not orthographic. **Domain-suppressed to weight 0 when `domain==='customer_service'`.** |
| `hedge_density` | LLM↑ | any | PROSE-ONLY | 100 tok | 0.15 | HEDGES per 100 tokens. EN `may/might/could/tends to/generally/typically/it is worth noting/that said`; TR `olabilir/genellikle/çoğunlukla/nispeten/unutulmamalıdır/görünmektedir`; AR `قد/ربما/عادةً/غالبًا/تجدر الإشارة/يبدو أن`. |
| `human_lexicon` | HUMAN↑ | per-lang | DOMAIN-TRANSFERABLE | 1 tok | **0.55** | `strongHits*3 + weakHits` over the human/slang/dialect lists (§B.8). One `شو` or `nbr` in a six-token message outweighs every distributional feature, because it is a positive observation rather than an absence. |
| `contraction_apostrophe_drop` | HUMAN↑ | en | DOMAIN-TRANSFERABLE | 5 tok | 0.45 | word-boundary matches of `{dont, cant, wont, im, ive, id, youre, theyre, doesnt, didnt, wasnt, isnt, thats, theres, whats, hes, shes, wouldnt, couldnt, shouldnt, lets, aint, yall, gonna, wanna, gotta, kinda, dunno}`. **Exclude `its` and `were`** — legitimate words. |
| `self_correction_marker` | HUMAN↑ | any | CHAT-ONLY | 2 tok | **0.60** | EN `/^\*\s*\S/m`, `/\bi meant\b/i`, `/\bsorry,? typo\b/i`, `/\bedit:/i`, `/\bnvm\b/i`; TR `/\bpardon\b/i`, `/\byok yani\b/i`, `/\bdüzelt(me\|iyorum)\b/i`, `/\byok\s+pardon\b/i`; AR `عفوًا`, `قصدي`, `اقصد`, `غلط`. **Weighted above `contraction_apostrophe_drop` deliberately:** humanizer tools inject character noise, not conversational repair. Self-repair is the hardest human marker to fake. |

### B.6 AGGREGATE-ONLY features (≥5 messages from one sender)

R1 §7b: aggregation is the **only** short-text lever with evidence behind it (concatenating 10 tweets moved accuracy 80% → ~100%). D1 §6.5 calls session-aggregate "the only defensible chat mode". DATA §4.2 proves thresholds are writer-specific. **DECIDED: `--aggregate` is a required B1 deliverable, not an option**, and per-message chat verdicts are inputs to it, never surfaced alone as `likely_*`.

| id | dir | min | w | computation |
|---|---|---|---|---|
| `msg_length_uniformity` | LLM↑ | 5 msgs | 0.30 | `1 - clamp(sd(charLens)/mean(charLens), 0, 1)`. |
| `template_repetition` | LLM↑ | 5 msgs | 0.45 | any identical 6-gram (on `foldedLex`) reused across ≥3 distinct messages. |
| `cross_msg_style_variance` | HUMAN↑ | 5 msgs | 0.35 | sd across messages of the per-message feature vector (terminal-punct, caps, emoji, elongation), z-normalized. Humans drift; a bot is uniform. |
| `idiolect_stability` | HUMAN↑ | 5 msgs | **0.55** | the same non-dictionary token (length ≥5, not a known word) appearing in ≥2 messages — the same hotel name misspelled the same way twice. D2's C20. Expensive to fake. |
| `bare_token_turn_rate` | HUMAN↑ | 5 msgs | 0.40 | fraction of messages with ≤2 word tokens or that are a bare number/date/city. DATA: 11.2% of human messages are unclassifiably short vs **0.9%** of generated ones. Humans send bare tokens; this generator almost never does. |

### B.7 DROPPED — with the reason, so nobody re-adds them

| dropped | proposed by | why it is gone |
|---|---|---|
| `em_dash_rate` (prose) | D1 F20 | R1: human range 0.33–17.12 per 1,000 words **contains** the whole model range; two shipping models at 0.00; corpora ASCII-normalize it away. |
| `mattr_50`, `hapax_ratio`, `type_token_ratio` | D1 F05/F06, D2 | Direction genuinely flips by genre; TR agglutination and AR cliticization break the denominator; DATA measured AUC 0.654 on 25% applicability. Kept as **display-only diagnostics**, never in the sum. |
| `function_word_profile_distance` | D1 F07 | Needs `REF_HUMAN[lang][register]` tables that do not exist for TR or AR and will not exist this round. |
| `oxford_comma` | D1 F44 | A US-vs-UK house-style marker, not an authorship marker. |
| `tricolon_rate` | D1 F43 | Fires on any list of three items — dates, names, room types. In a booking domain that is every second message. |
| `quote_and_apostrophe_consistency` | D1 F24 | DATA measured it **inverted**: humans 23.5% curly (iOS smart quotes), generator 0%. n=17, i.e. noise on top of a wrong sign. Survives as a `note` only. |
| `digit_system_choice` / `ar_indic_digit_ratio` | D1 F29, D2 | DATA: AUC **0.46** — no signal, slightly human-leaning. Both sides type `٠-٩`. Any design assuming "the LLM writes 3, the human writes ٣" is contradicted. Retained only as `note:'perso_arabic_layout'` when U+06F0–06F9 appear (out-of-scope keyboard, not authorship). |
| `emoji_rate` | D1 F38 | DATA: 0.010 vs 0.031 per message, AUC 0.513. The *patterns* survive (`emoji_repeat_run`, `emoji_bullet_led`); the rate does not. |
| `has_newline` | DATA's own model | DATA §4.2: highest-magnitude coefficient (−3.67) and the direct cause of the leave-one-writer-out failure that flagged **86%** of a real Turkish customer. It separates R1/R2 from R0, not humans from machines. |
| `log_chars`, `words`, message length | DATA's own model | Generator config, not style: SYNTH max 216 chars, REAL max 619, exactly **one** generated message over 200 chars in 14,785. Length gates; it does not score. |
| `latin_arabic_mix` | DATA's own model | Corpus artifact — the persona prompt hands the generator the hotel catalogue in Latin script (19.5% vs 3.2%). Code-switching is normal human behaviour in this domain and is logged as a `note`, never as evidence, in either direction. |
| `semicolon_rate` | D1 F25 | English-only, academic-human confounded; the useful half (`colon_led_list`) is kept separately. |
| `unbalanced_delimiters`, `no_paragraphing_wall`, `fragment_thinking` | D1 F68/F69/F63 | Weak priors with no measurement on either side. `fragment_thinking`'s real content survives as `bare_token_turn_rate` in aggregate mode, where it is measurable. |
| `typo_rate`, `typo_gap_cv` | D2 §6 | **Not implementable zero-dependency.** No dictionary ⇒ no true typo detection. These stay as *judge* criteria (C17/C18), where a language model can read them, and the CLI must not pretend to. |

### B.8 Lexicons

- Ship as `lexicon.v1.json`: `[{phrase, lang, tag:'strong'|'weak', domain:'general'|'cs'|'travel'|'email'|'marketing', note}]`.
- **Arabic and Turkish entries are stored `\uXXXX`-escaped.** Bidi-unaware editors, terminals and diff viewers reorder Arabic literals, and a maintainer "fixing" a reordered line silently corrupts the lexicon. `build-lexicon.mjs` generates the escaped JSON from `lexicon-src/*.txt` (the human-editable artifact). Never print Arabic lexicon rows to the terminal for review; diff them programmatically.
- Matching runs on `foldedLex`, one Aho-Corasick pass (hand-rolled trie, ~120 lines, no dependency), **not** 150 separate regex scans.
- Contents: EN 65 rows, TR 42, AR 40 (D1 §5.1–5.3 verbatim), plus human/slang/dialect lists (D1 §5.4) and the Arabizi list.
- **Domain suppression is not optional for this product.** Rows tagged `cs` — `thank you for reaching out`, `we apologize for any inconvenience`, `I'd be happy to`, `let me know if you have any questions`, `I understand your concern`, `geri bildiriminiz bizim için değerli`, `anlayışınız için teşekkür ederiz`, `yaşadığınız olumsuzluk için özür dileriz`, `شكرًا لتواصلك معنا`, `نعتذر عن أي إزعاج` — drop to weight **0** when `domain === 'customer_service'`. These strings are literally in human support snippet libraries. Without this, the detector accuses the support team, and fixture A5 fails.

### B.9 Text pipeline (non-negotiable, verified on Node v24.5.0)

Re-verified by the synthesizer, not taken on trust — all of D1's Unicode claims reproduced:

```
raw       = text as received                      // rules and typography read THIS
nfc       = raw.normalize("NFC")                  // tokenization + segmentation
foldedLex = caseFold(stripTashkeel(stripTatweel(unifyAlef(nfc))), lang)   // lexicon matching ONLY
```

- **Never `NFKC` the scoring view.** Verified: `'…'.normalize('NFKC') === '...'` (true), NBSP → space (true); tatweel and Arabic-Indic digits survive. NFKC destroys the ellipsis and invisible-char signals.
- **`caseFold(s, 'tr')` = `s.toLocaleLowerCase('tr')`, then strip a stray U+0307 following `i`.** Verified: `'İ'.toLowerCase()` yields codepoints `69 307` — two code points — so a default-locale fold silently never matches a lexicon entry stored as `istanbul`. Every Turkish lexicon entry is stored **already folded with the `tr` locale**.
- **`AR_LETTER = /[\p{Script=Arabic}&&\p{L}]/v`** — set intersection, v flag. Verified: matches `ب`, rejects `،` `؟` `ـ` `٠` `۰` `َ`. Writing it as `[؀-ۿ]` matches Arabic punctuation, digits and tashkeel and silently biases every Arabic ratio. **Script ratios are computed over letters only**, because U+060C and U+0640 are `Script=Common` while Arabic-Indic digits *are* `Script=Arabic`.
- **`WORD_RE = /(?!ـ)[\p{L}\p{M}][\p{L}\p{M}ـ'’-]*/gu`.** Verified: `\p{L}` matches tatweel, so the negative lookahead is load-bearing — without it `ـــ` counts as a word token. `NUM_RE = /[\p{Nd}][\p{Nd}.,:٫٬]*/gu`; verified `\p{Nd}` matches U+0660–0669 **and** U+06F0–06F9. (This repo has already lost months to ASCII `\d` rejecting Arabic-Indic digits. No numeric regex in this tool uses `\d`.)
- **`Intl.Segmenter` is forbidden in the shipped path.** Its behaviour depends on the ICU version compiled into the host binary, which breaks the determinism test. Hand-rolled segmenter per D1 §3 (terminators `. ! ? ؟ ۔ ‼ ⁉ ！ ？ 。`; `؛`/`;` soft in prose only; **`،` is a comma, never a terminator**; abbreviation, decimal, URL and initial guards; every line is a hard boundary in chat shape; runs of terminators collapse to one boundary but their composition is recorded first). `Intl.Segmenter` may be used in `run-eval.mjs` as an offline cross-check oracle.
- **Language ID** per D1 §2: script shares over letters, Perso-Arabic guard (`[پچژگکی]` > 2% of Arabic letters ⇒ `unknown`, out of scope), Latin sub-ID by weighted vote over TR-specific letters + TR stopwords (stored in both diacritic and de-diacriticized forms) + EN stopwords + TR suffix shapes. `mixed` when both scripts ≥20%, or the two Latin sub-IDs are within one vote, or Arabizi is detected. **`mixed` disables every language-specific feature**; only the script-agnostic set runs.

---

## C. CLI CONTRACT AND JSON SCHEMA

### C.1 Invocation

```
node tools/llm-detect/stylometry.mjs [input] [options]

INPUT (exactly one)
  --file <path>            one document
  --text <string>          one document, inline
  (none)                   read stdin
  --jsonl <path>           batch: NDJSON in, NDJSON out (one report per line, `id` passed through)
  --aggregate <path>       NDJSON grouped by `sender`; emits one aggregate report per sender

OPTIONS
  --context chat|prose|auto     what the text LOOKS like            (default auto)
  --channel whatsapp|web|email|form|unknown   where it ARRIVED      (default unknown)
  --lang auto|en|tr|ar                                              (default auto)
  --genre auto|review|email|chat|formal_letter|marketing            (default auto)
  --domain general|customer_service                                 (default general)
  --corpus <path>          NDJSON index enabling the near_duplicate rule
  --weights <path>         override weights.v1.json
  --allow-uncalibrated     REQUIRED to emit any verdict from prior weights
  --explain                include inactive features in `evidence` with value null
  --pretty                 human-readable text instead of JSON
  --version                print { detector, lexicon, weights, node } and exit 0
```

`--context` and `--channel` are **orthogonal and both matter**. A 900-character bulleted em-dashed message arriving on WhatsApp is `channel=whatsapp, shape=prose` — the highest-signal case in the system (`out_of_channel_register`). Auto-detection is a fallback: `isChat = (chars < 400 && lines <= 4 && no markdown structure) || channel === 'whatsapp'`. A caller that knows must pass it.

### C.2 The six verdicts

**DECIDED — vocabulary reconciliation.** D1 used `abstain / unknown`; D2 used `insufficient_text / uncertain`. D2's names win because the agent, the decision table and the report format are already written against them. D1's *semantics* are preserved by splitting the two causes:

| verdict | meaning |
|---|---|
| `insufficient_text` | A hard gate failed (§D.2). Nothing was scored. `score` is `null`. |
| `leaning_human` | Positive human evidence, no LLM rule fired. |
| `likely_human` | **Aggregate mode only** (§D.3). |
| `uncertain` | Gates passed; evidence is thin, contradictory, or a stated FP trap applies. `score` may be non-null. This is a real answer and the most common non-gate answer. |
| `leaning_llm` | The stylometric ceiling. ≥2 LLM-direction features from ≥2 different groups. |
| `likely_llm` | **Requires an artifact rule** (§D.3). Never reachable from the score alone. |

### C.3 JSON schema (exact field names)

```jsonc
{
  "version": {
    "detector": "1.0.0",
    "lexicon": "v1",
    "weights": "prior-2026-09-09",           // or "fitted-<corpusHash8>"
    "provenance": "prior",                   // "prior" | "fitted"
    "expiresAt": "2027-03-08T00:00:00Z"      // generatedAt + 180d
  },
  "id": "row-17",                            // present only in --jsonl / --aggregate mode
  "input": { "chars": 412, "bytes": 498, "sha256": "9f2c…" },
  "language": {
    "primary": "tr",                         // "en"|"tr"|"ar"|"mixed"|"unknown"
    "confidence": 0.82,
    "mixed": false,
    "shares": { "latin": 0.97, "arabic": 0.0, "other": 0.03 }
  },
  "shape": "chat",                           // resolved value of --context
  "channel": "whatsapp",
  "genre": "chat",
  "domain": "general",
  "counts": { "chars": 412, "tokens": 63, "sentences": 5, "paragraphs": 1, "lines": 3 },

  "verdict": "uncertain",
  "score": 0.58,                             // null whenever verdict === "insufficient_text"
  "channels": { "human": 0.21, "llm": 0.44 },// INDEPENDENT accumulators, 0..1 each

  "rules": [                                 // Tier 0. Empty array is normal and expected.
    { "name": "markdown_in_chat", "matched": "**Location:**", "direction": "llm",
      "precision": "high", "note": "markdown arriving in a channel that does not render it" }
  ],

  "signals": [                               // Tier 1. Sorted by |contribution| desc.
    { "name": "terminal_punct_ratio", "value": 1.0, "direction": "llm", "group": "punctuation",
      "scope": "DOMAIN-TRANSFERABLE", "weight": 0.60, "contribution": 0.71,
      "confidence": "MED", "provenance": "prior",
      "note": "register, not authorship; one prompt line ('no final period') removes it" }
  ],

  "gates":    { "passed": ["G1_chars","G2_tokens","G3_lang"], "failed": [] },
  "caps":     { "band": "20-49_tokens", "maxDeviation": 0.15, "applied": true },
  "warnings": ["uncalibrated_weights"],
  "notes":    ["code_switch_observed: latin hotel name inside turkish text — not evidence in either direction"],
  "caveats": [
    "This score is not a probability. No calibration set exists for this language and length.",
    "63 tokens: below the 150-token floor at which any published detector holds accuracy."
  ]
}
```

Invariants the builder **must not** soften:

1. `score === null` whenever `verdict === "insufficient_text"`. Never emit a number a caller can read as "45% AI".
2. `signals[]` includes features that fired **against** the verdict. A one-sided evidence list is a lie by omission.
3. `sum(signals[].contribution) + b0 === logit(score)` to within 1e-9. `selftest.mjs` asserts this. If it does not hold, the explainability display is decoration and the whole claim is fake — exit code 4.
4. A `null` feature is **omitted from the sum and not renormalized**. Omission is no evidence, not half evidence. Its absence is reflected in the confidence cap (§D.2), which widens as the active-feature count falls.
5. `rules[]` and `signals[]` are **never merged into one number**. R1 §7d: artifact rules are near-100% precision, the score is not.

### C.4 Batch mode

`--jsonl <path>`: input lines are `{"id": string, "text": string, "lang"?: string, "sender"?: string, "ts"?: string, "context"?: string}`. Output is NDJSON, one report per line, `id` passed through, **input order preserved**, one line per input line even on error (`{"id":…, "error":"…"}`). A malformed input line does not abort the run; it emits an error line and increments a counter printed to stderr.

`--aggregate <path>`: same input, grouped by `sender`. Emits one report per sender with `"mode":"aggregate"`, `"messageCount": n`, the aggregate feature set (§B.6) plus the prose feature set run on the sentinel-joined concatenation, and `"perMessage": [{id, verdict, score}]` for traceability. Senders with <5 messages emit `insufficient_text` with `reason: "aggregate_floor"`.

`--corpus <path>` builds the shingle index from an NDJSON of `{id, sender, text}` at startup and enables the `near_duplicate` rule for every scored document.

### C.5 Exit codes

| code | meaning |
|---|---|
| 0 | One or more reports emitted. **Says nothing about the verdict.** |
| 1 | Usage error (unknown flag, two inputs, missing argument). |
| 2 | Input error (unreadable file, empty input, not valid UTF-8). |
| 3 | Refused to score: `provenance === "prior"` and `--allow-uncalibrated` not given. |
| 4 | Internal invariant violation (contribution sum mismatch, weights file schema mismatch). |

**Exit code never encodes the verdict.** A caller doing `if [ $? -eq 0 ]` must not be able to read that as "human". Say this in the README.

### C.6 Library API

```js
import { detect, detectBatch, aggregate, buildCorpusIndex, VERSION } from './stylometry.mjs';
const report = detect(text, { shape:'chat', channel:'whatsapp', lang:'auto',
                              genre:'auto', domain:'general', corpusIndex:null,
                              allowUncalibrated:true, explain:false });
```

`detect` is **pure**: no clock, no RNG, no filesystem, no network, no global mutation. Same input ⇒ byte-identical report. Every `features/*` export has signature `(ctx) => Evidence[]`, reads only `ctx`, never throws, and returns `[]` (never a fabricated `0`) when it cannot compute.

---

## D. SCORING

### D.1 Combiner and weights file

```
z_i    = transform_i(x_i)
logit  = b0 + Σ_i (w_i * z_i)                 // over ACTIVE features only
score  = 1 / (1 + exp(-logit))
```

`transform_i`: **continuous** → `clip((x − μ[lang][shape][i]) / σ[lang][shape][i], −3, +3)` where μ/σ come from the **human** side of the training split, so `z = 0` means "typical human", not "typical text"; **rate** → same after `log1p` where heavy-tailed; **binary** → 0 or 1.

`weights.v1.json`:
```jsonc
{ "provenance": "prior", "generatedAt": "2026-09-09", "expiresAt": "2027-03-08",
  "corpusHash": null, "modelFamiliesCovered": [],
  "cells": { "en:chat": { "b0": -0.4, "w": { "terminal_punct_ratio": 0.60, … },
                          "mu": {…}, "sigma": {…} }, "en:prose": {…}, "tr:chat": {…}, … } }
```

Six cells: `{en,tr,ar} × {chat,prose}`. `mixed`/`unknown` languages use the script-agnostic subset of the `en` cell with all `w` halved and a `warnings:['mixed_language_reduced_features']`.

`b0` is fitted, never assumed, and must be **re-based to the deployment prevalence**:
`b0' = b0 + log(p_deploy/(1−p_deploy)) − log(p_train/(1−p_train))`.
Skipping this is the commonest way a lab-validated detector is wrong in production. Our own corpus's prior is 62% SYNTH — pure fiction relative to production.

### D.2 Hard gates and caps

Evaluated in order; first failure ⇒ `insufficient_text` with `gates.failed`.

| gate | chat | prose |
|---|---|---|
| **G1** chars ≥ | 100 | 250 |
| **G2** word tokens ≥ | **20** | **50** |
| **G3** language | `primary !== 'unknown'` (`mixed` allowed, reduced feature set) | same |
| **G4** active features ≥ | 3 | 6 |
| **G5** ≥1 feature of confidence HIGH or MED | yes | yes |
| **G6** not hybrid-suspect | high `llmChannel` **and** ≥2 strong human markers ⇒ `uncertain` + `warning:'hybrid_suspect'` | same |

**DECIDED — the floor is a joint word-AND-char floor, not D1's ×1.2 morphological multiplier.** D1 raised the TR/AR token gates by 1.2× on the premise that Arabic packs *more* content per token — which argues for a *lower* token gate, not a higher one; the premise and the adjustment point in opposite directions. A joint `words ≥ N AND chars ≥ M` gate expresses the real intent (enough surface for enough independent observations) without needing a per-language fudge factor, and it answers D2's open question directly: **the floor is counted in words AND characters, and it is enforced by both the CLI and the agent.** 20 Arabic words and 20 English words differ enormously in characters; the char floor is what makes them comparable.

Graded caps on `|score − 0.5|` — these are not abstention, they are a ceiling on how far a verdict may travel:

| word tokens | cap | strongest reachable verdict |
|---|---|---|
| < 20 | — | `insufficient_text` |
| 20–49 | 0.15 | `leaning_*` |
| 50–149 | 0.30 | `leaning_*` (`likely_llm` only via a rule) |
| 150–499 | 0.45 | `likely_llm` via rule; `likely_human` via aggregate |
| ≥ 500 | 0.50 | same |

Grounding: R1 §3 — commercial SOTA loses accuracy under 50 words (Booth 2025, independent); ~120 words needed for GLTR/DetectGPT and ~200 for GPT-4 output; sentence-level detection sits at chance; the vendors' own floors are 250 chars (GPTZero) and 300 words (Turnitin, raised from 150). D2's corpus measurement: only **7.6%** of our real customer messages reach 20 words, so `insufficient_text` on ~92% of real traffic is the product, not a bug to tune away.

**The only gate bypass:** a Tier-0 rule with `precision:"high"` (`assistant_frame_leak`, `own_bot_marker`, `near_duplicate`) bypasses G1–G5 and the caps, because those are **fingerprints, not stylometry**. `markdown_in_chat` bypasses G1/G2 but not the caps. `invisible_chars` bypasses nothing.

### D.3 Two channels and the verdict table

```
llmChannel   = 1 − exp(−Σ_{dir==='llm'}   max(0, w_i·z_i) / K)      // K = 2.0
humanChannel = 1 − exp(−Σ_{dir==='human'} max(0, w_i·z_i) / K)
```

The verdict comes from the **2-D table**, not from a threshold on `score`. `score` exists only to rank a queue; where the two disagree the table wins and `warnings` gets `score_table_disagreement`.

| | human < 0.25 | human 0.25–0.6 | human > 0.6 |
|---|---|---|---|
| **llm > 0.6** | `leaning_llm` † | `uncertain` | `uncertain` + `contradictory_evidence` |
| **llm 0.25–0.6** | `leaning_llm` | `uncertain` | `leaning_human` |
| **llm < 0.25** | **`insufficient_text`** ‡ | `leaning_human` | `leaning_human` § |

† **`likely_llm` requires a Tier-0 rule.** ‡ The bottom-left cell is the design's core commitment: no evidence either way ⇒ abstain, never "probably AI". § **`likely_human` requires aggregate mode** with ≥3 human-direction features including ≥1 expensive-to-fake one (`self_correction_marker`, `idiolect_stability`, `letter_elongation`, `arabizi`) and no Tier-0 rule.

**DECIDED — `likely_llm` is gated behind an artifact rule; the stylometric score tops out at `leaning_llm`.** This is the single most consequential decision in the spec and it reconciles all four lanes: R1 §5.5 (rules are near-100% precision, style is not) + R1 §7 (base rates), D1 §6.7 (at 1% prevalence three of four flags are innocent), D1's own escape hatch for assistant-frame leakage, DATA §3.4 (precision 0.183 at a 1% prior even at the strictest measured threshold), D2's invariant 4. The product's actionable output is `leaning_human` / `insufficient_text` plus a **ranked queue**; `likely_llm` is reserved for the cases where we found a fingerprint, not a style.

**DECIDED — `likely_human` is unreachable in single-message mode.** Every chat human marker is the cheapest thing in the world to prompt for (D1 fixtures B1/B3/B11), and DATA proved it empirically: the two lowest-scoring generated messages in the whole held-out set (0.001, 0.004) are the generator replaying a real transcript's telegraphic lowercase Turkish. Single messages top out at `leaning_human`.

**Additional invariant — no single feature carries a verdict.** Any verdict other than `insufficient_text` / `uncertain` requires ≥2 active features **of the same direction from ≥2 different groups**. This is what stops `terminal_punct_ratio` — DATA's strongest single signal at AUC 0.945, and also a pure register/keyboard proxy — from convicting a Turkish customer who happened to end a sentence with a period (DATA §5.1 rows 4–7 are exactly that failure).

### D.4 Ship-time guard

```js
if (weights.provenance === 'prior') {
  if (!opts.allowUncalibrated) { exit(3, 'refusing to score with uncalibrated prior weights'); }
  report.warnings.push('uncalibrated_weights');
  report.verdict = capToward('uncertain', report.verdict, { except: ['likely_human'] });
}
if (Date.now() > Date.parse(weights.expiresAt)) {
  report.warnings.push('weights_expired');
  report.verdict = demoteOneStep(report.verdict);   // toward uncertain
}
```

With prior weights: `likely_llm` remains reachable **only via a Tier-0 rule** (a rule is not a weight), and `likely_human` is exempt from the cap in aggregate mode. **The asymmetry is deliberate**: a false `likely_human` costs one missed datapoint; a false `likely_llm` is an accusation against a paying customer. The loss matrix is ~20:1 and the guard reflects it.

Expiry is 180 days because the lexicon is a snapshot of one generation of RLHF style — em-dash suppression alone moved measurably between model releases (R1 §5.2: GPT-4.1 at 10.62/1,000 words, GPT-5.4 at 1.43). A detector with no expiry silently rots into a formality detector.

### D.5 CALIBRATION PROCEDURE — what `run-eval.mjs` executes

```
node tools/llm-detect/eval/run-eval.mjs --data eval/data --out eval/out [--quick]
```

1. **Load and dedup.** Normalized-key dedup exactly as DATA §1.1 (NFKC → strip tashkeel/tatweel → Arabic-Indic digits to ASCII → alef/ya/ta-marbuta fold → strip emoji → Turkish-aware ASCII fold → lowercase → collapse non-alphanumerics). Print the duplicate rate per label. **Any accuracy quoted on a non-deduped stream is rejected by the harness** — our own corpus is 71.9% duplicate on the generated side and 31.6% on the human side, so raw-stream numbers double-count generated text nearly 4×.
2. **Detect texts that occur under both labels** and force them onto the same split side (59 such strings in our corpus: `merhaba`, `مرحبا`, `evet`, `7`, and one customer name). They are irreducible; no feature set separates them.
3. **Group-aware split, 60/20/20** (train/val/test): hold out by **author** (`writer_id`), by **persona** (`persona_id`), by **prompt template**, and by **HF dataset source**. Never split by row. Random row splits leak template siblings across the boundary and inflate AUC by 10–20 points; this is the commonest way a detector is oversold.
4. **Fit μ/σ on the human side of TRAIN only.**
5. **Fit L2-regularized logistic regression per cell** on TRAIN. Features marked `prior` and LOW-confidence start at 0 and are admitted only with a stable non-zero coefficient across all folds. **A fitted coefficient whose sign is opposite to §B is not flipped — it is flagged, investigated, and either explained or the feature is dropped.** A sign flip usually means a corpus artifact.
6. **Isotonic calibration on VAL.** Report ECE and a reliability diagram per cell.
7. **Threshold selection is fairness-constrained, not accuracy-maximizing:**
   ```
   τ = min{ t : FPR(t | non-native stratum) ≤ 0.02
                AND FPR(t | formal-register stratum) ≤ 0.02
                AND FPR(t | lang) ≤ 0.02 for each of en, tr, ar }
   ```
   Then report whatever recall falls out, per cell, **without editorializing**. If Arabic-chat recall at τ is 0.15, the release note says "we cannot do Arabic chat"; it does not lower τ.
8. **Report on TEST only.** A train number may appear in the output only on a line literally labelled `(train, reference only)`. The harness **refuses to print a train number in the headline table** — enforced in code, not by convention.
9. **Mandatory extra runs, all reported:**
   - **Leave-one-writer-out** over R0/R1/R2, model *and* thresholds refit inside each fold. DATA measured 86.2% / 31.1% / 8.8% flag rates. This is the binding constraint and it must be re-measured every release.
   - **Hard mode**: delete every orthographic/format feature a one-line prompt change would erase (`terminal_punct_ratio`, `sentence_initial_caps`, `all_lowercase`, `tr_asciified_probe`, `tr_apostrophe_absent`, `em_dash_in_chat`, `space_hygiene`, `ar_tashkeel_band`, `emoji_*`, `ellipsis_hand_typed`) and re-report. DATA: AUC 0.992 → **0.833**, recall at 5% FPR 0.997 → **0.504**. **Hard mode is the headline number for any adversary who is trying; the easy number is a footnote.**
   - **Negative controls:** (a) pre-2022 human text — expected positive rate ≈ target FPR; if it is 8%, we built a formality detector wearing a costume; (b) human-translated text; (c) machine-translated human text (will be flagged — measure it, document it, MT is not LLM authorship); (d) shuffled-sentence control (score should barely move; a large move means the segmenter is order-dependent); (e) **the product's own customer-service snippet library run as human text** — any snippet scoring above τ is added to the domain-suppression list.
   - **Base-rate table** at priors 50 / 20 / 10 / 5 / 2 / 1%, computed from the release's actual FPR and recall, printed next to every precision figure.
10. **Emit `weights.fitted.json`** with `provenance:"fitted"`, `corpusHash`, `modelFamiliesCovered`, `generatedAt`, `expiresAt = generatedAt + 180d`.

---

## E. THE DECISION TABLE AND THE AGENT

### E.1 CLI × judge → final

`LL` likely_llm · `EL` leaning_llm · `UN` uncertain · `EH` leaning_human · `LH` likely_human · `IT` insufficient_text · `⚠` print the CONFLICT block.

| CLI ↓ / Judge → | LL | EL | UN | EH | LH | IT |
|---|---|---|---|---|---|---|
| **LL** | LL | EL | EL | UN ⚠ | UN ⚠ | UN |
| **EL** | EL | EL | UN | UN ⚠ | UN ⚠ | UN |
| **UN** | EL | UN | UN | UN | EH | UN |
| **EH** | UN ⚠ | UN | UN | EH | EH | UN |
| **LH** | UN ⚠ | UN | EH | EH | LH | EH |
| **IT** | IT | IT | IT | IT | IT | IT |

Asymmetries, all deliberate:
- `CLI=LL, judge=IT` → `UN` but `CLI=LH, judge=IT` → `EH`. When the judge abstains the system falls toward human, not toward accusation.
- `CLI=UN, judge=LL` → `EL`. Judge-only confidence never reaches `likely_*` — the judge is a language model reading its own priors with no calibration.
- The whole `IT` row is absolute. **No judge finding overrides the CLI's `insufficient_text`.** The judge's read is still printed, under "what little can be seen", explicitly labelled *not a verdict*.

Four invariants above the table:
1. `insufficient_text` is absolute.
2. **No averaging.** The CLI score and the judge band are printed separately and never combined arithmetically. There is no "final score", only a final verdict.
3. Directional disagreement resolves to `uncertain` with both sides printed.
4. The judge may shift a cell **one step toward human** with a reason from a fixed list (non-native writer; sender is a support agent using a script; text is a pasted template or our own bot output; text is a structured list, not prose; under 40 words). **Never one step toward LLM.**

### E.2 Judge verdict derivation (before it sees the CLI)

- `likely_llm`: ≥2 **S**-class criteria quoted, from ≥2 different rubric groups, **and** no →HUMAN criterion evidenced, **and** ≥60 words.
- `leaning_llm`: 1 S + 1 M, or 3 M, quoted; or the humanized set (C17/C18/C19) with ≥1 S.
- `uncertain`: anything else that is not an abstention — including "tells present but a stated FP trap applies", which is the correct answer far more often than the judge will want it to be.
- `leaning_human`: ≥2 →HUMAN criteria quoted (C08, C10, C15-counter, C16, C20) and ≤1 M-class →LLM.
- `likely_human`: ≥3 →HUMAN criteria including ≥1 expensive to fake (C08 repair across messages, C20 idiolect continuity), no S-class →LLM. **Cross-message scope only.**
- `insufficient_text`: <20 words **or** <100 characters, or a bare list of names/numbers with no prose, or the language is not EN/TR/AR, or the text is mostly quoted material from another author.

### E.3 Report format

```
VERDICT: <one of six>                 confidence band: <strong|moderate|none|n/a>
CLI: <verdict> (score <0.00-1.00 or n/a>, <n> tokens, lang=<..> context=<..>)
JUDGE: <verdict> — <band>             [CONFLICT] if a ⚠ cell fired

RULES FOUND (artifact matches — high precision, printed separately from the score)
  • <rule name>: "<literal matched string>"     or "none"

EVIDENCE (3-6 bullets, each quoting the text)
  • [C##] "<quoted span>" — <one clause of why> (→LLM|→HUMAN, S/M/W)

CAVEATS
  • length: <n words — and what that means for this verdict>
  • language: <lang, and the language-specific FP trap that applies>
  • writer: <non-native / support-agent / unknown — and the effect>
  • provenance: <origin ≠ attribution note when relevant>

WHAT WOULD CHANGE THIS VERDICT
  • <2-4 concrete, obtainable things>
```

Bands are **words, never percentages**: strong / moderate / none / n/a. Numeric ranges are permitted only after a labelled validation set exists, and then only labelled `uncalibrated heuristic range`.

**Arabic reporting rule:** every Arabic quote prints as three parts on one line — `العربية` · *transliteration* · "English gloss". The owner's terminal reverses RTL and re-orders embedded digits. Never cite a character offset inside an Arabic string; cite the word index in ASCII.

### E.4 Signal-name map (D2's expected names → shipped names)

D2 asked for this table before build; D1 owns the truth; several of D2's names correspond to features this spec deleted or inverted. **This table is authoritative and B3 copies it into `RUBRIC.md`.**

| D2 expected | shipped | note |
|---|---|---|
| `sentence_len_cv` | `sentence_len_cv` | unchanged |
| `type_token_ratio`, `func_word_entropy`, `avg_word_len` | — | dropped (§B.7) |
| `repeat_ngram_rate` | `template_repetition` | aggregate mode only |
| `punct_em_dash_rate` | `em_dash_in_chat` | demoted to a chat binary, w 0.15 |
| `curly_quote_rate` | — | dropped; measured inverted (§B.7) |
| `markdown_in_chat` | `markdown_in_chat` | promoted to a **rule**, not a signal |
| `emoji_regime` | `emoji_repeat_run` (HUMAN↑), `emoji_bullet_led` (LLM↑) | the rate is dropped |
| `hedge_phrase_hits` | `hedge_density` | |
| `scaffold_phrase_hits` | `enumerated_openers` + `parallel_openers` | split |
| `typo_rate`, `typo_gap_cv` | — | **not implementable zero-dependency**; judge-only (C17/C18) |
| `tr_diacritic_completeness` | `tr_asciified_probe` | **direction inverted**: only the ASCII-fied⇒HUMAN arm exists |
| `tr_apostrophe_suffix_accuracy` | `tr_apostrophe_absent` | **direction inverted**, human-arm only |
| `tr_formal_suffix_rate` | `tr_formal_copula` | prose only, off for `formal_letter` |
| `ar_dialect_marker_rate` | `ar_dialect_markers` | HUMAN↑ only; MSA carries 0 |
| `ar_msa_connective_rate` | folded into `llm_lexicon_strong` (ar) | |
| `ar_indic_digit_ratio` | — | dropped; measured AUC 0.46 (§B.7) |
| `ar_hamza_accuracy` | `ar_orthographic_shortcuts` | **direction inverted**, human-arm only |
| `latin_in_rtl_rate` | — | dropped; `note` only |

Rubric criteria that have **no CLI counterpart** and must be argued qualitatively, never quantitatively: C17, C18 (typo distribution and class), C10 (non-native fluency profile), C13, C19 (register/content mismatch), C16 (dialect authenticity), C20 (idiolect continuity — CLI has `idiolect_stability` in aggregate mode only).

### E.5 THE AGENT — `.claude/agents/llm-text-detector.md` (final)

Changes from D2's draft, all forced by other lanes: the floor is words **and** characters; `likely_human` is unreachable single-message; rules are reported separately from the score; keyboard-proxy signals may never be cited toward LLM; `⟡V3⟡` gets an explicit line; `--corpus` is mentioned. Measured by the synthesizer with `wc -w`, not estimated: **836** body words, **897** including frontmatter — 3 words under the 900 limit. D2's draft plus these additions came to 942 and had to be trimmed; the trim came out of Procedure, never out of Anti-patterns, which is the rule B3 must also follow.

```markdown
---
name: llm-text-detector
description: Judge whether text (English, Turkish, Arabic) was written by a human or generated by an LLM, including humanized output with fake typos. Takes inline text, a file path, or .jsonl for batch. Runs the stylometry CLI, forms an independent quoted judgement, combines them under a fixed decision table.
tools: Bash, Read, Grep, Glob, Write
model: opus
---

You decide whether a text was written by a human or generated by an LLM. You are one of two
instruments; the other is a deterministic CLI. You are the qualitative one, and the one that must
stay honest about what it cannot see.

## Ground truth about your own limits

You cannot detect LLM text reliably in short samples, and you cannot detect well-humanized text
under about 60 words at all. Fluent non-native writing looks like LLM writing to every signal you
have, and that bias has never been measured for Turkish or Arabic. Nothing here is calibrated, so
you never print a percentage. A wrong "likely_llm" about a real customer is the worst outcome this
tool can produce; a wrong "uncertain" costs nothing.

## Procedure

1. **Normalize the input.** Inline text → a temp file under the session scratchpad. A `.jsonl`
   path → batch mode; any other path is one document. Never write inside the git repo unless the
   caller gave an explicit path there.

2. **Run the CLI, but do not read its verdict yet.**
   `node tools/llm-detect/stylometry.mjs --json --file <path> --context <chat|prose|auto> --lang auto --allow-uncalibrated > <out>.json`
   Add `--channel whatsapp` for chat turns and `--corpus <index.jsonl>` when a corpus is available.

3. **Judge first, independently.** Read `tools/llm-detect/RUBRIC.md`, then the text. Write your own
   verdict, evidence bullets and band **before** opening the CLI output — anchoring on the CLI is
   the main way this agent goes wrong. Every criterion marked present must quote a literal span;
   no quote means absent, not "weakly present".

4. **Then read the CLI JSON.** `rules[]` and `signals[]` are different kinds of thing: a rule is a
   matched artifact string with real precision, a signal is a weak style prior. Never merge them
   into one number. Combine with the decision table in RUBRIC.md; the table is the authority.
   Four invariants: `insufficient_text` can never be overridden; you never average your judgement
   into the CLI score; directional disagreement resolves to `uncertain` with both sides printed;
   you may shift a cell one step toward human for a stated reason, never toward LLM.

5. **Report** in the fixed skeleton: VERDICT + band, CLI line, JUDGE line, RULES FOUND, 3-6 quoted
   evidence bullets, CAVEATS (length, language, writer, provenance), WHAT WOULD CHANGE THIS.

## Batch mode (.jsonl)

Each line is `{"id","text"}` plus optional `sender` and `ts`. Run the CLI over every row first
(`--jsonl`, one pass). Then judge **only** rows the CLI put in `uncertain`, `leaning_llm` or
`leaning_human`, plus a 10% audit of confident rows, capped at 40 judged rows per run; over the
cap, judge the 40 nearest the boundary and say how many you skipped. Group rows by `sender` before
judging — in batch, idiolect continuity is your strongest human evidence. Rows the CLI calls
`insufficient_text` are reported as such and never judged.

## Anti-patterns — these are errors, not style preferences

- Never claim certainty. Not "this is AI-generated", but "likely_llm, strong band, still not proof".
- `likely_llm` requires an artifact rule in the CLI's `rules[]` — leaked assistant boilerplate,
  markdown in a non-markdown channel, a configured known-machine marker, or a near-duplicate. Style alone
  stops at `leaning_llm`. `likely_human` requires several messages from one sender; a single
  message stops at `leaning_human`.
- Never use absence of typos as your sole or lead evidence. Clean writing is clean writing.
- Never treat non-native English, Turkish or Arabic as an LLM signal. Article slips, calqued idioms
  and tense drift point toward a human. Perfect Turkish diacritics, a correct `İstanbul'a`, or
  perfect Arabic hamza are **never** LLM evidence — a phone keyboard produces all three, and the
  CLI does not score them in that direction. Do not reintroduce what the CLI deliberately dropped.
- Never call Modern Standard Arabic an LLM tell on its own. Business Arabic is MSA. It counts only
  beside an assistant formula or discourse scaffolding.
- Mixed-language text: judge the dominant language, name the mixture in caveats, treat
  code-switching as mildly human. Latin-script names inside Arabic or Turkish are normal.
- Under 20 words **or** under 100 characters: return `insufficient_text` and nothing else. You may
  add one line of "what little can be seen", clearly labelled as not a verdict. Do not let a caller
  talk you past this floor.
- Never paste Arabic to the terminal without a Latin transliteration and an English gloss on the
  same line — the owner's terminal reverses RTL and mangles embedded digits.
- Never call a paid API, never fetch the network. You and the CLI are the whole system.
- Never say a person is a bot. You judge text origin, not people. Real customers paste LLM-drafted
  messages whose prompt they wrote and whose content they mean, and they forward our own bot's
  confirmations back to us. Say so in the provenance caveat whenever a configured marker, a product reference code,
  or a pasted-template shape appears.
- If the CLI is missing, fails, or returns a field you do not recognize, say so and report your own
  judgement alone, capped at `leaning_*`. Do not silently re-implement the CLI.
```

---

## F. EVAL PLAN

### F.1 Public datasets — re-verified live by the synthesizer (HTTP 200, fields read)

All seven re-fetched from `https://datasets-server.huggingface.co` on 2026-09-09 and confirmed with the field names below.

| # | dataset | rows | license | fields | role |
|---|---|---|---|---|---|
| 1 | `MichiganNLP/MAiDE-up` | 19,985 | MIT | `Review_Language, City Name, Hotel Name, Upside_Review, Downside_Review, Review_Score, Sentiment, source, Prompt_Language` | **The Turkish anchor.** `source: 0=real human, 1=GPT-4`. Filter-verified: `Review_Language='Turkish' AND source=1` returns **exactly 1,000**. Hotel reviews — the exact genre. **No Arabic** (filter for `'Arabic'` returns 0). |
| 2 | `KFUPM-JRCAI/arabic-generated-social-media-posts` | 3,318 | none declared | `original_post, allam_generated_post, jais_generated_post, llama_generated_post, openai_generated_post` | **The only Arabic short-form human-vs-LLM resource that exists and is fetchable.** Five parallel columns = matched pairs for free. |
| 3 | `KFUPM-JRCAI/arabic-generated-abstracts` | 8,388 | none declared | `original_abstract, allam_/jais_/llama_/openai_generated_abstract`; splits `from_title`, `from_title_and_content`, **`by_polishing`** | Arabic long prose, four generators. The `by_polishing` split **is** the light-polish threat model that took Originality.ai from 92% to 12%. |
| 4 | `Flowerly/modern-fake-reviews` | 40,424 | cc-by-4.0 | `category, rating, label, text_` (**trailing underscore**) | EN reviews vs a *modern* generator. `label: 'OR'=human, 'CG'=LLM`. Both halves ASCII-normalized — smart quotes and em dashes folded — which is itself the proof that those tells evaporate for free. |
| 5 | `theArijitDas/Fake-Reviews-Dataset` | 40,526 | apache-2.0 | `category, rating, text, label` | EN reviews, `0=human, 1=machine`. **GPT-2-era machine half** — natively 13-word short text, so it is the honest place to measure the short-text ceiling, and a control for generation drift (a detector trained on it flags only ~4% of modern LLM reviews). |
| 6 | `Hello-SimpleAI/HC3` | 24,322 (config `all`) | cc-by-sa-4.0 | `id, question, human_answers[], chatgpt_answers[], source` | EN matched-pair QA prose. |
| 7 | `yaful/MAGE` | 436,606 | apache-2.0 | `text, label, src` | EN at scale. **`0 = machine, 1 = human` — INVERTED relative to every other dataset here.** The harness asserts this mapping in a unit test; getting it backwards is the likeliest silent bug in the eval. |

Access notes for the builder: use `/rows?dataset=…&config=…&split=…&offset=…&length=100` and page. The `/filter` endpoint works but returned HTTP 500 `"the dataset index is loading"` on two of my re-checks — **`fetch-public-datasets.mjs` must retry with backoff on 500 and fall back to paging `/rows` with a client-side filter.** Do not treat a 500 as "dataset gone".

**Verified failures — do not rediscover these:** `kinit/multitude` (auth-gated), `kanwal-mehreen18/Multilingual_MGT_Detection` (CastError), `qandos0/AFRD` (no data files), `Fath-Karaman/turkish-deception-detection-hotel-reviews` (broken CSV), `IbrahimAmin/egyptian-arabic-fake-reviews` (works, but its labels are spam/sentiment heuristics — **wrong task**), ALHD (Zenodo record 17249602 only, unfetched, unverified).

### F.2 In-house corpus split (from DATA)

`pull-messages-corpus.cjs` re-pulls `messages` where `role='user'`, columns `id, user_phone, content, created_at`, into `eval/data/corpus_user_messages.jsonl`. It **fixes the defect DATA hit**: the previous pull collapsed all 1,285 generated personas to `phone_tag:'S'`, destroying persona identity and making a true persona holdout impossible. The new script emits `persona_id = sha256(phone + salt).slice(0,12)` and `writer_id ∈ {R0,R1,R2}`, and never writes a phone number.

Splitting (`make-splits.mjs`) reproduces DATA's partition and reuses `data_split.json` where ids match:
- dedup first (REAL 31.6% dup, SYNTH 71.9%), both-label texts forced to the same side;
- REAL: **chronological per writer** (every held-out human message is later than that writer's training messages);
- SYNTH: **persona holdout** now that `persona_id` exists, plus DATA's whole-run-day holdout as the robustness check (DATA measured AUC 0.989 vs 0.992 across the two — the conclusion does not depend on the segmentation);
- report the ≥0.5 / ≥0.7 / ≥0.9 Jaccard contamination rate (DATA measured **15.8% / 3.5% / 0.85%** of generated messages are near-copies of a real human message, because the replay scenarios were built from real transcripts).

### F.3 Agent-generated LLM fixtures

**Zero API spend: these are written by the builder agent in-session, not generated through an API call.** Prompt-and-model provenance is recorded per row anyway (`{"gen":"claude-opus-5, in-session, prompt:'…'"}`), because §D.5 step 3 splits by prompt template.

Per language (EN / TR / AR), **25 rows each = 75 total**:

| genre | clean | humanized | notes |
|---|---|---|---|
| hotel review | 4 | 3 | matches MAiDE-up genre so the fixtures and the public data are comparable |
| product review | 2 | 1 | |
| WhatsApp booking message | 5 | 3 | **the deployment genre**; deliberately spans the 20-word floor |
| email to a hotel | 2 | 2 | |
| short essay / travel blurb | 2 | 1 | |
| **total** | **15** | **10** | |

Humanized variants use the four documented transforms, one per row, recorded in a `transform` field: (a) prompt-level `"write casually, lowercase, no final period"`; (b) `sed 's/—/, /g'` + lowercase sentence openers; (c) injected typos (`teh`, `recieve`, dropped apostrophes); (d) few-shot mimicry of three REAL corpus messages from the same language. **The adversarial suite asserts the score DROPS under (b) and (c)** — the point is to document the collapse in CI, not to pretend it is prevented.

Also required: `must-not-fire.jsonl` (D1 §7's 24 rows — 12 human-that-looks-LLM, 12 LLM-that-looks-human, each with an `allowed` verdict set) and `judge-tests.jsonl` (D2 §5's 14 rows, most verbatim from the corpus, each with an `expectedFinal` and a `criticalFailure` field).

### F.4 Where genuinely-human text comes from — and where it does not

| cell | human source | verified? |
|---|---|---|
| EN prose / reviews | Flowerly `label='OR'`, Fake-Reviews `label=0`, HC3 `human_answers`, MAGE `label=1` | **yes, fetched** |
| TR reviews | MAiDE-up `Review_Language='Turkish' AND source=0` | **partly.** `source=1` filter verified at exactly 1,000. The `source=0` counterpart returned HTTP 500 (`index is loading`) on re-check; the dataset is 10,000 real + ~10,000 generated across 10 languages so ~1,000 is expected. **The builder must verify the count at pull time and record it in the manifest** rather than assume it. |
| TR chat | our own corpus, REAL writers R0/R1/R2 | yes (in-house) |
| AR short-form | KFUPM `original_post` (3,318 social-media posts) | **yes, fetched** |
| AR long prose | KFUPM `original_abstract` (academic abstracts) | **yes, fetched** — but the genre is academic, not review |
| AR chat | our own corpus, REAL writers R1/R2 | yes (in-house) |
| **AR reviews** | **NONE.** | **No fetchable source exists.** ALHD (>400K, includes a reviews genre) is on Zenodo record 17249602 and was never fetched or verified. |
| **TR non-review prose** | **NONE.** | Turkish appears in no major multilingual MGT benchmark. MAiDE-up's 1,000+1,000 review slice is the entire Turkish budget in the world. |
| **Chat-length (<30 words) human-vs-LLM, any language** | **NONE.** | No labelled corpus exists that R1 could find. Our own corpus is the only one, and it is three humans and one generator. |

**Fallback and the caveat that must be printed.** For Arabic reviews, substitute KFUPM `original_post` (short-form social) as the human side and its four `*_generated_post` columns as the LLM side, and print verbatim in every Arabic-review result:

> "No labelled corpus of human-written Arabic reviews is publicly available. The Arabic numbers below are measured on social-media posts and academic abstracts, and are transferred to the review genre by assumption, not by measurement. Treat any Arabic review verdict as uncalibrated."

For Turkish non-review prose, print verbatim:

> "The only labelled Turkish resource in existence is 1,000 GPT-4 hotel reviews and their human counterparts. Every Turkish number below is measured on hotel reviews. Turkish is also the language where GPT-4 output was measured to be *least* detectable of ten. Do not extrapolate to Turkish chat, email or essays."

---

## G. METRICS AND THE HONESTY BAR

### G.1 What `run-eval.mjs` prints — held-out only

Per **(language × length bucket)** cell, on TEST:
`n_human, n_llm, AUC, ECE, FPR@τ, TPR@τ, precision@τ` at the fairness-constrained τ, plus precision re-computed at priors 50/20/10/5/2/1%.

Length buckets: `<20 words (gated)`, `20–49`, `50–149`, `150–499`, `≥500`.
Languages: `en`, `tr`, `ar`, `mixed`.

Mandatory additional rows, none optional:
- **hard mode** (format features deleted) beside every headline row;
- **leave-one-writer-out** flag rate per writer;
- **per-stratum FPR**: non-native, formal-register, mobile-typed, machine-translated;
- **negative controls** (a)–(e) from §D.5;
- an explicit `(train, reference only)` marker on any train number.

Any cell with `n_human < 100` or `n_llm < 100` prints `INSUFFICIENT — placeholder, not a measurement` instead of a number. DATA's EN cell (n=40) and UNK cell (n=52) are exactly why: a 0.429 precision computed from three positives is a rounding artifact wearing a decimal point.

### G.2 The README's two verbatim caveats

`README.md` prints both of these, word for word, above any usage instructions. B3 does not paraphrase them.

**THE THREE-HUMANS CAVEAT**

> The human side of our in-house corpus is three people. R0 (1,241 deduplicated messages), R1 (466) and R2 (147) are not a sample of humanity; they are three idiolects, one of whom types Turkish without diacritics and two of whom write multi-line guest lists. In a leave-one-writer-out test — train on two of them, score the third — the model flagged **86% of R0's real messages as machine-generated**, because with R0 removed the surviving humans were the ones who use newlines, so the model learned that "human" means "writes multi-line lists". Ranking survived that test (AUC 0.967); the threshold did not. **Any threshold in this tool is valid for the writers it was fitted on and for nobody else.** Calibrate per sender against that sender's own history, and abstain until there is history.

**THE NON-NATIVE-WRITER CAVEAT**

> This detector is biased against people writing in a language that is not their first, and against anyone writing formally. Seven commercial detectors flagged **61.22% of 91 TOEFL essays** by non-native English writers as AI-generated, versus **5.19%** of essays by US eighth-graders; a 2026 re-test of the same essays still measured **23.1% versus 0%**. The mechanism was vocabulary richness being mistaken for authorship. The *direction* of that bias is a property of the language, not a law: in Czech it reverses, because inflectional morphology means learner errors raise entropy instead of lowering it. **Nobody has ever measured the direction for Turkish or Arabic.** If this tool leans toward "LLM" about a careful non-native writer, it is wrong in exactly the way it is known to be wrong, and the correct response is to disbelieve it.

### G.3 The base-rate line that must appear next to every flag

At FPR 2% and recall 60%: precision is 0.968 at a 50% prevalence, 0.612 at 5%, 0.380 at 2%, **0.233 at 1%**. Measured on our own corpus at its own operating points: precision **0.183 at a 1% prior**, i.e. four of five flags wrong, even at the strictest threshold we measured. The README states this, and the CLI puts the corresponding sentence in `caveats[]` on every non-abstain report.

---

## H. WAYS THIS DETECTOR WILL BE CONFIDENTLY WRONG

Ordered by how likely each is to happen in this product, in production, this quarter. All of these go in the README under this exact heading.

1. **A customer forwards our own bot's confirmation back to us and gets flagged.** Measured, not hypothetical: the single highest-scoring "human" message in DATA's held-out set (score 1.000) is a customer pasting our `⟡V3⟡` price list back into the chat. The text is machine-written; the author is a paying customer. `own_bot_marker` catches the marker-bearing ones; nothing catches a customer who retypes a hotel name and room type out of our menu, Arabic comma and all.
2. **A careful Turkish customer with a Turkish keyboard, who ends a sentence with a period.** DATA rows 4–7: real Turkish, correct diacritics, mid-sentence period, flagged at the 5% and 10% thresholds. The ≥2-features-from-≥2-groups invariant is the mitigation, not a cure.
3. **A fluent non-native English writer being formal.** The whole of §G.2. `leaning_llm` on a "Dear Sir, We are 4 person, two adult and two childs" message is a critical failure, and the rubric's C10 exists solely to stop it.
4. **A support agent's snippet library.** "Thank you for reaching out. I'd be happy to help." is on the LLM list and in the human template file. Domain suppression handles it only if the caller passes `--domain customer_service`. **A caller who forgets the flag accuses the support team.**
5. **A human who used an assistant for grammar.** 10% light polishing took a commercial Arabic detector from 92% to 12% accuracy, and its baseline FPR on *unpolished* human Arabic was already 8%. Our design's answer is to abstain (`hybrid_suspect`), which means we will also miss real hybrids. Both halves of that trade are real.
6. **A marketing-register human.** Emoji-headed sections, "Şehrin kalbinde", a bulleted list of five tips — humans copied that format *from* models. It is the worst confounder class in the catalogue and we have no defence beyond `warning:'marketing_register'`.
7. **Machine-translated human text.** MT and LLM decoding share a rhythm: flat sentence length, no idiom, no typos. We flag it, we measure how badly in negative control (c), and we do not pretend to separate them.
8. **A generator told to write like a WhatsApp user.** Hard mode: AUC 0.833, recall at 5% FPR **0.504**. Half of everything is gone for one line of prompt. The two lowest-scoring generated messages in our own held-out set were the generator replaying a real transcript's style — proof that imitation works whenever the adversary has a sample.
9. **Any adversary at all.** A sed pass replacing `—` with `, ` and lowercasing sentence openers defeats a third of the catalogue. Homoglyph substitution cost a commercial detector 75.7 points. Our power against a trying adversary is zero, and the CI suite asserts the collapse rather than hiding it.
10. **A small open-weights model.** The lexicon is a snapshot of instruction-tuned frontier-assistant register. An 8B model's repetitive, occasionally ungrammatical output does not match it — `content_word_repeat` even points HUMAN. Known blind spot; the corpus stratification exists to measure it, not to fix it.
11. **The lexicon aging out.** Every threshold decays with each model release. GPT-4.1 emitted 10.62 em dashes per 1,000 words; GPT-5.4 emits 1.43. Two shipping models emit zero. The 180-day expiry is the only defence.
12. **A number quoted without its base rate.** The most likely way this tool causes harm is not a wrong verdict but a right verdict read as "97% accurate" when it is 18% precise. §G.3 exists for this.

## NON-GOALS

- **Not evidence.** Not for discipline, moderation, refunds, disputes, or any conversation with a customer about their honesty. Triage and corpus hygiene only.
- **Not an attribution tool.** It judges strings, never people. "This text was LLM-generated" does not mean "this person is a bot" or "this person is deceiving you".
- **No perplexity, no log-probabilities, no model in the loop.** DetectGPT, Fast-DetectGPT, Binoculars and GLTR all need token log-probs from a resident LM. GLTR's 62.6% TPR at 5% FPR on an independent benchmark is our **ceiling, not our target**.
- **No watermark detection.** SynthID only detects models that opted in; WhatsApp traffic is not watermarked.
- **No true typo detection.** Zero-dependency means no wordlist; everything in the "typo" family is orthographic-shortcut detection, which is a proxy. Typo *distribution* stays a judge criterion.
- **No Italian, French or Spanish.** Scope is EN/TR/AR, Arabic first. Do not add IT/FR/ES rows, corpora or tickets. (Existing IT/FR/ES coverage elsewhere in the repo is not removed either.)
- **No paid API, no network, in the shipped tool.** `fetch-public-datasets.mjs` is the only networked file and it is eval-only, free, and unauthenticated.
- **Not a per-message chat verdict.** Aggregate over a sender or return `insufficient_text`.
- **Not a replacement for near-duplicate matching** if the real question is "are these reviews fake". For that use case, `near_duplicate` alone is the better instrument and it needs no detection theory.

---

## I. BUILD SPLIT — three parallel builders

### B1 — stylometry core + self-tests

**Owns exclusively:** `tools/llm-detect/stylometry.mjs`, `lexicon-src/*.txt`, `build-lexicon.mjs`, `lexicon.v1.json`, `weights.v1.json`, `selftest.mjs`.

Deliver:
1. The pipeline of §B.9 — three text views, `caseFold(s,'tr')` with the U+0307 strip, `AR_LETTER` as the v-flag set intersection, `WORD_RE` with the tatweel lookahead, hand-rolled segmenter, language ID with the Perso-Arabic guard.
2. Every Tier-0 rule (§B.1) and every Tier-1 feature (§B.2–B.6) at the stated weights. Nothing from §B.7. Every `Evidence.note` names a confounder.
3. Aho-Corasick lexicon matching, single pass, built once at module load.
4. The scorer of §D: two channels, the 2-D table, gates, caps, the ≥2-features-from-≥2-groups invariant, the rule-gated `likely_llm`, the aggregate-gated `likely_human`, the ship-time guard.
5. CLI of §C: all flags, `--jsonl`, `--aggregate`, `--corpus`, exit codes 0–4.
6. `selftest.mjs`, zero-dep, `node selftest.mjs` exits non-zero on any failure:
   - **Unicode assertions** for every claim in §B.9 (I verified all of them on v24.5.0 — re-assert them in code so a Node upgrade cannot break them silently);
   - **segmenter fixtures**: decimals, `Dr.`, URLs, `…`, `!!!`, emoji-terminated lines, a six-line unpunctuated WhatsApp message, an RTL paragraph with embedded Latin;
   - **one hand-computed golden value per feature**;
   - **contribution-sum invariant** (§C.3 rule 3);
   - **determinism**: same input ⇒ byte-identical JSON across two runs and two Node minor versions;
   - **the 24 `must-not-fire` fixtures** (B1 reads B2's file if present; ships its own inline copy of 6 of them so B1 is not blocked by B2).

### B2 — eval harness, fixtures, corpus pull

**Owns exclusively:** everything under `tools/llm-detect/eval/`, plus the single new line in root `.gitignore`.

Deliver:
1. `pull-messages-corpus.cjs` — `require('dotenv').config({path: <repoRoot>/backend/.env})`, `@supabase/supabase-js` from `backend/node_modules`, table `messages`, `role='user'`, columns `id,user_phone,content,created_at`, paged 1,000 at a time. **`git check-ignore -q` the output directory and exit 2 if it is not ignored.** Emits `writer_id`/`persona_id`, never a phone number. Requires an explicit `--i-have-approval` flag and prints "this performs a database read" before doing so. `--dry-run` prints counts only.
2. `fetch-public-datasets.mjs` — the seven verified sources of §F.1, retry-with-backoff on HTTP 500, `/rows` paging fallback when `/filter` is unavailable, a `manifest.json` recording the **actual** row counts fetched (not the expected ones), licences, and a per-file sha256.
3. `make-splits.mjs` — §F.2, group-aware by `writer_id` / `persona_id` / prompt template / dataset source, both-label texts forced to one side, contamination report.
4. `run-eval.mjs` — the ten steps of §D.5 and the metric table of §G.1, writing `weights.fitted.json`. **It must refuse in code to print a train number in the headline table.**
5. Fixtures: `must-not-fire.jsonl` (24), `judge-tests.jsonl` (14), `llm-{en,tr,ar}.jsonl` (25 each, §F.3), `human-chat.jsonl` (from our corpus, deny-by-default redaction — a token is printed only if it is in a booking/function-word allowlist, so some innocent rare words print as `[NAME]`; that is the correct direction to err).
6. The `.gitignore` line, exactly: `tools/llm-detect/eval/data/`.

### B3 — agent, rubric, README

**Owns exclusively:** `.claude/agents/llm-text-detector.md`, `tools/llm-detect/README.md`, `tools/llm-detect/RUBRIC.md`.

Deliver:
1. The agent file **verbatim from §E.5**. Verify with `wc -w` and report the actual number; if an edit pushes it over 900 words including frontmatter, cut from the Procedure section, never from Anti-patterns.
2. `RUBRIC.md`: D2's 20 criteria C01–C20 with their FP traps and the banned-inference list, the §E.1 decision table with all four invariants, the §E.2 derivation rules, the §E.3 report skeleton and Arabic reporting rule, and the **§E.4 signal-name map verbatim** — including the "no CLI counterpart" list, so the judge never borrows quantitative authority for a criterion the CLI does not measure.
3. `README.md`: the §0 honest statement; the four-tier threat model (T0 unaware / T1 lightly styled / T2 post-edited hybrid / T3 adversarial) with "this is a lock on an unlocked door: it works because nobody is trying"; **both §G.2 caveats verbatim**; the §G.3 base-rate table; §H "Ways this detector will be confidently wrong" and "Non-goals" in full; usage; **and an explicit note that exit code 0 means "a report was produced" and never "the text is human"**.

### Conflict rules

- **No file has two owners.** The only shared file is root `.gitignore` and only B2 touches it.
- B1 and B2 both reference the fixture verdict vocabulary; §C.2 fixes it and neither may change it. If a fixture and the core disagree, **the head arbitrates** — B2 does not "fix" B1's verdict names and B1 does not edit B2's fixtures.
- B3 depends on §E.4, which is frozen in this spec. If B1 must rename a signal, it tells the head; the head updates §E.4 and B3 re-copies. B3 never guesses a name at run time.
- Nobody runs jest, `gate.sh`, `npm run deploy`, or any live test. Nobody calls a paid API. `fetch-public-datasets.mjs` is the only file permitted to touch the network, and only against `datasets-server.huggingface.co`.

### Acceptance checks the head will run

```bash
# 1. Zero dependency, really.
grep -nE "^\s*(import|require)\s*\(?['\"][^./]" tools/llm-detect/stylometry.mjs    # must print nothing
node -e "import('./tools/llm-detect/stylometry.mjs').then(m=>console.log(Object.keys(m)))"

# 2. Self-tests, including the 24 must-not-fire fixtures.
node tools/llm-detect/selftest.mjs                      # exit 0

# 3. Determinism.
node tools/llm-detect/stylometry.mjs --file X --json > a.json
node tools/llm-detect/stylometry.mjs --file X --json > b.json && diff a.json b.json   # empty

# 4. The guard actually guards.
node tools/llm-detect/stylometry.mjs --text "..." --json ; echo $?    # 3 without --allow-uncalibrated

# 5. The floor holds. Every one of these must be insufficient_text with score null.
for t in "tamam abi" "٥ بالغين و ٣ اطفال" "Sure, sounds good." \
         "reis naber antalya 5 kasim giris 3 gece 2 kisiyiz" \
         "Good morning. Could you please confirm the reservation for two adults on 12 March? Thank you."; do
  node tools/llm-detect/stylometry.mjs --text "$t" --allow-uncalibrated --json | \
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.verdict, j.score)})'
done

# 6. likely_llm cannot come from style alone.
grep -c "likely_llm" <(node tools/llm-detect/stylometry.mjs --file eval/fixtures/human-formal-l2.txt --allow-uncalibrated --json)   # 0

# 7. Contribution sum invariant — asserted in selftest, spot-checked here.
node tools/llm-detect/stylometry.mjs --file X --explain --json | node -e '…assert Σcontribution + b0 == logit(score)…'

# 8. No PII escaped.
git status --porcelain | grep -E "eval/data/" && echo "FAIL: data dir is tracked"
git check-ignore -q tools/llm-detect/eval/data && echo "OK: ignored"
grep -rE "\+?[0-9]{10,15}" tools/ .claude/agents/ && echo "FAIL: phone-shaped digit run in a tracked file"

# 9. Agent length.
wc -w .claude/agents/llm-text-detector.md          # < 900

# 10. The caveats are verbatim, not paraphrased.
grep -q "86% of R0's real messages" tools/llm-detect/README.md && \
grep -q "61.22% of 91 TOEFL essays" tools/llm-detect/README.md && echo "OK: caveats intact"

# 11. Eval refuses to headline a train number.
node tools/llm-detect/eval/run-eval.mjs --quick 2>&1 | grep -i "train" | grep -v "reference only" && echo "FAIL"

# 12. Hard mode is reported.
node tools/llm-detect/eval/run-eval.mjs --quick 2>&1 | grep -q "hard mode" && echo "OK"
```

**Gate:** a build ships only if (2) passes with **zero `likely_llm` on the 12 human-that-looks-LLM fixtures**, **zero `likely_human` on the 12 LLM-that-looks-human fixtures**, and **≥6 of those 12 producing `insufficient_text` or `uncertain`**. Abstention is the deliverable, not the consolation prize.

---

## APPENDIX — every place the lanes disagreed, and the ruling

| # | Disagreement | Ruling |
|---|---|---|
| 1 | Verdict vocabulary: D1 `abstain/unknown` vs D2 `insufficient_text/uncertain` | D2's names, D1's semantics. Gate failure → `insufficient_text`; thin/contradictory evidence past the gates → `uncertain`. |
| 2 | Length floor: D1 5–6 tokens, D2 20 words, R1 ~50 words, DATA 30 chars | Joint word-AND-char floor: chat 20 words + 100 chars, prose 50 words + 250 chars. D1's ×1.2 TR/AR multiplier is deleted — it contradicts its own premise; the char floor does the language-neutral work instead. |
| 3 | Em dash | Prose rate dropped (R1's human range contains the model range). Survives only as a chat binary at w 0.15. |
| 4 | Arabic-Indic digits | Dropped. DATA measured AUC 0.46 — no signal, both sides type `٠-٩`. Retained only as an out-of-scope keyboard `note`. |
| 5 | Emoji | Rate dropped (AUC 0.513); the repeat/bullet-led *patterns* kept. |
| 6 | Turkish diacritics / apostrophe, Arabic hamza | One-armed, human-direction only. D1's LLM arms deleted per DATA's corpus-artifact finding and D1's own A6/A7 fixtures. A human-direction feature cannot produce a false accusation — which is why no separate "safe mode" flag is needed. |
| 7 | `has_newline`, message length | Dropped entirely. DATA's LOWO shows `has_newline` caused an 86% false-positive rate on a real customer; length is a generator config value. |
| 8 | Curly quotes / smart punctuation | Dropped. DATA measured the sign **inverted** (humans 23.5%, generator 0%). |
| 9 | Is `likely_llm` an allowed output? (D1 open Q1) | Yes, but **only behind a Tier-0 artifact rule**. Style alone stops at `leaning_llm`. R1 §5.5 + §7d, D1 §6.7, DATA §3.4 all point here. |
| 10 | Is `likely_human` reachable single-message? (D2 open Q4) | No. Aggregate mode only. Every chat human marker is trivially promptable, and DATA's two lowest-scoring generated messages prove it empirically. |
| 11 | Aggregation: optional or required? | **Required** B1 deliverable. It is R1's only evidence-backed short-text lever (10 tweets: 80% → ~100%). |
| 12 | Near-duplicate matching | Promoted from a footnote to a first-class Tier-0 rule with its own `--corpus` flag. R1 called it the single thing most worth building first; no other lane had it. |
| 13 | MSA-vs-dialect (R1 open Q3: feature or banned?) | Dialect presence is human evidence; MSA presence carries **zero** in every context. Not banned — half-banned, in the only half that is safe. |
| 14 | ASCII normalization vs the em-dash tell (R1 open Q9) | A false dilemma. D1's three-view pipeline resolves it: normalization is per-view, not global. Rules read `raw`, lexicons read `foldedLex`. |
| 15 | Signal names (D2 open Q1) | D1's snake_case wins where the feature survived; §E.4 is the authoritative map, including the deletions and the two direction inversions. |
| 16 | Rubric location (D2 open Q2) | `tools/llm-detect/RUBRIC.md`, read at run time. Inlining it would blow the agent's 900-word budget. |
| 17 | Batch mode: native flag or shell fallback? (D2 open Q2/§6) | Native `--jsonl` with `id` passthrough is required of B1. D2's shell fallback is deleted as dead weight. |
| 18 | Deployment target (D1 open Q3, R1 open Q5, DATA open Q2) | **Corpus hygiene first**, chat second, and chat only through `--aggregate`. This is the only mode our own data supports, and it is the head's call to make, not a builder's. |
| 19 | Typo distribution features (D2 §6) | Not implementable zero-dependency. They stay judge-only criteria and the CLI does not fake them. |
| 20 | Persona ids destroyed at export (DATA open Q1) | Fixed at the source: the new pull script emits a salted `persona_id` hash, which recovers persona holdout **and** satisfies the no-PII rule in the same move. |

*Unresolved and escalated to the owner, not decided here:* whether `--domain customer_service` should default to **on** for this product's traffic (it would suppress the LLM lexicon rows that a human support team actually uses, at the cost of recall on genuine assistant text arriving through the same channel); and whether the customer-service snippet library exists in a form B2 can load for negative control (e).
