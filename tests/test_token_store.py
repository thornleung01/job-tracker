"""Saved sign-ins: encrypted with DPAPI on Windows, owner-only plain text elsewhere, and never a crash for lack of DPAPI."""
import json
import stat
import sys

import msal_extensions
import pytest

from jobtracker import config
from jobtracker.jobs import adzuna
from jobtracker.providers import base


def test_a_saved_sign_in_round_trips_and_clears_off_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    store = base.token_persistence("x.token", "me")
    with pytest.raises(FileNotFoundError):
        store.load()                       # never saved: the callers' "not connected" case
    store.save('{"a": 1}')
    assert base.token_persistence("x.token", "me").load() == '{"a": 1}'
    store.clear()
    store.clear()                          # clearing twice is fine
    with pytest.raises(FileNotFoundError):
        store.load()


@pytest.mark.skipif(sys.platform == "win32", reason="NTFS has no unix permission bits")
def test_the_fallback_file_is_readable_only_by_its_owner(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    store = base.token_persistence("x.token")
    store.save("secret")
    assert stat.S_IMODE(config.SECRETS_DIR.joinpath("x.token").stat().st_mode) == 0o600


def test_windows_uses_the_dpapi_store_and_other_platforms_do_not(monkeypatch):
    made = []

    class FakeDpapi(msal_extensions.FilePersistence):
        is_encrypted = True

        def __init__(self, location):
            made.append(location)
            super().__init__(location)

    monkeypatch.setattr(msal_extensions, "FilePersistenceWithDataProtection", FakeDpapi)
    monkeypatch.setattr(sys, "platform", "win32")
    assert base.token_persistence("w.token").is_encrypted and len(made) == 1
    monkeypatch.setattr(sys, "platform", "darwin")
    assert not base.token_persistence("m.token").is_encrypted and len(made) == 1


def test_msal_can_use_the_store_as_its_token_cache(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    cache = msal_extensions.PersistedTokenCache(base.token_persistence("outlook.token"))
    assert list(cache.search("AccessToken")) == []


def test_adzuna_keys_work_and_clear_without_dpapi(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    assert adzuna.load_credentials("me") is None
    adzuna.save_credentials("id", "key", "me")
    assert adzuna.load_credentials("me") == {"app_id": "id", "app_key": "key"}
    adzuna.clear_credentials("me")
    assert adzuna.load_credentials("me") is None


@pytest.mark.skipif(sys.platform != "win32", reason="real DPAPI exists only on Windows")
def test_on_windows_the_saved_file_is_encrypted():
    store = base.token_persistence("real.token")
    store.save(json.dumps({"refresh_token": "plain-marker"}))
    assert b"plain-marker" not in config.SECRETS_DIR.joinpath("real.token").read_bytes()
    assert json.loads(store.load())["refresh_token"] == "plain-marker"
    store.clear()
