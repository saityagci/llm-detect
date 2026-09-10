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
