#!/usr/bin/env python3
"""First look at a Sentry issue: the newest unresolved one, or one named by its short id (FASTSTUDY-A),
with its latest event's exception, stack, tags, contexts and breadcrumbs. Read-only."""

import argparse
import configparser
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://us.sentry.io/api/0"
ORG = "prinz"
PROJECT = "faststudy"
TOKEN_URL = f"https://{ORG}.sentry.io/settings/account/api/auth-tokens/"


def die(msg):
    print("sentry.py: " + msg, file=sys.stderr)
    sys.exit(1)


def token():
    """SENTRY_AUTH_TOKEN wins; else sentry-cli's own ~/.sentryclirc, so one token serves both."""
    if os.environ.get("SENTRY_AUTH_TOKEN"):
        return os.environ["SENTRY_AUTH_TOKEN"]
    rc = configparser.ConfigParser()
    rc.read(os.path.expanduser("~/.sentryclirc"))
    t = rc.get("auth", "token", fallback=None)
    if not t:
        die(
            "no Sentry token. Create one (scopes event:read, project:read, org:read) at\n"
            f"  {TOKEN_URL}\nthen put it in ~/.sentryclirc:\n  [auth]\n  token=<token>"
        )
    return t


def get(path, **query):
    url = API + path + ("?" + urllib.parse.urlencode(query) if query else "")
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token()})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        if e.code == 401:
            die(f"token rejected (401) — create a new one at {TOKEN_URL}")
        if e.code == 404:
            return None
        die(f"GET {path} -> {e.code}: {body}")
    except urllib.error.URLError as e:
        die(f"GET {path} failed: {e.reason}")


def age(stamp):
    if not stamp:
        return "?"
    t = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    s = int((datetime.now(timezone.utc) - t).total_seconds())
    for unit, n in (("d", 86400), ("h", 3600), ("m", 60)):
        if s >= n:
            return f"{s // n}{unit} ago"
    return f"{s}s ago"


def find_issue(short_id, query):
    if short_id:
        hit = get(f"/organizations/{ORG}/shortids/{short_id.upper()}/")
        if not hit:
            die(f"no issue {short_id.upper()} in org {ORG}")
        return hit["group"]
    issues = get(
        f"/projects/{ORG}/{PROJECT}/issues/", query=query, sort="date", limit=1
    )
    if not issues:
        die(f"no issue in {PROJECT} matches {query!r}")
    return issues[0]


def print_issue(i):
    print(
        f"{i['shortId']}  {i.get('level', '?').upper()}  {i.get('status')}  {i['permalink']}"
    )
    print(f"  title:   {i['title']}")
    print(f"  culprit: {i.get('culprit') or '-'}")
    print(
        f"  events:  {i.get('count')}  users: {i.get('userCount')}"
        f"  first: {i.get('firstSeen')} ({age(i.get('firstSeen'))})"
        f"  last: {i.get('lastSeen')} ({age(i.get('lastSeen'))})"
    )
    first, last = i.get("firstRelease") or {}, i.get("lastRelease") or {}
    if first or last:
        print(
            f"  release: first {first.get('version', '?')}  last {last.get('version', '?')}"
        )


def frame_line(f):
    where = f.get("filename") or f.get("absPath") or f.get("module") or "?"
    mark = "" if f.get("inApp") else "  [lib]"
    s = f"    {where}:{f.get('lineNo') or '?'} in {f.get('function') or '?'}{mark}"
    code = next((c for n, c in f.get("context") or [] if n == f.get("lineNo")), None)
    return s + (f"\n        {code.strip()}" if code else "")


def print_exception(data):
    # Sentry orders the chain cause-first and frames oldest-first, like a Python traceback.
    for exc in data.get("values") or []:
        mech = (exc.get("mechanism") or {}).get("type")
        print(
            f"  {exc.get('type')}: {exc.get('value')}"
            + (f"  (mechanism: {mech})" if mech else "")
        )
        frames = ((exc.get("stacktrace") or {}).get("frames")) or []
        shown = [f for f in frames if f.get("inApp")] or frames[-8:]
        if frames and frames[-1] not in shown:
            shown.append(frames[-1])
        if len(shown) < len(frames):
            print(
                f"    ({len(frames) - len(shown)} library frames hidden; full JSON in --out)"
            )
        for f in shown:
            print(frame_line(f))


def print_event(e, crumbs):
    print(
        f"\nLATEST EVENT {e.get('eventID')}  {e.get('dateCreated')} ({age(e.get('dateCreated'))})"
    )
    tags = {t["key"]: t["value"] for t in e.get("tags") or []}
    print("  tags: " + "  ".join(f"{k}={v}" for k, v in sorted(tags.items())))
    for name, ctx in sorted((e.get("contexts") or {}).items()):
        vals = {
            k: v
            for k, v in ctx.items()
            if k != "type" and isinstance(v, (str, int, float, bool))
        }
        if vals:
            print(f"  {name}: " + "  ".join(f"{k}={v}" for k, v in vals.items()))
    entries = {en["type"]: en["data"] for en in e.get("entries") or []}
    if "message" in entries:
        print(
            "\nMESSAGE\n  "
            + str(entries["message"].get("formatted") or entries["message"])
        )
    if "exception" in entries:
        print("\nEXCEPTION")
        print_exception(entries["exception"])
    if "request" in entries:
        r = entries["request"]
        print(f"\nREQUEST  {r.get('method')} {r.get('url')}")
    bc = (entries.get("breadcrumbs") or {}).get("values") or []
    if bc:
        print(f"\nBREADCRUMBS (last {min(len(bc), crumbs)} of {len(bc)})")
        for b in bc[-crumbs:]:
            msg = b.get("message") or json.dumps(b.get("data") or {})
            print(
                f"  {(b.get('timestamp') or '')[11:19]} {b.get('level', ''):7} {b.get('category', '')}: {msg[:200]}"
            )
    extra = e.get("context") or {}
    if extra:
        print("\nEXTRA")
        for k, v in extra.items():
            print(f"  {k}: {json.dumps(v)[:300]}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "short_id", nargs="?", help="e.g. FASTSTUDY-A; omit for the newest issue"
    )
    p.add_argument(
        "--query",
        default="is:unresolved",
        help="issue search when no short id is given",
    )
    p.add_argument("--crumbs", type=int, default=20, help="breadcrumbs to print")
    p.add_argument(
        "--out",
        help="directory for issue.json and event.json (default: $TMPDIR/faststudy-sentry)",
    )
    args = p.parse_args()

    issue = find_issue(args.short_id, args.query)
    issue = get(f"/organizations/{ORG}/issues/{issue['id']}/") or issue
    event = get(f"/organizations/{ORG}/issues/{issue['id']}/events/latest/")
    print_issue(issue)
    if event:
        print_event(event, args.crumbs)
    else:
        print("\n(no event retained for this issue)")

    out = os.path.join(
        args.out or os.path.join(os.environ.get("TMPDIR", "/tmp"), "faststudy-sentry"),
        issue["shortId"],
    )
    os.makedirs(out, exist_ok=True)
    for name, obj in (("issue.json", issue), ("event.json", event)):
        with open(os.path.join(out, name), "w") as f:
            json.dump(obj, f, indent=1)
    print(f"\nsaved: {out}/issue.json {out}/event.json")


if __name__ == "__main__":
    main()
