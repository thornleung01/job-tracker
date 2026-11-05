from __future__ import annotations

import argparse
import sys

from . import db
from .profiles import Profiles
from .providers import get_provider
from .sync import sync_all


def _discover(conn, force: bool = False, owner: str = "default", who: str = "") -> str:
    from .jobs.run import run_discovery

    r = run_discovery(conn, force=force, owner=owner, who=who)
    if r["skipped"]:
        return r["skipped"]
    return f"{r['feeds']} new from company feeds, {r['adzuna']} from Adzuna, notified about {r['notified']}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jobtracker", description="Track job applications from your email.")
    parser.add_argument("--profile", help="Profile id to work on. Default: every profile for sync, jobs and status; the first for connect.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    connect = sub.add_parser("connect", help="Log in to a mail account (read-only)")
    connect.add_argument("provider", choices=["gmail", "outlook"])

    sync = sub.add_parser("sync", help="Fetch new mail and update applications")
    sync.add_argument("--days", type=int, help="Look back this many days (default: since the last sync; a first sync uses the look-back set in Settings)")

    serve = sub.add_parser("serve", help="Run the dashboard on http://127.0.0.1:8765")
    serve.add_argument("--port", type=int, default=8765)

    sub.add_parser("status", help="Show connected accounts and application counts")
    sub.add_parser("jobs", help="Look for new matching jobs now (company feeds and Adzuna) and notify")
    sub.add_parser("profiles", help="List profiles")
    sub.add_parser("recheck", help="Re-run the current rules over stored job mail and undo what they no longer believe")
    notify_cmd = sub.add_parser("notify", help="Check that Windows notifications work")
    notify_cmd.add_argument("--test", action="store_true", required=True, help="Show a test notification")

    args = parser.parse_args(argv)
    profiles = Profiles(db.DEFAULT_PATH.parent, db.DEFAULT_PATH)
    if args.profile and not profiles.exists(args.profile):
        print(f"No profile called {args.profile!r}. Profiles: {', '.join(profiles.ids())}")
        return 2
    ids = [args.profile] if args.profile else profiles.ids()
    many = len(profiles.ids()) > 1

    def label(pid: str) -> str:
        return f"[{profiles.name(pid)}] " if many else ""

    def who(pid: str) -> str:
        return profiles.name(pid) if many else ""

    if args.cmd == "profiles":
        for r in profiles.list():
            print(f"{r['id']}  {r['name']}")
        return 0

    if args.cmd == "recheck":
        from .recheck import recheck

        for pid in ids:
            r = recheck(db.connect(profiles.db_path(pid)))
            print(f"{label(pid)}checked {r['checked']} job emails: {r['cleared']} turned back into ordinary mail, {r['removed']} applications removed, {r['settled']} review emails settled, {r['roles']} roles filled in")
        return 0

    if args.cmd == "connect":
        pid = args.profile or ids[0]
        conn = db.connect(profiles.db_path(pid))
        address = get_provider(args.provider, None, profile=pid).connect()
        db.upsert_account(conn, args.provider, address)
        conn.commit()
        print(f"Connected {args.provider}: {address}  ({profiles.name(pid)})")
        return 0

    if args.cmd == "sync":
        failed = False
        for pid in ids:
            conn = db.connect(profiles.db_path(pid))
            results = sync_all(conn, args.days, get_provider=lambda n, a, pid=pid: get_provider(n, a, profile=pid))
            for acct, outcome in results.items():
                print(f"{label(pid)}{acct}: {outcome}")
                failed |= isinstance(outcome, str)
            if not results:
                print(f"{label(pid)}No email account connected (run: python -m jobtracker connect gmail|outlook). Looking for jobs anyway.")
            print(f"{label(pid)}jobs:", _discover(conn, owner=pid, who=who(pid)))
        return 1 if failed else 0

    if args.cmd == "jobs":
        for pid in ids:
            conn = db.connect(profiles.db_path(pid))
            print(f"{label(pid)}{_discover(conn, force=True, owner=pid, who=who(pid))}")
        return 0

    if args.cmd == "notify":
        from .jobs.notify import jobs_url, show_toast

        shown = show_toast("Job Tracker", "Notifications work. New matching jobs will show up like this.", jobs_url())
        print("Notification shown." if shown else "Windows wouldn't show a notification from here.")
        return 0 if shown else 1

    if args.cmd == "serve":
        import uvicorn

        from .web import create_app

        # Under pythonw (the sign-in task) there is no console, and uvicorn's default log setup fails without one.
        quiet = sys.stdout is None or sys.stderr is None
        uvicorn.run(create_app(), host="127.0.0.1", port=args.port, log_config=None if quiet else uvicorn.config.LOGGING_CONFIG)
        return 0

    if args.cmd == "status":
        for pid in ids:
            conn = db.connect(profiles.db_path(pid))
            if many:
                print(f"== {profiles.name(pid)} ({pid})")
            for a in conn.execute("SELECT * FROM accounts"):
                state = "" if a["active"] else "  (disconnected)"
                print(f"{a['provider']}:{a['address']}{state}  last sync: {a['last_sync'] or 'never'}  error: {a['last_error'] or 'none'}")
            for r in conn.execute("SELECT stage, COUNT(*) n FROM applications GROUP BY stage ORDER BY n DESC"):
                print(f"  {r['stage']}: {r['n']}")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
