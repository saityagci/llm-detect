# `examples/samples/` — the texts quoted in the README, and how to reproduce them

**Every text here is Claude-authored.** None is a real student's work. They exist so that a claim in
`README.md` § "What a report looks like" can be checked rather than believed — a claim about a draft
that is not committed is not a claim (HEAD-RULINGS R42 addendum).

Verdicts below reproduce on the shipped build under **all four** flag sets tried: `--preset essay`,
`--context prose --lang en --genre essay`, `--context prose`, and `--context auto`. The flags do not
move any of them, which is worth knowing on its own: on 300-word English prose the essay preset
changes the routing, not the answer.

| file | command | verdict | `summary.label` | score |
|---|---|---|---|---|
| `student-essay-v1-tidy.txt` | `node stylometry.mjs --file examples/samples/student-essay-v1-tidy.txt --preset essay --allow-uncalibrated --json` | `uncertain` | `no_reliable_indicators` | 0.5330 |
| `student-essay-v2.txt` | `node stylometry.mjs --file examples/samples/student-essay-v2.txt --preset essay --allow-uncalibrated --json` | `insufficient_text` | `too_short_or_no_signal` | — |
| `student-essay-v3.txt` | `node stylometry.mjs --file examples/samples/student-essay-v3.txt --preset essay --allow-uncalibrated --json` | `leaning_human` | `no_reliable_indicators` | 0.1248 |
| `human-style-essay.txt` | `node stylometry.mjs --file examples/samples/human-style-essay.txt --preset essay --allow-uncalibrated --json` | `leaning_human` | `no_reliable_indicators` | 0.1248 |
| `assistant-essay.txt` | `node stylometry.mjs --file examples/samples/assistant-essay.txt --preset essay --allow-uncalibrated --json` | `likely_llm` | `fingerprint_found` | 0.7270 |

`human-style-essay.txt` is byte-identical to `student-essay-v3.txt`; it is the name the README's
first sample report was produced under, kept so the report and its input can be matched up.

## The three drafts are a ladder, and they are two separate findings

All three argue the same case about the printing press, in a school-student voice.

- **v1 is the careful-student case, and it is the one HEAD-RULINGS R43 was written for.** It used to
  come out `leaning_llm` / `ai_style_indicators`. The score has not moved (0.5330) and neither has
  the human side; what changed is that a non-proxy signal now has to be *material* — contribution
  ≥ 0.10 — before it can satisfy R24's "two non-proxy signals from two groups". Here the LLM channel
  is carried by the register proxy `terminal_punct_ratio` (+0.600 of +0.921), `sentence_len_mode_mass`
  contributes +0.291, and the second non-proxy signal `parallel_openers` contributes **+0.030** — a
  sliver that was letting a keyboard habit convict. The report now says so in full:

  > `register_only_evidence` (HEAD-RULINGS R24): the LLM-direction evidence is register proxies —
  > terminal_punct_ratio — plus 1 non-proxy signal(s) from 1 group(s). parallel_openers (+0.030) is
  > below the 0.10 materiality floor (HEAD-RULINGS R43) and cannot carry the requirement. A formal,
  > careful or non-native HUMAN produces these for free, so they may rank a queue but they may not
  > carry a verdict. leaning_llm needs >=2 non-proxy LLM signals from >=2 groups, or a Tier-0 rule.

  `uncertain` / **`no_reliable_indicators`** is the honest answer for a text whose only material LLM
  evidence is that its lines end with full stops.
- **v1 → v2 is a register change.** Same argument, same length, rewritten messier: shorter
  fragments, a direct address to the reader, one exclamation, an unfinished last line. The verdict
  moves from **`no_reliable_indicators` to `too_short_or_no_signal`** — from "no indicators" to
  *nothing to read at all*. Neither draft has an assistant phrase anywhere in it, and neither is a
  flag; before R43 the first of them was.
- **v2 → v3 is punctuation only.** v3 is v2 with the apostrophes dropped (`didn't` → `didnt`,
  `that's` → `thats`, five words in total, nothing else changed). The verdict moves from
  **`too_short_or_no_signal` to `no_reliable_indicators`**, human channel 0.093 → 0.416, carried
  almost entirely by `contraction_apostrophe_drop` — whose own note in the report calls it "exactly
  what a humanizer tool injects, the cheapest fake there is".

So the apostrophe delta is between **no signal and human markers**, not between a flag and no flag.
And after R43 there is no flag anywhere in this ladder: three drafts of a school essay, none of them
machine-written, none of them flagged. Two earlier README drafts got this wrong in opposite
directions — one said punctuation moved a flag, one said a tidy register drew one that the shipped
build no longer draws. The table above is the build; the prose follows it.

## The history sample

`prior-submissions.jsonl` is the three student drafts as one author's prior work, in the shape
`--history` reads (`{"id","text"}` per line, `id` standing in for a submission date).

```bash
# the student's own next essay, against their own history
node examples/platform-essay.mjs examples/samples/student-essay-v3.txt \
  --history examples/samples/prior-submissions.jsonl
#   -> note: consistent_with_history — within 2 SD on 10 compared features

# a machine-written essay submitted under the same student
node examples/platform-essay.mjs examples/samples/assistant-essay.txt \
  --history examples/samples/prior-submissions.jsonl
#   -> warning: style_shift_vs_history — 5 features beyond 2 SD
```

The second one is the case the platform cares about, and note what it is *not*: the `fingerprint_found`
label there comes from the leaked drafting frame, not from the style shift. The shift is a reason for
a person to look. A student who improves across a term shifts exactly the same way.

## The stored profile

`prior-profile.json` is the same three drafts compiled once into the reusable profile a platform
stores beside the student (HEAD-RULINGS R45). It was built with exactly this command:

```bash
node stylometry.mjs --build-history-profile examples/samples/prior-submissions.jsonl \
  --preset essay --allow-uncalibrated > examples/samples/prior-profile.json
```

(`--allow-uncalibrated` is required even though nothing is scored: the shipped weights are priors and
the CLI refuses to load them without it.) The committed copy has its floats **rounded to six
decimals** — a raw float prints a 15-digit run and trips the phone-shaped-digit acceptance grep on a
tracked file, the same reason `weights.fitted.json` rounds (HEAD-RULINGS R26). The rounding does not
change the result: the equality check below is run against the committed, rounded file. The profile
is
`{version: 1, cell: "en:prose", weightsId: "prior-2026-09-09", minTokensPerDoc: 150, priorDocs: 3,
inputRows: 3, skippedRows: [], features: {…10 features, mean and sd…}}` — pure JSON, no text.

**The two history paths are byte-identical.** Verified on the shipped build:

```bash
node stylometry.mjs --file examples/samples/student-essay-v3.txt --preset essay   --allow-uncalibrated --json --history examples/samples/prior-submissions.jsonl
node stylometry.mjs --file examples/samples/student-essay-v3.txt --preset essay   --allow-uncalibrated --json --history-profile examples/samples/prior-profile.json
```

Both give `leaning_human` / `no_reliable_indicators`, score 0.091305, the note
`consistent_with_history: … within 2 SD … on 10 compared feature(s)`, and the **same bytes** — the
whole report, not just the label. The same equality holds through
`examples/platform-essay.mjs --history` versus `--history-profile`.

## The class batch

`class-batch.jsonl` is four submissions from three students, built to exercise every history state
in one file:

| row | student | input | what it exercises |
|---|---|---|---|
| `sub-1041` | `s-77` | `student-essay-v3.txt` | a valid stored profile → `consistent_with_history`; **and** the near-duplicate pair below |
| `sub-1042` | `s-81` | `assistant-essay.txt` | the same profile → `style_shift_vs_history` on 5 features |
| `sub-1043` | `s-90` | `student-essay-v1-tidy.txt` | none — a first submission |
| `sub-1044` | `s-77` | `student-essay-v2.txt` | a profile with a **wrong `weightsId`** → `history_profile_mismatch` |
| `sub-1045` | `s-63` | the same bytes as `sub-1041` | a different student handing in the same essay → `near_duplicate` |

```bash
node examples/platform-class-batch.mjs examples/samples/class-batch.jsonl
```

```
sub-1041      s-77      not_independently_authored  leaning_llm       consistent with 3 prior submission(s)
                        matched: near_duplicate: duplicate of sub-1045 at Jaccard 1.000
                        templated_or_copied: duplicate of sub-1045 at Jaccard 1.000
                          -> not independently authored. NOT evidence of LLM authorship (R3).
sub-1042      s-81      fingerprint_found           likely_llm        style shift on 5 feature(s) — a reason to look
                        matched: assistant_frame_leak: "Here's a polished version"
sub-1043      s-90      no_reliable_indicators      uncertain         no history supplied
sub-1044      s-77      too_short_or_no_signal      insufficient_text PROFILE STALE — no comparison made
sub-1045      s-63      not_independently_authored  leaning_llm       no history supplied
                        matched: near_duplicate: duplicate of sub-1041 at Jaccard 1.000
                        templated_or_copied: duplicate of sub-1041 at Jaccard 1.000
                          -> not independently authored. NOT evidence of LLM authorship (R3).

fingerprint_found: 1  ·  no_reliable_indicators: 1  ·  not_independently_authored: 2  ·  too_short_or_no_signal: 1
5 submission(s) in one pass, indexed against 5 document(s). Every row needs a human before anything happens to a student.
```

**The near-duplicate pair is the point of `sub-1045`.** It is `sub-1041`'s essay byte-for-byte under a
different student id, and the rule finds it because the script indexes the class against itself
(HEAD-RULINGS R46(c)); `near_duplicate` never fires within one sender, so a student's own resubmission
is not a hit. Both rows carry the fifth platform label, **`not_independently_authored`** (R47), which
exists precisely so a copy is not reported as an AI finding: the text was not independently authored —
a copy, a template, a shared source — and that is **never** evidence of LLM authorship (R3). It does
not say which student wrote it, or that either did.

**The label these two rows carry did not exist when this sample was first committed.** They were
`ai_style_indicators` — `near_duplicate` alone drives the verdict to `leaning_llm` (R3) and R42(a)
mapped that to the AI-style label, so a copied essay was being reported as an AI-styled one. R47 added
the fifth value to separate the two findings. The underlying verdict is still `leaning_llm`; what
changed is what a platform is told.

**And note what adding `sub-1045` did to `sub-1041`:** its label moved without its text changing. The
essay is the same bytes it always was; the class around it acquired a duplicate. A label is true only
relative to the corpus it was computed against — store the corpus id beside the label, or recompute
the class when it changes. The core says so in the caveat it attaches to this label.

The stale-profile row is the other one worth staring at: a stale profile produces **no comparison**, not a wrong
one, and the platform is told so on stderr. That is the failure mode a platform would otherwise never
notice. (`sub-1044`'s profile is `prior-profile.json` with `weightsId` changed to `fitted-deadbeef`;
its embedded profiles are rounded to six decimals for the same reason as above.)
