# `examples/` — calling the detector from a backend

Two runnable examples, and the rules that matter more than the code.

```bash
# one submission
node examples/platform-essay.mjs <essay.txt> [--history prior.jsonl | --history-profile profile.json]

# a whole class in one pass, each row carrying its own student's profile
node examples/platform-class-batch.mjs <class.jsonl>
node examples/platform-class-batch.mjs --build-profile <prior.jsonl> [--out profile.json]
```

The first imports `detect()`, prints the platform label, the verdict it came from, the evidence spans
and the caveat. The second imports `detectBatch()` and `buildHistoryProfile()` and prints one label
line per submission. Both are zero-dependency, no child process, no network, and exit 0.
Committed inputs for both are in [`samples/`](samples/), with the exact command per file.

## The one rule

**The label is a review flag. It is never a grade input, never proof about a person, and never a
yes/no.** There are five values; `not_independently_authored` is a **copy** finding, not an AI one
(HEAD-RULINGS R47), and a label is true only relative to the corpus it was computed against — adding
a late submission to a class can change an earlier one's label, so store the corpus id beside the
label or recompute. `summary.humanReviewRequired` is `true` on every report this tool produces, and that is not
a formality. **What the shipped CLI actually does** on 650 held-out student essays: it flags
**1.2%** of the human ones and catches **15.7%** of the machine ones — five machine essays in six
come back unflagged, and half of them are refused a judgement entirely. (The eval report also carries
*fitted-model* figures — 0.4% false-flag at 25.0% recall on essays — but those are a different
instrument at a threshold the shipped CLI cannot reach, and they are never rates about these labels.)
Read
`README.md` § "Using this in a school platform" before wiring any of this to something a student
sees. If your UI turns four labels into a number, you have built a different product from this one.

## Calling it from Node

```js
import { detect, detectBatch, aggregate } from './stylometry.mjs';

// one submission. The essay preset (HEAD-RULINGS R42(c)) is these three options.
const report = detect(essayText, {
  shape: 'prose', genre: 'essay', lang: 'en',
  allowUncalibrated: true,     // the shipped weights are priors — see README "Status: uncalibrated"
  explain: true,               // populates evidenceSpans[]
  now: Date.now(),             // enables the weights-expiry check; omit it and detect() stays pure
});

report.summary.label;                 // one of five values (R47)
report.summary.humanReviewRequired;   // always true
report.summary.caveat;                // the base-rate sentence — ship it with the label
report.evidenceSpans;                 // [{start, end, text, source, name, direction}]
```

`detect()` is pure: no clock unless you pass one, no filesystem, no network, no randomness. The same
input gives a byte-identical report, which is what makes a stored label auditable months later.

## A whole class at once

```js
const reports = detectBatch(rows, opts);   // rows: [{id, text}, …]; input order preserved
```

One pass, one process. Judge nothing the tool floored: an `insufficient_text` row has no verdict and
your UI should show the gate reason, not a blank.

## Per student, across submissions — the strongest lever you have

The README's own three-humans caveat says it: *calibrate per sender against that sender's own
history, and abstain until there is history.* Two ways to use it, and they answer different
questions:

```js
// (1) "is this submission unlike the rest of this student's work?"
detect(newEssay, { ...opts, history: priorSubmissions });   // needs >= 2 priors of >= 150 tokens

// (2) "what does this student's whole body of work look like?"
aggregate(allSubmissionsByThisStudent, opts);               // >= 3 documents of >= 150 tokens
```

**In production use a stored profile, not (1) directly.** `history` re-scores every prior on every
call. `buildHistoryProfile()` does that work once and returns plain JSON you keep beside the student
(HEAD-RULINGS R45):

```js
import { detect, detectBatch, buildHistoryProfile } from './stylometry.mjs';

const historyProfile = buildHistoryProfile(priorTexts, { preset: 'essay' });  // store this

detect(text, { preset: 'essay', historyProfile });          // one submission

detectBatch([                                              // a class in one pass
  { id: 'sub-1041', text: essayA, historyProfile: profileFor77 },
  { id: 'sub-1042', text: essayB, history: ['…a prior essay…'] },
  { id: 'sub-1043', text: essayC },
], { preset: 'essay' });
```

A row's own `historyProfile` (or `history`) wins over anything passed for the batch. Rows name their
author in **`sender`** (`student` is accepted as an alias, HEAD-RULINGS R51(b)) — `--jsonl`,
`--aggregate` and `--corpus` all read that field, and `near_duplicate`'s different-sender guard is
inoperative without it.

Two things history does **not** do (R50(a)): it detects a **change of hand, not machine authorship**
— a student who has always used AI reads consistent — and it never manufactures a verdict on a text
the tool declined to score, where the comparison is reported with `history_not_applied_below_floor`
and the verdict stands. The two paths
give **byte-identical reports** — the profile is a cache, not a different measurement.

**A profile is valid only for the cell and weights id it was built in.** On a mismatch the core warns
`history_profile_mismatch` and makes **no comparison at all** rather than a silently wrong one:
rebuild the profile when you see it. `history: []` warns `history_insufficient`; omitting history
emits no history block, which is the right answer for a first submission.

`--history` adds `style_shift_vs_history` (with the features named) or a consistency note. It can
move a lean **toward** `uncertain` and never away from it: a style shift is a reason to look, never a
reason to accuse, and a student whose writing improves across a term will trip it honestly. Treat it
as one signal among several, which is exactly how the scorer treats it.

## What this does not do

It does not rewrite, humanize or "clean" a text, and it will not. It does not tell you a student
cheated. It does not produce a percentage. And it has not yet been measured on student essays at all
— the English numbers come from reviews and QA answers; see the essay-genre row in the evaluation
report once it exists, and until then treat the essay case as unmeasured.
