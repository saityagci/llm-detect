#!/bin/sh
# install.sh — install the llm-text-detector agent globally and point it at this repo.
# Zero dependencies. Does not touch git. Safe to re-run.
#
# HEAD-RULINGS R31(h): --dry-run is evaluated BEFORE the refusal branch and never exits
# non-zero; --help prints the usage block and nothing else (no stray script lines).

set -eu

usage() {
  cat <<'USAGE'
install.sh — install the llm-text-detector agent globally and point it at this repo.
Zero dependencies. Does not touch git. Safe to re-run.

  ./install.sh            install (refuses to clobber a differing agent file, exit 3)
  ./install.sh --force    overwrite an existing, differing agent file
  ./install.sh --dry-run  print what WOULD happen and exit 0 — always exit 0, even when a
                          real run would refuse. Combine with --force to preview an overwrite.
  ./install.sh --help     this text

Exit codes: 0 ok (including every --dry-run) · 1 unknown option · 2 missing agent source
            · 3 refused to overwrite a differing installed file · selftest's code if it fails.
USAGE
}

FORCE=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "install.sh: unknown option '$arg' (try --help)" >&2
      exit 1 ;;
  esac
done

# Absolute path of this repo, however install.sh was invoked.
REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SRC="$REPO/agent/llm-text-detector.md"
DEST_DIR="${HOME}/.claude/agents"
DEST="$DEST_DIR/llm-text-detector.md"

if [ ! -f "$SRC" ]; then
  echo "install.sh: missing $SRC" >&2
  exit 2
fi

echo "llm-detect installer"
echo "  repo:  $REPO"
echo "  agent: $SRC"
echo "  dest:  $DEST"
echo

# ---- 1. the agent file -------------------------------------------------------
# R31(h): the dry branch comes FIRST. A dry run reports what a real run would do — including
# that it would refuse — and still exits 0. Nothing below this point writes anything when DRY=1.
if [ "$DRY" -eq 1 ]; then
  if [ -f "$DEST" ] && cmp -s "$SRC" "$DEST"; then
    echo "[agent] (dry run) already installed and identical — would do nothing."
  elif [ -f "$DEST" ] && [ "$FORCE" -eq 0 ]; then
    echo "[agent] (dry run) $DEST exists and DIFFERS from the repo copy."
    echo "[agent] (dry run) a real run would REFUSE and exit 3; re-run with --force to overwrite."
    echo "[agent] (dry run) inspect the difference with:  diff \"$DEST\" \"$SRC\""
  elif [ -f "$DEST" ]; then
    echo "[agent] (dry run) would OVERWRITE $DEST (--force given; it differs from the repo copy)."
  else
    echo "[agent] (dry run) would copy the agent file to $DEST"
  fi
elif [ -f "$DEST" ] && cmp -s "$SRC" "$DEST"; then
  echo "[agent] already installed and identical — nothing to do."
elif [ -f "$DEST" ] && [ "$FORCE" -eq 0 ]; then
  echo "[agent] REFUSED: $DEST exists and differs from the repo copy." >&2
  echo "        Review the difference, then re-run with --force to overwrite:" >&2
  echo "          diff \"$DEST\" \"$SRC\"" >&2
  echo "          $0 --force" >&2
  exit 3
else
  if [ -f "$DEST" ]; then existed=1; else existed=0; fi
  mkdir -p "$DEST_DIR"
  cp "$SRC" "$DEST"
  if [ "$existed" -eq 1 ]; then
    echo "[agent] installed (overwrote the previous copy)."
  else
    echo "[agent] installed."
  fi
fi
echo

# ---- 2. the environment line -------------------------------------------------
echo "[env] The agent locates the tool through LLM_DETECT_HOME."
echo "      Add this line to your shell profile (~/.zshrc or ~/.bashrc):"
echo
echo "        export LLM_DETECT_HOME=$REPO"
echo
echo "      Without it the agent falls back to \$HOME/Desktop/llm-detect."
if [ "${LLM_DETECT_HOME:-}" = "$REPO" ]; then
  echo "      Current shell: LLM_DETECT_HOME already points here."
elif [ -n "${LLM_DETECT_HOME:-}" ]; then
  echo "      Current shell: LLM_DETECT_HOME=$LLM_DETECT_HOME (does NOT point here)."
else
  echo "      Current shell: LLM_DETECT_HOME is not set."
fi
echo

# ---- 3. selftest -------------------------------------------------------------
if [ -f "$REPO/selftest.mjs" ]; then
  if [ "$DRY" -eq 1 ]; then
    echo "[selftest] (dry run) would run: node selftest.mjs"
  else
    echo "[selftest] running: node selftest.mjs"
    if (cd "$REPO" && node selftest.mjs); then
      echo "[selftest] PASS (exit 0)"
    else
      rc=$?
      echo "[selftest] FAIL (exit $rc) — the agent is installed, but the CLI is not trustworthy yet." >&2
      exit "$rc"
    fi
  fi
else
  echo "[selftest] not present ($REPO/selftest.mjs) — skipped, nothing was verified."
fi
echo

echo "Done. Use it with:  \"use the llm-text-detector agent on <text|path>\""
