"""Work that outlives a request: connecting an account (a login window the user must finish) and a sync.

Both run on a background thread and are looked up by profile, so the page can show where they are. Each tracker owns
its lock, so no route has to remember to take it. Times use `time.monotonic()`, which a clock change cannot disturb.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from .. import config


# -- connecting an account ------------------------------------------------------------------
@dataclass
class SignIn:
    state: str = "waiting"      # waiting, done or error
    started: float = field(default_factory=time.monotonic)
    message: str = ""


class SignIns:
    """Logins in progress or just finished, by (profile, provider). A finished one is reported once."""

    def __init__(self) -> None:
        self._items: dict[tuple[str, str], SignIn] = {}
        self._lock = threading.Lock()

    def start(self, profile: str, provider: str) -> bool:
        """False when that login window is already open and still within its time."""
        with self._lock:
            current = self._items.get((profile, provider))
            if current and current.state == "waiting" and time.monotonic() - current.started < config.SIGN_IN_WAIT:
                return False
            self._items[(profile, provider)] = SignIn()
            return True

    def finish(self, profile: str, provider: str, ok: bool, message: str) -> None:
        with self._lock:
            item = self._items.setdefault((profile, provider), SignIn())
            item.state, item.message = ("done" if ok else "error"), message

    def take_results(self, profile: str, providers: tuple[str, ...]) -> tuple[bool, str | None, str | None]:
        """(still waiting, notice, error) for this profile. A login that never reported back counts as failed once
        it is past its time, so the page cannot wait on it forever."""
        waiting, notice, error = False, None, None
        with self._lock:
            for provider in providers:
                item = self._items.get((profile, provider))
                if not item:
                    continue
                if item.state == "waiting" and time.monotonic() - item.started >= config.SIGN_IN_WAIT:
                    item.state, item.message = "error", f"Couldn't connect {provider.capitalize()}. The login window timed out. Try again."
                if item.state == "waiting":
                    waiting = True
                    continue
                del self._items[(profile, provider)]
                if item.state == "done":
                    notice = item.message
                else:
                    error = item.message
        return waiting, notice, error


# -- syncing ---------------------------------------------------------------------------------
@dataclass
class SyncRun:
    running: bool = True
    phase: str = "finding"      # finding, reading, jobs or done
    done: int = 0
    total: int | None = None
    account: str = ""
    note: str = ""
    message: str = ""           # the result sentence, shown once when the run is over
    failed: bool = False
    t0: float | None = None     # when the current account's reading began (monotonic), for the time left
    first_done: int = 0         # how many emails were already read when that clock started

    def update(self, **fields) -> None:
        if "account" in fields and fields["account"] != self.account:
            self.t0, self.first_done = None, 0            # a new account starts its own clock
        for name, value in fields.items():
            setattr(self, name, value)
        if fields.get("phase") == "reading" and fields.get("total") and self.t0 is None:
            self.t0, self.first_done = time.monotonic(), fields["done"]


class SyncRuns:
    """A sync in progress or just finished, by profile."""

    def __init__(self) -> None:
        self._runs: dict[str, SyncRun] = {}
        self._lock = threading.Lock()

    def start(self, profile: str) -> bool:
        """False when this profile is already syncing."""
        with self._lock:
            run = self._runs.get(profile)
            if run and run.running:
                return False
            self._runs[profile] = SyncRun()
            return True

    def report(self, profile: str, **fields) -> None:
        with self._lock:
            self._runs[profile].update(**fields)

    def finish(self, profile: str, message: str, failed: bool) -> None:
        with self._lock:
            self._runs[profile].update(running=False, phase="done", message=message, failed=failed, note="")

    def view(self, profile: str) -> dict:
        with self._lock:
            run = self._runs.get(profile)
            return sync_view(run) if run else {"running": False, "label": "", "percent": None, "eta": "", "note": ""}

    def progress_or_result(self, profile: str, flash_shown: bool) -> tuple[dict | None, str | None, str | None]:
        """(progress to show, notice, error). A finished run's result is returned once, and only when the page has no
        other message to show: it stays until a page that can show it asks."""
        with self._lock:
            run = self._runs.get(profile)
            if run and run.running:
                return sync_view(run), None, None
            if run and run.message and not flash_shown:
                message, run.message = run.message, ""
                return None, *((None, message) if run.failed else (message, None))
        return None, None, None


def _eta_text(seconds: float | None) -> str:
    if seconds is None:
        return "Estimating time left…"
    if seconds < 45:
        return "Less than a minute left"
    if seconds < 90:
        return "About 1 minute left"
    if seconds < 3600:
        return f"About {round(seconds / 60)} minutes left"
    hours, minutes = divmod(round(seconds / 60), 60)
    return f"About {hours} hour{'s' if hours != 1 else ''} {minutes} minute{'s' if minutes != 1 else ''} left"


def sync_view(run: SyncRun) -> dict:
    """What the progress bar shows for a sync's state: ready-made text, so the page only has to display it."""
    who = f"{run.account} · " if run.account else ""
    percent, eta = None, ""
    if run.phase == "reading":
        label = f"{who}Reading emails: {run.done} of {run.total}" if run.total else f"{who}Reading emails: {run.done} so far"
        if run.total:
            percent = min(100, round(100 * run.done / run.total))
            steps = run.done - run.first_done
            if run.t0 and steps >= 3:
                eta = _eta_text((time.monotonic() - run.t0) / steps * max(run.total - run.done, 0))
            else:
                eta = _eta_text(None)
    elif run.phase == "jobs":
        label = "Looking for new jobs…"
    else:
        label = f"{who}Finding your emails…"
    return {"running": run.running, "label": label, "percent": percent, "eta": eta, "note": run.note}
