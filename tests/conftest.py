import pytest

from jobtracker import config


@pytest.fixture(autouse=True)
def isolated_secrets(tmp_path, monkeypatch):
    """No test may read or write the real secrets folder (your Google credentials and sign-ins live there)."""
    monkeypatch.setattr(config, "SECRETS_DIR", tmp_path / "secrets-for-tests")
