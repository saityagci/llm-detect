# D1 — Deterministic stylometric core for LLM-text detection (EN / TR / AR)

Status: DESIGN. No code shipped. Build round is separate.
Target runtime: Node 24, ESM, **zero runtime dependencies**, pure functions, no network, no clock, no RNG.
Author note: every threshold in this document that is not derived from a Unicode fact is a **prior guess** and is marked as such. §6.6 defines the procedure that must replace them.

---

## 0. Scope, threat model, and what this cannot do

### 0.1 What it is

A deterministic function

```
detect(text, opts) -> Report
```

that extracts ~70 stylometric features, maps them through a **calibrated** logistic combiner, and returns either a graded verdict with per-feature evidence, or `abstain`. It is a *triage* instrument: it ranks a queue of documents for human review. It is not evidence.

### 0.2 Threat model (state it before the features, because it determines every weight)

| Adversary | Description | Detector's realistic power |
|---|---|---|
| **T0 — Unaware** | User pastes default ChatGPT/Claude/Gemini output verbatim into a review form or an email. No instruction to hide. | **This is the only tier we can catch reliably.** All the punctuation/structure/register features assume T0. |
| **T1 — Lightly styled** | Prompt says "casual", "short", "no em dashes", "like a WhatsApp user". | Structure and punctuation features collapse. Register lexicon partly survives. Recall drops to maybe 0.3–0.5 on prose, ~0 on chat. |
| **T2 — Post-edited hybrid** | LLM draft, human rewrites 20–40%. | **Undetectable, and also arguably not "LLM text".** The design must ABSTAIN here rather than guess. Any detector that confidently classifies hybrids is lying. |
| **T3 — Adversarial** | Humanizer tools, back-translation, synonym swap, deliberate typo injection, few-shot mimicry of the victim's own prior messages. | **Zero power.** Do not claim otherwise. A single sed pass replacing `—` with `, ` and lowercasing the first letter of each message defeats a third of this catalogue. |

The build must carry this table in its README. A stylometric detector is a **lock on an unlocked door**: it works because nobody is trying.

### 0.3 Hard limits — the honest list

1. **Short chat is not classifiable.** At a median of 25 characters, the Shannon information available about *authorship process* is on the order of a few bits. `"tamam abi"` is decidable (human). `"Okay, thank you."` is not decidable by anything, ever. The design responds by (a) an unconditional abstain gate, and (b) a **two-channel** output where the absence of human markers is never treated as evidence of LLM. See §6.3.
2. **The classifier is biased against non-native writers and against formal registers.** The features that separate LLM from human — low burstiness, no typos, hedging, formulaic connectors, correct orthography, complete terminal punctuation — are *exactly* the features of (i) an L2 English writer who learned from textbooks, (ii) a lawyer, (iii) a customer-service agent working from a snippet library, (iv) a translated text. This is not a tuning problem, it is the feature space. Mitigation is a fairness-constrained threshold (§6.6.4), not a cleverer feature.
3. **The lexicon is GPT-family-shaped and date-stamped.** "delve", "tapestry", "testament to" describe 2023–2025 RLHF'd assistant prose. Frontier outputs have been drifting away from these since the tells became public; several vendors now actively suppress em dashes. Weights therefore have an **expiry**: §6.6.6.
4. **Base rates destroy precision.** At 2% false-positive rate, 60% recall and a 1% true prevalence, a positive is wrong ~77% of the time. Arithmetic in §6.7. The product must never surface a raw positive as an accusation.
5. **Arabic and Turkish support is weaker than English support**, and honestly so: the LLM-tell lexicons for TR/AR are smaller, the reference distributions do not exist yet, and dialectal Arabic has no orthographic standard to measure deviation *from*. Expect EN AUC materially above TR, and TR above AR, in the first calibrated release.
6. **No dictionary ⇒ no true typo detection.** Zero-dependency means no wordlist of meaningful size. Everything in the "typo" family is really *orthographic-shortcut detection* (elongation, dropped apostrophes, dropped diacritics), which is a proxy and misses ordinary misspellings entirely.

### 0.4 Cost asymmetry (drives every threshold)

Calling a human "AI" is a false accusation with reputational cost. Missing an LLM review costs one bad datapoint. The loss matrix is roughly **20:1**. Therefore: thresholds are tuned for low FPR at whatever recall results, abstention is the default, and the top-level verdict vocabulary contains no word as strong as "AI-generated".

---

## 1. Text pipeline and normalization contract

### 1.1 The normalization trap (verified on Node 24.5.0)

Do **not** run `NFKC` before feature extraction. Verified behaviours:

| Input | `.normalize("NFKC")` | Signal destroyed |
|---|---|---|
| `…` (U+2026) | `...` | ellipsis-style feature (F21) |
| NBSP U+00A0, NNBSP U+202F | ` ` | provenance/copy-paste feature (F26) |
| Arabic presentation form `ﻳ` U+FEF3 | `ي` | paste-from-PDF provenance |
| `ﻻ` U+FEFB | `ل` + `ا` | same |
| tatweel U+0640 | **kept** | (fine) |
| Arabic-Indic `٠` | **kept** (not folded to ASCII) | (fine) |

**Contract:**

```
raw        = text as received (features F19–F27, F40s read this)
nfc        = raw.normalize("NFC")                 // for tokenization + all lexicon matching
foldedLex  = caseFold(stripTashkeel(unifyAlef(nfc)))   // lexicon matching ONLY, per language
```

`nfc` never has NBSP collapsed, quotes straightened, or ellipses expanded. Two views, always both in scope.

### 1.2 Case folding — the Turkish trap (verified)

```js
"İ".toLowerCase()                 // "i" + U+0307  (two code points!)  ← breaks naive lexicon match
"I".toLocaleLowerCase("tr")       // "ı"
"i".toLocaleUpperCase("tr")       // "İ"
"ı".toUpperCase()                 // "I"
```

Rule: `caseFold(s, lang)` =
- if `lang === 'tr'`: `s.toLocaleLowerCase('tr')`
- else: `s.toLowerCase()`
- then always: `.replace(/̇/g, '')` when the preceding base char is `i` (removes the stray combining dot from a locale-less `İ` fold).

Every Turkish lexicon entry is stored **already folded with the `tr` locale**, and comparison is done on the folded forms. Storing `"İstanbul"` and lowercasing it with the default locale silently never matches.

### 1.3 Tokenization

```js
const WORD_RE = /(?!ـ)[\p{L}\p{M}][\p{L}\p{M}ـ'’-]*/gu;  // tatweel/apostrophe/hyphen INTERNAL only
const NUM_RE  = /[\p{Nd}][\p{Nd}.,:٫٬]*/gu;                     // includes ٠-٩ and ۰-۹ (both are \p{Nd})
```

Facts verified: `\p{Nd}` matches U+0660–0669 **and** U+06F0–06F9. `\p{L}` matches tatweel U+0640 (so the negative lookahead in `WORD_RE` is load-bearing: without it a run of tatweel is counted as a word token). `\p{M}` matches tashkeel U+064B–0652.

Token count `N` used by every gate = count of `WORD_RE` matches on `nfc`.

**Arabic token-count caveat.** Arabic orthography attaches clitics (`و`, `ب`, `ال`, `ـه`, `ـها`) to the host word, so an Arabic text of `N` whitespace tokens carries roughly **1.25–1.4×** the morpheme content of an English text of `N` tokens. Every minimum-token gate in this document is therefore multiplied by **1.2 for AR** (round up). Turkish is agglutinative in the same direction but more extremely (`gidebileceğimizi` = one token, five morphemes); use **1.2 for TR** as well. These multipliers are prior guesses; §6.6.2 makes them fitted quantities.

### 1.4 Character classes used throughout

```js
const AR_LETTER   = /[\p{Script=Arabic}&&\p{L}]/v;  // v-flag SET INTERSECTION: letters only.
const AR_TASHKEEL = /[ً-ْٰٓ-ٕ]/u;      // fathatan..sukun + superscript alef
const AR_TATWEEL  = /ـ/u;
const AR_INDIC    = /[٠-٩]/u;                         // Arabic-Indic digits
const AR_EXT_IND  = /[۰-۹]/u;                         // Extended (Persian/Urdu) digits
const AR_PUNCT    = /[،؛؟٪-٭۔]/u; // ، ؛ ؟ ٪ ٫ ٬ ٭ ۔
const TR_SPECIFIC = /[çğıöşüÇĞİÖŞÜ]/u;
const ZW          = /[​‌‍‎‏⁠﻿]/u;
const ODD_SPACE   = /[  -   　]/u;
const EMOJI       = /\p{Extended_Pictographic}/u;               // + /\p{RGI_Emoji}/v available on Node 24
```

**Do not write `AR_LETTER` as a raw `[\u0600-\u06FF]` range** — that block contains the Arabic comma, question mark, digits and tashkeel, so the "Arabic letter share" it computes is wrong. Verified on Node 24: `/[\p{Script=Arabic}&&\p{L}]/v` matches `\u0628` and the presentation forms, and correctly rejects `\u060C`, `\u061F`, `\u0640`, `\u0660`, `\u06F0`, `\u064E`. (I made exactly this mistake while drafting this document; it is the kind that silently biases every AR ratio by a few percent.)

Two traps verified on Node 24: **Arabic comma `،` U+060C is `Script=Common`, not `Script=Arabic`**, and **tatweel U+0640 is `Script=Common` too**. So a script-ratio computed with `\p{Script=Arabic}` silently ignores Arabic punctuation and tatweel. Conversely Arabic-Indic digits **are** `Script=Arabic`, which inflates the Arabic share of a text that is mostly numbers. Script ratios must therefore be computed over **letters only** (`\p{L}` minus U+0640), never over all characters.

### 1.5 Determinism rule

`Intl.Segmenter` exists in Node 24 and would give decent sentence segmentation — **do not use it**. Its behaviour is a function of the ICU version compiled into the host binary, so the same text can segment differently on two machines. That violates "deterministic". Hand-rolled segmenter in §3. (`Intl.Segmenter` may be used in the *offline calibration harness* as a cross-check oracle, never in the shipped path.)

---

## 2. Language identification

Output: `{ primary: 'en'|'tr'|'ar'|'mixed'|'unknown', confidence: 0..1, mixed: bool, shares: {latin, arabic, other}, notes: [] }`

### 2.1 Algorithm

```
function identify(nfc):
  letters = [...nfc].filter(c => /\p{L}/u.test(c) && c !== 'ـ')
  if letters.length < 8: return {primary:'unknown', confidence:0, note:'too few letters'}

  arShare  = fraction of letters matching AR_LETTER
  laShare  = fraction matching /\p{Script=Latin}/u
  otShare  = 1 - arShare - laShare

  // Persian/Urdu guard — out of scope, must not be scored as Arabic
  if arShare > 0.3 and count([پچژگکی]) / arabicLetters > 0.02:
      return {primary:'unknown', confidence:0.6, note:'perso-arabic script, out of scope'}

  if arShare >= 0.60 and laShare < 0.20: base = 'ar'
  else if laShare >= 0.60 and arShare < 0.20: base = latinSubId(nfc)   // 'en' | 'tr'
  else if arShare >= 0.20 and laShare >= 0.20: base = 'mixed'
  else base = 'unknown'
```

**`latinSubId`** — Turkish vs English, three converging signals; take a weighted vote, do not chain:

1. **Turkish-specific letters.** `TR_SPECIFIC` density over Latin letters. `>0.015` ⇒ +2 TR. (Turkish running text is ~4–8% of these letters; English is 0 except in loanwords/names.)
2. **Turkish stopwords** (works even fully de-diacriticized — see list below): hits per token. `>0.06` ⇒ +2 TR.
3. **English stopwords**: hits per token. `>0.08` ⇒ +2 EN.
4. **Turkish suffix shapes** (a cheap morphology proxy): tokens ending in `lar|ler|dır|dir|dur|dür|dan|den|tan|ten|ında|inde|unda|ünde|mak|mek|ıyor|iyor|uyor|üyor|acak|ecek|miş|mış|muş|müş`, ≥8% of tokens ⇒ +1 TR.

TR stopwords (ASCII-safe: both diacritic and de-diacriticized forms are stored; the de-diacriticized form is what makes this work on `"cocuk yasinda gidecegiz"`):

```
ve, bir, bu, için/icin, ile, ama, çok/cok, daha, gibi, kadar, sonra, önce/once,
de, da, ki, mi, mı, mu, mü, ne, var, yok, olarak, olan, ben, sen, biz, siz,
şey/sey, değil/degil, göre/gore, her, hem, işte/iste, şimdi/simdi, zaten,
tamam, evet, hayır/hayir, iyi, güzel/guzel, büyük/buyuk, küçük/kucuk,
çocuk/cocuk, yaşında/yasinda, geçen/gecen, teşekkür/tesekkur, günaydın/gunaydin
```

EN stopwords: `the, and, is, are, was, were, to, of, in, for, with, that, this, it, on, at, as, but, not, have, has, had, be, been, will, would, can, could, from, they, we, you, your, our, my, me, i, a, an, or, if, so, all, about, just, very, more, most`.

### 2.2 `mixed` outcome and what it means for scoring

`mixed: true` when either (a) both scripts ≥20% of letters, or (b) the two Latin sub-ids are within 1 vote of each other, or (c) **Arabizi is detected** (§5.3: Latin script + AR-chat markers + digit-letters `2 3 5 6 7 8 9` inside Latin word tokens).

Consequences, non-negotiable:
- `mixed` ⇒ **all language-specific features are disabled**; only the script-agnostic set runs (F01–F04 burstiness/structure, F19–F27 punctuation/whitespace, F30–F35 structure, F50s emoji).
- **Arabizi detection is itself a strong HUMAN marker** (weight in §5.3) — no consumer LLM emits Arabizi unless explicitly asked.
- Code-switching (TR text with English hotel names; AR text with English booking terms) is *normal human behaviour* in this domain. It must not push the score in either direction by itself. Log it as a `note`, never as evidence.

---

## 3. Sentence segmentation

Sentence boundaries feed F01/F02/F03 (burstiness family). A bad segmenter produces fake variance or fake uniformity, so this is load-bearing.

### 3.1 Terminator inventory

```
HARD  . ! ? ؟(U+061F) ۔(U+06D4) ‼ ⁉ ！ ？ 。
SOFT  ؛(U+061B) ;            → boundary only in prose shape, never in chat
NEVER ،(U+060C) , ٫ ٬ :      → Arabic comma is a COMMA. Never a terminator.
```

### 3.2 Rules, in order

```
1. Split the raw text into LINES on /\r?\n/. Keep empty lines: 2+ consecutive newlines = paragraph break.
2. In CHAT shape: every line is a hard sentence boundary. Chat users press send/enter instead of
   typing a period; treating a 4-line WhatsApp message as one sentence fabricates a 40-token
   sentence and poisons burstiness.
   In PROSE shape: a single newline inside a paragraph is a SOFT boundary (join if the next line
   starts lowercase or with a conjunction; split otherwise). A blank line is hard.
3. Within a line, scan for HARD terminators. A terminator ends a sentence unless:
   a. it is a '.' inside a number:            /\d\.\d/            (3.5, 14.00)
   b. it is a '.' inside an abbreviation from the ABBREV list (below), case-folded
   c. it is a '.' inside a URL/email/host token (token contains '://' or '@' or /\.(com|net|org|tr|sa|ae)\b/)
   d. it is a '.' inside an initial:          /\b\p{Lu}\.$/u      (J. Smith)
   e. it is part of a RUN of terminators: collapse /[.!?؟]{2,}/ and /…/ into ONE boundary,
      but record the run's length and composition for F21/F22 before collapsing.
4. Ellipsis: '…' (U+2026), '...' and '..'/'....'/'.....' are one boundary each.
   Record: style = 'char'(U+2026) | 'exact3' | 'other'.  (feature F21)
5. Emoji: a run of \p{Extended_Pictographic} (plus ZWJ/VS16/skin-tone modifiers) that is
   (i) preceded by a non-terminator character and (ii) followed by end-of-line OR by an
   uppercase letter / Arabic letter starting a new clause ⇒ hard boundary.
   Emoji embedded mid-clause (surrounded by lowercase on both sides) is NOT a boundary.
6. Quotes/brackets: a terminator immediately inside a closing quote or bracket
   (`."` `.”` `.)` `!»`) closes the sentence at the outer delimiter.
7. Trailing fragment with no terminator = a sentence (this is the norm in chat).
8. Discard sentences with 0 word tokens (bare emoji lines still count for F50s, not for F01).
```

ABBREV (do not split after): EN `mr, mrs, ms, dr, prof, st, no, vs, etc, e.g, i.e, inc, ltd, jan..dec, mon..sun, approx, dept, fig, vol, p, pp, u.s, u.k`. TR `dr, doç, prof, sn, av, no, vb, vs, örn, bkz, yy, tl, cad, sok, mah, apt, bl`. AR: Arabic does not conventionally abbreviate with `.`; the main risk is Latin-script insertions inside Arabic text — apply the EN list there too.

### 3.3 Degenerate outcomes (must be handled, not crashed on)

| Situation | Result |
|---|---|
| Zero HARD terminators, one line, 30 tokens (typical chat) | 1 sentence. Burstiness **undefined** ⇒ F01–F03 emit `null`, not 0. |
| Text is a bullet list, no terminators | Each bullet is one sentence, and F30 (bullets) fires. Burstiness across bullets is *structurally* uniform — **F01 must be suppressed when >60% of sentences are list items**, otherwise the list itself is misread as LLM uniformity. This is a real false-positive source: a human's packing list looks maximally "LLM". |
| Sentence longer than 120 tokens | Almost always a segmentation failure (missing punctuation). Cap and flag `warnings:['segmentation_suspect']`; suppress F01–F03. |

---

## 4. Feature catalogue

Record format for each feature:

```
id            stable snake_case key, appears in evidence objects
langs         which of EN/TR/AR/any
shape         chat | prose | both   (and how it degrades)
minTokens     below this the feature emits null (EN baseline; ×1.2 for TR/AR)
direction     LLM↑ (higher value ⇒ more LLM-like) or HUMAN↑
confidence    HIGH / MED / LOW  — HIGH = I would defend it before calibration.
              LOW = plausible hypothesis, MUST be measured before it gets a nonzero weight.
```

Everything marked LOW ships with weight **0** until the calibration in §6.6 says otherwise. That is the discipline that keeps the guesswork out of production.

---

### Group A — Distributional / rhythm

#### F01 `burstiness_cv`
- **langs** any · **shape** prose (chat: only in session-aggregate mode) · **minTokens** 120, and ≥8 sentences · **direction** HUMAN↑ · **confidence** HIGH (EN prose), MED (TR/AR)

```
lens = sentences.map(s => s.tokenCount).filter(n => n >= 1)
if (lens.length < 8) return null
mean = avg(lens); sd = sampleStdDev(lens)
value = sd / mean                        // coefficient of variation
```
- **Why**: decoding under a likelihood objective regresses sentence length toward a register-typical mean; humans interleave a 3-word sentence with a 34-word one. Human prose CV typically ~0.55–0.9; default assistant prose ~0.35–0.55. *These bands are priors, not measurements.*
- **Confounders**: list-heavy text (suppress, §3.3); translated human text (flat); a human writing in a constrained genre (recipe, spec); very short prose (a 5-sentence review has huge sampling error in `sd` — hence the 8-sentence floor); L2 writers who compose in short, uniform clauses.
- **Variant to fit alongside**: `burstiness_iqr = (p75-p25)/median`, more robust to one runaway sentence.

#### F02 `sentence_len_mode_mass`
- **langs** any · **shape** prose · **minTokens** 120, ≥8 sentences · **direction** LLM↑ · **confidence** MED
```
value = fraction of sentences whose token count is in [12, 22]
```
- **Why**: not just low variance — assistant prose piles up in a specific 12–22 token band. Complements F01 by catching text that is uniformly *long* or uniformly *short* (which F01 also flags) versus uniformly *median* (only F02).
- **Confounders**: news-style human writing sits in the same band.

#### F03 `paragraph_uniformity`
- **langs** any · **shape** prose · **minTokens** 250, ≥4 paragraphs · **direction** LLM↑ · **confidence** MED
```
plens = paragraphs.map(p => p.tokenCount)
value = 1 - clamp(sampleStdDev(plens) / mean(plens), 0, 1)   // 1 = perfectly uniform
```
- **Why**: default long-form output emits 3–5 paragraphs of near-identical mass, often 3 sentences each. Humans write a two-word paragraph then a 200-word one.
- **Confounders**: templates, CMS-constrained fields, a human writing to a word budget per section.

#### F04 `content_word_repetition`
- **langs** any (TR/AR need stemming caveat) · **shape** prose · **minTokens** 150 · **direction** HUMAN↑ · **confidence** MED
```
content = tokens.filter(t => !STOPWORDS[lang].has(t) && t.length >= 4)
value = 1 - (uniqueTypes(content) / content.length)          // repeat rate
```
- **Why**: assistants avoid repeating a content word inside a paragraph (they reach for a synonym); humans repeat "hotel … hotel … hotel". This is the *right* way to use lexical statistics, and it is the opposite direction from the naive "LLM has poor vocabulary" folk claim.
- **Turkish/Arabic caveat**: agglutination and clitics mean `otel`, `oteli`, `otelde` are three types. Without a stemmer the metric is diluted. Mitigation: compare on a **prefix key** — first `min(6, len-2)` characters for TR, and for AR strip leading `و ف ب ك ل ال` and trailing `ها هم كم نا ه ة ي ين ون ات`. Crude, deterministic, documented as crude.

#### F05 `mattr_50`
- **langs** any · **shape** prose · **minTokens** 120 · **direction** ambiguous · **confidence** LOW → **ship at weight 0**
```
// Moving-Average Type-Token Ratio, window w=50, step 1. Length-invariant, unlike raw TTR.
if (tokens.length < 50) return null
value = mean over all windows of (uniqueTypes(window)/50)
```
- **Why included at all**: it is the standard length-robust diversity metric and it belongs in the *evidence display*, but its direction genuinely flips by genre — assistant prose beats a casual human review on diversity and loses to a literary human. Anyone who assigns it a sign before measuring is guessing. Report the value, weight it only after §6.6 gives it a fitted coefficient per (lang, shape, register).

#### F06 `hapax_ratio`
- **langs** any · **shape** prose · **minTokens** 200 · **direction** HUMAN↑ · **confidence** LOW
```
value = countTypesOccurringOnce / uniqueTypes
```
- Same warning as F05. Ships at 0.

#### F07 `function_word_profile_distance`
- **langs** EN, TR (AR later) · **shape** prose · **minTokens** 200 · **direction** LLM↑ · **confidence** MED — **but requires shipped reference tables**
```
p = normalized frequency vector over the 60-word function-word list for `lang`
value = jensenShannonDistance(p, REF_HUMAN[lang][register])
```
- **Why**: the single most established authorship-attribution family. Its weakness here is that it needs a *reference*, which means it cannot ship until §6.6 produces `REF_HUMAN` tables. Include the slot in the architecture now so it is not bolted on later.

---

### Group B — Punctuation and typography

All Group-B features are computed **per 1000 characters of `raw`** unless stated. Rates, never raw counts, except where a binary "any occurrence" is specified.

#### F20 `em_dash_rate`
- **langs** EN (HIGH), TR (MED), AR (LOW) · **shape** both (binary in chat) · **minTokens** 40 for the rate; **0** for the chat binary · **direction** LLM↑ · **confidence** HIGH-EN

```
em = count(/—/g)                     // U+2014 only
en = count(/–/g)                     // U+2013
spacedHyphen = count(/ - /g)         // the human/mobile substitute
value_rate   = em / (chars/1000)
value_binary = em >= 1 && spacedHyphen === 0       // chat mode
ratio        = em / (em + spacedHyphen + 1)        // "does this author own an em dash key"
```
- **Why**: an em dash requires `⌥⇧-` on macOS, a long-press on iOS, or an autocorrect rule. Most people type `-` or ` - `. Assistant output emits `—` at a high rate. In a **WhatsApp message**, a bare `—` with no spaced hyphens anywhere is one of the few near-binary tells that survives at 25 characters.
- **Confounders, serious**: (1) professional writers, editors, and anyone with macOS text substitution on; (2) **Word/Docs autocorrect converts `word - word` into `word — word`**, so a pasted-from-Word human doc scores as LLM; (3) vendors have begun suppressing em dashes post-2025, which kills recall, not precision; (4) Turkish uses `–`/`—` for dialogue lines (`— Nasılsın?`) — in TR the *line-initial* em dash must be excluded from the count; (5) Arabic typography rarely uses either dash, so the AR rate is near-zero on both classes ⇒ **weight 0 for AR** until measured.

#### F21 `ellipsis_style`
- **langs** any · **shape** both · **minTokens** 0 (needs ≥1 ellipsis) · **direction** see below · **confidence** MED
```
char3   = count(/…/g)          // U+2026
exact3  = count of runs /(?<!\.)\.{3}(?!\.)/
other   = count of runs /\.{2}|\.{4,}/           // ".." "...." "......."
value = { char3, exact3, other }
llmish  = (char3 + exact3) > 0 && other === 0
humanish= other > 0
```
- **Why**: `…` as a single glyph comes from autocorrect or from a model; `..` and `.....` are hand-typed. Humans are *inconsistent* in run length; models emit exactly three dots or the glyph.
- **Confounders**: iOS/Android substitute `…` for `...` automatically — this is the single biggest confounder in mobile chat, and it means `char3` alone must carry **low** weight for chat while `other > 0` carries decent HUMAN weight. Asymmetric on purpose.

#### F22 `terminal_punctuation_ratio`
- **langs** any · **shape** **chat primarily** · **minTokens** 5 · **direction** LLM↑ · **confidence** HIGH (chat)
```
lines = non-empty lines with ≥1 word token
value = fraction of lines ending (after trailing whitespace/emoji strip) with [.!?؟۔]
```
- **Why**: the strongest single chat feature. People do not end WhatsApp lines with a period; the send button *is* the terminator. A 2-line message where both lines end in `.` is unusual for a human, ordinary for a pasted model reply. (Note the well-documented sociolinguistic effect that a terminal period in chat reads as *curt* — humans avoid it for that reason too.)
- **Confounders**: older users and business/formal chat do use periods; some keyboards auto-insert one on double-space; **a single-line message that happens to end with `?` is not evidence of anything** — hence the "fraction over ≥2 lines" framing and a minimum of 2 lines for full weight.

#### F23 `exclamation_profile`
- **langs** any · **shape** both · **minTokens** 5 · **direction** split · **confidence** MED
```
singles  = count of /(?<!!)!(?!!)/
multies  = count of runs /!{2,}/
value = { singlesPerSentence: singles/sentences, multies }
HUMAN↑ if multies > 0
LLM↑  if singlesPerSentence in [0.25, 0.75] AND multies === 0 AND sentences >= 4
```
- **Why**: `!!!` is human affect. Exactly one `!` per upbeat sentence with never a double is the assistant's enthusiasm register ("Great choice! I'd be happy to help!").

#### F24 `quote_and_apostrophe_consistency`
- **langs** EN, TR · **shape** prose · **minTokens** 60 · **direction** LLM↑ (consistency), HUMAN↑ (mixture) · **confidence** MED
```
curly = count(/[‘’“”]/g);  straight = count(/['"]/g)
value = curly>0 && straight===0 ? 1 : (curly>0 && straight>0 ? 0 : 0.5)
```
- **Why**: the *signal is consistency*, not curliness. A document that is 100% curly (`don’t`, `“nice”`) came from an autocorrecting editor or a model; a document that mixes `don't` and `don’t` is a human typing across two contexts.
- **Confounders**: iOS smart punctuation makes ordinary humans 100% curly; Word does too. This feature is therefore **weak alone and useful only in combination** — its real job is to *cancel* other provenance features (if the text is uniformly curly and also has NBSPs, that is "pasted from a rich editor", not "written by a model").

#### F25 `semicolon_and_colon_profile`
- **langs** EN (MED), TR (LOW), AR (LOW) · **shape** prose · **minTokens** 100 · **direction** LLM↑ · **confidence** MED-EN
```
semis = count(/;/g) / (words/100)
colonList = count of lines matching /:\s*$/ or /:\s*\n\s*[-*•\d]/     // colon introducing a list
value = { semis, colonList }
```
- **Why**: semicolons are rare in casual human writing and common in assistant prose. `colonList` (a colon that opens a bullet list) is a *strong* structural tell in a context where nobody writes lists (a hotel review, a WhatsApp message).
- **Confounders**: academic/legal humans; Arabic `؛` is rare in both classes; Turkish uses `;` rarely — LOW for both until measured.

#### F26 `invisible_and_odd_space_chars`
- **langs** any · **shape** both · **minTokens** 0 · **direction** LLM↑ (provenance) · **confidence** MED — but see the honest caveat
```
zw   = count(ZW) MINUS ZWJ occurrences that sit inside an emoji sequence
       (a ZWJ U+200D is legitimate between two \p{Extended_Pictographic}; exclude those)
       ALSO exclude ZWNJ/ZWJ adjacent to Arabic letters (legitimate Arabic/Persian shaping)
       ALSO exclude U+200E/200F (LRM/RLM) in any text containing Arabic — bidi marks are normal there
nbsp = count(/[  ]/g)
value = { zw, nbsp }
```
- **Why**: NBSP and narrow-NBSP are inserted by web UIs and rich-text copy paths; a plain keyboard does not produce them.
- **HONEST CAVEAT**: this is a **provenance** feature — "this text passed through a rich text surface" — not an LLM feature. Pasting from Word, Notion, or a webpage produces the same. It may only ever act as a *corroborator* (small weight, and only when at least one Group-D/Group-C feature already fires). On its own it must never move a verdict. In Arabic it is close to useless because bidi controls are everywhere.

#### F27 `space_hygiene`
- **langs** any · **shape** both · **minTokens** 20 · **direction** HUMAN↑ · **confidence** MED
```
doubleSpaceMid   = count(/\S {2,}\S/g)
spaceBeforePunct = count(/\s+[,.;:!?،؛؟]/g)
missingSpaceAfter= count(/[,.;:،؛](?=[\p{L}])/gu)  minus decimals/URLs/abbrevs
trailingSpaces   = lines ending in /\s+$/
value = sum of the above, normalized per 100 tokens
```
- **Why**: models emit typographically clean text. Every one of these is a human artifact (fat fingers, mobile keyboards, French-spacing habits, old two-space-after-period training).
- **Confounders**: `missingSpaceAfter` fires on legitimately unspaced Arabic/Turkish constructions and on URLs — the exclusion list matters; two-space-after-period is a *generational* human marker, not a universal one.

#### F28 `ascii_vs_native_punctuation` (AR)
- **langs** AR · **shape** both · **minTokens** 15 · **direction** LLM↑ · **confidence** MED
```
arabicPunct = count(AR_PUNCT)             // ، ؛ ؟ ۔
asciiPunct  = count(/[,;?]/g)
value = arabicPunct / (arabicPunct + asciiPunct + 1)
```
- **Why**: models produce orthographically correct Arabic punctuation (`،` `؟`). Human phone typists frequently leave the keyboard in a state that emits ASCII `?` and `,`, or omit punctuation entirely.
- **Confounders**: Arabic keyboards emit `،` and `؟` natively too — so a careful human on a proper Arabic keyboard looks like a model here. This is why the feature is MED and pairs with F22 (a human with a proper Arabic keyboard still won't terminate every chat line).

#### F29 `digit_system_choice` (AR)
- **langs** AR · **shape** both · **minTokens** 0 (needs ≥2 digits) · **direction** UNKNOWN · **confidence** LOW → **ship at weight 0**
```
indic = count(AR_INDIC); ext = count(AR_EXT_IND); ascii = count(/[0-9]/g)
value = { indicShare: indic/(indic+ascii+ext+1), extPresent: ext>0 }
```
- **Why it is LOW**: my prior is that assistant Arabic prefers ASCII digits, and that Arabic-Indic digits indicate a native keyboard — but I have not measured it, model behaviour differs by prompt language, and Gulf vs Levant keyboard defaults differ. **Do not guess a sign.** Two things *are* safe: (a) `extPresent` (U+06F0–06F9) means a Persian/Urdu keyboard layout, which is a human provenance fact and out of the AR scope — raise a `note`; (b) *mixing* both digit systems inside one short text is human.
- Note the existing production lesson in this repo: ASCII-only `\d` regexes silently rejected Arabic-Indic digits for months. Every numeric regex here uses `\p{Nd}` or an explicit union.

#### F30 `tashkeel_and_tatweel` (AR)
- **langs** AR · **shape** both · **minTokens** 20 · **direction** split · **confidence** MED
```
tashkeelRate = count(AR_TASHKEEL) / arabicLetters
tatweelRate  = count(AR_TATWEEL)  / arabicLetters
LLM↑  if 0.005 < tashkeelRate < 0.08 and it appears on FUNCTION words spread evenly
HUMAN↑ if tatweelRate > 0.002  (kashida stretching: "مبروووك", "الســـلام")
HUMAN↑ if tashkeelRate > 0.25  (a quotation from scripture/poetry — pasted, not generated)
```
- **Why**: everyday Arabic typing has *zero* tashkeel; adding partial vocalization is either a model being "helpful" or a copy from a vocalized source. Tatweel is a purely decorative/emphatic human act (and a WhatsApp-era stylistic one).
- **Confounders**: educational/children's content is vocalized by humans; a model asked to vocalize does so at ~100%, which lands in the "pasted scripture" band. Hence the *three-band* treatment rather than a monotone direction.

#### F31 `hamza_and_orthographic_shortcuts` (AR)
- **langs** AR · **shape** both · **minTokens** 25 · **direction** HUMAN↑ (shortcuts present) · **confidence** MED
Zero-dependency approach: a **closed list of high-frequency words with an expected orthography**, and count how often the *shortcut* variant appears. No dictionary needed.

| Expected (correct) | Shortcut (human) | Note |
|---|---|---|
| `أنا` | `انا` | bare alef for hamza-on-alef |
| `أنت` / `أنتِ` | `انت` | |
| `إلى` | `الى` / `إلي` / `الي` | also ya/alef-maqsura confusion |
| `على` | `علي` | alef maqsura → ya |
| `أو` | `او` | |
| `إن` / `أن` | `ان` | |
| `أيضًا` | `ايضا` | + tanween dropped |
| `شيء` | `شي` | |
| `الذي` | `اللي` | *dialectal*, also F41 |
| `هذه` | `هاي` / `هذي` | dialectal |
| `مساءً` | `مساء` | tanween dropped |
| ending `ة` | ending `ه` | ta-marbuta → ha (`مدرسه` for `مدرسة`) |

```
shortcutHits = Σ occurrences of shortcut forms
correctHits  = Σ occurrences of expected forms
value = shortcutHits / (shortcutHits + correctHits + 1)
taMarbutaShortcut = count of tokens matching /[مة...]/ ... implement as:
   tokens ending in 'ه' that ALSO appear elsewhere (or in the closed list) ending in 'ة'
```
- **Why**: a model writes fully correct Arabic orthography essentially always. Dropping hamza and confusing `ة/ه`, `ى/ي` is the single most reliable Arabic human marker after dialect words.
- **Confounders**: educated humans write correctly; **the reverse direction is the danger** — correct orthography is NOT evidence of a model, because it is also evidence of an educated human. Weight the "shortcut present ⇒ human" arm strongly and the "no shortcut ⇒ LLM" arm at **zero**. This asymmetry is the whole point of the two-channel design (§6.3).

#### F32 `turkish_diacritic_fidelity` (TR)
- **langs** TR · **shape** both · **minTokens** 15 · **direction** LLM↑ (fidelity) / HUMAN↑ (ASCII-fication) · **confidence** HIGH
Ratio-based detection is unreliable (you cannot know where a diacritic *should* have been without a lexicon). Use a **closed ASCII-fied-stopword probe** instead — this is the reliable construction, and it is what catches `"cocuk yasinda gidecegiz"`:

```
ASCIIFIED = { icin, cok, degil, gecen, yasinda, cocuk, gidecegiz, buyuk, kucuk, sey, oyle,
              boyle, tesekkurler, tesekkur, gunaydin, gorusuruz, iyi gunler, ogrenci, dogru,
              yarin, bugun, sabah, aksam, ucret, ucus, gelecegim, gidecegim, yapacagim,
              olacagim, kalacagiz, bakacagim, calisiyorum, guzel, kotu, sukur, insallah,
              nasilsin, naber, tamamdir, sagol, oncelikle, ozellikle, sonrasinda }
DIACRITIC = the same words correctly spelled (için, çok, değil, geçen, yaşında, çocuk, ...)

asciiHits = Σ ASCIIFIED matches   (case-folded with tr locale)
diacHits  = Σ DIACRITIC  matches
value = asciiHits / (asciiHits + diacHits + 1)     // 1.0 = fully ASCII-fied
HUMAN↑ strongly when value > 0.5 with asciiHits >= 2
```
Secondary probe, orthogonal and cheap:
```
trLetterDensity = count(TR_SPECIFIC) / latinLetters
// Turkish running prose ≈ 0.04–0.08. A Turkish text with density < 0.005 and ≥25 tokens
// is ASCII-fied ⇒ HUMAN↑.   (prior band; calibrate)
```
- **Why**: models never de-diacriticize Turkish. Humans do it constantly on keyboards without a TR layout, and on desktop.
- **Confounders, and they are real**: (1) **iOS/Android Turkish keyboards autocorrect diacritics back in**, so a large and growing share of human mobile Turkish is fully diacriticized — meaning "correct diacritics ⇒ LLM" is FALSE and must carry weight ~0; only the ASCII-fied ⇒ human arm gets weight. (2) A human on a desktop at work, ASCII-fying, vs. the same human on a phone, will score differently — the feature measures *device*, not authorship, so the note field must say so. (3) Some humans mix (`çok` and `cok` in one message) — mixture is itself a human marker; add `asciiHits>0 && diacHits>0 ⇒ HUMAN↑ (mixed orthography)`.

#### F33 `turkish_dotted_i_handling` (TR)
- **langs** TR · **shape** both · **minTokens** 10 · **direction** LLM↑ · **confidence** MED
```
// capital İ where a human ASCII typist would write I
correctCapDotted = count(/İ/g)
bareCapI_inTurkishWord = count of tokens matching /^I(?=[a-zçğıöşü])/  e.g. "Istanbul", "Izmir", "Iyi"
value = bareCapI_inTurkishWord / (bareCapI_inTurkishWord + correctCapDotted + 1)   // HUMAN↑
```
- **Why**: `İstanbul` vs `Istanbul` is the crispest single orthographic split in Turkish. Models always write `İstanbul`. Humans on ASCII layouts write `Istanbul`.
- **Implementation trap** (verified): `"İstanbul".toLowerCase()` is `"i"+U+0307+"stanbul"` — a lexicon lookup on the default-locale lowercase form will silently never match `istanbul`. Fold with `toLocaleLowerCase('tr')` and strip stray U+0307 (§1.2).
- **Confounders**: same autocorrect problem as F32; also proper nouns in a Latin-transliterated context.

#### F34 `turkish_apostrophe_on_proper_noun_suffix` (TR)
- **langs** TR · **shape** both · **minTokens** 12 · **direction** LLM↑ (present) / HUMAN↑ (absent) · **confidence** MED
Turkish orthography requires an apostrophe between a proper noun and its case suffix: `İstanbul'a`, `Ankara'da`, `Türkiye'nin`, `Asem'e`. Chat users routinely drop it: `istanbula`, `ankarada`.

```
SUFFIX = (?:'|’)?(?:n?[ıiuü]n|[ıiuü]?[nsy]?[ae]|d[ae]|t[ae]|d[ae]n|t[ae]n|l[ae]r|[ıiuü]|y[ıiuü]|nd[ae]|nd[ae]n|yl[ae]|l[ae])$
withApos    = count of tokens /^\p{Lu}\p{L}+['’](?:[a-zçğıöşü]{1,6})$/u
withoutApos = count of tokens that (a) start uppercase, (b) are ≥6 chars, (c) end in a case suffix,
              (d) contain no apostrophe, and (e) whose stem (token minus suffix) also appears
                  elsewhere in the text OR is in a small city/PROPER list (Istanbul, Ankara, Izmir,
                  Antalya, Turkiye, Trabzon, Bursa, Konya, ...) in either orthography.
value = withApos / (withApos + withoutApos + 1)
```
- **Why**: it is a *learned orthographic rule* that models apply perfectly and casual humans skip.
- **Confounders**: condition (e) is essential — without it, ordinary capitalized sentence-initial words ("Bugünlerde") are misread as suffixed proper nouns. False-positive prone; keep MED and require ≥2 hits before it contributes.

#### F35 `capitalization_habits`
- **langs** EN, TR · **shape** chat mainly · **minTokens** 8 · **direction** HUMAN↑ (deviation) · **confidence** HIGH (chat)
```
sentStartUpper = fraction of sentences whose first letter-token starts uppercase
allLower       = (letters that are lowercase)/(letters) > 0.98 && tokens >= 6
allCapsWords   = count of tokens /^\p{Lu}{3,}$/u   (excluding known acronyms EN: OK, ASAP, USA, PDF, ID)
loneLowerI     = count of /\bi\b/ in EN text (pronoun "i")
HUMAN↑ if allLower, or loneLowerI>0, or allCapsWords>0
LLM↑   if sentStartUpper === 1.0 AND sentences >= 3 AND shape==='chat'
```
- **Why**: all-lowercase chat is a strong human register marker; a model writing a chat reply capitalizes every sentence. `"i think its fine"` is essentially never model output.
- **Confounders**: keyboards auto-capitalize the first letter of a message (so `sentStartUpper === 1` on a *single*-sentence human message is meaningless — hence `sentences >= 3`); ALL-CAPS is also used by a model for emphasis in rare cases; some humans always capitalize properly.

#### F36 `letter_elongation` ("pleaseee")
- **langs** any · **shape** both · **minTokens** 3 · **direction** HUMAN↑ · **confidence** HIGH
```
// 3+ identical letters in a row, Unicode-aware, excluding legitimate doubles
runs = matches of /(\p{L})\1{2,}/gu
// Arabic: also count tatweel runs /ـ{2,}/ (F30) and repeated و/ا/ي in "مبرووووك"
// Turkish: "çoook", "yaaa", "tmmm" (m-run), "yokkk"
value = runs.length
```
- **Why**: elongation is affect. No consumer model produces it unprompted. Among the most reliable human markers at *any* length — it works on a 9-character message, which almost nothing else does.
- **Confounders**: brand names (`Zzzz`), onomatopoeia in fiction, and a model explicitly asked to be casual (T1). Also: absence proves nothing — most human messages have no elongation.

#### F37 `repeated_punctuation_and_emoticons`
- **langs** any · **shape** chat · **minTokens** 2 · **direction** HUMAN↑ · **confidence** HIGH
```
value = count(/[!?؟]{2,}/g) + count(/:\)|:\(|:D|:'\(|<3|xD|:-\)/g) + count(/\.{4,}/g)
```
- ASCII emoticons in particular are near-zero in model output and common in human chat (and in older/desktop users who don't reach for the emoji keyboard).

#### F38 `emoji_profile`
- **langs** any · **shape** both · **minTokens** 0 · **direction** split · **confidence** MED
```
emojis = grapheme clusters matching /\p{RGI_Emoji}/v   (Node 24 supports the v flag)
rate   = emojis.length / max(1, tokens/100)
positions = for each emoji: 'lineStart' | 'lineEnd' | 'midClause'
repeats   = count of runs of ≥2 IDENTICAL adjacent emoji  (😂😂😂)
skinTone  = any of \u{1F3FB}-\u{1F3FF}
bulletLed = count of lines matching /^\s*(\p{RGI_Emoji})\s+\p{Lu}/v
distinctRatio = uniqueEmoji / emojis.length

HUMAN↑ : repeats > 0 ; skinTone present ; ≥80% of emoji at lineEnd ; emoji with no other punctuation
LLM↑   : bulletLed >= 2 (emoji used as a section marker: "🌟 Location: ...")
         OR (emojis.length >= 3 AND distinctRatio === 1 AND rate is regular across sections)
         OR presence of the "assistant palette": ✨🚀🎯📌🔍💡🌟🙌 used as decoration in a review
```
- **Why**: humans *repeat* emoji and park them at the end of a thought; models *distribute* distinct emoji as visual structure, one per bullet, and favour a narrow decorative palette.
- **Confounders**: marketing/influencer humans do exactly the LLM pattern (and often for the same reason — they copied the format from a model). Corporate social-media copy is the worst confounder in this whole catalogue.

---

### Group C — Structure and rhetorical shape

#### F40 `markdown_artifacts`
- **langs** any · **shape** both · **minTokens** 0 · **direction** LLM↑ · **confidence** HIGH in chat, MED in prose
```
headers    = lines matching /^\s{0,3}#{1,6}\s+\S/
boldStars  = count(/\*\*[^*\n]{2,80}\*\*/g)            // DOUBLE asterisk
italicUnd  = count(/(?<!\w)_[^_\n]{2,80}_(?!\w)/g)
bullets    = lines matching /^\s{0,3}[-*+•]\s+\S/
numbered   = lines matching /^\s{0,3}\d{1,2}[.)]\s+\S/
hrule      = lines matching /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/
tablePipe  = lines with >=2 unescaped '|'
codeFence  = /^```/m
value = weighted sum; ALSO a binary `markdownInChat`
```
- **CRITICAL WhatsApp disambiguation**: WhatsApp's own markup is **single** `*bold*`, `_italic_`, `~strike~`, ` ```mono``` `. So in chat shape, a **single**-asterisk pair is a *human WhatsApp user* marker (weak HUMAN↑), while a **double**-asterisk pair is a markdown artifact from a model that was never told it was writing to WhatsApp (strong LLM↑). Getting this backwards inverts the sign of one of the best chat features. Likewise `#` at line start is a hashtag in human chat if it is `#word` with no space — require `#{1,6}` **followed by a space**.
- **Why**: markdown structure in a hotel review or a WhatsApp message is not something people type.
- **Confounders**: developers and power users do type markdown; some review platforms render it; `1.` at line start is also how humans number a list by hand — `numbered` alone is weak, `numbered + bold lead-ins` is strong (F41).

#### F41 `bold_lead_in_list`
- **langs** any · **shape** both · **minTokens** 20 · **direction** LLM↑ · **confidence** HIGH
```
value = count of lines matching /^\s*[-*•\d.)]+\s*\*\*[^*]{2,40}\*\*\s*[:：-]/
        + count of lines matching /^\s*[-*•]\s*\p{Lu}[^:\n]{2,40}:\s+\S/u
```
- The `- **Location:** Central and well connected.` shape. This is the highest-precision structural tell in the catalogue for T0 prose. Near-zero human base rate outside technical documentation.

#### F42 `parallel_openers`
- **langs** any · **shape** prose · **minTokens** 120, ≥6 sentences · **direction** LLM↑ · **confidence** MED
```
first = sentences.map(s => caseFold(s.tokens[0]))
value = 1 - (uniqueCount(first) / first.length)         // repetition rate of opening tokens
bonus if first tokens are drawn from the CONNECTOR set (§5, "Furthermore/Moreover/Additionally"
      / "Ayrıca/Bunun yanı sıra/Ek olarak" / "بالإضافة إلى ذلك/علاوة على ذلك") in ≥3 sentences
```
- Also detect **enumerated openers**: `First, … Second, … Finally,` / `Öncelikle, … Ardından, … Son olarak,` / `أولاً … ثانياً … وأخيراً`. Three or more in sequence: strong LLM↑.
- **Confounders**: essays by humans taught the five-paragraph form; L2 writers taught connector lists explicitly (this is a *known* bias against ESL writing — carry it in the fairness report).

#### F43 `tricolon_rate`
- **langs** EN (MED), TR (LOW), AR (LOW) · **shape** prose · **minTokens** 150 · **direction** LLM↑ · **confidence** MED-EN
```
// "A, B, and C" with three comparable-length constituents
value = count of /\b([\p{L}\p{M}'’-]+(?:\s+[\p{L}\p{M}'’-]+){0,2}),\s+([\p{L}...]{...}),\s+(and|&)\s+/giu
        per 100 sentences
// TR analogue: "X, Y ve Z"   AR analogue: "س، ص و ع"
```
- Assistant prose loves the rule of three. Humans use it too, just less often per unit text.
- **Confounders**: any list of three items in the world (dates, names, room types). Filter tricolons whose members are numerals or proper nouns.

#### F44 `oxford_comma` (EN)
- **langs** EN · **shape** prose · **minTokens** 100 · **direction** LLM↑ (consistent use) · **confidence** LOW
```
withOxford    = count(/,\s+(and|or)\s+\p{L}/giu) matched inside a detected tricolon
withoutOxford = count(/\p{L}\s+(and|or)\s+\p{L}/giu) at the tail of a detected 3-item list, no comma
value = withOxford / (withOxford + withoutOxford + 1)
```
- **Honest note**: this is a **dialect** marker (US vs UK/AU house style) far more than an authorship marker. It ships at weight 0 and exists only so calibration can prove or kill it. Do not let it near a verdict on a prior.

#### F45 `closing_summary_move`
- **langs** any · **shape** prose · **minTokens** 120 · **direction** LLM↑ · **confidence** MED
```
lastPara = final paragraph
value = 1 if lastPara starts with a member of CLOSER set for the language
        ("In conclusion", "Overall", "In summary", "Ultimately", "All in all",
         "Sonuç olarak", "Özetle", "Kısacası", "Genel olarak",
         "في الختام", "وفي الختام", "باختصار", "بشكل عام", "ختامًا")
```
- Combined with F46 (`hedge_density`) and F42 this is the "essay shape" cluster. Strong bias risk against students and L2 writers — the calibration must report this cluster's FPR on L2 text separately.

#### F46 `hedge_density`
- **langs** any · **shape** prose · **minTokens** 100 · **direction** LLM↑ · **confidence** MED
```
value = hits(HEDGES[lang]) per 100 tokens
EN: may, might, could, can be, tends to, generally, typically, often, it depends,
    somewhat, relatively, arguably, it is worth noting, keep in mind, that said
TR: olabilir, genellikle, çoğunlukla, bir ölçüde, nispeten, dikkate alınmalı,
    unutulmamalıdır, denilebilir, görünmektedir
AR: قد، ربما، عادةً، غالبًا، نسبيًا، يمكن القول، تجدر الإشارة، يبدو أن، إلى حد ما
```
- **Confounders**: cautious humans; scientific/medical registers; and, in this repo's own domain, a customer-service agent trained to never over-promise. Genuinely double-edged.

#### F47 `balanced_contrast_frames`
- **langs** any · **shape** prose · **minTokens** 100 · **direction** LLM↑ · **confidence** MED
```
EN: /\bnot only\b[^.]{3,80}\bbut also\b/i , /\bwhether you(?:'re| are)\b[^.]{3,90}\bor\b/i,
    /\bwhile\b[^.]{3,60},\s/i , /\bon the one hand\b/i
TR: /\bhem\b[^.]{2,60}\bhem de\b/i , /\bsadece\b[^.]{2,60}\bdeğil,?\s*aynı zamanda\b/i,
    /\b(ister)\b[^.]{2,60}\bister\b/i
AR: /\bليس فقط\b[^.]{2,80}\bبل أيضًا\b/ , /\bسواء كنت\b[^.]{2,80}\bأو\b/ , /\bمن ناحية\b[^.]{2,60}\bمن ناحية أخرى\b/
```
- The "whether you're travelling for business or leisure" frame is close to a signature in review-shaped LLM text.

---

### Group D — Register formulas and assistant-frame leakage

#### F50 `llm_lexicon_score`
- **langs** EN/TR/AR (per-language lists in §5.1–5.2) · **shape** both · **minTokens** 0 · **direction** LLM↑ · **confidence** HIGH for `strong` hits, MED for `weak`
```
strongHits = Σ matches of STRONG[lang]      (multiword, matched on foldedLex with word boundaries)
weakHits   = Σ matches of WEAK[lang]
density    = (strongHits*3 + weakHits) / max(1, tokens/100)
binaryStrong = strongHits >= 1
```
- **Matching rules**: match on `foldedLex` (case-folded, Arabic alef/ya/ta-marbuta unified, tashkeel stripped, tatweel stripped) so that `إنَّ الأمرَ` and `ان الامر` both hit. For TR, fold with the `tr` locale. Allow an optional intervening clitic where the phrase is listed with `…`.
- **Cap**: `density` is clipped at the 95th percentile of the calibration set to stop one repeated phrase from dominating.
- **Confounders**: quoting; a human who has read a lot of assistant output and absorbed the register (this is real and increasing); marketing copy; **and the biggest one — customer-service snippet libraries**, which contain "Thank you for reaching out", "We apologize for any inconvenience", "Let me know if you have any questions" as *human* templates. Every such phrase is tagged `DOMAIN:cs` in §5 and its weight is **halved or zeroed when `opts.domain === 'customer_service'`**.

#### F51 `assistant_frame_leakage`
- **langs** any · **shape** both · **minTokens** 0 · **direction** LLM↑ · **confidence** VERY HIGH (near-binary)
```
value = any of:
  /\bas an ai\b/i , /\bi'?m an ai\b/i , /\blanguage model\b/i , /\bi (do not|don'?t) have (personal|access)/i
  /\bmy (training|knowledge) (data|cutoff)\b/i , /\bi cannot browse\b/i
  /\bhere('?s| is) (a|an|the) (draft|revised|rewritten)\b/i , /^(sure|certainly|absolutely|of course)[,!]/i
  /\bi hope (this|that) helps\b/i , /\blet me know if you (need|have|'d like)\b/i
  /\bwould you like me to\b/i , /\bfeel free to (ask|reach out|let me know)\b/i
  TR: /\bumarım (bu )?(bilgiler )?(yardımcı )?ol(ur|muştur)\b/i , /\bbaşka bir sorunuz olursa\b/i,
      /\bsize nasıl yardımcı olabilirim\b/i , /\bbir yapay zeka\b/i
  AR: /نأمل أن (تكون|يكون)/ , /هل تود مني/ , /كنموذج ذكاء اصطناعي/ , /لا تتردد في/
```
- **Why**: this is the one family that is close to proof — a text containing "As an AI language model" was generated, full stop. `binaryStrong` here can carry enough weight to overcome the abstention gate on a short text (§6.4).
- **Confounder that must be handled**: a human *quoting* or *complaining about* AI ("the bot kept saying 'I hope this helps'"). Mitigation: suppress the hit if it is inside quotation marks, or if the text also contains a meta-mention (`chatgpt|yapay zeka|bot|ذكاء اصطناعي`) within 100 characters. Log `note: 'possible quotation'` and drop the weight to 0 rather than trying to be clever.

#### F52 `greeting_signoff_template`
- **langs** any · **shape** prose (email/review) · **minTokens** 30 · **direction** LLM↑ · **confidence** MED — **DOMAIN-SENSITIVE**
```
opener = first line matches /^(dear|hello|hi|greetings|good (morning|afternoon|evening))\b/i
       | /^(sayın|merhaba|iyi (günler|akşamlar)|günaydın)\b/i
       | /^(السلام عليكم|تحية طيبة|مرحبًا|السادة)/
closer = last 2 lines match /^(best( regards)?|kind regards|sincerely|warm regards|thanks( again)?|cheers)[,!]?$/i
       | /^(saygılarımla|iyi çalışmalar|teşekkürler|sevgiler)[,!]?$/i
       | /^(مع خالص التقدير|مع الشكر|تحياتي|وتفضلوا بقبول فائق الاحترام)/
value = opener + closer + (both ? 1 : 0)
```
- **Why**: models emit a complete letter frame even when asked for two sentences; and they emit it in *reviews*, where it is bizarre.
- **HONEST CAVEAT**: in an *email* corpus this feature is nearly worthless — humans write "Dear X … Best regards" all day. It is only informative **out of register**: a greeting+signoff on a hotel review, or on a WhatsApp message. Gate it: `active only if shape==='chat' || opts.genre==='review'`.

#### F53 `enumerated_offer`
- **langs** any · **shape** both · **minTokens** 15 · **direction** LLM↑ · **confidence** MED
```
/\bhere are (\d+|a few|some|three|five)\b/i  |  /\b(\d+) (tips|ways|reasons|things|options)\b/i
TR: /\bişte (\d+|birkaç)\b/i | /\bsizler için (derledik|hazırladık)\b/i
AR: /إليك (بعض|\d+)/ | /فيما يلي/
```

---

### Group E — Positive human evidence (the channel that actually works in chat)

#### F60 `human_lexicon_score`
- **langs** EN/TR/AR + Arabizi · **shape** both, **primary in chat** · **minTokens** 1 · **direction** HUMAN↑ · **confidence** HIGH
```
strongHits = Σ HUMAN_STRONG[lang]   (slang, dialect, chat abbreviations — §5.3)
weakHits   = Σ HUMAN_WEAK[lang]
value = strongHits*3 + weakHits
```
- One `شو` / `nbr` / `tbh` in a 6-token message is worth more than every distributional feature combined, because it is a *positive* observation rather than an absence.

#### F61 `contraction_apostrophe_drop` (EN)
- **langs** EN · **shape** both · **minTokens** 5 · **direction** HUMAN↑ · **confidence** HIGH
```
DROPPED = { dont, cant, wont, im, ive, id, youre, theyre, doesnt, didnt, wasnt, isnt,
            thats, theres, whats, hes, shes, wouldnt, couldnt, shouldnt, lets, aint,
            yall, gonna, wanna, gotta, kinda, sorta, dunno }
value = Σ matches (word-boundary, case-folded)
```
- Models essentially never drop the apostrophe. Note `its` and `were` are ambiguous with legitimate words — **exclude them**.

#### F62 `self_correction_marker`
- **langs** any · **shape** chat · **minTokens** 2 · **direction** HUMAN↑ · **confidence** HIGH
```
EN: /^\*\s*\S/ (a line starting with a bare asterisk = correction), /\bi meant\b/i, /\bsorry,? typo\b/i,
    /\bedit:/i, /\bnvm\b/i
TR: /\bpardon\b/i, /\byok yani\b/i, /\bözür.{0,10}yanlış\b/i, /\bdüzelt(me|iyorum)\b/i, /^\*\s*\S/
AR: /عفوًا/ , /قصدي/ , /غلط/ , /اقصد/ , /^\*\s*\S/
```
- Self-repair mid-conversation is a human process artifact. A model producing a clean single draft has nothing to repair.

#### F63 `fragment_and_ellipsis_thinking`
- **langs** any · **shape** chat · **minTokens** 3 · **direction** HUMAN↑ · **confidence** MED
```
value = fraction of lines with no finite-verb-ish structure — approximated (no POS tagger) as:
        lines of 1–4 tokens with no terminal punctuation and no LLM lexicon hit
        + lines that are a bare number, a bare date, a bare city name, a bare "ok"
```
- Chat is full of one-word turns. A model asked to write a chat message writes a *sentence*.

#### F64 `question_without_qmark`
- **langs** any · **shape** chat · **minTokens** 3 · **direction** HUMAN↑ · **confidence** MED
```
EN: line starts with (is|are|do|does|did|can|could|will|would|have|has|when|where|what|how|why)
    AND has no [?] anywhere
TR: line contains a token ending in /\b(mı|mi|mu|mü)\b/ or /\b(nasıl|ne|nerede|kaç|neden)\b/ and no [?]
AR: line contains one of (شو|ايش|وين|ليش|كيف|متى|كم|هل|أين|ماذا) and no [?؟]
```

#### F65 `arabic_dialect_markers` (AR)
- **langs** AR · **shape** both · **minTokens** 3 · **direction** HUMAN↑ · **confidence** HIGH
- Full list in §5.2. Detection is a plain lexicon match on `foldedLex` with alef/ya/ta-marbuta unification. Also structural dialect markers, which are cheaper and dialect-general:
```
bPresent   = tokens matching /^ب[يتنأا]?\p{L}{2,}/ used as present-tense marker (بروح، بيجي، بدي)
haFuture   = tokens matching /^ح\p{L}{3,}/  (حاجي، حنروح) or /^رح\s/
negTrailer = tokens matching /\p{L}+ش$/  (ما بعرفش، مش) — Egyptian/Levantine negation
mesh       = /\bمش\b|\bمو\b|\bما\s?في\b/
```
- **Why**: MSA is the register of published text and of assistant output; nobody chats in MSA. This is the single best Arabic human marker, and it is robust to orthographic sloppiness.
- **Confounder**: a model *asked* for Levantine dialect produces these markers (T1). Also literary dialogue quotes dialect. And note that dialect markers are **absent** from formal human Arabic — so their absence must carry weight 0 (asymmetry again).

#### F66 `arabizi` (AR-in-Latin)
- **langs** AR/mixed · **shape** chat · **minTokens** 2 · **direction** HUMAN↑ · **confidence** VERY HIGH
```
digitLetterTokens = tokens matching /^[a-z]*[23579][a-z]+$/i   (3ala, 7abibi, 2ana, 5alas, sha3b)
lexHits           = ARABIZI lexicon (§5.3)
value = digitLetterTokens + lexHits
```
- Consumer models do not emit Arabizi unless explicitly asked. `3ala`/`7abibi` in a message is about as close to "human" as this catalogue gets.
- **Confounder**: leetspeak in English (`h4x0r`, `l33t`) — require the token to also match an Arabizi lexicon entry OR appear in a `mixed`/`ar` context.

#### F67 `turkish_chat_morphology` (TR)
- **langs** TR · **shape** chat · **minTokens** 3 · **direction** HUMAN↑ · **confidence** HIGH
```
// spoken future/clipped forms; the written form is -acağım/-eceğiz, chat clips to -cam/-caz
value = count of tokens matching
        /\p{L}+(cam|cem|cak|cek|caz|cez|ceksin|caksin|icem|icam|icez|icaz)$/iu
        e.g. gelicem, yapcam, bakcaz, gidicez, alicam, görüşcez
     + count of /\b(bi|bii|napıyon|napıyorsun|nooluyo|olur mu|valla|aynen|hadi|hadii)\b/i
```
- The `-cam/-caz` clipping is a written-spoken form that a model will not produce in a normal reply. Very high precision.

#### F68 `unbalanced_delimiters`
- **langs** any · **shape** both · **minTokens** 10 · **direction** HUMAN↑ · **confidence** LOW
```
value = |count('(') - count(')')| + |count('"') % 2| + |count('«') - count('»')|
```
- Cheap, small weight. Models close their brackets.

#### F69 `no_paragraphing_wall`
- **langs** any · **shape** prose · **minTokens** 200 · **direction** HUMAN↑ · **confidence** MED
```
value = 1 if the text has ≥200 tokens and ZERO blank-line paragraph breaks
```
- Real people write walls of text. Model long-form output is paragraphed by default.

---

### 4.x Feature activity matrix (which features run where)

| Feature group | EN chat | TR chat | AR chat | EN prose | TR prose | AR prose |
|---|---|---|---|---|---|---|
| A rhythm (F01–F07) | off* | off* | off* | on | on | on (×1.2 gates) |
| B punctuation (F20–F31) | partial (F20 bin, F21, F22, F23, F27, F36, F37) | + F32–F34 | + F28, F30, F31 | on | on | on |
| C structure (F40–F47) | F40/F41 only | F40/F41 only | F40/F41 only | on | on | on (F43/F44 off) |
| D register (F50–F53) | F50 strong-only, F51 | same | same | on | on | on |
| E human (F60–F69) | **on — primary** | **on — primary** | **on — primary** | on | on | on |

\* except in **session-aggregate mode** (§6.5), where ≥8 messages from one author are concatenated and the rhythm features run on the aggregate.

---

## 5. Lexicons

### 5.0 Storage and matching rules

- Ship as a single versioned JSON (`lexicon.v1.json`) with `{phrase, lang, tag: 'strong'|'weak', domain: 'general'|'cs'|'travel'|'email', note}`.
- **Store Arabic and Turkish entries as `\uXXXX` escapes in the JSON source.** Rationale: bidi-unaware editors, terminals and diff viewers reorder Arabic literals, and a maintainer "fixing" a reordered line silently corrupts the lexicon. Generate the escaped file from a plain-text source with a build script; the plain-text source is the human-editable artifact, the escaped JSON is the shipped one. (The repo owner's terminal is known to reverse Arabic — do not print these to a terminal for review, diff them programmatically.)
- Matching: on `foldedLex`. For AR that means alef unification (`أإآٱ → ا`), ya/alef-maqsura (`ى → ي`), ta-marbuta (`ة → ه`) **for matching only**, tashkeel and tatweel stripped. For TR, `toLocaleLowerCase('tr')` + stray-U+0307 strip. For EN, plain lowercase.
- Word-boundary semantics: for EN/TR use `\b`-equivalent built from `\p{L}\p{M}\p{N}_`. Arabic has no case and clitics attach, so allow a leading `[وفبكل]` and the `ال` article before the first word of an AR phrase.
- A phrase written with `…` in the table means "allow 1–4 intervening tokens".

### 5.1 English LLM-tell phrases (65)

`strong` = high precision, low human base rate. `weak` = elevated in LLM text but common enough in human text that it may only corroborate.

| # | Phrase | Tag | Domain |
|---|---|---|---|
| 1 | as an ai (language model) | strong | general |
| 2 | i hope this helps | strong | general |
| 3 | i hope you find this helpful | strong | general |
| 4 | let me know if you have any questions | weak | email/cs |
| 5 | feel free to reach out | weak | email/cs |
| 6 | i'd be happy to | weak | cs |
| 7 | great question | strong | general |
| 8 | certainly! (sentence-initial) | strong | general |
| 9 | absolutely! (sentence-initial) | weak | general |
| 10 | it's important to note that | strong | general |
| 11 | it's worth noting that | strong | general |
| 12 | it is essential to | weak | general |
| 13 | delve into | strong | general |
| 14 | delving into | strong | general |
| 15 | in today's fast-paced world | strong | general |
| 16 | in today's digital age | strong | general |
| 17 | in the ever-evolving landscape of | strong | general |
| 18 | navigating the complexities of | strong | general |
| 19 | stands as a testament to | strong | general |
| 20 | a testament to | weak | general |
| 21 | plays a crucial role | strong | general |
| 22 | plays a vital role | strong | general |
| 23 | plays a pivotal role | strong | general |
| 24 | underscores the importance of | strong | general |
| 25 | highlights the importance of | weak | general |
| 26 | unlock the potential | strong | general |
| 27 | harness the power of | strong | general |
| 28 | take your … to the next level | strong | general |
| 29 | elevate your | weak | marketing |
| 30 | embark on a journey | strong | travel |
| 31 | the perfect blend of | strong | general |
| 32 | a perfect balance of | strong | general |
| 33 | look no further | strong | marketing |
| 34 | nestled in the heart of | strong | travel |
| 35 | in the heart of the city | weak | travel |
| 36 | a hidden gem | weak | travel |
| 37 | boasts (as verb, "the hotel boasts") | weak | travel |
| 38 | offers a wide range of | weak | general |
| 39 | ensuring a comfortable stay | strong | travel |
| 40 | whether you're … or … | strong | travel/marketing |
| 41 | seamless experience | weak | general |
| 42 | seamlessly integrates | weak | tech |
| 43 | state-of-the-art | weak | marketing |
| 44 | cutting-edge | weak | marketing |
| 45 | top-notch | weak | travel |
| 46 | second to none | weak | travel |
| 47 | leaves no stone unturned | strong | general |
| 48 | a myriad of | weak | general |
| 49 | rich tapestry | strong | general |
| 50 | meticulously curated | strong | general |
| 51 | meticulous attention to detail | weak | travel |
| 52 | a game-changer | weak | general |
| 53 | not only … but also | weak | general |
| 54 | furthermore, (sentence-initial) | weak | general |
| 55 | moreover, (sentence-initial) | weak | general |
| 56 | additionally, (sentence-initial) | weak | general |
| 57 | in conclusion, | weak | essay |
| 58 | in summary, | weak | general |
| 59 | overall, (paragraph-initial, closing) | weak | general |
| 60 | rest assured | weak | cs |
| 61 | thank you for reaching out | weak | **cs — human template!** |
| 62 | we apologize for any inconvenience | weak | **cs — human template!** |
| 63 | let's dive in | strong | general |
| 64 | here are a few / here are some | weak | general |
| 65 | i understand your concern | weak | cs |

Rows 4, 5, 6, 60, 61, 62, 65 are **domain-suppressed**: when `opts.domain === 'customer_service'` their weight is set to 0, because a human agent's snippet library contains exactly these strings. Failing to do this makes the detector accuse the support team.

### 5.2 Turkish LLM-tell phrases (42)

| # | Phrase | Tag | Domain |
|---|---|---|---|
| 1 | umarım bu bilgiler yardımcı olur | strong | general |
| 2 | umarım yardımcı olmuştur | strong | general |
| 3 | başka bir sorunuz olursa | strong | cs |
| 4 | size nasıl yardımcı olabilirim | strong | cs |
| 5 | yardımcı olmaktan memnuniyet duyarım | strong | cs |
| 6 | elbette! (sentence-initial) | strong | general |
| 7 | tabii ki! (sentence-initial) | weak | general |
| 8 | öncelikle belirtmek gerekir ki | strong | general |
| 9 | unutulmamalıdır ki | strong | general |
| 10 | dikkat çekmektedir | strong | general |
| 11 | önem taşımaktadır | strong | general |
| 12 | önemli bir rol oynamaktadır | strong | general |
| 13 | ön plana çıkmaktadır | strong | general |
| 14 | göze çarpmaktadır | strong | general |
| 15 | değerlendirilmektedir | weak | general |
| 16 | bu bağlamda | weak | general |
| 17 | bu doğrultuda | weak | general |
| 18 | söz konusu | weak | formal |
| 19 | göz önünde bulundurulduğunda | strong | general |
| 20 | bunun yanı sıra | weak | general |
| 21 | buna ek olarak | weak | general |
| 22 | ayrıca, (sentence-initial, ≥3×) | weak | general |
| 23 | diğer taraftan | weak | general |
| 24 | sonuç olarak, | weak | essay |
| 25 | özetle, | weak | general |
| 26 | kısacası, | weak | general |
| 27 | genel olarak, | weak | general |
| 28 | eşsiz bir deneyim | strong | travel |
| 29 | unutulmaz bir deneyim | strong | travel |
| 30 | konforlu bir konaklama | strong | travel |
| 31 | şehrin kalbinde | strong | travel |
| 32 | muhteşem bir manzara | weak | travel |
| 33 | misafirperverliği ile öne çıkıyor | strong | travel |
| 34 | her bütçeye uygun | weak | travel |
| 35 | ihtiyaçlarınıza yönelik | weak | cs |
| 36 | mükemmel bir uyum | strong | general |
| 37 | sizler için derledik | strong | content |
| 38 | keyifli bir tatil geçirmenizi dileriz | strong | travel/cs |
| 39 | geri bildiriminiz bizim için değerli | weak | **cs — human template** |
| 40 | anlayışınız için teşekkür ederiz | weak | **cs — human template** |
| 41 | yaşadığınız olumsuzluk için özür dileriz | weak | **cs — human template** |
| 42 | hem … hem de … (balanced, ≥2×) | weak | general |

**Structural TR tell, worth as much as the list**: the `-mAktAdIr` / `-mAlIdIr` formal suffix family. `count of tokens matching /(makta|mekte)(dır|dir)$/ or /(malı|meli)dır$/ or /(dır|dir|dur|dür)$/ at sentence end`, per 100 tokens. Near-zero in chat, moderate in formal human writing, high in assistant Turkish. Treat as feature `F32b turkish_formal_copula`, confidence MED, and **disable it entirely when `genre === 'formal_letter'`**.

### 5.3 Arabic LLM-tell phrases (40)

Listed with a transliteration so the table can be reviewed without rendering Arabic.

| # | Phrase | Translit | Tag | Domain |
|---|---|---|---|---|
| 1 | من الجدير بالذكر | min al-jadeer bi-l-dhikr | strong | general |
| 2 | تجدر الإشارة إلى أن | tajdur al-ishara ila anna | strong | general |
| 3 | بالإضافة إلى ذلك | bil-idafa ila dhalik | weak | general |
| 4 | علاوة على ذلك | 'ilawatan 'ala dhalik | weak | general |
| 5 | من ناحية أخرى | min nahiya ukhra | weak | general |
| 6 | في الختام | fi-l-khitam | weak | essay |
| 7 | وفي الختام يمكن القول | wa fi-l-khitam yumkin al-qawl | strong | essay |
| 8 | باختصار | bikhtisar | weak | general |
| 9 | بشكل عام | bishakl 'aam | weak | general |
| 10 | يلعب دورًا حيويًا | yal'ab dawran hayawiyyan | strong | general |
| 11 | يلعب دورًا مهمًا | yal'ab dawran muhimman | strong | general |
| 12 | يُعد من أهم | yu'ad min ahamm | strong | general |
| 13 | تُعتبر من أبرز | tu'tabar min abraz | strong | general |
| 14 | مما يجعله خيارًا مثاليًا | mimma yaj'aluhu khiyaran mithaliyyan | strong | general |
| 15 | خيارًا مثاليًا لـ | khiyaran mithaliyyan li- | strong | travel |
| 16 | تجربة لا تُنسى | tajriba la tunsa | strong | travel |
| 17 | إقامة مريحة | iqama muriha | weak | travel |
| 18 | في قلب المدينة | fi qalb al-madina | strong | travel |
| 19 | يتميز الفندق بـ | yatamayyaz al-funduq bi- | weak | travel |
| 20 | يوفر مجموعة واسعة من | yuwaffir majmu'a wasi'a min | strong | general |
| 21 | على أحدث طراز | 'ala ahdath tiraz | weak | travel |
| 22 | المزيج المثالي بين | al-mazij al-mithali bayn | strong | general |
| 23 | سواء كنت … أو … | sawa'an kunta … aw … | strong | travel |
| 24 | لا تتردد في التواصل معنا | la tataraddad fi-t-tawasul ma'ana | strong | cs |
| 25 | يسعدنا مساعدتك | yus'iduna musa'adatuk | strong | cs |
| 26 | نأمل أن تكون هذه المعلومات مفيدة | na'mal an takun hadhihi al-ma'lumat mufida | strong | general |
| 27 | شكرًا لتواصلك معنا | shukran li-tawasulik ma'ana | weak | **cs — human template** |
| 28 | نعتذر عن أي إزعاج | na'tadhir 'an ayy iz'aj | weak | **cs — human template** |
| 29 | بالتأكيد! (sentence-initial) | bit-ta'kid | weak | general |
| 30 | إليك بعض | ilayka ba'd | strong | general |
| 31 | فيما يلي | fima yali | weak | general |
| 32 | أولاً … ثانياً … وأخيرًا | awwalan … thaniyan … wa akhiran | weak | general |
| 33 | في عالمنا اليوم | fi 'alamina al-yawm | strong | general |
| 34 | في عصرنا الحالي | fi 'asrina al-hali | strong | general |
| 35 | مما لا شك فيه | mimma la shakka fih | weak | general |
| 36 | الأمر الذي يعكس | al-amr alladhi ya'kis | weak | general |
| 37 | نتطلع إلى خدمتكم | natatalla' ila khidmatikum | weak | cs |
| 38 | مع خالص التقدير | ma' khalis at-taqdir | weak | email |
| 39 | يُنصح بـ | yunsah bi- | weak | general |
| 40 | يستحق التجربة | yastahiqq at-tajriba | weak | travel |

**Structural AR tells** (worth more than half the list, and dialect-independent):
- `passive/nominalization density`: tokens matching `/^(يُ|تُ)\p{L}{3,}/` plus verbal-noun patterns `تفعيل، استخدام، توفير، تحسين` per 100 tokens. Formal MSA/assistant register.
- `MSA-only function words present AND zero dialect markers` (F65 = 0) in a *chat* context ⇒ LLM↑. In a *prose* context this means nothing (all published Arabic prose is MSA).

### 5.4 Human-tell markers

#### EN (chat abbreviations + slang) — `strong` unless noted
`u, ur, r, pls, plz, thx, thnx, ty, tysm, k, kk, idk, idc, imo, imho, btw, lol, lmao, rofl, omg, wtf, rn, tbh, ngl, fr (as "for real"), af, smth, sth, ppl, bc, cuz, coz, w/ , w/o, yeah, yea, yep, yup, nope, nah, naw, hmm, hmmm, ugh, oof, meh, aight, ight, wdym, hbu, wyd, jk, brb, ttyl, np, nvm, sry, srsly, def, prob, prolly, rly, gimme, lemme, ya, yall, sup, gotcha, ok cool, sounds good (weak), same, mood, bet, lowkey, deadass`
Weak (business-casual humans use them too): `asap, fyi, eta, pto, wfh, ok, thanks`.

#### TR — `strong` unless noted
`slm, mrb, sa (selamünaleyküm), as (aleykümselam), nbr, naber, napıyon, nasilsin, nsl, tmm, tmmm, tamamdır, ok, okey, okeyy, eyv, eyvallah, ins, inş, insallah, inşallah (weak — also formal), msj, tşk, tsk, tesekkurler (ASCII form), sğol, sagol, sağol, bi, bii, ya, yha, yaa, yaw, abi, abicim, abla, kanka, kanks, reis, hocam, kardeşim, kardesim, valla, vallahi, aynen, aynn, hadi, hdi, bkm, bakalım, bakcam, of, oha, hayırdır, yok artık, cnm, canım, olur, olcak, yapcam, gelcem, gidicez, görüşcez, napcaz, nolur, çok tşk, iyi ki, ay, aa, hee, he, hı hı, eh, neyse, boşver, bosver`
Weak/ambiguous: `tamam, evet, hayır, peki` (also used by models).
**Domain-specific (customer-service chat)**: `abi, reis, hocam, kanka` are used *by customers to agents* in this repo's corpus; they are strong human markers on the customer side and would be alarming on the agent side. Tag `speaker: customer`.

#### AR — dialect + chat (`strong`)
| Marker | Translit | Dialect |
|---|---|---|
| شو | shu | Levantine |
| ايش / إيش | eish | Levant/Gulf |
| وش | wesh | Gulf/Najdi |
| بدي / بدك / بدو | biddi / biddak | Levantine |
| ليش | leish | Levant/Gulf |
| هلق / هلأ | hallaq / halla' | Levantine |
| كتير | kteer | Levantine |
| خلينا | khallina | pan-dialect |
| مش / مو / ما في | mish / mu / ma fi | Levant/Egypt/Gulf |
| عشان / علشان | 'ashan | Egypt/Levant |
| دلوقتي | dilwa'ti | Egyptian |
| ازيك / ازيكم | izzayyak | Egyptian |
| عايز / عاوز | 'ayez | Egyptian |
| ايوه | aywa | Egyptian |
| وين | wein | Levant/Gulf |
| هسه / هسا | hassa | Iraqi/Jordanian |
| ماكو / اكو | maku / aku | Iraqi |
| زين | zein | Gulf/Iraqi |
| أبغى / ابي | abgha / abi | Gulf |
| يلا | yalla | pan |
| ماشي | mashi | pan |
| معليش | ma'lesh | pan |
| خلص / خلاص | khalas | pan |
| طيب | tayyeb | pan |
| يا ريت | ya reit | Levantine |
| الله يخليك | allah ykhallik | pan |
| مبروك | mabrouk | pan (weak) |
| حبيبي | habibi | pan (weak) |
| والله | wallah | pan (weak) |
| اللي | illi | dialectal relative pronoun — very frequent, strong |

#### Arabizi (Latin script, `strong`)
`shu, shou, kifak, kefak, keefik, 3ala, 3ind, 3youni, 7abibi, 7elo, 7ayati, 2ana, 2enta, 5alas, 5ala9, ma3lish, mnee7, mni7, insha2allah, inshallah, yalla, wallah, walla, ba3dein, sa7, akeed, bas, mabrouk, sho fi, ya3ni, la2, aiwa, ahlan, habibi, 6ayeb, 9ba7 el 5eir, ta3al, bade, badde, hala wallah`
Detection rule: token matches `/^[a-z']*[234567890][a-z']+$/i` **or** appears in this list. Require ≥1 hit for the feature to fire; ≥2 hits for `strong` weight.

#### Cross-language human markers (script-agnostic)
Letter elongation (F36), ASCII emoticons (F37), repeated emoji (F38), self-correction (F62), dropped apostrophes (F61), missing terminal punctuation (F22), all-lowercase (F35), double spaces (F27), unbalanced brackets (F68).

---

## 6. Scoring design

### 6.1 Output contract

```ts
type Direction = 'llm' | 'human' | 'neutral';

interface Evidence {
  name: string;           // feature id, e.g. 'em_dash_rate'
  value: number | object | null;
  direction: Direction;   // which way THIS observation points (not the feature's generic sign)
  weight: number;         // the fitted coefficient actually used, after all gates/suppressions
  contribution: number;   // weight * transformedValue — the signed logit delta. Sums to the score.
  confidence: 'HIGH'|'MED'|'LOW';
  note: string;           // human-readable, MUST name the confounder when one applies
}

interface Report {
  version: string;                 // detector version + lexicon version + weights version
  language: { primary, confidence, mixed, shares };
  shape: 'chat' | 'prose';
  counts: { chars, tokens, sentences, paragraphs, lines };
  verdict: 'abstain' | 'likely_human' | 'lean_human' | 'unknown' | 'lean_llm' | 'likely_llm';
  score: number | null;            // 0..1, null when abstaining
  channels: { human: number; llm: number };   // 0..1 each, INDEPENDENT (see 6.3)
  evidence: Evidence[];            // sorted by |contribution| desc
  gates: { passed: string[]; failed: string[] };
  warnings: string[];              // 'segmentation_suspect', 'uncalibrated_weights', 'domain_suppressed', ...
}
```

Rules the builder must not soften:
- `score` is `null` whenever `verdict === 'abstain'`. Never emit a number the caller can misread as "45% AI".
- `evidence` includes **features that fired against the verdict**. A one-sided evidence list is a lie by omission.
- `contribution` values must literally sum (plus intercept) to `logit(score)`. If they don't, the display is decoration and the whole explainability claim is fake.

### 6.2 Combiner

```
z_i = transform_i(x_i)                      // see below
logit = b0 + Σ_i (w_i * z_i)                // w_i from the (lang, shape) weight table
score = 1 / (1 + exp(-logit))
```

`transform_i`:
- **continuous** → `clip((x - μ[lang][shape][i]) / σ[lang][shape][i], -3, +3)`. Reference μ/σ come from the **human** side of the calibration corpus, so a z of 0 means "typical human", not "typical text".
- **rate** → same after `log1p` where the raw distribution is heavy-tailed (lexicon density, emoji rate).
- **binary** → 0 or 1.
- **null** (feature gated off, or below minTokens) → **omit from the sum entirely**, and do not renormalize. Omission is not "0.5 evidence"; it is no evidence. The absence of the feature is instead reflected in the confidence band (§6.4), which widens as the number of active features falls.

Intercept `b0` is fitted, not assumed, and it will not be 0: it encodes the corpus prevalence, which must then be *re-based* to the deployment prevalence with `b0' = b0 + log(p_deploy/(1-p_deploy)) - log(p_train/(1-p_train))`. Skipping this step is the most common way a lab-validated detector is wrong in production.

### 6.3 The two channels, and why a single axis is wrong

The naive design puts human at 0 and LLM at 1 and reads the absence of human markers as evidence for LLM. That is exactly the inference that convicts an L2 writer and a careful professional. So the core keeps **two saturating evidence accumulators**:

```
llmChannel   = 1 - exp(-Σ_{i: direction==='llm'}   max(0, w_i * z_i) / K)
humanChannel = 1 - exp(-Σ_{i: direction==='human'} max(0, w_i * z_i) / K)
```

and the verdict comes from a 2-D table, not from a threshold on one number:

| | humanChannel low (<0.25) | mid | high (>0.6) |
|---|---|---|---|
| **llmChannel high (>0.6)** | `likely_llm` | `unknown` (contradictory) | `unknown` + warning `contradictory_evidence` |
| **mid** | `lean_llm` | `unknown` | `lean_human` |
| **low (<0.25)** | **`abstain`** ← the common case for short text | `lean_human` | `likely_human` |

The bottom-left cell is the design's core honesty commitment: *no evidence either way ⇒ abstain*, never "probably AI".

`score` (the scalar) is still produced by §6.2 for ranking a queue, but the **verdict** comes from the table. Where the two disagree (score > 0.7 but the table says `unknown`), the table wins and a warning is emitted.

### 6.4 Hard abstention gates

Evaluated in order; the first failure abstains.

| Gate | chat | prose | Notes |
|---|---|---|---|
| G1 chars ≥ | 12 | 200 | below this, nothing runs |
| G2 word tokens ≥ | 5 (EN) / 6 (TR,AR) | 40 (EN) / 48 (TR,AR) | the ×1.2 morphological correction |
| G3 language identified | `primary !== 'unknown'` | same | `mixed` allowed, with reduced feature set |
| G4 active features ≥ | 3 | 6 | after all gating/suppression |
| G5 at least one feature with confidence HIGH or MED | yes | yes | prevents a verdict built only from LOW-confidence features |
| G6 not `T2-suspect` | see below | see below | |

Additional graded caps (not abstention, but a ceiling on how far from 0.5 the score may travel):

| tokens (EN; ×1.2 for TR/AR) | cap on \|score − 0.5\| | rationale |
|---|---|---|
| 5–11 (chat) | 0.15 — **and only the human channel may fire** | at this length only positive human markers are readable |
| 12–39 (chat) | 0.25 | |
| 40–99 | 0.30 | lexicon + punctuation + structure only; F01–F07 null |
| 100–199 | 0.40 | rhythm features enter if ≥8 sentences |
| 200–499 | 0.45 | |
| ≥500 | 0.50 (no cap) | |

**The one escape hatch**: `F51 assistant_frame_leakage` with an unquoted match ("As an AI language model", "Umarım bu bilgiler yardımcı olur", "نأمل أن تكون هذه المعلومات مفيدة"). This bypasses G1/G2/G4 and the caps, because it is not stylometry — it is a fingerprint. Everything else obeys the gates.

**G6 / T2-suspect**: if the text shows *both* a high llmChannel and ≥2 strong human markers (elongation, Arabizi, dropped apostrophes, dialect), the most likely explanation is a **post-edited hybrid** or a human quoting a model. Emit `unknown` with `warning:'hybrid_suspect'`. Do not pick a side.

### 6.5 Context switch: chat vs prose

`opts.shape` ∈ `'auto' | 'chat' | 'prose'`. `'auto'` decides by:

```
isChat = (chars < 400 && lines <= 4 && no markdown structure)
      || opts.source === 'whatsapp'
```
When the caller knows (a WhatsApp webhook does know), it must pass `shape` explicitly — auto-detection is a fallback, and a long pasted model reply arriving *through* WhatsApp is still `prose` in shape while being `chat` in provenance. Handle that with two orthogonal flags: `shape` (what the text looks like) and `channel` (where it arrived). A 900-character, bulleted, em-dashed message arriving on WhatsApp is the highest-signal case in the entire system — `channel==='whatsapp' && shape==='prose'` is itself a feature (`F70 out_of_channel_register`, LLM↑, HIGH).

**Session-aggregate mode** (strongly recommended as the *only* defensible chat mode): given ≥8 messages from one author within a session,
```
- run per-message detection (mostly abstains — fine)
- concatenate the messages with sentinel newlines and run the PROSE feature set on the aggregate
- additionally compute cross-message features:
    * inter-message style variance (humans drift; a bot is uniform)
    * template repetition (identical 6-gram reused across messages)
    * response-length uniformity
- the aggregate verdict is the one worth reporting
```
Per-message verdicts on 25-character messages should be treated as *inputs to the aggregate*, never surfaced individually.

### 6.6 Calibration — why the weights above must not be guessed, and the procedure

Everything in §4 fixes the *sign* and the *support* of a feature from first principles. Nothing in §4 fixes its *magnitude*, and magnitude is what determines FPR. Hand-picked weights fail in three specific ways:

1. **Correlated features double-count.** F20 (em dash), F24 (curly quotes), F26 (NBSP) are largely one latent variable ("came out of a rich-text/model surface"). Summing three hand-set weights triples one piece of evidence. Only a joint fit shrinks the correlated block correctly.
2. **The human distribution is unknown per language.** I do not know the em-dash rate of Turkish hotel reviews. Nobody does, until it is counted. A z-score against an invented μ is theatre.
3. **The prior is systematically wrong in the direction of the designer's fluency.** I can feel EN assistant register; my sense of "how formal is normal" in Arabic reviews is much weaker, so my AR priors would be the *most* confidently wrong, on the language with the least tolerance for that error.

#### 6.6.1 Corpus construction

Per cell `(lang ∈ {en,tr,ar}) × (shape ∈ {chat,prose})` — 6 cells, target **≥400 human + ≥400 LLM documents each**, and the human side stratified:

| Human stratum | ≥ share | why |
|---|---|---|
| L1 native, casual | 25% | the easy case |
| **L2 / non-native writer** | **25%** | the primary false-positive population; must be large enough to measure FPR on |
| formal/professional human (agent scripts, complaint letters, business email) | 20% | the second FP population |
| mobile-typed (autocorrect on) | 20% | the diacritic/curly-quote confounder |
| human-translated / MT-post-edited | 10% | flat rhythm, no typos |

LLM side stratified by: model family (≥4: GPT-family, Claude, Gemini, an open-weights 8–70B), prompt style (default / "be casual, short" / "write in Turkish chat style" / "write in Levantine dialect"), and post-edit level (none / light human edit / humanizer tool). The last stratum exists to *measure* the T2/T3 collapse rather than pretend it away.

Provenance: label by **acquisition**, never by another detector's output and never by human guess. Human documents = collected pre-2022 or from an authenticated non-AI workflow. LLM documents = generated by us, prompt and model recorded. Any document whose provenance is inferred is discarded, not "probably human".

#### 6.6.2 Fitting

- Per-cell **L2-regularized logistic regression** (or elastic net) on the transformed features. Fit `μ`, `σ` from the human side of the *training* split only.
- Group-aware splitting: hold out by **author** and by **source/prompt-template**, not by row. Random row splits leak template siblings across the split and inflate AUC by 10–20 points. This is the single most common way a detector is oversold.
- Fit the morphological gate multipliers (§1.3's 1.2×) as a hyperparameter sweep over `{1.0, 1.1, 1.2, 1.35, 1.5}` per language rather than keeping my guess.
- Any feature whose fitted coefficient has a sign **opposite** to the §4 prediction is not "fixed" by flipping the prior — it is flagged, investigated, and either explained or dropped. A sign flip usually means a corpus artifact (e.g. all the LLM prose came from one prompt that banned bullets).
- Features marked LOW in §4 start at weight 0 and are only admitted if the fit gives them a stable nonzero coefficient across all folds.

#### 6.6.3 Probability calibration

Fit the combiner on split A; fit **isotonic regression** (or Platt) on split B to map raw logits to probabilities; measure **ECE** and a reliability diagram on split C. Report ECE per cell. An uncalibrated score presented as a probability is the second-most-common lie in this product category.

#### 6.6.4 Threshold selection — fairness-constrained

Do **not** pick the threshold that maximizes accuracy or F1. Pick:

```
τ = min{ t : FPR(t | stratum = L2 writer) ≤ 0.02
             AND FPR(t | stratum = formal human) ≤ 0.02
             AND FPR(t | lang = each of en,tr,ar) ≤ 0.02 }
```
then report whatever recall falls out, per cell, without editorializing. If recall at that τ is 0.15 for Arabic chat, the answer is "we cannot do Arabic chat", not a lower τ. Publish the per-stratum FPR table alongside the model; a release that cannot show it does not ship.

#### 6.6.5 Negative controls (run every release)

1. **Pre-2020 human corpus** (reviews, emails, forum posts written before consumer LLMs). Expected positive rate ≈ the target FPR. If it is 8%, the detector is a formality detector wearing a costume.
2. **Human-translated text** (TR→EN, AR→EN by human translators). Should not be flagged.
3. **Machine-translated human text**. Will be flagged; measure how much, and document it as a known limitation, because MT is not LLM authorship.
4. **Shuffled-sentence control**: shuffle sentences within a human doc. Score should barely move (the features are order-light); a large move means the segmenter is doing something order-dependent it shouldn't.
5. **Template control**: the actual customer-service snippet library from this product, run as human text. Any snippet that scores >τ is added to the domain-suppression list.

#### 6.6.6 Drift and expiry

The weights file carries `{corpusHash, modelFamiliesCovered, generatedAt, expiresAt = generatedAt + 180 days}`. Past expiry the detector still runs but every report carries `warnings: ['weights_expired']` and verdicts are demoted one step toward `unknown`. Rationale: the LLM-tell lexicon is a snapshot of one generation of RLHF style; em-dash suppression alone has already moved between model releases. A detector with no expiry date silently rots into a formality detector.

#### 6.6.7 Ship-time guard

```
if (weights.provenance === 'prior') {
  if (!opts.allowUncalibrated) throw new Error('refusing to score with uncalibrated prior weights');
  report.warnings.push('uncalibrated_weights');
  report.verdict = downgradeToAtMost(report.verdict, 'lean_*');   // no 'likely_*' from priors
}
```
The prior weights exist so the pipeline can be built and unit-tested end to end. They must not be able to produce a confident verdict by accident.

### 6.7 Base rates — the arithmetic that must appear in the product UI

With FPR = 0.02 and recall = 0.60:

| True prevalence of LLM text | Precision of a positive |
|---|---|
| 50% | 0.968 |
| 20% | 0.882 |
| 10% | 0.769 |
| 5% | 0.612 |
| 2% | 0.380 |
| 1% | 0.233 |

At 1% prevalence, **three out of four flags are innocent people.** This table, computed with the release's actual FPR/recall, belongs next to the output, not in a footnote. It is also the argument for the two-channel design: `likely_human` is a far more actionable and far better-calibrated output than `likely_llm`, and the product should lean on it.

---

## 7. MUST-NOT-FIRE cases

These are **acceptance tests**, not illustrations. Each one becomes a fixture with an asserted verdict. A build that produces `likely_llm` on any Group A row fails the release gate regardless of its AUC.

### 7.A Human, but looks LLM — the detector must NOT say `likely_llm`

| # | Lang / shape | Text | Why it trips the detector | Required output |
|---|---|---|---|---|
| A1 | EN prose | *"Dear Sir or Madam, I am writing to express my sincere appreciation for the excellent service provided during my recent stay. The staff were highly professional, the room was impeccably clean, and the location was very convenient for business travellers. I would definitely recommend this hotel to my colleagues. Kind regards, M."* | L2 (Turkish-speaking) writer, textbook-formal, zero typos, tricolon, greeting+signoff, perfect punctuation. Hits F43, F45, F52, F46, F01-low. | `unknown` at most. Evidence must carry `note: 'formal L2 register — features overlap with LLM register'`. Verdict cap: never above `lean_llm`, and the L2-fairness threshold should put it at `unknown`. |
| A2 | EN prose | A project manager's real email: greeting, three bulleted action items with **bold** lead-ins, "Let me know if you have any questions. Best, Dave" | F41 (bold lead-in list) is the highest-precision structural feature and it fires fully. F52 fires. | `unknown`. Mitigation: `genre==='email'` disables F52 and halves F41; `domain==='work'` zeroes lexicon rows 4/5/6. |
| A3 | TR prose | A lawyer's complaint letter: *"Söz konusu rezervasyonun iptal edilmesi hususunda tarafınıza defalarca bildirimde bulunulmuş olmasına rağmen herhangi bir işlem yapılmamaktadır. Gereğinin yapılmasını saygılarımla arz ederim."* | `-maktadır`, `söz konusu`, nominalization, full diacritics, formal signoff. Hits TR rows 18, F32b, F52. | `unknown`. `genre==='formal_letter'` must disable F32b entirely — Turkish officialese *is* this register. |
| A4 | AR prose | A journalist's hotel write-up in polished MSA: `يُعد هذا الفندق من أبرز الوجهات في المدينة، إذ يوفر مجموعة واسعة من الخدمات` (*yu'ad hadha al-funduq min abraz al-wijhat…*) | Hits AR rows 12, 13, 20 and the passive/nominalization structural tell, with zero dialect markers. | `unknown`. In AR **prose**, "MSA with no dialect" carries weight 0 by design (§5.3) — all published Arabic prose is MSA. |
| A5 | EN chat | A support agent's real snippet: *"Thank you for reaching out. I'd be happy to help with that. Could you please confirm your booking reference? Best regards."* | Every phrase is on the LLM list. It is also literally in a human snippet library. | `abstain` or `unknown`. `domain==='customer_service'` zeroes rows 4, 6, 61, 65. This is the single most important suppression in the system for this product. |
| A6 | TR chat | A hotel guest on an iPhone with Turkish autocorrect: *"Merhaba, İstanbul'a 12 Mart'ta geliyoruz. İki kişilik bir oda ayırtmak istiyorum. Teşekkürler."* | Perfect diacritics (F32 fidelity), correct `İ` (F33), correct proper-noun apostrophes (F34), every sentence terminated (F22), sentence-initial capitals (F35). Looks flawless because the *keyboard* is flawless. | `abstain`. This is why all three TR orthography features have **weight 0 on the "correct ⇒ LLM" arm**. Only the ASCII-fied arm carries weight. |
| A7 | AR chat | A guest writing formally to a business in MSA: `السلام عليكم، أرغب في حجز غرفة مزدوجة لليلتين. شكرًا لكم.` | Correct hamza, Arabic punctuation `،`, no dialect, terminal punctuation. | `abstain`. Same asymmetry: correct orthography earns 0. |
| A8 | AR prose | A human pasting a vocalized quotation from poetry/scripture into a review, tashkeel throughout. | F30 tashkeel band. | Handled by the *three-band* F30: >0.25 tashkeel ⇒ HUMAN↑ (pasted source), not LLM. Required output: `lean_human` or `unknown`. |
| A9 | EN prose | Human-written text that was **machine-translated** from Turkish. Flat rhythm, no idioms, no typos, uniform sentence length. | F01, F02, F04, F27 all point LLM. | `unknown` + `warning: 'translationese_suspect'`. This is a genuine confusion class; MT and LLM decoding share a rhythm. Do not pretend to separate them. Negative control 6.6.5(3) measures the damage. |
| A10 | EN prose | A professional editor's review: em dashes, semicolons, curly quotes, an Oxford comma, no typos. | F20, F24, F25, F44 all fire at once — and they are **correlated**, which is exactly the double-counting failure §6.6.1 describes. | `lean_llm` at worst, and only if a Group-C or Group-D feature also fires. The correlated block must be shrunk by the joint fit; if the fit hasn't run, these four features carry a shared cap. |
| A11 | EN chat | *"Good morning. Could you please confirm the reservation for two adults on 12 March? Thank you."* | Terminal punctuation on every sentence, capitalized, polite, no human markers at all. 16 tokens. | **`abstain`.** The bottom-left cell of §6.3. There is no information here. Any product that returns a number for this string is misleading its user. |
| A12 | TR prose | A travel blogger's SEO copy, human-written, imitating the format the platform rewards: emoji-headed sections, "Şehrin kalbinde", bulleted list of 5 tips. | F38 bulletLed, F40, F41, TR rows 31/37. | `unknown` + `warning: 'marketing_register'`. Marketing copy is the worst confounder class in the catalogue because humans copied the format *from* models. |

### 7.B LLM, but looks human — the detector must NOT say `likely_human` (and mostly must abstain)

| # | Lang / shape | Text | Why it slips | Required output |
|---|---|---|---|---|
| B1 | TR chat | Model prompted "reply like a WhatsApp user": *"tmm abi bakarim ben sana donerim"* | Fires F32 (ASCII-fied), F35 (all-lowercase), F22 (no terminal), F60 (`abi`), F67. Every human channel lights up. | **`abstain`** is the honest answer; `lean_human` is acceptable but must carry `warning: 'human_markers_are_imitable'`. The design must never emit `likely_human` from chat markers alone, because they are the cheapest thing in the world to prompt for. |
| B2 | EN chat | Model output: *"Sure, sounds good."* | 3 tokens. | `abstain` (G2). |
| B3 | AR chat | Model asked for Levantine: `شو بدك تحجز؟ فيك تقلي التواريخ` | F65 dialect markers fire strongly. | `abstain` / `lean_human` with the same imitability warning. Dialect is a *register*, and registers are promptable. |
| B4 | EN prose | Model output post-processed by `sed 's/—/, /g'` plus a lowercase pass on sentence openers. | F20, F35 neutralized. | Score drops; F41/F42/F45/F50 must still carry it to `lean_llm` at best. Accept the recall loss — do not compensate by raising weights elsewhere. |
| B5 | EN prose | **Hybrid**: model draft, human rewrote 30% and added two typos. | Contradictory evidence. | `unknown` + `hybrid_suspect` (G6). This is the *correct* answer, not a failure. The question "was this LLM-generated" has no true answer for hybrids. |
| B6 | EN chat | *"Check-in is at 14:00."* — model-generated factual answer. | Nothing to measure. | `abstain`. |
| B7 | EN prose | Model output with typos deliberately injected by a "humanizer" tool (`teh`, `recieve`, a dropped apostrophe). | F61 fires, elongation absent. | `unknown` at best. Note that F36 (elongation) and F62 (self-correction) are *harder* to fake convincingly than dropped apostrophes — humanizers inject character noise, not conversational repair. Weight F62/F36 above F61 for that reason. |
| B8 | TR prose | Model output translated by MT into Turkish, keeping full diacritics. | Looks like careful human Turkish; the TR lexicon may miss because phrasing came through MT. | `unknown`. TR recall on translated LLM text will be poor; say so in the release notes. |
| B9 | EN chat | Model given 5 examples of the target user's real messages (few-shot mimicry). | Style is copied from a human. | `abstain`. There is no defence; the stylometric signal has been *replaced* with the victim's. |
| B10 | EN prose | Output from a small open-weights model (8B) — repetitive, sometimes ungrammatical, occasional degenerate loop. | Does not match a GPT-shaped lexicon; F04 (repetition) even points HUMAN. | `unknown`. **Known blind spot**: the whole design is tuned to instruction-tuned frontier-assistant register. Non-assistant-shaped models are out of coverage; the corpus stratification (§6.6.1) exists to measure this, not to fix it. |
| B11 | AR chat | Model asked to write Arabizi: *"shu badak ne7jez?"* | F66 fires — the "very high confidence" human marker. | `abstain`. Documented explicitly: F66 has near-zero *base rate* in model output but no *robustness* to an explicit prompt. High precision under T0 ≠ high precision under T1. |
| B12 | EN prose | Marketing copy generated by a model and then lightly edited by the brand's copywriter, published as a review. | Hybrid + marketing register. | `unknown`. Same as B5 and A12 from the other side — these two rows meeting in the middle is the honest picture of this problem's ceiling. |

### 7.C What the acceptance gate asserts

```
for each fixture: assert verdict ∈ allowedSet(fixture)
aggregate: FPR on 7.A ≤ 0/12 for 'likely_llm'
aggregate: 7.B rows producing 'likely_human' = 0
aggregate: ≥6 of 12 rows in 7.B produce 'abstain' or 'unknown'  // abstention is the deliverable
```

---

## 8. Build notes, module shape, and open questions

### 8.1 Module layout (zero-dependency, ESM)

```
src/
  index.js            detect(text, opts) -> Report            (pure)
  normalize.js        raw/nfc/foldedLex views, caseFold(lang)
  tokenize.js         WORD_RE/NUM_RE, counts, script tallies
  language.js         identify() + stopword tables
  segment.js          sentences(), paragraphs(), lines()
  features/
    rhythm.js  punctuation.js  structure.js  register.js  human.js
    turkish.js  arabic.js
  lexicon.v1.json     escaped, generated from lexicon-src/*.txt
  weights.v1.json     { provenance: 'prior' | 'fitted', b0, w{}, mu{}, sigma{}, expiresAt }
  score.js            combiner, channels, gates, verdict table
```
Every `features/*` export has the signature `(ctx) => Evidence[] | []` where `ctx` carries the three text views plus counts. No feature reads global state, no feature throws, and a feature that cannot compute returns `[]` (never a fabricated 0).

### 8.2 Performance

All features are O(n) over the text with a bounded number of passes; the lexicon match should be a single Aho-Corasick-style pass over `foldedLex` built once at module load from `lexicon.v1.json` (hand-rolled trie, ~120 lines, no dependency), not ~150 separate regex scans. Target: <2 ms for a 2000-word document, <50 µs for a chat message.

### 8.3 Test plan

1. **Unicode unit tests** for every claim in §1: `İ` folding, tatweel not being `Script=Arabic`, `،` not being `Script=Arabic`, Arabic-Indic and Extended-Indic both matching `\p{Nd}`, NFKC destroying `…`/NBSP (asserting we never call it on the raw view).
2. **Segmenter fixtures**: decimals, `Dr.`, URLs, `…`, `!!!`, emoji-terminated lines, a 6-line unpunctuated WhatsApp message, an RTL paragraph with embedded Latin.
3. **Feature golden tests**: one hand-computed expected value per feature.
4. **The 24 fixtures in §7** as the release gate.
5. **Determinism test**: same input ⇒ byte-identical `Report` across two Node minor versions (this is what forbids `Intl.Segmenter`).
6. **Adversarial suite**: apply the T3 transforms (em-dash strip, lowercase, typo injection, synonym swap) to a known-LLM fixture and *assert the score drops* — the point is to document the collapse in CI, not to prevent it.

### 8.4 Requirements coverage map (for the reviewer)

| Asked for | Section |
|---|---|
| Feature catalogue w/ Unicode specifics, direction, langs, shape, min tokens, confounders | §1, §4 (F01–F70), §4.x |
| burstiness / MATTR / punctuation / structure / register / caps / terminal punct / typos / abbreviations / emoji / whitespace | F01, F05, F20–F27, F40–F47, F50–F53, F35, F22, F36, F60, F38, F27 |
| TR apostrophe-suffix, TR diacritic ratio, ASCII-fied TR, dotted/dotless i | F32, F33, F34, F32b |
| AR dialect vs MSA, digits, hamza/alef normalization, tashkeel/tatweel | F65, F29, F31, F30, F28 |
| zero-width / non-breaking chars | F26 |
| paragraph uniformity | F03 |
| per-language lexicons (≥40 EN / ≥30 TR / ≥30 AR), strong-weak, domain-specific | §5.1 (65), §5.2 (42), §5.3 (40) |
| human-tell markers incl. TR slm/nbr/tmm/ins/bi/yha/abi/reis and AR shu/biddi/leish/halla'/kteer/khallina + Arabizi | §5.4 |
| sentence segmentation (؟ ، ۔ ! … newlines emoji unpunctuated) | §3 |
| language identifier w/ script ratio + stopwords + `mixed` | §2 |
| scoring, evidence objects, abstention gate, context switch, calibration argument | §6.1–§6.7 |
| must-not-fire, ≥10 + ≥10 | §7.A (12), §7.B (12) |

### 8.5 Open questions for the synthesizer / owner

1. **Is `likely_llm` ever an allowed output for this product?** Given §6.7, a defensible product might expose only `{likely_human, unknown/abstain}` and a ranking score for internal triage. That is a product decision, not a technical one, and it changes the threshold policy.
2. **Does labeled data exist, or will it be built?** Without §6.6's corpus this ships with prior weights and `allowUncalibrated`, which caps every verdict at `lean_*`. If no corpus is coming, say so now and scope the deliverable as "evidence extractor + ranking heuristic", not "detector".
3. **Which domain does the first deployment target** — inbound WhatsApp customer messages (chat, adversary T0, low stakes) or submitted reviews (prose, adversary T1–T3, higher stakes)? The chat case needs session-aggregate mode (§6.5) to be worth anything at all.
4. **Is the customer-service snippet library available?** It is required for negative control 6.6.5(5) and for the domain suppression list in §5.1. Without it, A5 is a live false-positive source.
5. **Arabic dialect coverage**: the F65 list spans Levantine, Egyptian, Gulf and Iraqi. Which dialects actually appear in this product's traffic? Trimming to the real two would raise precision.
6. **Do we ever see the same author across messages** (a stable phone number / account)? If yes, cross-message features (§6.5) are strictly stronger than anything in §4, and the design should be re-centred on them.
