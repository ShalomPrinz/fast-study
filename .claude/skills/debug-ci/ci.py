#!/usr/bin/env python3
"""First look at GitHub Actions runs: recent runs per commit, one run's jobs, logs, test roster and
artifacts, and a failed run's whole debugging context. Read-only — never dispatches, re-runs or deletes."""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

MARK = {
    "success": "ok",
    "failure": "FAIL",
    "skipped": "-",
    "cancelled": "cancel",
    "in_progress": "run",
    "queued": "queue",
}
# Placeholders gh fills from the git remote locally, saving a `gh repo view` round trip.
REPO = "repos/{owner}/{repo}"


def die(msg):
    print("ci.py: " + msg, file=sys.stderr)
    sys.exit(1)


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def gh_json(path):
    out = gh("api", path)
    return json.loads(out) if out else None


def die_gh(msg):
    # Checked only on a failed call: `gh auth status` is a network round trip every success would pay.
    if subprocess.run(["gh", "auth", "status"], capture_output=True).returncode != 0:
        die("gh is not authenticated — run: gh auth login")
    die(msg)


def parallel(*calls):
    with ThreadPoolExecutor(max_workers=max(len(calls), 1)) as pool:
        return [f.result() for f in [pool.submit(fn, *args) for fn, *args in calls]]


def contains(ref, sha):
    """Whether commit `sha` has `ref` in its history — so a rebased-then-pushed commit still counts."""
    rc = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ref, sha], capture_output=True
    ).returncode
    return {0: "yes", 1: "no"}.get(rc, "unknown locally")


def age(stamp):
    secs = (
        datetime.now(timezone.utc)
        - datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    ).total_seconds()
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60)):
        if secs >= size:
            return "%d%s" % (secs // size, unit)
    return "%ds" % secs


def list_runs(workflow, count, failed=False):
    """The newest `count` runs, of every workflow whose name contains `workflow` (case-insensitive)."""
    query = "?per_page=%d%s" % (min(count, 100), "&status=failure" if failed else "")
    if not workflow:
        paths = [REPO + "/actions/runs" + query]
    else:
        # Per-workflow endpoints: filtering the repo-wide list client-side would pull ~1.3 MB for 100 runs.
        flows = gh_json(REPO + "/actions/workflows")
        if flows is None:
            die_gh("gh cannot list the workflows of this repo")
        paths = [
            "%s/actions/workflows/%s/runs%s" % (REPO, w["id"], query)
            for w in flows["workflows"]
            if workflow.lower() in w["name"].lower()
        ]
    pages = parallel(*[(gh_json, path) for path in paths])
    if None in pages:
        die_gh("gh cannot list the runs of this repo")
    runs = sorted(
        (r for page in pages for r in page["workflow_runs"]),
        key=lambda r: r["created_at"],
        reverse=True,
    )
    return runs[:count]


# ---------------------------------------------------------------- runs


def cmd_runs(args):
    ref = subprocess.run(
        ["git", "rev-parse", "--verify", "-q", args.commit + "^{commit}"],
        capture_output=True,
        text=True,
    )
    if ref.returncode != 0:
        die("cannot resolve %s locally" % args.commit)
    sha = ref.stdout.strip()
    runs = list_runs(args.workflow, args.limit)
    if not runs:
        die("no run of a workflow matching '%s'" % args.workflow)
    verdicts = {s: contains(sha, s) for s in {r["head_sha"] for r in runs}}
    print("* built %s (%s)   ? sha not fetched locally" % (args.commit, sha[:8]))
    for r in runs:
        subject = (
            (r.get("head_commit") or {}).get("message") or r.get("display_title") or ""
        ).split("\n")[0]
        mark = {"yes": "*", "no": " "}.get(verdicts[r["head_sha"]], "?")
        state = "%s/%s" % (r["status"], r["conclusion"] or "-")
        print(
            "%s %s  %-22s %-20s %-10s %-17s %4s  %s  %s"
            % (
                mark,
                r["id"],
                r["name"][:22],
                state,
                r["head_branch"],
                r["event"],
                age(r["created_at"]),
                r["head_sha"][:8],
                subject,
            )
        )
    if "yes" not in verdicts.values():
        print("\nNo listed run built %s." % args.commit)


# ---------------------------------------------------------------- logs


# Strips the CR, the BOM, the ANSI colours and the ISO timestamp every Actions log line
# carries, so the saved log is greppable and a third cheaper to read.
NORMALIZE = [
    (re.compile(r"^\ufeff"), ""),
    (re.compile(r"\x1b\[[0-9;]*[a-zA-Z]"), ""),
    (re.compile(r"^\d{4}-\d{2}-\d{2}T[0-9:.]{8,}Z "), ""),
]


def fetch_log(job_id, path):
    # `gh run view --log-failed` and `--job <id> --log` come back empty or truncated on this
    # repo's runs; the raw job-log API is the only path that reliably yields the whole text.
    raw = gh("api", "%s/actions/jobs/%s/logs" % (REPO, job_id))
    lines = []
    for line in (raw or b"").decode("utf-8", "replace").split("\n"):
        line = line.rstrip("\r")
        for pat, sub in NORMALIZE:
            line = pat.sub(sub, line)
        lines.append(line)
    if lines and lines[-1] == "":
        lines.pop()
    write(path, lines)
    return lines


def denoise(lines):
    """Drops node:test's passing subtests and their YAML diagnostics, which otherwise bury the one
    failing subtest. Playwright's roster is indented, so this leaves it untouched."""
    out, held, skipping = [], None, False
    for line in lines:
        if line.startswith("# Subtest: "):
            held = line
        elif re.match(r"ok \d+ ", line):
            skipping, held = True, None
        elif skipping and re.match(r"\s", line):
            pass
        else:
            skipping = False
            if held:
                out.append(held)
                held = None
            out.append(line)
    return out


def capped(lines, path, max_lines):
    # A failure's opening and its last lines are both load-bearing, the repetition in between is not.
    if len(lines) <= max_lines:
        return lines
    half = max_lines // 2
    return (
        lines[:half]
        + [
            "    [... %d lines elided — full block at %s ...]"
            % (len(lines) - max_lines, path)
        ]
        + lines[-half:]
    )


def write(path, lines):
    with open(path, "w") as f:
        f.writelines(line + "\n" for line in lines)


def roster(lines, path):
    """Saves the job's test roster and returns the lines worth printing, or [] when it has none."""
    # Playwright's list reporter prints a roster worth having whole; every other runner here
    # only gets its failure lines pulled out, or its pass summary when nothing failed.
    for pat in (
        r"^\s*(ok|x|-|°)\s+\d+\s+\S+\.spec\.[jt]s",
        r"^(not ok \d|FAILED |# fail [1-9])",
        r"^(\d+ passed.* in [\d.]+s|\s*Tests\s+\d+ .*|# (pass|fail) \d+)$",
    ):
        found = [line for line in lines if re.search(pat, line)]
        if found:
            break
    else:
        return []
    write(path, found)
    if len(found) <= 40:
        return found
    passing = [line for line in found if re.match(r"\s*ok\s", line)]
    return [line for line in found if line not in passing] + [
        "  (%d passing tests omitted — full roster at %s)" % (len(passing), path)
    ]


def error_block(lines):
    """The span from the first test-runner failure marker (or 60 lines back) up to the first ##[error] —
    where a step's real diagnostic lives. A TAP `not ok` reports the failure after the crash that caused it,
    so that anchor reaches back 30 lines."""
    end = mark = None
    back = 0
    for n, line in enumerate(lines, 1):
        if end is None and line.startswith("##[error]"):
            end = n
        if mark is None and re.match(r"\s*1\)\s", line):
            mark = n
        if mark is None and (
            re.match(r"not ok \d|FAILED ", line) or re.search(r"=+ FAILURES =+", line)
        ):
            mark, back = n, 30
    end = end or len(lines)
    start = mark - back if mark and mark < end and end - mark < 400 else end - 60
    return denoise(lines[max(start, 1) - 1 : end])


def annotations(job_id):
    data = gh_json("%s/check-runs/%s/annotations" % (REPO, job_id)) or []
    text = "\n".join(
        "  %s:%s %s" % (a["path"], a["start_line"], a["message"])
        for a in data
        if a["annotation_level"] == "failure"
    )
    return text.split("\n")[:30] if text else []


def safe(name):
    return re.sub(r"[^\w.-]", "_", name)


# ---------------------------------------------------------------- artifacts


def plan_artifacts(arts, max_mb, every):
    """Pairs each artifact with what happens to it; "downloading" marks the ones to fetch."""
    plan = []
    for a in arts:
        if a["expired"]:
            why = "expired"
        # Traces are the bulk of a smoke failure and are never read from disk, so size alone would not
        # skip them — the digest lists them and --all-artifacts fetches them.
        elif a["name"] == "smoke-traces" and not every:
            why = "skipped, traces are only ever listed (--all-artifacts to fetch)"
        elif every or a["size_in_bytes"] <= max_mb * 1048576:
            why = "downloading"
        else:
            why = "skipped, over the %g MB cap (--all-artifacts to fetch)" % max_mb
        plan.append((a, why))
    return plan


def print_inventory(plan):
    # The inventory always prints in full, so the size cap is visible rather than silent.
    print("\n--- ARTIFACTS ---")
    if not plan:
        print("  (none)")
    for a, why in plan:
        print("  %-20s %8.1f MB  %s" % (a["name"], a["size_in_bytes"] / 1048576, why))


def download(run_id, name, out):
    dest = os.path.join(out, "artifacts", name)
    os.makedirs(dest, exist_ok=True)
    ok = (
        subprocess.run(
            ["gh", "run", "download", str(run_id), "-n", name, "-D", dest],
            capture_output=True,
        ).returncode
        == 0
    )
    return dest if ok else None


def smoke_section(out):
    # `smoke-failure` is what runs from before the artifact split carry, and it holds the traces
    # inside itself rather than in a second artifact.
    smoke = os.path.join(out, "artifacts", "smoke-logs")
    if not os.path.isdir(smoke):
        smoke = os.path.join(out, "artifacts", "smoke-failure")
    traces = os.path.join(out, "artifacts", "smoke-traces")
    if not os.path.isdir(traces):
        traces = os.path.join(smoke, "traces")
    launch_dir = os.path.join(smoke, "launch-logs")
    if not os.path.isdir(launch_dir):
        return
    print("\n--- SMOKE FAILURE ARTIFACT ---")
    print("  launch logs: " + " ".join(sorted(os.listdir(launch_dir))))
    if os.path.isdir(traces):
        print(
            "  traces (list only, never extract): "
            + " ".join(sorted(os.listdir(traces)))
        )

    blocks = ""
    logs = os.path.join(out, "logs")
    for name in os.listdir(logs):
        if name.endswith("-error-block.txt"):
            with open(os.path.join(logs, name)) as f:
                blocks += f.read()
    for sub in sorted(os.listdir(smoke)):
        ctx = os.path.join(smoke, sub, "error-context.md")
        if not os.path.isfile(ctx):
            continue
        details, on, fences = [], False, 0
        with open(ctx) as f:
            for line in f.read().split("\n"):
                if line.startswith("# Error details"):
                    on = True
                elif on and line.startswith("```"):
                    fences += 1
                    if fences > 1:
                        break
                elif on:
                    details.append(line)
        details = details[:25]
        first = next((line for line in details if line), "")
        # Usually a verbatim repeat of the job log's error block — print it only when it says more.
        if first and first in blocks:
            print("\n  %s/error-context.md: the same error as the job log" % sub)
        else:
            print("\n  %s/error-context.md:" % sub)
            print("\n".join("    " + line for line in details))

    # The highest-numbered launch is the one that failed, and its tail is usually the answer.
    launches = [
        n for n in os.listdir(launch_dir) if re.fullmatch(r"launch-\d+\.log", n)
    ]
    if launches:
        last = max(launches, key=lambda n: int(n[7:-4]))
        with open(os.path.join(launch_dir, last), errors="replace") as f:
            tail = f.read().split("\n")
        if tail and tail[-1] == "":
            tail.pop()
        print("\n  tail of %s — the failing launch:" % last)
        print("\n".join("    " + line for line in tail[-40:]))


def saved(out):
    print("\n--- SAVED ---")
    found = []
    for root, dirs, files in os.walk(out):
        # Matches `find -maxdepth 4`: files at most four levels under out.
        if root[len(out) :].count(os.sep) >= 3:
            dirs[:] = []
        found += [
            os.path.join(root, f) for f in files if f.endswith((".log", ".txt", ".md"))
        ]
    for path in sorted(found):
        print("  " + path)
    print("  (everything under %s)" % out)


# ---------------------------------------------------------------- run


def cmd_run(args):
    run_id = args.id
    if run_id is None:
        runs = list_runs(args.workflow, 1, args.failed)
        if not runs:
            die(
                "no %srun of a workflow matching '%s' — pass a run id explicitly"
                % ("failed " if args.failed else "", args.workflow or "")
            )
        run_id = runs[0]["id"]

    base = "%s/actions/runs/%s" % (REPO, run_id)
    run, jobs, arts = parallel(
        (gh_json, base), (gh_json, base + "/jobs"), (gh_json, base + "/artifacts")
    )
    if run is None:
        die_gh("no run %s in this repo — 'ci.py runs' shows the recent ones" % run_id)
    if jobs is None:
        die_gh("cannot read the jobs of run %s" % run_id)
    jobs = jobs["jobs"]
    arts = (arts or {}).get("artifacts", [])

    out = args.out or os.path.join(
        os.environ.get("TMPDIR", "/tmp"), "faststudy-ci", str(run_id)
    )
    os.makedirs(os.path.join(out, "logs"), exist_ok=True)

    sha, status, conclusion, url = (
        run["head_sha"],
        run["status"],
        run["conclusion"],
        run["html_url"],
    )
    print("RUN %s — %s" % (run_id, run["name"]))
    print(
        "  %s/%s on %s via %s at %s (%s)"
        % (
            status,
            conclusion or "-",
            run["head_branch"],
            run["event"],
            run["created_at"],
            sha[:8],
        )
    )
    print(
        "  contains HEAD: %s   contains origin/main: %s"
        % (contains("HEAD", sha), contains("origin/main", sha))
    )
    print("  " + url)

    print("\nJOBS")
    for j in jobs:
        c = j["conclusion"] or j["status"]
        print("  %6s  %s  (id %s)" % (MARK.get(c, c), j["name"], j["id"]))
        for s in j.get("steps") or []:
            if s["conclusion"] in ("failure", "cancelled"):
                print(
                    "          %s step %s: %s"
                    % (s["conclusion"], s["number"], s["name"])
                )
            elif s["status"] == "in_progress":
                print("          running step %s: %s" % (s["number"], s["name"]))

    if status != "completed":
        print(
            "\nStill %s — the above is a snapshot; run this again for a later one."
            % status
        )
        return
    if conclusion == "success":
        success(run_id, jobs, arts, out, args)
    else:
        digest(run_id, url, jobs, arts, out, args)
    saved(out)


def success(run_id, jobs, arts, out, args):
    done = [
        j for j in jobs if j["status"] == "completed" and j["conclusion"] != "skipped"
    ]
    paths = [
        os.path.join(out, "logs", "%s-%s.log" % (safe(j["name"]), j["id"]))
        for j in done
    ]
    with ThreadPoolExecutor(max_workers=len(done) + 4) as pool:
        logs = [pool.submit(fetch_log, j["id"], p) for j, p in zip(done, paths)]
        for j, log in zip(done, logs):
            tests = roster(
                log.result(),
                os.path.join(out, "logs", "%s-roster.txt" % safe(j["name"])),
            )
            if tests:
                print("\n--- TESTS: %s ---" % j["name"])
                print("\n".join(tests))
        plan = plan_artifacts(arts, args.max_mb, args.all_artifacts)
        print_inventory(plan)
        picked = [a["name"] for a, why in plan if why == "downloading"]
        for name, dest in zip(
            picked, pool.map(lambda n: download(run_id, n, out), picked)
        ):
            if not dest:
                print("  !! failed to download " + name)


def digest(run_id, url, jobs, arts, out, args):
    failed = [j for j in jobs if j["conclusion"] in ("failure", "cancelled")]
    if not failed:
        print(
            "\nNo job reports failure — the run failed before or between jobs (a startup failure,"
        )
        print("a cancellation, or a required check). Open %s." % url)

    plan = plan_artifacts(arts, args.max_mb, args.all_artifacts)
    picked = [a["name"] for a, why in plan if why == "downloading"]
    with ThreadPoolExecutor(max_workers=2 * len(failed) + len(picked) + 1) as pool:
        downloads = [pool.submit(download, run_id, n, out) for n in picked]
        fetched = [
            (
                j,
                pool.submit(
                    fetch_log,
                    j["id"],
                    os.path.join(out, "logs", "%s-%s.log" % (safe(j["name"]), j["id"])),
                ),
                pool.submit(annotations, j["id"]),
            )
            for j in failed
        ]
        for j, log, ann in fetched:
            name, lines = safe(j["name"]), log.result()
            if not lines:
                print(
                    "\n!! could not fetch the log for job %s (%s) — see %s/job/%s"
                    % (name, j["id"], url, j["id"])
                )
                continue
            print(
                "\n======== JOB %s (%s) — %d log lines ========"
                % (name, j["id"], len(lines))
            )
            tests = roster(lines, os.path.join(out, "logs", "%s-roster.txt" % name))
            if tests:
                print("\n--- TESTS ---")
                print("\n".join(tests))
            print("\n--- ERRORS ---")
            errors = [
                "  %d:%s" % (n, line)
                for n, line in enumerate(lines, 1)
                if line.startswith("##[error]")
            ]
            if errors:
                print("\n".join(errors[:20]))
            block_path = os.path.join(out, "logs", "%s-error-block.txt" % name)
            block = error_block(lines)
            write(block_path, block)
            print()
            print("\n".join(capped(block, block_path, 90)))
            notes = ann.result()
            if notes:
                print("\n--- ANNOTATIONS ---")
                print("\n".join(notes))
        print_inventory(plan)
        for name, dl in zip(picked, downloads):
            if not dl.result():
                print("  !! failed to download " + name)
    smoke_section(out)


# ---------------------------------------------------------------- artifacts


def cmd_artifacts(args):
    data = gh_json("%s/actions/runs/%s/artifacts" % (REPO, args.id))
    if data is None:
        die_gh("no run %s in this repo — 'ci.py runs' shows the recent ones" % args.id)
    arts = data.get("artifacts", [])
    print("ARTIFACTS of run %s" % args.id)
    if not arts:
        print("  (none)")
    for a in arts:
        print(
            "  %-20s %8.1f MB  %s"
            % (
                a["name"],
                a["size_in_bytes"] / 1048576,
                "expired" if a["expired"] else "",
            )
        )
    if not args.get:
        return
    out = args.out or os.path.join(
        os.environ.get("TMPDIR", "/tmp"), "faststudy-ci", str(args.id)
    )
    known = {a["name"] for a in arts if not a["expired"]}
    for name in args.get:
        if name not in known:
            print("  !! no unexpired artifact named " + name)
    names = [n for n in args.get if n in known]
    print()
    for name, dest in zip(
        names, parallel(*[(download, args.id, n, out) for n in names])
    ):
        print(
            "  %s -> %s" % (name, dest) if dest else "  !! failed to download " + name
        )


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("runs", help="recent runs, marking those that built a commit")
    r.add_argument("--workflow", help="case-insensitive substring of the workflow name")
    r.add_argument("--limit", type=int, default=15)
    r.add_argument(
        "--commit",
        default="HEAD",
        help="mark runs whose head contains this ref (default HEAD)",
    )

    r = sub.add_parser(
        "run", help="one run: jobs, then a snapshot, roster or failure digest by state"
    )
    r.add_argument("id", nargs="?", type=int)
    r.add_argument("--workflow", help="with no id, the newest run of this workflow")
    r.add_argument(
        "--failed", action="store_true", help="with no id, the newest failed run"
    )
    r.add_argument(
        "--out",
        help="where logs and artifacts land (default $TMPDIR/faststudy-ci/<run-id>)",
    )
    r.add_argument(
        "--all-artifacts",
        action="store_true",
        help="download every artifact, installers and traces included",
    )
    r.add_argument(
        "--max-mb", type=float, default=25, help="artifact size cap in MB (default 25)"
    )

    r = sub.add_parser(
        "artifacts", help="a run's artifact inventory; downloads only what --get names"
    )
    r.add_argument("id", type=int)
    r.add_argument("--get", nargs="+", action="extend", metavar="NAME")
    r.add_argument(
        "--out",
        help="downloads land in <out>/artifacts/<name> (default $TMPDIR/faststudy-ci/<run-id>)",
    )

    args = p.parse_args()
    if getattr(args, "out", None):
        args.out = os.path.abspath(args.out)

    # Both `gh api` and `gh run download` shell out to git to find the repo, so they die with
    # "not a git repository" anywhere else — move into the repo rather than trusting $PWD.
    here = os.path.dirname(os.path.abspath(__file__))
    top = subprocess.run(
        ["git", "-C", here, "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
    )
    if top.returncode != 0:
        die("cannot find the git repo containing " + here)
    os.chdir(top.stdout.strip())
    if not shutil.which("gh"):
        die("gh is not installed — see https://cli.github.com")

    {"runs": cmd_runs, "run": cmd_run, "artifacts": cmd_artifacts}[args.cmd](args)


if __name__ == "__main__":
    main()
