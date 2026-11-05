"""The command line: `python -m jobtracker <command>`. Each command is one function below, listed in COMMANDS.

`sync` and `jobs` are what the scheduled task runs; `serve` is the dashboard; `connect` logs in to a mail account.
"""
from __future__ import annotations

import argparse
import os
import sys
from contextlib import closing

from . import db
from .profiles import Profiles
from .providers import get_provider
from .providers.base import NotConnected
from .sync import sync_all


def _discover(conn, force: bool = False, owner: str = "default", who: str = "") -> str:
    from .jobs.run import run_discovery

    r = run_discovery(conn, force=force, owner=owner, who=who)
    if r["skipped"]:
        return r["skipped"]
    return f"{r['feeds']} new from company feeds, {r['adzuna']} from Adzuna, notified about {r['notified']}"


class Context:
    """The parsed arguments and which profiles they apply to."""

    def __init__(self, args: argparse.Namespace, profiles: Profiles):
        self.args, self.profiles = args, profiles
        self.ids = [args.profile] if args.profile else profiles.ids()
        self.many = len(profiles.ids()) > 1

    def label(self, pid: str) -> str:
        return f"[{self.profiles.name(pid)}] " if self.many else ""

    def who(self, pid: str) -> str:
        return self.profiles.name(pid) if self.many else ""

    def open(self, pid: str):
        """The profile's database, closed when the `with` ends."""
        return closing(db.connect(self.profiles.db_path(pid)))


def cmd_profiles(ctx: Context) -> int:
    for r in ctx.profiles.list():
        print(f"{r['id']}  {r['name']}")
    return 0


def cmd_recheck(ctx: Context) -> int:
    from .recheck import recheck

    for pid in ctx.ids:
        with ctx.open(pid) as conn:
            r = recheck(conn)
        print(f"{ctx.label(pid)}checked {r['checked']} job emails: {r['cleared']} turned back into ordinary mail, {r['removed']} applications removed, "
              f"{r['settled']} review emails settled, {r['roles']} roles filled in")
    return 0


def cmd_connect(ctx: Context) -> int:
    pid = ctx.args.profile or ctx.ids[0]
    try:
        address = get_provider(ctx.args.provider, None, profile=pid).connect()
    except NotConnected as exc:
        print(exc, file=sys.stderr)
        return 1
    except Exception as exc:        # a closed login window, a timeout: a sentence, not a traceback
        print(f"Couldn't log in to {ctx.args.provider}: {exc}", file=sys.stderr)
        return 1
    with ctx.open(pid) as conn:
        db.upsert_account(conn, ctx.args.provider, address)
        conn.commit()
    print(f"Connected {ctx.args.provider}: {address}  ({ctx.profiles.name(pid)})")
    return 0


def cmd_sync(ctx: Context) -> int:
    failed = False
    for pid in ctx.ids:
        with ctx.open(pid) as conn:
            results = sync_all(conn, ctx.args.days, get_provider=lambda n, a, pid=pid: get_provider(n, a, profile=pid))
            for acct, outcome in results.items():
                print(f"{ctx.label(pid)}{acct}: {outcome}")
                failed |= isinstance(outcome, str)
            if not results:
                print(f"{ctx.label(pid)}No email account connected (run: python -m jobtracker connect gmail|outlook). Looking for jobs anyway.")
            print(f"{ctx.label(pid)}jobs:", _discover(conn, owner=pid, who=ctx.who(pid)))
    return 1 if failed else 0


def cmd_jobs(ctx: Context) -> int:
    for pid in ctx.ids:
        with ctx.open(pid) as conn:
            print(f"{ctx.label(pid)}{_discover(conn, force=True, owner=pid, who=ctx.who(pid))}")
    return 0


def cmd_notify(ctx: Context) -> int:
    from .jobs.notify import jobs_url, show_toast

    shown = show_toast("Job Tracker", "Notifications work. New matching jobs will show up like this.", jobs_url())
    print("Notification shown." if shown else "Windows wouldn't show a notification from here.")
    return 0 if shown else 1


def cmd_serve(ctx: Context) -> int:
    import uvicorn

    from .web import create_app

    # The pop-ups and the scheduled sync link to this port (see jobs.notify.jobs_url).
    os.environ["JOBTRACKER_PORT"] = str(ctx.args.port)
    # Under pythonw (the sign-in task) there is no console, and uvicorn's default log setup fails without one.
    quiet = sys.stdout is None or sys.stderr is None
    uvicorn.run(create_app(), host="127.0.0.1", port=ctx.args.port, log_config=None if quiet else uvicorn.config.LOGGING_CONFIG)
    return 0


def cmd_status(ctx: Context) -> int:
    for pid in ctx.ids:
        with ctx.open(pid) as conn:
            if ctx.many:
                print(f"== {ctx.profiles.name(pid)} ({pid})")
            for a in conn.execute("SELECT * FROM accounts"):
                state = "" if a["active"] else "  (disconnected)"
                print(f"{a['provider']}:{a['address']}{state}  last sync: {a['last_sync'] or 'never'}  error: {a['last_error'] or 'none'}")
            for r in conn.execute("SELECT stage, COUNT(*) n FROM applications GROUP BY stage ORDER BY n DESC"):
                print(f"  {r['stage']}: {r['n']}")
    return 0


COMMANDS = {
    "connect": cmd_connect, "sync": cmd_sync, "serve": cmd_serve, "status": cmd_status, "jobs": cmd_jobs,
    "profiles": cmd_profiles, "recheck": cmd_recheck, "notify": cmd_notify,
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jobtracker", description="Track job applications from your email.")
    parser.add_argument("--profile", help="Profile id to work on. Default: every profile for sync, jobs and status; the first for connect.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    connect = sub.add_parser("connect", help="Log in to a mail account (the app reads mail only; sending is turned on later in Settings)")
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
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    profiles = Profiles(db.DEFAULT_PATH.parent, db.DEFAULT_PATH)
    if args.profile and not profiles.exists(args.profile):
        print(f"No profile called {args.profile!r}. Profiles: {', '.join(profiles.ids())}")
        return 2
    return COMMANDS[args.cmd](Context(args, profiles))


if __name__ == "__main__":
    sys.exit(main())
