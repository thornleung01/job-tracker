"""The Google credentials file is checked and rewritten before it is kept: sign-ins can only go to Google."""
import json
import stat
import sys

import pytest

from jobtracker import config
from jobtracker.providers import clients

GOOD = {"installed": {"client_id": "abc.apps.googleusercontent.com", "client_secret": "GOCSPX-x", "project_id": "my-project",
                      "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
                      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs", "redirect_uris": ["http://localhost"]}}


def save(info):
    clients.save_gmail(json.dumps(info).encode())
    return json.loads(clients.gmail_path().read_text())


def test_a_real_google_file_is_kept_with_only_what_signing_in_needs():
    kept = save(GOOD)["installed"]
    assert kept["client_id"] == GOOD["installed"]["client_id"] and kept["token_uri"] == clients.GOOGLE_TOKEN_URI
    assert set(kept) == {"client_id", "client_secret", "auth_uri", "token_uri", "redirect_uris", "project_id"}
    assert clients.gmail_ready()


def test_a_file_without_addresses_gets_googles_own():
    kept = save({"installed": {"client_id": "a", "client_secret": "b"}})["installed"]
    assert kept["auth_uri"] == clients.GOOGLE_AUTH_URI and kept["token_uri"] == clients.GOOGLE_TOKEN_URI


@pytest.mark.parametrize("field,value", [
    ("token_uri", "https://attacker.example/token"), ("auth_uri", "https://accounts.google.com.evil.example/o/oauth2/auth"),
    ("token_uri", "http://oauth2.googleapis.com/token"), ("auth_uri", ""),
])
def test_a_file_that_sends_sign_ins_elsewhere_is_refused_and_nothing_is_written(field, value):
    bad = json.loads(json.dumps(GOOD))
    bad["installed"][field] = value
    with pytest.raises(clients.ClientError, match="somewhere other than Google"):
        clients.save_gmail(json.dumps(bad).encode())
    assert not clients.gmail_path().exists()


@pytest.mark.parametrize("block", [{"client_id": ["x"], "client_secret": "y"}, {"client_id": "x", "client_secret": 5}, {"client_id": "", "client_secret": "y"}])
def test_ids_and_secrets_must_be_text(block):
    with pytest.raises(clients.ClientError, match="missing its client ID or secret"):
        clients.save_gmail(json.dumps({"installed": block}).encode())


@pytest.mark.skipif(sys.platform == "win32", reason="NTFS has no unix permission bits")
def test_credential_files_are_private_and_written_whole():
    save(GOOD)
    clients.save_outlook("1a2b3c4d-1234-5678-9abc-0123456789ab")
    for path in (clients.gmail_path(), clients.outlook_path()):
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert not list(config.SECRETS_DIR.glob("*.tmp"))
