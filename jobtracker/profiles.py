"""Profiles: each person (or purpose) gets their own mail accounts, applications, jobs, settings and sign-in tokens.

The first profile, "default", keeps using the original database and token files, so nothing existing moves.
Every other profile gets its own folder, which means one profile can never read or overwrite another's data
and removing one is just deleting its folder.
"""
from __future__ import annotations

import json
import re
import shutil
import threading
from pathlib import Path

from . import config
from .textutil import collapse_spaces

DEFAULT_ID = config.DEFAULT_PROFILE
MAX_PROFILES = 20
MAX_NAME = 40


class ProfileError(ValueError):
    """A message that is safe to show the user."""


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")[:30] or "profile"


class Profiles:
    def __init__(self, data_dir: Path, default_db: Path | str, secrets_dir: Path | None = None):
        self.data_dir = Path(data_dir)
        self.default_db = Path(default_db)
        self._secrets_dir = secrets_dir
        self._file = self.data_dir / "profiles.json"
        self._lock = threading.Lock()

    @property
    def secrets_dir(self) -> Path:
        return Path(self._secrets_dir or config.SECRETS_DIR)

    # -- registry ----------------------------------------------------------------------
    def list(self) -> list[dict]:
        try:
            rows = json.loads(self._file.read_text(encoding="utf-8")).get("profiles", [])
            rows = [{"id": str(r["id"]), "name": str(r["name"])} for r in rows if isinstance(r, dict) and r.get("id") and r.get("name")]
        except (OSError, ValueError, KeyError, AttributeError):
            rows = []
        if not any(r["id"] == DEFAULT_ID for r in rows):
            rows.insert(0, {"id": DEFAULT_ID, "name": "Me"})
        return rows

    def _save(self, rows: list[dict]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._file.with_suffix(".tmp")
        tmp.write_text(json.dumps({"profiles": rows}, indent=2), encoding="utf-8")
        tmp.replace(self._file)

    def ids(self) -> list[str]:
        return [r["id"] for r in self.list()]

    def exists(self, profile_id: str | None) -> bool:
        return bool(profile_id) and profile_id in self.ids()

    def name(self, profile_id: str) -> str:
        return next((r["name"] for r in self.list() if r["id"] == profile_id), profile_id)

    # -- where a profile's things live ---------------------------------------------------
    def db_path(self, profile_id: str) -> Path:
        if profile_id == DEFAULT_ID:
            return self.default_db
        return self.data_dir / "profiles" / profile_id / "tracker.db"

    def token_dir(self, profile_id: str) -> Path:
        return config.token_dir(profile_id, self.secrets_dir)

    # -- changes -----------------------------------------------------------------------
    @staticmethod
    def clean_name(name: str) -> str:
        name = collapse_spaces(name)
        if not name:
            raise ProfileError("Give the profile a name.")
        if len(name) > MAX_NAME:
            raise ProfileError(f"Keep the name to {MAX_NAME} characters or fewer.")
        return name

    def _check_unique(self, rows: list[dict], name: str, ignore: str = "") -> None:
        if any(r["name"].casefold() == name.casefold() and r["id"] != ignore for r in rows):
            raise ProfileError(f'There is already a profile called "{name}".')

    def create(self, name: str) -> str:
        name = self.clean_name(name)
        with self._lock:
            rows = self.list()
            if len(rows) >= MAX_PROFILES:
                raise ProfileError(f"You can have up to {MAX_PROFILES} profiles.")
            self._check_unique(rows, name)
            base, taken, n = slug(name), set(self.ids()), 1
            pid = base
            while pid in taken or pid == DEFAULT_ID:
                n += 1
                pid = f"{base}-{n}"
            self._save(rows + [{"id": pid, "name": name}])
        return pid

    def rename(self, profile_id: str, name: str) -> None:
        name = self.clean_name(name)
        with self._lock:
            rows = self.list()
            if not any(r["id"] == profile_id for r in rows):
                raise ProfileError("That profile doesn't exist.")
            self._check_unique(rows, name, ignore=profile_id)
            self._save([dict(r, name=name) if r["id"] == profile_id else r for r in rows])

    def delete(self, profile_id: str) -> None:
        """Remove a profile and everything stored for it: database, sign-in tokens, saved keys."""
        if profile_id == DEFAULT_ID:
            raise ProfileError("The first profile can't be deleted. Rename it instead.")
        with self._lock:
            rows = self.list()
            if not any(r["id"] == profile_id for r in rows):
                raise ProfileError("That profile doesn't exist.")
            self._save([r for r in rows if r["id"] != profile_id])
        # The id is a slug made here (letters, digits, hyphens), so these can only be this profile's own folders.
        for folder in (self.db_path(profile_id).parent, self.token_dir(profile_id)):
            shutil.rmtree(folder, ignore_errors=True)
