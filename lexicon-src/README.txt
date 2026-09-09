lexicon-src/ — human-editable lexicon sources. `node build-lexicon.mjs` compiles these into
lexicon.v1.json, which is the shipped artifact (Turkish rows stored \uXXXX-escaped, SPEC B.8).

Line format:  phrase | tag | domain | flags | note
  phrase  the literal string, written naturally. Turkish rows are folded with the tr locale by
          the build script, so write them normally (İstanbul, teşekkür) — never pre-fold by hand.
          A "…" inside a phrase means "allow up to 60 characters of intervening text".
  tag     strong | weak
  domain  general | cs | travel | email | marketing | essay | content | formal | tech
  flags   comma list, or "-" . Supported: initial (phrase must start a sentence/line)
  note    free text; shown as the confounder note when the row fires. Optional.

Lines starting with # and blank lines are ignored.
Language and kind come from the filename: en.txt / tr.txt are LLM-tell rows,
human-en.txt / human-tr.txt are human-tell rows.

SCOPE: English + Turkish only. Arabic is out of scope (HEAD-RULINGS R22); there is no ar.txt,
no human-ar.txt and no arabizi.txt in this build.
