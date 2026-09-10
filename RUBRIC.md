# RUBRIC — the judge side of llm-detect

The agent (`agent/llm-text-detector.md`) reads this file at run time and forms its verdict from it
**before** it looks at the CLI's output. The CLI is the quantitative instrument; this rubric is the
qualitative one. They are combined by the decision table in §3, never by averaging.

**Language scope: English and Turkish.** Arabic is out of scope (HEAD-RULINGS R22): Arabic script
returns `insufficient_text` with reason `unsupported_language` and is never judged. Criteria C14,
C15 and C16 were the Arabic group; their ids are retained but withdrawn, so that every other
criterion keeps the number the CLI, the agent and the design documents already refer to.

**Evidence rule (hard):** a criterion may only be marked *present* if the judge can quote a literal
span from the text. No quote → the criterion is `not-evidenced`, not "weakly present".

Direction: `→LLM` raises LLM-ness, `→HUMAN` lowers it. Weight class: **S**trong / **M**edium /
**W**eak — a criterion's weight is capped by its class no matter how many instances are found;
three W hits never equal one S hit.

*Examples marked "(constructed)" are written for this file. No row from the private calibration
corpus is reproduced here; aggregate facts about that corpus are, and are labelled as such.*

---

## 1. THE 20 CRITERIA

### Group A — cross-language structure (the part that survives humanization)

**C01 · Assistant politeness envelope · →LLM · EN TR · S**
An opener that accepts the task and/or a closer that offers further help, wrapping content that
did not need either. Evidence = quoting the opener or closer.
EN: "Sure!", "Certainly!", "Great question", "I hope this helps", "Let me know if you need anything else".
TR: "Elbette", "Tabii ki", "Memnuniyetle", "Umarım yardımcı olur", "Başka bir sorunuz olursa
buradayım", "Size yardımcı olmaktan memnuniyet duyarım".
*FP trap:* customer-service humans are trained to write exactly this. If the sender is an agent,
a hotel, or a support rep, downgrade to W.

**C02 · Discourse scaffolding and enumerated triads · →LLM · EN TR · S**
Explicit ordinal scaffolding, or a summarizing frame, in text short enough not to need one.
EN: "First, ... Second, ... Finally,", "It's important to note that", "In summary", "Overall".
TR: "Öncelikle", "İkinci olarak", "Son olarak", "Belirtmek gerekir ki", "Özetle".
Also counts: three parallel items where two would do, repeatedly.
*FP trap:* a genuine structured brief (a family manifest, an itinerary) is enumerated because the
*content* is enumerated. Scaffolding counts only when it frames prose, not when it lists facts.

**C03 · Balanced-contrast frame · →LLM · EN TR · M**
Antithesis used as a rhetorical default: "not only X but also Y", "It's not just X — it's Y",
"While X, Y", TR "sadece ... değil, aynı zamanda ...", "-mekle birlikte". Evidence = the quoted
construction; two or more in one short text is S.

**C04 · Semantic uniformity · →LLM · EN TR · M**
Sentences share the same shape: same clause count, same length band, same information density,
each one complete. Humans mix a 3-word fragment with a 40-word run-on. This is the qualitative twin
of the CLI's sentence-length CV — the judge asserts it only after quoting two or three consecutive
sentences that demonstrate the sameness.
*FP trap:* lists and form-like messages are uniform for structural reasons. Not applicable when
`context=chat` and the message is a list.

**C05 · Meta-commentary and instruction echo · →LLM · EN TR · S**
The text restates the request before answering, announces its own structure, or leaves a task frame
in place: "Here's a draft of...", "As requested, below is...", TR "İsteğiniz üzerine ...".
Also: headings, bold labels, or a numbered plan on a message that answers a one-line question.

**C06 · Surface-form fingerprint: typography and emoji regime · →LLM/→HUMAN · EN TR · W (M only when corroborated)**
*Typography, →LLM:* spaced em dash `—`, curly quotes `“ ” ’`, a real ellipsis `…`, `*` / `-` markdown
bullets or `**bold**` inside a WhatsApp-style channel, consistent Oxford commas, no double spaces,
no stray shift-caps.
*Emoji, →LLM:* at most one decorative emoji, at the end of a clause, semantically redundant with the
sentence it decorates ("Teşekkürler, iyi günler! 😊").
*Emoji, →HUMAN:* repeated or clustered emoji (😂😂😂), emoji mid-clause replacing a word, emoji that
contradicts the literal text (irony), skin-tone or regional variants used consistently.
*Deliberately weak:* iOS/macOS autocorrect produces curly quotes and em dashes for humans, and
copy-paste carries formatting across. Never a lead signal; only ever a corroborator. Corpus fact:
real customer messages in the private calibration corpus contain `—` and `*` bullets.

**C07 · Over-complete specification / zero unresolved deixis · →LLM · EN TR · M**
Every referent is introduced; nothing depends on shared history; no pronoun points outside the
message; quantities are round; no unanswered question is assumed. Human chat is the opposite:
"the one we said yesterday", "same as before", bare "olsun".
Evidence = quoting the fully-specified span *and* noting what a human would have left implicit.

**C08 · Absence of repair and channel behaviour · →HUMAN when present · EN TR · M**
→HUMAN: mid-message self-correction ("yok pardon", "sorry i meant"), abandoned clause, a second
message that fixes the first, duplicate send, trailing fragment, a line that answers a question
nobody asked yet.
→LLM: single-pass, no repair, no fragment, ends where it planned to end.
Corpus fact: real messages routinely open with a correction of the previous turn.

### Group B — English

**C09 · EN register lexicon · →LLM · EN · M**
The assistant-register word set used unprompted: delve, leverage, robust, seamless, underscore,
"a testament to", "navigate the complexities", "in today's fast-paced", "it's worth noting",
"ensure", "utilize", "furthermore/moreover" at high density, "crucial", "vibrant", "rich tapestry".
Evidence = quoted words with count. Two or more distinct members in <150 words is the threshold.
*FP trap:* academic and business English uses these natively. In `--context prose` drop to W.

**C10 · EN non-native fluency profile · →HUMAN · EN · M**
Article/preposition slips ("in the last week we go"), calqued idiom ("we are 4 person"), tense drift,
number agreement misses, transliterated names inconsistently spelled — **while** the content is
coherent. This is the anti-false-positive criterion and it is mandatory to check whenever the writer
appears non-native. Example (constructed): "my son 5 years old, other son he is 10 years old, we
want room for 4 person" — that is a Turkish speaker writing English, not a model.
Never invert it: absence of this profile is *not* evidence of an LLM.

### Group C — Turkish

**C11 · TR assistant register · →LLM · TR · S**
Openers/closers of C01 in Turkish plus the bureaucratic-service register: "-ebilirsiniz /
edebilirsiniz" stacks, "gerçekleştirmek", "sağlamaktadır", "bulunmaktadır", "tarafınıza",
"rezervasyonunuz oluşturulmuştur", heavy nominalization ("yapılması", "sağlanması").
Contrast set (→HUMAN): "olsun", "lazım", "yaparız", "reis", "naber", "kanka", "hallederiz".
The human pole looks like this (constructed): "reis naber antalya 12 mart giris 4 gece 3 kisiyiz".

**C12 · TR orthographic perfection · →LLM · TR · M**
All six diacritics present and correct (ç ğ ı ö ş ü and the İ/I distinction), correct apostrophe on
proper-noun suffixes ("İstanbul'a", "Yağcı'nın"), correct separate/joined "de/da" and "ki",
correct "-ecek/-acak" vowel harmony throughout a long agglutinative chain, no ASCII folding.
Real Turkish WhatsApp is largely ASCII-folded: real chat in the calibration corpus reads "lazim",
"gidiyor", "kisiyiz", "yasinda", "giris", "cocuk".
*FP trap (strong):* a Turkish keyboard on a phone produces perfect diacritics automatically, and
educated writers punctuate correctly. Perfection alone is at most M and never sufficient alone;
it needs C11 or a Group A criterion to matter.

**C13 · TR register/content mismatch · →LLM · TR · M**
Formal morphology carrying casual content, or slang carrying formal syntax: "kanka, rezervasyonunuz
tarafınıza iletilmiştir", second-person plural politeness inside a message that also says "naber".
Evidence = the two quoted spans that clash, side by side.

### Group D — Arabic — WITHDRAWN (HEAD-RULINGS R22)

**C14 · MSA drift in a dialect channel — WITHDRAWN.**
**C15 · AR assistant formulae and orthographic perfection — WITHDRAWN.**
**C16 · AR dialect authenticity check — WITHDRAWN.**

Arabic is out of scope for this build. Arabic-script input is gated at the language check
(`language.primary = "unsupported"`, `gates.failed: ["G3_lang"]`, `reason: "unsupported_language"`)
and never reaches the rubric. These three ids are reserved, never cited, and never satisfied.
References to "C15-counter" and "C16" elsewhere in this file are inert for the same reason.

### Group E — humanized LLM (text told to sound casual / add typos)

*The humanized case gets three criteria (C17, C18, C19) rather than one, because it is the hard case and no single criterion carries it.*

**C17 · Typo distribution and typo class · →LLM when unnatural · EN TR · S**
Unnatural (→LLM): typos spread almost evenly (one every ~15-25 words, no bursts); each typo is a
different word (no repeated error); typo classes are letter transposition of common words ("teh",
"adn", "recieve") with no keyboard-adjacency logic; punctuation and capitalization around the typo
stay perfect; no autocorrect artefacts.
Natural (→HUMAN): bursts (three errors in one clause, then a clean paragraph); the *same* word
misspelled the same way twice; keyboard-adjacent slips (TR "gice" for "gece"); autocorrect
substitutions of real words ("ducking", "İstanbul'a" → "istanbula"); missing space between words;
doubled letters from key repeat.
Evidence = list the quoted typos with their word offsets, then state the gap pattern.
*Hard limit:* below ~80 words there are too few typos to judge distribution. Say so; do not infer.

**C18 · Easy-word errors beside flawless rare items · →LLM · EN TR · S**
The signature of instructed humanization: "definately" or "recieve" in the same message as a
correctly-spelled low-frequency term, or a correctly-inflected long agglutinative Turkish chain.
Evidence = the misspelled easy word and the flawless rare word, quoted together. This is the
strongest single humanized-LLM tell and it is still not proof.

**C19 · Fake-casual markers and register/content contradiction · →LLM · EN TR · M**
Casual markers appearing exactly once each, evenly spaced, in otherwise well-formed sentences:
"lol", "tbh", "ngl", "haha", TR "yani", "ya", "işte" used as decoration. Companion tells:
everything lowercase but every comma correct and every apostrophe present ("i'm" not "im" — humans
drop the apostrophe long before the capital); "..." used as a decorative pause between two
grammatical clauses; claimed emotion (anger, urgency, exhaustion) with calm, complete, subordinated
syntax; the assistant structure of C01-C05 still present under the costume ("ngl this is tricky,
but here are three options for you 🙂").

**C20 · Idiolect continuity and world-mess · →HUMAN · EN TR · M (S in batch/thread mode)**
Only available when more than one message from the sender is in scope: the same hotel name misspelled
the same way across turns, a stable greeting habit ("reis naber"), a stable digit convention, a
personal detail that costs the writer something (a wrong date they later fix, a complaint about the
previous answer), timestamps consistent with typing speed. In batch mode this is the most reliable
human evidence available and outranks any single-message lexical tell.

### Never counts as evidence (banned inferences)

*Copied verbatim from the judge design. This list is the judge's hardest constraint.*

- Absence of typos, alone. (C12/C15 perfection is capped at M and needs a partner.)
- Politeness, alone. Formality, alone. Length, alone. Topic, alone.
- Correct grammar in a second language. Non-native errors as *pro*-LLM evidence (they are →HUMAN).
- Use of a template the business itself provides (booking recap, price list).
- The text being *about* AI, or mentioning ChatGPT.
- Markdown or em dashes alone (C06 is W by design).
- MSA alone (C14's explicit FP trap).
- "It feels like AI." Feelings are not quotes. No quote, no criterion.

Two lines above are inert under R22 and are kept only because the list is copied, not paraphrased:
the C15 clause (Arabic perfection) and the MSA line. Nothing Arabic is judged at all.

---

## 2. FP TRAPS, RESTATED AS A CHECKLIST

Before writing any →LLM verdict, the judge answers all six out loud:

1. Is the sender plausibly a **support agent or a business** working from a snippet library? (C01 → W.)
2. Is the writer plausibly **non-native**? (C10 is mandatory; fluency is not evidence.)
3. Is the uniformity **structural** — a list, a form, an itinerary — rather than stylistic? (C04 n/a.)
4. Is the "perfect orthography" just a **phone keyboard**? (C12 capped at M, never alone.)
5. Is the text a **pasted template, a booking recap, or machine-written text the sender is
   forwarding**? Origin ≠ attribution. (Banned inference 4; see R17 below.)
6. Is the sample **under 80 words** — too short for C17's distribution argument, or under the
   20-word / 100-character floor entirely?

---

## 3. COMBINATION — THE DECISION TABLE (SPEC §E.1)

`LL` likely_llm · `EL` leaning_llm · `UN` uncertain · `EH` leaning_human · `LH` likely_human ·
`IT` insufficient_text · `⚠` print the CONFLICT block.

| CLI ↓ / Judge → | LL | EL | UN | EH | LH | IT |
|---|---|---|---|---|---|---|
| **LL** | LL | EL | EL | UN ⚠ | UN ⚠ | UN |
| **EL** | EL | EL | UN | UN ⚠ | UN ⚠ | UN |
| **UN** | EL | UN | UN | UN | EH | UN |
| **EH** | UN ⚠ | UN | UN | EH | EH | UN |
| **LH** | UN ⚠ | UN | EH | EH | LH | EH |
| **IT** | IT | IT | IT | IT | IT | IT |

### The six ⚠ cells — the only places `[CONFLICT]` is printed (HEAD-RULINGS R35(b))

`[CONFLICT]` appears in these six cells and nowhere else:

| CLI | judge | final |
|---|---|---|
| `LL` | `EH` | `uncertain` ⚠ |
| `LL` | `LH` | `uncertain` ⚠ |
| `EL` | `EH` | `uncertain` ⚠ |
| `EL` | `LH` | `uncertain` ⚠ |
| `EH` | `LL` | `uncertain` ⚠ |
| `LH` | `LL` | `uncertain` ⚠ |

**CLI `EH` × judge `EL` is `uncertain` WITHOUT the tag** — the two instruments are one step apart on
either side of neutral, which is ordinary noise, not a contradiction worth a block. A batch run
tagged that cell; it is not one of the six.

Asymmetries, all deliberate:

- `CLI=LL, judge=IT` → `UN` but `CLI=LH, judge=IT` → `EH`. When the judge abstains the system falls
  toward human, not toward accusation.
- `CLI=UN, judge=LL` → `EL`. Judge-only confidence never reaches `likely_*` — the judge is a
  language model reading its own priors with no calibration.
- The whole `IT` row is absolute. **No judge finding overrides the CLI's `insufficient_text`.** The
  judge's read is still printed, under "what little can be seen", explicitly labelled *not a verdict*.
- Every `⚠` cell prints the CLI's top 3 signals with values, the judge's top 3 quoted criteria, and
  one sentence naming the specific contradiction.

### The four invariants above the table

1. `insufficient_text` is absolute.
2. **No averaging.** The CLI score and the judge band are printed separately and never combined
   arithmetically. There is no "final score", only a final verdict.
3. Directional disagreement resolves to `uncertain` with both sides printed.
4. The judge may shift a cell **one step toward human** with a reason from a fixed list (non-native
   writer; sender is a support agent using a script; text is a pasted template or machine-written
   text the sender is forwarding; text is a structured list, not prose; under 40 words).
   **Never one step toward LLM.**

**Invariant 4's third reason, qualified (HEAD-RULINGS R35(d)).** "Text is a pasted template or
machine-written text the sender is forwarding" licenses the one-step shift **only when the whole
text is the paste, or all of it but a greeting line**. A message that merely *contains* a pasted
line — a human question wrapped around a forwarded booking summary — does **not** qualify: that is
the R28 hybrid, which the CLI already handles with `hybrid_suspect`, and shifting for it a second
time double-counts the same fact. Single and batch runs had read this differently on the same bytes.
The other four reasons are unchanged.

A fifth, structural, follows from the table itself: `likely_*` requires both instruments confident.
One confident instrument plus one neutral one caps at `leaning_*` — the table never promotes.

### The `IT` row in practice (HEAD-RULINGS R31(b))

The end-to-end run found batch mode printing `JUDGE: leaning_human — moderate` on rows the CLI had
gated. That is the `IT` row being read as "the final is IT, so anything may be said above it". It is
not. **A CLI `insufficient_text` row receives no judge verdict and no confidence band, in single or
batch mode.** What §3 permits is one line, labelled `what little can be seen (not a verdict)`, and
nothing that could be read as a verdict: no verdict word, no band word, no evidence block, no
`JUDGE:` line. The gate reason belongs on the CLI line, because `below_char_floor` (the text is too
short) and `too_few_active_features` (the text is long enough and the instrument still has nothing)
are different findings and the caller acts on them differently.

### Percentages (HEAD-RULINGS R31(c))

Never print a percentage as this text's confidence, band or probability — not on the verdict line,
not in the evidence bullets, not as "about 70% likely". Bands are the words in §5. A **published**
FPR, TPR or base rate may appear in **CAVEATS only**, and only with its source named (for example
"seven commercial detectors flagged 61.22% of 91 TOEFL essays by non-native writers — Liang et al.,
quoted in README §The two caveats"). A number about this text is a fabrication; a number about the
literature is a citation.

---

## 4. JUDGE VERDICT DERIVATION (SPEC §E.2) — before it sees the CLI

- `likely_llm`, style route: ≥2 **S**-class criteria quoted, from ≥2 different rubric groups,
  **and** no →HUMAN criterion evidenced, **and** ≥60 words.
- `likely_llm`, **artifact route** (HEAD-RULINGS R31(e)): **one** artifact-class criterion, quoted
  verbatim from the text, at ≥20 words. The artifact classes are exactly the CLI's Tier-0 rules — a
  leaked assistant frame, markdown arriving in a non-markdown channel, a configured known-machine
  marker, a near-duplicate — and the quote must be the artifact itself, not a paraphrase of it. This
  mirrors the CLI's rule-gated path: without it a fingerprinted text and a style-only text land on
  the same final, which inverts the design. A near-duplicate alone still stops at `leaning_llm`
  (R3), and a known-machine marker inside a human-written message is a hybrid, not a machine text
  (R28 below).
- `leaning_llm`: 1 S + 1 M, or 3 M, quoted; or the humanized set (C17/C18/C19) with ≥1 S.
- `uncertain`: anything else that is not an abstention — including "tells present but a stated FP
  trap applies", which is the correct answer far more often than the judge will want it to be.
- `leaning_human`: ≥2 →HUMAN criteria quoted (C08, C10, C20) and ≤1 M-class →LLM.
- `likely_human`: ≥3 →HUMAN criteria including ≥1 expensive to fake (C08 repair across messages,
  C20 idiolect continuity), no S-class →LLM. **Cross-message scope only.**
- `insufficient_text`: <20 words **or** <100 characters, or a bare list of names/numbers with no
  prose, or the language is not EN or TR, or the text is mostly quoted material from another author.

(SPEC's `leaning_human` list named C15-counter and C16; both are withdrawn under R22, so the
Arabic-only routes to `leaning_human` no longer exist. The English and Turkish routes are unchanged.)

---

## 5. REPORT FORMAT (SPEC §E.3)

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

**CAVEATS labels are exact and machine-parseable (HEAD-RULINGS R31(g), R35(a)).** They are, on their
own line each, with the bullet character `•` — never `-`, never bold, never re-worded:

```
  • length:
  • language:
  • writer:
  • provenance:
  • calibration:        (optional fifth; use it when the weights' state matters to the reader)
```

Two of six end-to-end runs wrote `- length:` or `- **length:**`, which costs a parser a third of the
reports. The label is the contract; the text after the colon is free.

Bands are **words, never percentages**: strong / moderate / none / n/a. Numeric ranges are permitted
only after a labelled validation set exists, and then only labelled `uncalibrated heuristic range`.

| verdict | band word | what it means in English |
|---|---|---|
| likely_llm | **strong** | Multiple independent strong tells, no counter-evidence. Still not proof. |
| leaning_llm | **moderate** | Real tells, but a stated trap or a missing corroborator. Would not defend it. |
| uncertain | **none** | The instruments disagree, or the evidence is too thin. This is a real answer. |
| leaning_human | **moderate** | Human tells present, LLM tells absent or trapped. |
| likely_human | **strong** | Expensive-to-fake human evidence (repair, idiolect continuity). |
| insufficient_text | **n/a** | Below the floor. Nothing was judged. |

---

## 6. SIGNAL-NAME MAP (SPEC §E.4, verbatim)

The judge cites CLI signals by their **shipped** names only. This table is authoritative; several
names the judge design expected correspond to features that were deleted or inverted.

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

**R22 addendum (not part of the verbatim table):** the four `ar_*` rows are not built this round —
no Arabic feature exists in the shipped tool, so no Arabic signal name can appear in `signals[]`.
`C16` in the no-counterpart list is withdrawn with the rest of Group D. Every other row stands.

---

## 7. WHAT THE HEAD RULINGS CHANGE ABOUT THE RULES THE JUDGE READS

The judge reads `rules[]` as high-precision artifact matches. Four rulings change what a rule
*means*, and the judge must report them with the meaning below, not with the older SPEC meaning.

- **R1 — `assistant_frame_leak` is narrowed to true self-identification and drafting frames.**
  Only "as an AI", "I'm/I am an AI", "language model", "my training data / knowledge cutoff",
  "I don't have access to real-time", "I cannot browse", "here's a draft/revised/rewritten/polished",
  "as of my last/latest update"; TR "bir yapay zeka (modeli|asistanı)", "yapay zeka dil modeli",
  "bilgi kesim tarih". Everything softer — "Sure,", "I hope this helps", "let me know if you need
  anything", "size nasıl yardımcı olabilirim" — moved to the weighted lexicon, because a human
  receptionist writes all of it. The quotation / "talking about ChatGPT" suppression still applies.
  Consequence for the judge: those softer phrases are **C01 evidence at most**, never a rule hit,
  and never on their own a road to `likely_llm`.
- **R2 — `markdown_in_chat` no longer fires on plain dash bullets.** It fires only on a markdown
  header, double-asterisk bold, a fenced code block, a pipe table, or ≥2 bullet lines with at least
  one bold lead-in (`- **X:**`). A human writing "- 2 yetişkin\n- 1 çocuk" on WhatsApp is a human.
- **R3 — `near_duplicate` proves "not independently authored", not "LLM".** Alone it caps the final
  verdict at `leaning_llm` with `warnings:['templated_or_copied']`, and the report must say
  "duplicate of <id> at Jaccard J — template or copy; not proof of LLM authorship". `likely_llm`
  through this rule requires a **second** Tier-0 rule.
- **R17 — the machine marker is generic and user-configured.** The rule is `known_machine_marker`
  and it reads `markers.json` (default `[]`, so it never fires unless the operator configured it);
  `--markers <path>` overrides. When it matches, the report carries `warnings:['pasted_machine_text']`
  and must state that the string is machine-written and **the sender may be a person forwarding
  machine-written text**. Never attribute the marker to the sender.

- **R28 — a `known_machine_marker` inside a human-written message is a HYBRID, not a machine text.**
  A marker match proves that a machine-written *segment* is present. It does not prove the message
  is machine-written. When the marker is the only Tier-0 rule and the human channel is above 0.6 (or
  at least two human-direction signals from two groups fire), the CLI returns `uncertain` with
  `warnings: ['pasted_machine_text', 'hybrid_suspect']` and the note "machine-written segment inside
  a human-written message; the sender may be forwarding it". The judge reports it that way and never
  as `likely_llm`: the artifact route above is not open on a hybrid. When there is no human turn
  around the marker — a bare confirmation email, a pasted price list — SPEC §B.1 stands and
  `likely_llm` with `pasted_machine_text` is correct. This is G6 in a different costume.

Two SPEC constraints the judge may never relax, restated because they are the point of the whole
design: `likely_llm` requires a Tier-0 rule (style alone stops at `leaning_llm`), and `likely_human`
requires aggregate mode over ≥5 messages from one sender (a single message stops at `leaning_human`).

---

## 8. CLI WARNINGS THE JUDGE MUST HONOUR

`warnings[]` and `notes[]` are not decoration. Each of these changes what the judge is allowed to
say, and the report must show that it did.

| warning / note | what the judge must do |
|---|---|
| `register_only_evidence` | The CLI's LLM lean rests only on register proxies — correct punctuation, capitalised sentences, a greeting-and-signoff frame, a politeness formula, formal copulas, an out-of-channel register (R24). Treat the CLI's lean as **uncertain-grade** evidence and **never cite those proxy features toward LLM** in your own bullets. They are what a careful, formal or non-native human produces for free. |
| `hybrid_suspect` on a marker | Provenance caveat, verbatim in substance: "machine-written segment inside a human message; the sender may be forwarding it." Never `likely_llm`, never an attribution to the sender. |
| `homoglyph_suspect` | The text contains mixed-script words, fullwidth forms or mathematical alphanumerics (R30). Note possible adversarial editing, and **never lean human on it** — a defeated rule is not evidence of a human. Detection power against a real adversary is zero; the warning is the whole defence. |
| `possible_quotation_or_discussion` | The leak phrase is quoted or discussed, not the speaker's own frame (R27). It is not a rule hit and must not be cited as one. A human describing what a chatbot said to them is a human. |
| `pasted_machine_text` | Origin ≠ attribution. The string is machine-written; the sender may be a person forwarding it. |
| `templated_or_copied` | `near_duplicate` fired: the text was not independently authored. Template, copy or spam — not proof of LLM authorship (R3). |
| `domain_suppressed` / `marketing_register` | The caller declared a support desk or marketing copy; the register lexicon was zeroed or discounted. Do not re-import the suppressed phrasing as your own evidence. |
| `mixed_language_reduced_features` | Only script-agnostic features ran. Say so in the language caveat and lower your own confidence accordingly. |
| `uncalibrated_weights` / `weights_expired` / `expiry_not_checked` | The score is a ranking prior with no validated threshold, an expired one, or one whose expiry was never checked. Nothing here supports a numeric claim. |
| `segmentation_suspect` / `score_table_disagreement` / `contradictory_evidence` | The instrument is arguing with itself. Prefer `uncertain` and print both sides; never resolve it silently in the LLM direction. |
