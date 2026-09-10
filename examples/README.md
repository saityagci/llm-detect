# `examples/` — calling the detector from a backend

One runnable example, and the rules that matter more than the code.

```bash
node examples/platform-essay.mjs <essay.txt> [--history prior-submissions.jsonl]
```

It imports `detect()` from `../stylometry.mjs`, prints the platform label, the verdict it came from,
the evidence spans and the caveat, and exits 0. Zero dependencies, no child process, no network.

## The one rule

**The label is a review flag. It is never a grade input, never proof about a person, and never a
yes/no.** `summary.humanReviewRequired` is `true` on every report this tool produces, and that is not
a formality: on 150–499-token student essays the tool's own measured false-flag rate is 0.4% and its
recall is 28.2%, so **roughly seven in ten AI-written essays are not flagged at all**; on general
English prose the false-flag rate is 2.5% and at a 5% true prevalence a flag is right about **two
times in five**. Both are eval-side numbers at the fitted threshold, not rates about the four labels.
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

report.summary.label;                 // one of four values
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

`--history` adds `style_shift_vs_history` (with the features named) or a consistency note. It can
move a lean **toward** `uncertain` and never away from it: a style shift is a reason to look, never a
reason to accuse, and a student whose writing improves across a term will trip it honestly. Treat it
as one signal among several, which is exactly how the scorer treats it.

## What this does not do

It does not rewrite, humanize or "clean" a text, and it will not. It does not tell you a student
cheated. It does not produce a percentage. And it has not yet been measured on student essays at all
— the English numbers come from reviews and QA answers; see the essay-genre row in the evaluation
report once it exists, and until then treat the essay case as unmeasured.
