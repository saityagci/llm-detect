# `synthetic-split/` — a fake corpus whose only job is to be broken

Everything in this directory is **authored by `generate.mjs`**. There is no corpus row here, no real
human writing and no real LLM output: the two classes are separated by templates chosen to make a
logistic fit converge at all. **No number computed on this data means anything about the detector.**
`eval/selftest-eval.mjs` asserts exit codes and report structure over it and never asserts a rate.

It exists because `run-eval.mjs` refuses, in code, to publish numbers measured on a leaked split —
exit 5 on a straddling non-`writer::` group or a duplicate string on two sides, exit 4 on the
honesty guard, exit 6 on a fitted-weights file the shipped loader could not read — and every one of
those branches was previously verified by reading it. Staging a real failure would have meant
copying private chat messages into a scratch directory. This corpus can be corrupted instead.

| file | what it is |
|---|---|
| `generate.mjs` | The generator. One seeded `mulberry32`, no clock, no platform RNG: re-running rewrites byte-identical files. It refuses to write a fixture that is already leaky — duplicate keys, straddling duplicates, both-label collisions or a straddling non-`writer::` group all abort it. |
| `splits.jsonl` | 624 rows in the exact shape `eval/data/splits.jsonl` has. Every text is unique under `make-splits`' own `normKey`, which is what makes a planted duplicate meaningful. |
| `splits-report.json` | The shape `make-splits.mjs` writes, so `run-eval` §1 can print the pair table, the contamination bands and the recorded-split-reuse line. |
| `must-not-fire.jsonl` | 24 tiny rows so `gate-fixtures.mjs` will run at all (it exits 2 without this file). |
| `verify-round-1.allowed.jsonl` | Probe rows whose labels quote the three assistant-frame phrases the CAL append guard exempts by name. |
| `verify-round-1.refused.jsonl` | The same, plus a fourth label carrying the watched word in different wording. The append guard must refuse it; that is the check that keeps the exemption from widening. |

What the fixture is shaped to produce, and why:

- **one fitted cell** (`en:prose`) — `buildModel()` needs ≥ 30 non-gated fitting-side rows with ≥ 10
  humans, so the human templates carry ordinary capitalisation and terminal punctuation or they all
  fail gate G4 and no model exists to validate;
- **three not-fitted cells** — the `{status:"not fitted"}` shape the loader falls back from;
- **an all-gated `<20` bucket with ≥ 100 rows per label** — `NO COVERAGE` is only reachable past the
  `INSUFFICIENT` test, which runs first and needs both sides ≥ 100;
- **three writers and three personas** — leave-one-writer-out has folds, and `persona::` is the group
  kind the straddle assertion protects;
- **a `public:fake-reviews-gpt2era` source on all three sides** — negative control (a) needs a
  held-out subset *and* a fit/val composition to disclose beside it (HEAD-RULINGS R36(a));
- **a source with `pair` keys** — so §1's matched-pair table has an ACTIVE row.

Regenerate with `node eval/fixtures/synthetic-split/generate.mjs`.
