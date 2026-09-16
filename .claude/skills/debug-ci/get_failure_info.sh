#!/usr/bin/env bash
# One command that turns a failed GitHub Actions run into the whole debugging context:
# failing job and step, the error block, the Playwright roster, the artifact inventory,
# and the smoke run's launch-log tail. Read-only — it never dispatches, re-runs, or deletes.
set -uo pipefail

usage() {
  cat <<'EOF'
Usage: get_failure_info.sh [<run-id>|<workflow>] [--out <dir>] [--all-artifacts] [--max-mb <n>]

  <run-id>          a run's numeric id
  <workflow>        a workflow name ("CI", "Build and smoke-test", "publish"), whose
                    newest failed run is used
  (no argument)     the newest failed run in the repo

  --out <dir>       where logs and artifacts land (default: $TMPDIR/faststudy-ci/<run-id>)
  --all-artifacts   download every artifact, including the ~250 MB installers and the traces
  --max-mb <n>      artifact size cap in MB (default 25)
EOF
}

die() {
  echo "get_failure_info.sh: $*" >&2
  exit 1
}

TARGET=""
OUT=""
ALL_ARTIFACTS=0
MAX_MB=25
INVOKED_FROM=$PWD

while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --out)
      [ $# -ge 2 ] || die "--out needs a directory"
      OUT=$2
      shift 2
      ;;
    --all-artifacts)
      ALL_ARTIFACTS=1
      shift
      ;;
    --max-mb)
      [ $# -ge 2 ] || die "--max-mb needs a number"
      MAX_MB=$2
      shift 2
      ;;
    -*) die "unknown flag: $1" ;;
    *)
      [ -z "$TARGET" ] || die "at most one run id or workflow name"
      TARGET=$1
      shift
      ;;
  esac
done

# Both `gh api` and `gh run download` shell out to git to find the repo, so they die with
# "not a git repository" anywhere else — move into the repo rather than trusting $PWD.
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null) ||
  die "cannot find the git repo containing $SCRIPT_DIR"
cd "$REPO_ROOT" || die "cannot cd to $REPO_ROOT"

command -v gh >/dev/null 2>&1 || die "gh is not installed — see https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated — run: gh auth login"

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
[ -n "$REPO" ] || die "cannot resolve the GitHub repo for $REPO_ROOT"

# ---------------------------------------------------------------- resolve the run

if [[ $TARGET =~ ^[0-9]+$ ]]; then
  RUN_ID=$TARGET
else
  RUNS=$(gh run list --limit 100 \
    --json databaseId,name,status,conclusion,headBranch,event,createdAt,headSha 2>/dev/null) ||
    die "gh run list failed"
  RUN_ID=$(printf '%s' "$RUNS" | python3 -c '
import json, sys
want = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
runs = [r for r in json.load(sys.stdin) if want in r["name"].lower()]
failed = [r for r in runs if r["conclusion"] == "failure"]
print((failed or runs or [{"databaseId": ""}])[0]["databaseId"])' "$TARGET")
  [ -n "$RUN_ID" ] ||
    die "no run matching '${TARGET:-any failure}' in the last 100 — pass a run id explicitly"
fi

RUN=$(gh api "repos/$REPO/actions/runs/$RUN_ID" 2>/dev/null) ||
  die "no run $RUN_ID in $REPO — 'gh run list' shows the recent ones"

mapfile -t META < <(printf '%s' "$RUN" | python3 -c '
import json, sys
r = json.load(sys.stdin)
for k in ("name", "status", "conclusion", "head_branch", "event", "created_at", "head_sha", "html_url"):
    print(r.get(k) or "-")')
NAME=${META[0]} STATUS=${META[1]} CONCLUSION=${META[2]} BRANCH=${META[3]}
EVENT=${META[4]} CREATED=${META[5]} SHA=${META[6]} URL=${META[7]}

if [ -z "$OUT" ]; then
  OUT="${TMPDIR:-/tmp}/faststudy-ci/$RUN_ID"
elif [ "${OUT#/}" = "$OUT" ]; then
  OUT="$INVOKED_FROM/$OUT"
fi
mkdir -p "$OUT/logs" || die "cannot create $OUT"
OUT=$(cd "$OUT" && pwd)

echo "RUN $RUN_ID — $NAME"
echo "  $STATUS/$CONCLUSION on $BRANCH via $EVENT at $CREATED (${SHA:0:8})"
echo "  $URL"

[ "$STATUS" = "completed" ] ||
  die "run $RUN_ID is still '$STATUS' — wait for it to finish, then run this again"

# ---------------------------------------------------------------- jobs and steps

JOBS=$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs" 2>/dev/null) ||
  die "cannot read the jobs of run $RUN_ID"

echo
echo "JOBS"
printf '%s' "$JOBS" | python3 -c '
import json, sys
mark = {"success": "ok", "failure": "FAIL", "skipped": "-", "cancelled": "cancel"}
for j in json.load(sys.stdin)["jobs"]:
    c = j["conclusion"] or j["status"]
    print("  %6s  %s  (id %s)" % (mark.get(c, c), j["name"], j["id"]))
    for s in j.get("steps") or []:
        if s["conclusion"] in ("failure", "cancelled"):
            print("          %s step %s: %s" % (s["conclusion"], s["number"], s["name"]))'

if [ "$CONCLUSION" = "success" ]; then
  echo
  echo "This run SUCCEEDED — there is no failure to debug."
  exit 0
fi

FAILED_JOBS=$(printf '%s' "$JOBS" | python3 -c '
import json, sys
for j in json.load(sys.stdin)["jobs"]:
    if j["conclusion"] in ("failure", "cancelled"):
        print(j["id"], j["name"].replace(" ", "_"))')

# Strips the CR, the BOM, the ANSI colours and the ISO timestamp every Actions log line
# carries, so the saved log is greppable and a third cheaper to read.
normalize() {
  sed -e 's/\r$//' \
    -e 's/^\xef\xbb\xbf//' \
    -e 's/\x1b\[[0-9;]*[a-zA-Z]//g' \
    -e 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9:.]\{8,\}Z //'
}

# Drops node:test's passing subtests and their YAML diagnostics, which otherwise bury the one
# failing subtest. Playwright's roster is indented, so this leaves it untouched.
denoise() {
  awk '
    /^# Subtest: / { held = $0; next }
    /^ok [0-9]+ / { skipping = 1; held = ""; next }
    skipping && /^[[:space:]]/ { next }
    { skipping = 0; if (held) { print held; held = "" } print }'
}

# Prints at most $2 lines of $1, eliding the middle — a failure's opening and its last
# lines are both load-bearing, the repetition in between is not.
capped() {
  local file=$1 max=$2 n
  n=$(wc -l <"$file")
  if [ "$n" -le "$max" ]; then
    cat "$file"
  else
    head -n $((max / 2)) "$file"
    echo "    [... $((n - max)) lines elided — full block at $file ...]"
    tail -n $((max / 2)) "$file"
  fi
}

if [ -z "$FAILED_JOBS" ]; then
  echo
  echo "No job reports failure — the run failed before or between jobs (a startup failure,"
  echo "a cancellation, or a required check). Open $URL."
fi

while read -r JOB_ID JOB_NAME <&3; do
  [ -n "$JOB_ID" ] || continue
  LOG="$OUT/logs/$JOB_NAME-$JOB_ID.log"
  # `gh run view --log-failed` and `--job <id> --log` come back empty or truncated on this
  # repo's runs; the raw job-log API is the only path that reliably yields the whole text.
  gh api "repos/$REPO/actions/jobs/$JOB_ID/logs" 2>/dev/null | normalize >"$LOG"
  if [ ! -s "$LOG" ]; then
    echo
    echo "!! could not fetch the log for job $JOB_NAME ($JOB_ID) — see $URL/job/$JOB_ID"
    continue
  fi

  echo
  echo "======== JOB $JOB_NAME ($JOB_ID) — $(wc -l <"$LOG") log lines ========"

  # Playwright's list reporter prints a roster worth having whole; every other runner here
  # only gets its failure lines pulled out, since its passing output is pure noise.
  ROSTER="$OUT/logs/$JOB_NAME-roster.txt"
  grep -E '^[[:space:]]*(ok|x|-|°)[[:space:]]+[0-9]+[[:space:]]+\S+\.spec\.[jt]s' "$LOG" >"$ROSTER"
  [ -s "$ROSTER" ] || grep -E '^(not ok [0-9]|FAILED |# fail [1-9])' "$LOG" >"$ROSTER"
  if [ -s "$ROSTER" ]; then
    echo
    echo "--- TESTS ---"
    if [ "$(wc -l <"$ROSTER")" -le 40 ]; then
      cat "$ROSTER"
    else
      grep -vE '^[[:space:]]*ok[[:space:]]' "$ROSTER"
      echo "  ($(grep -cE '^[[:space:]]*ok[[:space:]]' "$ROSTER") passing tests omitted — full roster at $ROSTER)"
    fi
  else
    rm -f "$ROSTER"
  fi

  echo
  echo "--- ERRORS ---"
  grep -n '^##\[error\]' "$LOG" | head -20 | sed 's/^/  /'

  # The detailed block runs from the first test-runner failure marker (or 60 lines back) up to
  # the first ##[error] — that span is where a step's real diagnostic lives. A TAP `not ok`
  # reports the failure after the crash that caused it, so that anchor reaches back 30 lines.
  BLOCK="$OUT/logs/$JOB_NAME-error-block.txt"
  awk '
    { line[NR] = $0 }
    /^##\[error\]/ && !end { end = NR }
    !mark && /^[[:space:]]*1\)[[:space:]]/ { mark = NR }
    !mark && (/^not ok [0-9]/ || /^FAILED / || /=+ FAILURES =+/) { mark = NR; back = 30 }
    END {
      if (!end) end = NR
      start = (mark && mark < end && end - mark < 400) ? mark - back : end - 60
      if (start < 1) start = 1
      for (i = start; i <= end; i++) print line[i]
    }' "$LOG" | denoise >"$BLOCK"
  echo
  capped "$BLOCK" 90

  ANN=$(gh api "repos/$REPO/check-runs/$JOB_ID/annotations" --jq \
    '.[] | select(.annotation_level == "failure") | "  \(.path):\(.start_line) \(.message)"' 2>/dev/null)
  if [ -n "$ANN" ]; then
    echo
    echo "--- ANNOTATIONS ---"
    printf '%s\n' "$ANN" | head -30
  fi
done 3<<<"$FAILED_JOBS"

# ---------------------------------------------------------------- artifacts

ARTS=$(gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" 2>/dev/null)
echo
echo "--- ARTIFACTS ---"
# The inventory always prints in full, so the size cap is visible rather than silent.
printf '%s' "$ARTS" | MAX_MB="$MAX_MB" ALL="$ALL_ARTIFACTS" python3 -c '
import json, os, sys
cap, every = float(os.environ["MAX_MB"]) * 1024 * 1024, os.environ["ALL"] == "1"
arts = json.load(sys.stdin).get("artifacts", [])
if not arts:
    print("  (none)")
picked = []
for a in arts:
    if a["expired"]:
        why = "expired"
    # Traces are the bulk of a smoke failure and are never read from disk, so size alone would not
    # skip them — the digest lists them and --all-artifacts fetches them.
    elif a["name"] == "smoke-traces" and not every:
        why = "skipped, traces are only ever listed (--all-artifacts to fetch)"
    elif every or a["size_in_bytes"] <= cap:
        why = "downloading"
        picked.append(a["name"])
    else:
        why = "skipped, over the %s MB cap (--all-artifacts to fetch)" % os.environ["MAX_MB"]
    print("  %-20s %8.1f MB  %s" % (a["name"], a["size_in_bytes"] / 1048576, why))
open(sys.argv[1], "w").write("\n".join(picked))' "$OUT/logs/.artifacts"
DOWNLOAD=$(cat "$OUT/logs/.artifacts" 2>/dev/null)

for A in $DOWNLOAD; do
  DEST="$OUT/artifacts/$A"
  mkdir -p "$DEST"
  gh run download "$RUN_ID" -n "$A" -D "$DEST" >/dev/null 2>&1 ||
    echo "  !! failed to download $A"
done

# ---------------------------------------------------------------- the smoke artifact

# The text half of a smoke failure. `smoke-failure` is what runs from before the artifact split
# carry, and it holds the traces inside itself rather than in a second artifact.
SMOKE="$OUT/artifacts/smoke-logs"
[ -d "$SMOKE" ] || SMOKE="$OUT/artifacts/smoke-failure"
TRACES="$OUT/artifacts/smoke-traces"
[ -d "$TRACES" ] || TRACES="$SMOKE/traces"
if [ -d "$SMOKE/launch-logs" ]; then
  echo
  echo "--- SMOKE FAILURE ARTIFACT ---"
  echo "  launch logs: $(ls "$SMOKE"/launch-logs | tr '\n' ' ')"
  [ -d "$TRACES" ] && echo "  traces (list only, never extract): $(ls "$TRACES" | tr '\n' ' ')"

  for CTX in "$SMOKE"/*/error-context.md; do
    [ -f "$CTX" ] || continue
    DETAILS=$(awk '/^# Error details/ { on = 1; next } on && /^```/ { if (seen++) exit; next } on' "$CTX" | head -25)
    FIRST=$(printf '%s\n' "$DETAILS" | grep -m1 .)
    echo
    # Usually a verbatim repeat of the job log's error block — print it only when it says more.
    if [ -n "$FIRST" ] && grep -qF -- "$FIRST" "$OUT"/logs/*-error-block.txt 2>/dev/null; then
      echo "  $(basename "$(dirname "$CTX")")/error-context.md: the same error as the job log"
    else
      echo "  $(basename "$(dirname "$CTX")")/error-context.md:"
      printf '%s\n' "$DETAILS" | sed 's/^/    /'
    fi
  done

  # The highest-numbered launch is the one that failed, and its tail is usually the answer.
  LAST=$(ls "$SMOKE"/launch-logs/launch-*.log 2>/dev/null | sort -V | tail -1)
  if [ -n "$LAST" ]; then
    echo
    echo "  tail of $(basename "$LAST") — the failing launch:"
    tail -40 "$LAST" | sed 's/^/    /'
  fi
fi

# ---------------------------------------------------------------- where it all landed

echo
echo "--- SAVED ---"
find "$OUT" -maxdepth 4 -type f \( -name '*.log' -o -name '*.txt' -o -name '*.md' \) |
  sort | sed 's/^/  /'
echo "  (everything under $OUT)"
