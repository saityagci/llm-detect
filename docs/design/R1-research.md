# R1 — State of LLM-generated-text detection (research brief)

Prepared 2026-09-09. Round 1 of the detector design. **No build decisions here — evidence only.**

## How to read this document

Every numeric claim carries two tags.

**Who produced the number:**
- `[VENDOR CLAIM]` — the number was produced by the party selling or shipping the detector. Treat as an upper bound measured under conditions the vendor chose.
- `[INDEPENDENT]` — produced by a third party with no product to sell (academic paper, university study, shared task).
- `[SELF-REPORTED, ADVERSE]` — a vendor reporting a number *against* its own interest (e.g. OpenAI retiring its own classifier). These are the most trustworthy vendor numbers in existence.

**How *I* obtained it:**
- `[F]` — I fetched the primary source and read the number in it.
- `[S]` — the number reached me only through a search-engine summary of the source; I did not confirm it in the source text. Treat `[S]` numbers as *approximately right, precisely unverified*.

Anything without a URL is my own reasoning and is labelled as such.

---

## 0. Bottom line, before the details

1. **Nobody can reliably detect LLM text in a single short message.** Every serious measurement — vendor and independent alike — degrades sharply below ~100 words, and the commercial tools impose their own minimum-length floors (GPTZero 250 characters, Turnitin 300 words) precisely because they cannot.
2. **The headline accuracies are real but narrow.** They are measured on long, clean, unedited, single-generator, English text. Every step away from that — paraphrase, light human editing, a different generator, a different language, a shorter passage — costs tens of points.
3. **False positives are not uniformly distributed.** They concentrate on non-native writers, on formulaic genres, and (as of the 2026 Arabic work) on lightly polished non-English text. A detector's average FPR is not the FPR experienced by the person it accuses.
4. **The strongest available signals are not stylometric.** They are artifacts: leaked assistant boilerplate, chat-UI copy-paste residue, invisible characters, and near-duplicate text across accounts. Those are rules with near-zero FPR, not classifiers.
5. **A zero-dependency heuristic detector is a *screening* instrument, not a verdict instrument.** Section 7 gives the honest envelope.

---

## 1. Methods and reported numbers

### 1.1 Commercial detectors

| Detector | Headline number | Tag | What it needs | Source |
|---|---|---|---|---|
| OpenAI AI Text Classifier (retired) | 26% TPR ("likely AI-written"), 9% FPR on human text; launched 2023-01-31, killed 2023-07-20 | `[SELF-REPORTED, ADVERSE]` `[S]` | hosted API | [openai.com](https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/), [qz.com](https://qz.com/chatgpt-openai-inaccuracy-classifier-detection-tool-1850677501) |
| GPTZero | 99% accuracy, FPR ≤1%; mixed human/AI docs 96.5% accuracy / 0.9% FPR (dated 2025-01-30) | `[VENDOR CLAIM]` `[F]` | hosted API; min ~250 chars | [gptzero.me](https://gptzero.me/news/ai-accuracy-benchmarking/) |
| Originality.ai | Lite 1.0.2: 99% accuracy / 0.5% FPR. Turbo 3.0.2: 99%+ / 1.5% FPR | `[VENDOR CLAIM]` `[S]` | hosted API | [originality.ai](https://originality.ai/blog/ai-accuracy) |
| Copyleaks | >99% accuracy, 0.2% FPR (elsewhere 0.03%); per-language: English 99.97% on human / 99.20% on AI | `[VENDOR CLAIM]` `[S]` | hosted API | reported via [textpulse.ai review](https://textpulse.ai/blog/copyleaks-ai-detector-review) — **I did not fetch Copyleaks' own page; treat as second-hand** |
| Turnitin | ~98% accuracy, <1% FPR **at document level, and only for documents >20% AI**; raised minimum from 150 → 300 words; publicly admitted elevated FP in some cases | `[VENDOR CLAIM]` + `[SELF-REPORTED, ADVERSE]` `[S]` | hosted, LMS-integrated | [turnitin.com](https://www.turnitin.com/blog/understanding-false-positives-within-our-ai-writing-detection-capabilities), [k12dive](https://www.k12dive.com/news/turnitin-false-positives-AI-detector/652221/) |
| Pangram | 99% accuracy, FPR 0.02%, FNR ~2%. ESL: TOEFL (91 essays) 0% FP; ELLIPSE (3,907 ESL essays) 0% FP; ICNALE (5,600) 0.09% FPR | `[VENDOR CLAIM]` `[F]` — authored by Pangram Labs (Emi & Spero), v3 2024-07-29 | hosted API | [arXiv 2402.14873v3](https://arxiv.org/html/2402.14873v3) |
| Pangram's numbers *for competitors* | GPTZero ~94% acc / 10.02% FNR / 2% FPR; Originality.ai ~95% acc / 9.24% FPR (n=1,976 docs) | `[VENDOR CLAIM about rivals]` `[F]` — the most biased class of number in this table | | same |

**The one genuinely independent commercial head-to-head I found.** Jabarian & Imas, University of Chicago Booth, September 2025: ~2,000 human-written passages across six genres — blogs, **consumer reviews**, news, novels, **restaurant reviews**, résumés — with AI counterparts from four LLMs. `[INDEPENDENT]` `[F]` ([chicagobooth.edu](https://www.chicagobooth.edu/review/do-ai-detectors-work-well-enough-trust))

| | False positives | False negatives |
|---|---|---|
| Pangram | ~0% | 2–4% |
| GPTZero | <1% | 0–2% |
| Originality.ai | <1% | 10–40% |
| RoBERTa (open) | — | "close to random guessing" |

And the finding that matters most for this project: all three commercial detectors held accuracy on medium (200–500 words) and long (~1,000 words) passages but **lost accuracy on passages under 50 words**. `[INDEPENDENT]` `[F]`

**The honest reconciliation.** Booth's numbers are much kinder to the commercial tools than the 2023-era literature. Two readings are both defensible and I cannot separate them from the evidence I have: (a) the tools genuinely improved 2023→2025; (b) Booth's human corpus is professional/edited prose, which is easier than TOEFL essays. The Czech follow-up in §2 supports (a) partially — the same commercial detector went from 61.3% → 23.1% FPR on the *same* TOEFL set. Improved, still 23× the native rate.

### 1.2 Zero-shot / statistical detectors

These need **token-level log-probabilities from a language model**. That is the disqualifying requirement for a zero-dependency shipped tool: all of them need a GPU-resident LM at inference time.

| Method | Headline | Tag | Requirement | Source |
|---|---|---|---|---|
| GLTR (Gehrmann et al. 2019) | raises *human* detection rate 54% → 72% with no training | `[INDEPENDENT]` `[S]` | full next-token distribution from a scoring LM | [github](https://github.com/HendrikStrobelt/detecting-fake-text), [S2](https://www.semanticscholar.org/paper/867db5097ad6aaef098c60b0845785b440eca49a) |
| DetectGPT (ICML 2023) | probability-curvature via ~100 perturbations | `[INDEPENDENT]` | scoring LM **+** a mask-filling LM; ~100 forward passes/doc | (see Fast-DetectGPT for the comparison) |
| Fast-DetectGPT (ICLR 2024) | ~75% relative AUROC improvement over DetectGPT; ~2 orders of magnitude faster; ~65% better white-box than black-box | `[INDEPENDENT]` `[S]` | scoring LM, single forward pass + sampling | [arXiv 2310.05130](https://arxiv.org/abs/2310.05130) |
| Binoculars (ICML 2024) | >90% of ChatGPT samples at **0.01% FPR**, zero-shot, no ChatGPT training data | `[INDEPENDENT]` `[F]` | **two** pre-trained LLMs (observer + performer) | [arXiv 2401.12070](https://arxiv.org/abs/2401.12070) |

**The independent re-measurement that deflates all of the above — RAID (ACL 2024).** 6.2M generations, 11 models, 8 domains (including **reviews**), 11 adversarial attacks, 4 decoding strategies. Detection accuracy **at FPR = 5%**, non-adversarial: `[INDEPENDENT]` `[F]` ([aclanthology](https://aclanthology.org/2024.acl-long.674/), [arXiv HTML](https://arxiv.org/html/2405.07940v1))

- Open: RoBERTa-GPT2 **59.1%**, RoBERTa-ChatGPT **44.8%**, GLTR **62.6%**, Fast-DetectGPT **73.6%**, Binoculars **79.6%**
- Closed: GPTZero **66.5%**, Originality **85.0%**, Winston **71.0%**, ZeroGPT **65.5%**

Binoculars' own paper says >90% at 0.01% FPR; RAID says 79.6% at 5% FPR. Both are true. They are different distributions. **This gap — roughly 10–25 points between a method's own paper and an independent benchmark — is the single most useful calibration constant in this document.**

Under attack, from RAID: `[INDEPENDENT]` `[F]`
- Binoculars, synonym substitution: **−36.1 percentage points**
- Originality, homoglyph substitution: **−75.7 pp**
- GLTR, homoglyph: **−38.3 pp**; RoBERTa-GPT2, homoglyph: **−35.4 pp**
- Repetition penalty alone (not an attack, just a decoding setting): up to **−38 pp** across all detectors
- GPTZero was the outlier, losing only **0.3%** to homoglyphs — it evidently normalizes Unicode. Five others averaged **−40.6%**.

### 1.3 Watermarking — SynthID-Text (Nature, Oct 2024)

`[VENDOR, PEER-REVIEWED]` — Google DeepMind's own method, but published in Nature with independent review. `[F]` ([Nature](https://www.nature.com/articles/s41586-024-08025-4), [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11499265/), [code](https://github.com/google-deepmind/synthid-text))

- Modifies the **sampling procedure only**; detection does not need the underlying LLM.
- Primary metric is TPR at **FPR = 1%**; detectability improves monotonically with token count — "longer texts contain more watermarking evidence".
- Live deployment across Gemini: ~**20 million** watermarked and unwatermarked responses compared; thumbs-up/down rates differed by **0.01–0.02%** (i.e. no measurable quality cost).

Stated limitations, in the paper's own words: weakened by edits including LLM paraphrasing; must be applied **at generation time** (no post-hoc application); hard to enforce on decentralised open-weight models; vulnerable to stealing, spoofing and scrubbing. Google separately states confidence drops greatly when text is thoroughly rewritten or translated `[S]` ([DeepMind blog](https://deepmind.google/blog/watermarking-ai-generated-text-and-video-with-synthid/)).

**Relevance to this project: none, directly.** Watermarking only detects text from models that opted in. Text arriving over WhatsApp from an unknown source is not watermarked in any usable way. It matters only as the reason the industry's *own* researchers do not believe post-hoc detection is solvable.

### 1.4 Fine-tuned classifiers

- **OpenAI RoBERTa GPT-2 output detector** — ~95% detection rate for 1.5B-GPT-2 text `[SELF-REPORTED]` `[S]`; OpenAI's own caveat that this is "not high enough accuracy for standalone detection"; accuracy on 500-character documents about **15% lower** than on long ones `[SELF-REPORTED, ADVERSE]` `[S]` ([openai/gpt-2-output-dataset detection.md](https://github.com/openai/gpt-2-output-dataset/blob/master/detection.md)). Cross-generation collapse: 54.98% accuracy (i.e. chance) on GPT-3.5 text without retraining `[INDEPENDENT]` `[S]` ([GPT-Sentinel, arXiv 2305.07969](https://arxiv.org/pdf/2305.07969)). Confirmed in 2025 by Booth: "close to random guessing" `[INDEPENDENT]` `[F]`.
- **The retired OpenAI classifier is the load-bearing fact.** 26% TPR / 9% FPR, killed by the company that trained the generator. `[SELF-REPORTED, ADVERSE]` `[S]`. When any vendor claims 99%, this is the number to hold next to it.

### 1.5 Failure modes, consolidated

| Failure mode | Evidence | Tag |
|---|---|---|
| Recursive paraphrase | Sadasivan et al., TMLR — recursive paraphrasing significantly reduces detection across watermarking, neural and zero-shot detectors; plus a formal result bounding the best possible detector's AUROC by the total-variation distance between human and AI text distributions | `[INDEPENDENT]` `[F]` [arXiv 2303.11156](https://arxiv.org/abs/2303.11156) |
| Homoglyph / Unicode substitution | −75.7 pp (Originality), −38.3 pp (GLTR) | `[INDEPENDENT]` `[F]` RAID |
| Decoding-parameter shift | repetition penalty alone: up to −38 pp | `[INDEPENDENT]` `[F]` RAID |
| Unseen generator | RoBERTa-GPT2 → GPT-3.5: 95% → 54.98% | `[INDEPENDENT]` `[S]` |
| **Light human/AI polishing** | APT-Eval, 14.7K samples, 12 SOTA detectors: detectors "frequently flag even minimally polished text as AI-generated" and cannot distinguish degrees of involvement | `[INDEPENDENT]` `[F]` [arXiv 2502.15666](https://arxiv.org/abs/2502.15666) |
| Short text | see §3 | |
| Commercial "humanizers" | Marketing claims (e.g. StealthGPT's "99% bypass") are contradicted by independent tests, but this whole literature is affiliate-SEO content and I would not cite any of it as evidence. The *academic* proxy is RAID's synonym/paraphrase attacks above. | — |

---

## 2. False-positive literature

### 2.1 Liang et al. 2023 — the anchor study

"GPT detectors are biased against non-native English writers", *Patterns* 4(7), July 2023. `[INDEPENDENT]` `[F]`
[arXiv 2304.02819](https://arxiv.org/abs/2304.02819) · [Cell Patterns](https://www.cell.com/patterns/fulltext/S2666-3899(23)00130-7) · [full text I read](https://ar5iv.labs.arxiv.org/html/2304.02819) · [code](https://github.com/Weixin-Liang/ChatGPT-Detector-Bias)

Seven detectors: **Originality.AI, Quil.org, Sapling, OpenAI, Crossplag, GPTZero, ZeroGPT.**

| Measurement | Value |
|---|---|
| TOEFL essays (non-native), n | **91** |
| Average false-positive rate on those essays | **61.22%** |
| Flagged by **all seven** detectors | **18/91 = 19.78%** |
| Flagged by **at least one** detector | **89/91 = 97.80%** |
| US 8th-grade essays (Hewlett ASAP), n | **88** |
| False-positive rate on those | **~5.19%** |

Mitigation / attack (same prompt, two directions):
- TOEFL essays rewritten by ChatGPT with "enhanced word choices": FPR **61.22% → 11.77%**; unanimous detections fall to **1/91 (1.10%)**.
- US essays rewritten with *simplified* word choices: misclassification **5.19% → 56.65%**.

Mechanism: unanimously-flagged TOEFL essays had significantly lower perplexity (p = 9.74e-05); post-intervention perplexity rose significantly (p = 9.36e-05). **The detectors were measuring vocabulary richness and calling it authorship.**

### 2.2 2024–2026 follow-ups

**"Different Time, Different Language: Revisiting the Bias Against Non-Native Speakers in GPT Detectors"** (arXiv 2602.05769). `[INDEPENDENT]` `[F]`
Tested a Naïve-Bayes/TF-IDF baseline, a fine-tuned RobeCzech, and a commercial closed-source detector (Plagramme) on Czech, using the AKCES learner corpus (450 moderate + 29 C1 non-native samples vs native youth writers).

- **The bias does not reproduce in Czech.** Non-native Czech essays had *higher* entropy than native ones: **3.48 vs 3.19, p < 1e-14**.
- Commercial detector on Czech: **2.0% FPR** non-native vs **1.0%** native.
- Same commercial detector on the *original English TOEFL set*: **23.1% FPR** non-native vs **0%** native — a large improvement on Liang's 61.3%, but still a 23× gap.
- Modern detectors correlate only weakly with entropy (|ρ| ≤ 0.2), so entropy is no longer the mechanism.
- Their explanation: morphology. Czech's inflectional complexity means learner errors *raise* entropy; English learner writing is dominated by restricted vocabulary, which *lowers* it.

**This is the most important nuance in the whole brief for a Turkish/Arabic product.** The direction of non-native bias is a function of the language's morphology, not a universal law. Turkish is agglutinative; Arabic is templatic with heavy dialect variation. **Neither direction can be assumed. It must be measured per language, or the detector must abstain.**

**"The accuracy-bias trade-offs in AI text detection tools"** (PMC12453642, 2025-06-23). `[INDEPENDENT]` `[F]`
GPTZero, ZeroGPT, DetectGPT on scholarly abstracts. GPTZero 97.22% overall accuracy — and the *highest* bias: over-detection rate **25% for non-native** authors vs **11% for native** (t = −2.115, p = 0.036). Highest false-accusation rate by discipline: interdisciplinary **62.50%**; lowest, social sciences **25%**. The paper's framing — higher accuracy came *with* stronger group bias — is the trade-off to design around.

**Arabic light-polishing** (arXiv 2511.16690) — see §4.2. Human Arabic articles polished only 10% by an LLM drove Originality.AI from 92% → **12%** accuracy. `[INDEPENDENT]` `[F]`

---

## 3. Short-text limits — what accuracy vs length actually looks like

Five sources, converging.

1. **"Detecting AI-Generated Text: Factors Influencing Detectability"** (arXiv 2406.15583). `[INDEPENDENT]` `[F]` ([HTML](https://arxiv.org/html/2406.15583v1))
   - **~120 words** suffice for GLTR and DetectGPT to reach their ceiling across story/news/scientific domains.
   - **~200 words** needed for reliable detection of ChatGPT-turbo and GPT-4 output.
   - Watermarking is the exception: ~**10 words** can carry a binary signal (but see §1.3 — irrelevant here).
   - **Aggregation beats length:** concatenating **10 tweets** moved accuracy from **80% → ~100%**.
   - Sentence-level detection reached **93%** *only* when sentence-level examples were in training; **50% (chance)** when trained on full essays only.

2. **Jabarian & Imas / Chicago Booth, Sept 2025.** All three commercial detectors held on 200–500 and ~1,000-word passages and **lost accuracy under 50 words**. `[INDEPENDENT]` `[F]`

3. **OpenAI's own GPT-2 detector docs.** Accuracy on 500-character documents ~**15% lower** than on long documents; "shorter documents are harder to detect and performance improves gradually with length". `[SELF-REPORTED, ADVERSE]` `[S]`

4. **The vendors' own minimum-length floors** — an admission by product design: GPTZero **250 characters** (~50 words), Copyleaks **350 characters**, QuillBot **80 words**, Turnitin **300 words** (raised from 150). `[VENDOR]` `[S]` ([Turnitin/CASRAI](https://casrai.org/guides/why-does-my-paper-say-ai-detected), [detector minimums](https://effortlessacademic.com/how-reliable-are-ai-detectors/))

5. **The dissenting data point, and why I do not believe it generalizes.** SMLT-MUGC (arXiv 2407.12815) `[INDEPENDENT]` `[F]` ([HTML](https://arxiv.org/html/2407.12815v1)) reports classical classifiers hitting **99.03% F1 on tweets** (small), 97.35% on PubMed abstracts (medium), and only ~**72.6% F1** on GPT-2-XL long text.
   That inversion is a red flag, not a finding. Their own feature analysis explains it: human tweets contained **32,730 unique words** vs **7,735** for the machine set, and machine tweets scored Flesch Reading Ease **68.86** vs **56.62** for humans. A 4× vocabulary gap is a *corpus construction artifact* — the two halves were not matched. Note also that `Flowerly/modern-fake-reviews` (§6) documents exactly this trap: a detector trained on the GPT-2-era half of the classic fake-review corpus flags only **~4%** of modern-LLM reviews.
   **Read 99%-on-tweets as: on a poorly matched corpus you can get any number you like.**

**Conclusion for design.** Below ~50 words there is no defensible per-message score. Between 50 and 120 words the score is weak. Above ~150–200 words it is meaningful in-distribution. Aggregation across messages is the only lever that recovers short-text power, and it is a strong one.

---

## 4. Multilingual — Arabic and Turkish specifically

### 4.1 Benchmarks and what they cover

| Benchmark | Languages | Arabic? | Turkish? | Source |
|---|---|---|---|---|
| **MULTITuDE** (EMNLP 2023) | 74,081 texts, 11 langs: ar, ca, cs, de, en, es, nl, pt, ru, uk, zh; 8 multilingual LLMs | **Yes** | **No** | [arXiv 2310.13606](https://arxiv.org/abs/2310.13606) `[INDEPENDENT]` `[F]` |
| **SemEval-2024 Task 8** (M4/M4GT) | Subtask A multilingual — train: en, zh, ur, bg, id; dev: ru, ar, de; test: en, ar, de, **it** (surprise language) | **Yes** | **No** | [arXiv 2404.14183](https://arxiv.org/html/2404.14183) `[INDEPENDENT]` `[F]` |
| **GenAIDetect Task 1** (COLING 2025) | English + multilingual; 36 teams mono, 27 multi | Yes | not listed | [arXiv 2501.11012](https://arxiv.org/abs/2501.11012) `[INDEPENDENT]` `[S]` |
| **MAiDE-up** (hotel reviews) | 20,000 reviews, 10 langs: en, zh, fr, de, it, ko, ru, es, **tr**, ro | **No** | **Yes** | [arXiv 2404.12938](https://arxiv.org/html/2404.12938v1) `[INDEPENDENT]` `[F]` |
| **ALHD** (Arabic) | >400K balanced samples, 3 genres — news, social media, **reviews**; MSA + dialects; 3 LLMs | **Yes** | No | [arXiv 2510.03502](https://arxiv.org/abs/2510.03502) `[INDEPENDENT]` `[S]` |

Best shared-task scores, for calibration: SemEval-2024 Task 8 subtask A — monolingual **96.88** accuracy (Genaios), multilingual **95.99** (USTC-BUPT). `[INDEPENDENT]` `[F]`. These are fine-tuned transformer ensembles on in-distribution data; they are not achievable by heuristics and they are not out-of-distribution numbers.

### 4.2 What transfers across languages — the numbers that matter

**MULTITuDE results** `[INDEPENDENT]` `[F]` ([full text I read](https://ar5iv.labs.arxiv.org/html/2310.13606)):

- Best fine-tuned multilingual detector, mDeBERTa-v3-base trained on all languages: **0.9607 AUC ROC**, 0.8480 macro-F1.
- **Zero-shot statistical detectors (Rank, Log-Rank, Entropy, DetectGPT) across the multilingual set: ~0.4708 macro-F1** — i.e. they collapse to predicting a single class. *No transferability to non-English languages.*
- **English-trained detector evaluated on Arabic: 0.5448 F1**, versus **0.8537** when multilingually trained. English-only training on Arabic is barely above chance.
- Overall English → non-English drop: **0.9292 → 0.6903 F1 (−25.7%)**.
- Multilingual fine-tuning improved cross-lingual generalization on unseen languages (the only exception being Ukrainian, where Russian-only training was marginally better).

**Read that as the governing constraint: the statistical/stylometric family — the family a zero-dependency detector belongs to — is the family that measurably does not cross language boundaries.**

### 4.3 Arabic-specific work

- **AIRABIC** (IEEE 2024): 1,000 examples — 500 human passages from 41 sources + 500 GPT-3.5. Finding: **diacritics** confound AI detectors in Semitic languages. `[INDEPENDENT]` `[S]` ([IEEE Xplore](https://ieeexplore.ieee.org/document/10459781/))
- **AI-Generated Text Detector for Arabic (AraELECTRA / XLM-R)**: 43,958 + 3,078 examples across ChatGPT-3.5, GPT-4, Bard; benchmarked against GPTZero and the OpenAI classifier on AIRABIC. `[INDEPENDENT]` `[S]`
- **"The Arabic AI Fingerprint" / KFUPM-JRCAI** (arXiv 2505.23276, also in *Expert Systems with Applications*): ALLaM, Jais, Llama, GPT-4 across academic abstracts and social-media posts; three generation strategies (from title, content-aware, refinement). BERT-based detectors reach **up to 99.9% F1** in the *formal* domain, robust to >90% random token dropping — **but cross-domain generalization degrades**. `[INDEPENDENT]` `[F]` ([arXiv](https://arxiv.org/abs/2505.23276), [code](https://github.com/KFUPM-JRCAI/arabic-text-detection)). Their datasets are on HF and verified in §6.
- **"AI Text Detectors and the Misclassification of Slightly Polished Arabic Text"** (arXiv 2511.16690). `[INDEPENDENT]` `[F]` ([HTML](https://arxiv.org/html/2511.16690v1)) — **the most alarming numbers in this brief.**
  - Corpus 1: 800 samples (400 human, 400 AI from 10 LLMs). Corpus 2 (**Ar-APT**): 16,400 samples — 400 human Arabic articles polished by 10 LLMs at **10 / 25 / 50 / 75%** levels.
  - Detectors: Originality.AI, ZeroGPT, Smodin, Isgen, plus LLM-as-detector.
  - Baseline FPR on *unpolished* human Arabic: **Originality.AI 8%**, Claude-4-Sonnet-as-judge **16.49%**.
  - At only **10% polishing**: Originality.AI accuracy **92% → 12%** (−80 pp). Claude-4-Sonnet **83.51% → 57.63%**.
  - **Implication for a travel/hospitality product: a human Arabic reviewer who ran their own text through any assistant for grammar is, to current detectors, indistinguishable from a bot — in both directions.**

### 4.4 Turkish-specific work

- **MAiDE-up includes 1,000 GPT-4-generated Turkish hotel reviews** (verified by me, §6). The paper's ablation: detection performance is **lowest for Turkish and Korean** — GPT-4 produces particularly human-like reviews in Turkish. `[INDEPENDENT]` `[F]`
- **"A Deep Learning Approach to Classify AI-Generated and Human-Written Texts"**, *Applied Sciences* 15(10):5541, May 2025 — an LSTM on a purpose-built Turkish human-vs-ChatGPT corpus, reporting **>97% test accuracy and F1**, with **19 misclassifications out of 698**. `[INDEPENDENT]` `[S]` ([MDPI](https://www.mdpi.com/2076-3417/15/10/5541) — 403'd my fetch; numbers via search summary and the [ResearchGate record](https://www.researchgate.net/publication/391788095)). Single generator, single domain, ~700-sample test set: this is evidence that Turkish detection is *possible in-distribution*, not evidence that it generalizes.
- **There is no Turkish equivalent of MULTITuDE or ALHD.** Turkish appears in no major multilingual MGT benchmark I found. Turkish is a genuine data desert for this problem, with MAiDE-up's 1,000+1,000 review slice being the only clean, fetchable, labelled resource I could confirm.

### 4.5 Language-mechanical hazards (my analysis, not cited)

These are engineering facts about the languages, and they will bite any naive implementation:

- **Turkish:** agglutinative morphology inflates type counts, so type-token ratio and "lexical diversity" thresholds calibrated on English are meaningless. Turkish casing is a classic bug source — `"I".toLowerCase()` and the dotted/dotless `ı`/`i`/`İ`/`I` pair break under locale-naive lowercasing, and a broken fold can itself become a spurious "AI" signal. Turkish sentence length distributions differ from English by construction.
- **Arabic:** diacritics (tashkeel), tatweel/kashida, alef and hamza orthographic variants, and **Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩)** all need normalization before any counting. This repo has already been bitten once by exactly this class of bug — deterministic guards using ASCII `\d` clobbered Arabic-Indic digits. Additionally, the strongest naive Arabic cue — LLMs default to MSA while human web text is heavily dialectal — is simultaneously the strongest *fairness hazard* in the whole design: **a careful MSA writer is not a bot.**
- **Both:** every English lexical cue (§5) is void. "Delve", "underscores", "showcasing" are English tokens. Their Turkish and Arabic analogues have not been measured by anyone I found.

---

## 5. Stylometric tells with empirical support

### 5.1 Vocabulary shift — the best-evidenced tell, at the wrong granularity

**Kobak, González-Márquez, Horvát & Lause, "Delving into LLM-assisted writing in biomedical publications through excess vocabulary", *Science Advances* (2025).** `[INDEPENDENT]` `[F]` ([arXiv 2406.07016](https://arxiv.org/abs/2406.07016) · [HTML I read](https://arxiv.org/html/2406.07016v3) · [Science Advances](https://www.science.org/doi/10.1126/sciadv.adt3813) · [code](https://github.com/berenslab/llm-excess-vocab))

- Corpus: **>15 million** PubMed abstracts, 2010–2024. Method borrowed from excess-mortality analysis: measure word frequency *excess* relative to pre-LLM years, requiring no labelled corpus.
- **≥13.5%** of 2024 abstracts show LLM processing (lower bound). Derived from two independent word sets: rare style words → 13.6%, ten common high-impact words → 13.4%; averaged to 13.5%.
- Ceiling in subcorpora: computational fields ~**20%**; specific country×journal intersections **34–41%**; prestigious journals only ~**7–10%**.
- **454 excess words in 2024** vs **190** in 2021 (the Covid peak); 343 vs 180 unique lemmas.
- **Part-of-speech flip:** pre-LLM excess words were **79.2% nouns**; 2024's are **66% verbs and 14% adjectives**. This is the deepest finding in the paper — the shift is *stylistic*, not topical.
- Frequency ratios for rare style words: **"delves" 28.0×**, **"underscores" 13.8×**, **"showcasing" 10.7×**. Common words measured as frequency gaps: potential 0.052, findings 0.041, crucial 0.037.

**The critical caveat, which is the authors' own framing:** this is a *corpus-level* estimator. It says "≥13.5% of these 15 million abstracts", never "this abstract". A 28× frequency ratio on a word that occurs in <0.02% of documents contributes almost nothing to a single-document decision. **Do not build a per-document classifier out of a per-corpus method.**

### 5.2 Em-dash frequency

Widely believed; thinly measured. The one direct measurement I could fetch is a preprint, [arXiv 2603.27006](https://arxiv.org/html/2603.27006v1) — ~240,000 generated words across 12 models from 5 providers, ~10,000 words per model per condition, plus a human baseline of 8 published essays (57,232 words). `[INDEPENDENT]` `[F]` (not peer-reviewed; single study)

Em-dashes per 1,000 words, unconstrained: GPT-4.1 **10.62**, Claude Opus 4.6 **9.09**, Claude Sonnet 4 **8.29**, DeepSeek V3 **6.95**, GPT-4o Mini **4.16**, GPT-4o **4.12**, Gemini 2.5 Pro **3.53**, GPT-5.4 **1.43**, Gemini 2.5 Flash **1.28**, **Llama 3.1 8B and Llama 3.3 70B: 0.00**.

**Human baseline: 3.23 per 1,000 words — with a range of 0.33 to 17.12 across just eight essays.**

Read the numbers honestly: **the human range fully contains the model range.** Two shipping models are at zero and one human essayist is at 17. Em-dash rate separates *distributions over thousands of documents*; it cannot separate one document, and at chat length (30 words = 0.03 of a "per 1,000 words" unit) it carries essentially no information. Separately, a general human-English em-dash rate of 0.25–0.275% of characters is quoted around the web `[S]`, and models are being actively tuned on this axis (GPT-5.4 at 1.43 vs GPT-4.1 at 10.62), so any threshold decays with each model release.

**And the killer for this project's use case:** `Flowerly/modern-fake-reviews` normalizes smart quotes and em-dashes to ASCII *specifically* so "Unicode is not a spurious tell" — meaning any adversary, and any ordinary copy-paste-through-a-plain-textarea path, erases it for free.

### 5.3 Burstiness and perplexity

Definitionally central to GPTZero's public story: AI text has lower perplexity and lower burstiness (sentence-length/structure variance) than human text. `[VENDOR-adjacent]` `[S]` ([QuillBot explainer](https://quillbot.com/blog/ai-writing-tools/burstiness-and-perplexity/))

Three independent qualifications:
- **Perplexity requires a language model.** A zero-dependency tool cannot compute it. Only the *proxy* — sentence-length variance — is available, and it is the weaker half.
- **The gap closes as models improve.** Larger/newer LLMs produce burstiness scores similar to humans; the deviation shrinks with model capability `[S]`.
- **Humans in formal registers have low burstiness too.** Academic and graded writing is naturally uniform — which is exactly the Liang mechanism (§2.1) restated: low-variance human writing is what gets falsely accused.
- I attempted to extract per-model perplexity/burstiness separations from the Counter Turing Test / AI Detectability Index ([arXiv 2310.05030](https://arxiv.org/pdf/2310.05030)) and **failed** — the PDF would not yield text. **Unverified; flagged for the synthesizer.**

### 5.4 Lexical diversity, readability, structure

From SMLT-MUGC `[INDEPENDENT]` `[F]`, with the corpus-matching caveat from §3.5: machine tweets were markedly easier to read (Flesch **68.86** vs **56.62**) and drew on a 4× smaller vocabulary. From the Arabic AI Fingerprint work `[INDEPENDENT]` `[F]`: distinctive stylometric patterns do exist in Arabic and are strong in the *formal* domain, weakening across domains.

**Generalization to non-English: essentially unestablished.** Flesch Reading Ease is defined on English syllable counts and is not valid for Turkish or Arabic. Type-token ratio is confounded by Turkish agglutination. The excess-vocabulary lists are English. MULTITuDE's finding that statistical zero-shot methods score ~0.47 macro-F1 across 11 languages is the clean empirical statement of this.

### 5.5 The tells that actually work — artifacts, not style (my analysis)

Not in the papers, because they are too easy to be research, but they are the highest-precision signals available to a zero-dependency tool and they are largely language-agnostic:

- Leaked assistant boilerplate ("As an AI language model", "I hope this helps!", "Certainly!", "Here's a draft"), including its Turkish and Arabic equivalents.
- Markdown structure (`**bold**`, `- ` bullets, `###`) arriving in a channel with no markdown rendering — a copy-paste fingerprint, not a style.
- Invisible/zero-width characters (U+200B, U+00AD, U+FEFF) and non-breaking spaces from chat-UI copy.
- Near-duplicate detection across authors: shingled hashes over normalized text. Two "different" reviewers producing 0.9-Jaccard text is decisive evidence of *something*, in any language, at any length.
- Register mismatch that is structural rather than lexical: a 15-word question channel receiving a 400-word four-paragraph essay.

These are **rules with near-zero FPR**, and they are worth more than any stylometric score at the lengths this codebase actually sees.

---

## 6. Public labeled datasets — verified against the HF datasets-server

Everything below was fetched live, unauthenticated, from `https://datasets-server.huggingface.co` on 2026-09-09. `[VERIFIED BY FETCH]` means I got HTTP 200 and read the JSON.

### 6.1 Confirmed working — the nine I would actually use

**1. `Hello-SimpleAI/HC3` — the classic ChatGPT-vs-human QA corpus.** ✅
```
https://datasets-server.huggingface.co/rows?dataset=Hello-SimpleAI/HC3&config=all&split=train&offset=0&length=5
```
License **cc-by-sa-4.0** · languages **en, zh** · 24,322 rows in `all`; 48,644 across all configs (`all`, `finance`, `medicine`, `open_qa`, `reddit_eli5`, …). **No Arabic, no Turkish.**
Row shape — note human and AI answers are **parallel lists on the same row**, which is ideal for matched-pair evaluation:
```json
{"row_idx":0,"row":{
  "id":"0",
  "question":"Why is every book I hear about a \" NY Times # 1 Best Seller \" ? ...",
  "human_answers":["Basically there are many categories of \" Best Seller \" . ..."],
  "chatgpt_answers":["..."],
  "source":"reddit_eli5"}}
```

**2. `yaful/MAGE` — Machine-generated Text Detection in the Wild.** ✅
```
https://datasets-server.huggingface.co/rows?dataset=yaful/MAGE&config=default&split=test&offset=0&length=1
```
License **apache-2.0** · English · **436,606 rows** (train 319,071 / validation 56,792 / test 60,743) · 320 MB parquet.
**Label semantics confirmed in the repo README: `0 = machine-generated, 1 = human-written`** ([source](https://raw.githubusercontent.com/yafuly/MAGE/main/README.md)) — this is inverted relative to most datasets and *will* be gotten wrong by someone.
```json
{"row_idx":0,"row":{
  "text":"Little disclaimer: this deals with US laws and procedures ...",
  "label":1,
  "src":"eli5_human"}}
```

**3. `MichiganNLP/MAiDE-up` — 20k hotel reviews, 10 languages, GPT-4 fakes. THE most relevant dataset for this project.** ✅
```
https://datasets-server.huggingface.co/rows?dataset=MichiganNLP/MAiDE-up&config=default&split=train&offset=0&length=2
```
License **MIT** · languages **en, zh, fr, de, it, ko, ru, es, tr, ro** · **19,985 rows** (10,000 real + ~10,000 GPT-4) · single CSV, 3.5 MB parquet.
`source`: **0 = real human review, 1 = GPT-4 generated**. I verified by filter that **`Review_Language='Turkish' AND source=1` returns exactly 1,000 rows**. Hotel reviews, city- and hotel-attributed, split into `Upside_Review`/`Downside_Review` — i.e. the exact genre and shape of travel-domain text. **No Arabic.**
```json
{"row_idx":18985,"row":{
  "Unnamed: 0":0,
  "Review_Language":"Turkish",
  "City Name":"Ankara",
  "Hotel Name":"The Green Park Ankara",
  "Upside_Review":"The Green Park Ankara otelinin konumu ve hizmeti muhteşem. Personel çok cana yakın ve yardımsever. Odalar geniş, temiz ve konforlu, özellikle yataklar muhteşem.",
  "Downside_Review":"Otelin genelinde Wi-Fi biraz daha hızlı olabilir. Kahvaltı seçenekleri biraz daha çeşitli olabilirdi.",
  "Review_Score":9.0, "Sentiment":"POS",
  "source":1, "Prompt_Language":"English(Chinese)",
  "na_up_review":false, "na_down_review":false}}
```
Filter endpoint also works, which matters for pulling just the Turkish slice without downloading 20k rows:
```
https://datasets-server.huggingface.co/filter?dataset=MichiganNLP%2FMAiDE-up&config=default&split=train&where=%22Review_Language%22%3D%27Turkish%27%20AND%20%22source%22%3D1&offset=0&length=100
```

**4. `KFUPM-JRCAI/arabic-generated-abstracts` — Arabic human vs ALLaM/Jais/Llama/OpenAI.** ✅
```
https://datasets-server.huggingface.co/rows?dataset=KFUPM-JRCAI/arabic-generated-abstracts&config=default&split=from_title&offset=0&length=1
```
**License: none declared** (check before redistribution) · Arabic · **8,388 rows** across three splits that encode the *generation strategy*: `from_title` (2,963), `from_title_and_content` (2,574), `by_polishing` (2,851). The `by_polishing` split is directly the §4.3 polishing threat model.
Row shape is **five parallel columns — one human, four machine — on the same row**, so matched pairs come for free:
```json
{"row_idx":0,"row":{
  "original_abstract":"كثيرا ما ارتبطت المصادر التاريخية في الأندلس ...",
  "allam_generated_abstract":"...",
  "jais_generated_abstract":"...",
  "llama_generated_abstract":"...",
  "openai_generated_abstract":"..."}}
```

**5. `KFUPM-JRCAI/arabic-generated-social-media-posts` — the Arabic SHORT-form counterpart.** ✅
```
https://datasets-server.huggingface.co/rows?dataset=KFUPM-JRCAI/arabic-generated-social-media-posts&config=default&split=train&offset=0&length=1
```
Arabic · **3,318 rows** · same five-parallel-column shape (`original_post`, `allam_generated_post`, `jais_generated_post`, `llama_generated_post`, `openai_generated_post`). **This is the only Arabic short-text human-vs-LLM resource I confirmed**, and it is the right corpus for calibrating the abstain threshold in Arabic.

**6. `theArijitDas/Fake-Reviews-Dataset` — the classic Salminen fake-review corpus, cleaned.** ✅
```
https://datasets-server.huggingface.co/rows?dataset=theArijitDas/Fake-Reviews-Dataset&config=default&split=train&offset=0&length=1
```
License **apache-2.0** · English · **40,526 rows**, verified balance **20,232 label=0 / 20,294 label=1**. Card states: **`label=0` original (human), `label=1` computer-generated.**
⚠️ **The machine half is GPT-2-era.** Do not treat it as "modern LLM".
```json
{"row_idx":0,"row":{
  "category":"Home_and_Kitchen","rating":5.0,
  "text":"Love this!  Well made, sturdy, and very comfortable.  I love it!Very pretty",
  "label":1}}
```
Note the length — 13 words. This corpus is *natively* in the short-text regime and is therefore the honest place to measure the short-text ceiling.

**7. `Flowerly/modern-fake-reviews` — the same task with a CURRENT generator.** ✅
```
https://datasets-server.huggingface.co/rows?dataset=Flowerly/modern-fake-reviews&config=default&split=train&offset=0&length=1
```
License **cc-by-4.0** · English · **40,424 rows** (train 32,339 / validation 2,425 / test 5,660). Labels are strings: **`OR` = genuine human Amazon-style review, `CG` = LLM-generated** (card names deepseek-v4-pro), each fake grounded on a paired real review with matched category/rating/length.
Two facts from its card that are worth more than the data: (a) a detector trained on the GPT-2-era CG half flags only **~4%** of modern-LLM reviews; (b) both halves are **ASCII-normalized** (smart quotes and em-dashes folded) "so Unicode is not a spurious tell."
```json
{"row_idx":0,"row":{
  "category":"Pet_Supplies_5","rating":3.0,"label":"CG",
  "text_":"Maybe okay for a calm small dog, but not for my stubborn beagle."}}
```
(Field name is `text_`, with the trailing underscore.)

**8. `andythetechnerd03/AI-human-text`.** ✅ apache-2.0 · English · **487,235 rows** (train 462,873 / test 24,362). Fields: `text`, `generated` (int8).
```
https://datasets-server.huggingface.co/rows?dataset=andythetechnerd03/AI-human-text&config=default&split=train&offset=0&length=1
```

**9. `artem9k/ai-text-detection-pile`.** ✅ MIT · **1,392,522 rows**, ~2 GB parquet. Fields: `source` (string — `"human"` or a model name), `id`, `text`.
```
https://datasets-server.huggingface.co/rows?dataset=artem9k/ai-text-detection-pile&config=default&split=train&offset=0&length=1
```

### 6.2 Verified FAILURES — do not report these as working

| Dataset | Endpoint result |
|---|---|
| `kinit/multitude` | `splits` → *"The dataset does not exist, or is not accessible without authentication"*. **MULTITuDE is not fetchable at that HF path.** |
| `kanwal-mehreen18/Multilingual_Machine_Generated_Text_Detection` | `splits` OK, `rows` → `DatasetGenerationCastError` (per-language CSVs have mismatched column names). Unusable through the rows API. |
| `qandos0/AFRD_Arabic-Fake-Reviews-Detection` | `splits` → *"No (supported) data files found"*. |
| `ThanaritKanjanametawatAU/Machine-Generated-Text-Detection-Dataset` | `splits` → `EmptyDatasetError`. |
| `Fath-Karaman/turkish-deception-detection-hotel-reviews` | `splits` OK, `rows` → pandas `ParserError` ("Expected 1 fields in line 29, saw 4"). Broken CSV. |
| `IbrahimAmin/egyptian-arabic-fake-reviews` | `rows` **works** (MIT, ar/arz/en, train+test) — **but the labels are spam/sentiment/behavioural heuristics (`spam_hit_score`, `sentiment_label`, `entropy1/2`, `rating_deviation`), NOT human-vs-LLM.** Wrong task. Listed here so nobody re-discovers it and mislabels it. |
| `ALHD` (400K Arabic, incl. reviews) | Not on HF under any name I could find; the paper points at [Zenodo record 17249602](https://zenodo.org/records/17249602). **I did not fetch Zenodo — unverified.** |
| Turkish human-vs-LLM detection corpus | **None found on HF** beyond MAiDE-up's Turkish slice. Searches on `turkish detection`, `turkce`, `turkish chatgpt`, and `filter=language:tr&search=generated` returned nothing on-task. |

### 6.3 Coverage summary against this project's scope

| Need | Covered? | By what |
|---|---|---|
| English prose, human vs LLM | **Yes, abundantly** | MAGE, HC3, ai-text-detection-pile, AI-human-text |
| English **reviews**, human vs GPT-2-era | Yes | theArijitDas/Fake-Reviews-Dataset |
| English **reviews**, human vs modern LLM | Yes | Flowerly/modern-fake-reviews |
| **Turkish** reviews, human vs GPT-4 | **Yes — 1,000 + 1,000, and that is all there is** | MAiDE-up (`Review_Language='Turkish'`) |
| **Arabic** long prose, human vs 4 LLMs | Yes | KFUPM-JRCAI/arabic-generated-abstracts |
| **Arabic** short-form, human vs 4 LLMs | Yes, 3,318 rows | KFUPM-JRCAI/arabic-generated-social-media-posts |
| **Arabic reviews** specifically | **No fetchable source** | ALHD has them; Zenodo only, unverified |
| **Turkish** non-review prose | **No** | — |
| **Chat-length (<30 words) anything, any language** | **No labelled corpus exists that I could find** | — |

That last row is the most important line in this section.

---

## 7. What a zero-dependency heuristic detector can realistically achieve

Framing: no npm packages, no model logits, no API. That restricts us to surface statistics over the raw string — punctuation and character-class rates, sentence and token length distributions, function-word and n-gram frequencies, type-token ratio, structural markers, and lookup lists. Everything in §1.2 is off the table because all of it needs a language model. **We are strictly weaker than GLTR, which scored 62.6% at 5% FPR on RAID.** That is our ceiling, not our target.

### (a) English prose > 150 words

**Expected envelope: ROC-AUC 0.75–0.88 in-distribution. At a genuinely usable threshold (FPR ≤ 5%), expect TPR 40–65%. Out-of-distribution or against an adversary who edits, expect it to fall toward chance.**

Reasoning and citations:
- Upper anchor: GLTR — which has model probabilities we do not — hits **62.6%** TPR at 5% FPR on RAID's out-of-distribution mix ([RAID](https://aclanthology.org/2024.acl-long.674/)). Fine-tuned RoBERTa-GPT2 hits **59.1%**. A logit-free surface-feature scorer cannot beat these out of distribution.
- Lower anchor: on *matched in-distribution* corpora, classical feature classifiers reach very high F1 (SMLT-MUGC: 97.35% on abstracts) — but §3.5 shows that number is inflated by corpus mismatch, and MULTITuDE's statistical detectors at 0.4708 macro-F1 show what happens when the distribution moves.
- Every individual tell is weak at document scale: em-dash human baseline 3.23/1,000 words with range 0.33–17.12 fully overlapping the model range ([2603.27006](https://arxiv.org/html/2603.27006v1)); Kobak's excess-vocabulary method is explicitly a **corpus-level lower-bound estimator**, not a document classifier ([2406.07016](https://arxiv.org/html/2406.07016v3)).
- The fairness constraint is binding: at any threshold aggressive enough to catch 60% of AI text, formulaic and non-native human prose is being caught with it. Liang: 61.22% FPR on TOEFL essays at detector defaults; the 2026 follow-up still measures 23.1% vs 0% on that set.

**What actually works at this length, and works well:** the artifact rules in §5.5. Leaked assistant boilerplate and chat-UI residue are near-100% precision. They just have low recall — and low recall at perfect precision is a *usable* product; medium recall at 10% FPR is not.

### (b) Chat messages < 30 words

**Expected envelope: AUC 0.55–0.65 per message. At FPR ≤ 2%, expect single-digit TPR. There is no honest per-message verdict here and the tool must abstain.**

Reasoning and citations:
- 30 words ≈ 150–200 characters — **below GPTZero's own 250-character floor** and 10× below Turnitin's 300-word floor `[VENDOR]`.
- Booth 2025 measured commercial SOTA losing accuracy **under 50 words** `[INDEPENDENT]`.
- 2406.15583 puts the saturation points at **~120 words** (GLTR/DetectGPT) and **~200 words** (GPT-4 output), and found sentence-level detection at **chance (50%)** unless sentence-level examples were in training `[INDEPENDENT]`.
- OpenAI's own detector lost ~15% accuracy at 500 characters `[SELF-REPORTED, ADVERSE]`.
- The apparent counter-evidence (99% F1 on tweets, SMLT-MUGC) is explained by a 4× vocabulary gap between the two halves of that corpus — a construction artifact, not a detectable signal (§3.5).

**The one lever that works: aggregate.** 2406.15583 found concatenating **10 tweets** moved accuracy **80% → ~100%**. So the unit of decision must be the **author or session**, never the message. Ten messages from one WhatsApp number is a legitimate 150–300-word sample; one message is not.

**The second lever, better than detection: near-duplicate matching.** Shingled-hash overlap across authors is language-agnostic, length-tolerant, and near-zero-FPR. For the fake-review use case it is strictly the better instrument.

### (c) Turkish / Arabic prose

**Expected envelope: AUC 0.65–0.80 *only with a language-specific calibration corpus*. With no such corpus, the honest output is "insufficient evidence" — a score is worse than nothing, because it will be wrong in a way that lands on real people.**

Reasoning and citations:
- MULTITuDE: zero-shot statistical detectors — the family we are in — score **~0.4708 macro-F1** across 11 languages, i.e. they collapse. English-trained → Arabic: **0.5448 F1** vs **0.8537** multilingually trained. English → non-English overall: **−25.7%** ([ar5iv](https://ar5iv.labs.arxiv.org/html/2310.13606)).
- Arabic light-polishing: Originality.AI **92% → 12%** at 10% polish, with an **8% baseline FPR on unpolished human Arabic** ([2511.16690](https://arxiv.org/html/2511.16690v1)). A commercial detector with an Arabic-competent model is already at 8% FPR; a heuristic will be worse.
- Turkish is the hardest generator-side case measured: MAiDE-up found detection performance **lowest for Turkish and Korean** — GPT-4's Turkish reads as human ([2404.12938](https://arxiv.org/html/2404.12938v1)).
- The only Turkish-specific published success (Applied Sciences 15:5541, >97% F1) is a **single-generator, single-domain, ~700-sample** LSTM result — in-distribution proof, not generalization proof.
- Direction-of-bias is unknown per language. The Czech result (non-native entropy **higher**, 3.48 vs 3.19) proves the English mechanism does not port ([2602.05769](https://arxiv.org/html/2602.05769)). Nobody has measured Turkish or Arabic on this axis.
- Language-mechanical hazards (§4.5) mean an unnormalized implementation will measure its own normalization bugs. This repo already has a scar from exactly this: ASCII `\d` guards clobbering Arabic-Indic digits.

**Available calibration data (§6): Arabic — 8,388 abstracts + 3,318 social posts, four generators, matched pairs. Turkish — 1,000 GPT-4 hotel reviews + 1,000 real ones. That is the entire budget.** 1,000 Turkish AI reviews is enough to *estimate* an FPR envelope; it is not enough to fit anything with more than a handful of parameters without overfitting.

### (d) Design consequences that follow from the evidence

1. **Three-band output, never binary.** `likely-AI` / `insufficient evidence` / `likely-human`, with the middle band deliberately wide. Every study in §2 is a study of what happens when a binary verdict is issued on a marginal score.
2. **Hard length gate.** Below ~50 words: refuse to score. This is not conservatism, it is what §3 measures.
3. **Score authors/sessions, not messages.** The 80% → 100% aggregation result is the only short-text lever with evidence behind it.
4. **Separate the rules from the score.** Artifact rules (§5.5) are high-precision and should be reported as *evidence found*, with the literal matched string. The stylometric score should be reported as a weak prior. Do not mix them into one number.
5. **Normalize before counting, per language, or do not count.** Unicode NFC, Arabic-Indic → ASCII digits, tashkeel/tatweel stripping, alef/hamza folding, locale-aware Turkish casing. Then note that ASCII-normalizing *destroys* the em-dash tell (§5.2) — which is the correct trade, because the tell was worthless anyway.
6. **Never apply an English lexical list to Turkish or Arabic text.** Language-gate every lexical feature.
7. **Calibrate FPR on the deployed population, not on a benchmark.** Booth's <1% and Liang's 61.22% are the same detectors on different people.
8. **Assume the adversary.** Homoglyph substitution alone cost Originality.ai 75.7 pp. Any published thresholds become a target.
9. **Near-duplicate detection is the highest-value thing to build first.** It is language-agnostic, length-tolerant, adversary-resistant in the ways that matter for reviews, and needs no detection theory at all.

---

## 8. Provenance ledger — what I verified and what I did not

**Fetched and read directly `[F]`:** Liang et al. (ar5iv full text), Binoculars abstract, RAID (arXiv HTML), MULTITuDE (ar5iv full text), SemEval-2024 Task 8 (arXiv HTML), Kobak et al. (arXiv HTML v3), the em-dash preprint (arXiv HTML), the Arabic polishing paper (arXiv HTML), APT-Eval abstract, MAiDE-up (arXiv HTML), the Czech bias follow-up (arXiv HTML), Pangram technical report (arXiv HTML v3), SynthID-Text (PMC full text), Sadasivan abstract, the accuracy-bias PMC paper, GPTZero's benchmarking post, Chicago Booth Review, SMLT-MUGC (arXiv HTML), factors-influencing-detectability (arXiv HTML), MAGE README, plus **all nine dataset endpoints in §6.1 and all eight failures in §6.2**.

**Search-summary only `[S]` — the numbers are probably right, the wording is not verified:** OpenAI classifier 26%/9% and its retirement date; Copyleaks' vendor figures (I never reached Copyleaks' own page); Originality.ai's Lite/Turbo figures; Turnitin's 98%/<1%/300-word figures; the OpenAI GPT-2 detector's 95% and 500-character figures; GLTR's 54%→72%; Fast-DetectGPT's 75%; GPT-Sentinel's 54.98%; the Turkish MDPI paper's >97% (MDPI returned HTTP 403); AIRABIC's 1,000 examples; ALHD's 400K; the COLING-2025 Arabic 98.4% F1.

**Attempted and failed:** Counter Turing Test / AI Detectability Index (arXiv 2310.05030) — PDF unparseable, so **no burstiness/perplexity separation numbers are in this brief**. MULTITuDE via ACL Anthology PDF (recovered via ar5iv). Hausa low-resource transfer paper (arXiv 2503.13101) — PDF unparseable. MDPI Turkish paper — 403.

**Environment note on dating.** Several sources surfaced by search carry arXiv identifiers in the 2601–2606 range (i.e. 2026). I fetched and read 2602.05769, 2603.27006 and 2511.16690 directly and they returned coherent, internally consistent content, so I have cited them — but they are recent preprints, not peer-reviewed literature, and the em-dash study in particular rests on an 8-essay human baseline. Weight them accordingly.

**Open questions for the synthesizer, listed in §"unresolved" of my return.**
